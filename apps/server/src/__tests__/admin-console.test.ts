/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type {
  ConsoleAuditPage,
  ConsoleQuotas,
  ConsoleUsageReport,
  ConsoleUser,
  ConsoleUserDetail,
} from '../admin-console/types.js';
import { consoleReturnPath } from '../admin-console/sign-in.js';
import {
  browserSignIn,
  consoleCall,
  consoleSignIn,
  exchangeCode,
  PUBLIC_URL,
  refresh,
  startTestServer,
  type TestServer,
} from './support.js';

const BOSS = 'boss@relx.com';

async function withServer(
  run: (server: TestServer) => Promise<void>,
  options: Parameters<typeof startTestServer>[1] = {},
): Promise<void> {
  const server = await startTestServer({}, options);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

/** A desktop signed in as `email`; returns its refresh token. */
async function desktop(server: TestServer, email: string): Promise<string> {
  const code = `desk-${email}-${Math.random()}`;
  server.google.answers.set(code, { provider: 'google', subject: email, email });
  const { redirect } = await browserSignIn(server, server.google, code);
  const exchanged = await exchangeCode(server, redirect.searchParams.get('code') ?? '');
  return (exchanged.json() as { refresh_token: string }).refresh_token;
}

async function userId(server: TestServer, email: string): Promise<string> {
  const row = await server.db
    .selectFrom('users')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  return row.id;
}

test('an administrator signs in to the console and keeps a scoped, HttpOnly cookie', async () => {
  await withServer(async (server) => {
    const start = await server.app.inject({ method: 'GET', url: '/admin/login/google' });
    assert.equal(start.statusCode, 302);
    const state = new URL(String(start.headers.location)).searchParams.get('state');
    // The sign-in is tied to this browser, for the callback only.
    const binding = String([start.headers['set-cookie']].flat()[0]);
    assert.match(binding, /^maka_admin_login=/);
    assert.match(binding, /HttpOnly/);
    assert.match(binding, /Path=\/login\/google\/callback/);
    server.google.answers.set('c1', { provider: 'google', subject: 'boss', email: BOSS });
    const callback = await server.app.inject({
      method: 'GET',
      url: '/login/google/callback',
      query: { code: 'c1', state: state ?? '' },
      headers: { cookie: binding.split(';')[0]! },
    });
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, '/admin/');
    const cookies = [callback.headers['set-cookie']].flat().map(String);
    assert.ok(
      cookies.some((value) => /^maka_admin_login=;/.test(value)),
      'the binding is spent',
    );
    const cookie = cookies.find((value) => value.startsWith('maka_admin='))!;
    assert.match(cookie, /^maka_admin=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\/admin/);
    // The test server's address is https: the cookie never travels in the clear.
    assert.match(cookie, /Secure/);

    const session = await server.app.inject({
      method: 'GET',
      url: '/admin/api/session',
      headers: { cookie: cookie.split(';')[0]! },
    });
    assert.equal(session.statusCode, 200);
    const body = session.json() as {
      user: { email: string };
      csrfToken: string;
      serverUrl: string;
    };
    assert.equal(body.user.email, BOSS);
    assert.equal(body.serverUrl, PUBLIC_URL);
    assert.ok(body.csrfToken.length >= 40);
    // Only the hash is kept.
    const stored = await server.db.selectFrom('admin_sessions').select('token_hash').execute();
    assert.equal(stored.length, 1);
    assert.equal(cookie.includes(stored[0]!.token_hash), false);
    const audit = await server.db.selectFrom('audit_events').select('action').execute();
    assert.ok(audit.some((row) => row.action === 'admin.signed_in'));
  });
});

test('someone who is not an administrator goes back to the sign-in page with the reason, and no cookie', async () => {
  await withServer(async (server) => {
    await assert.rejects(
      consoleSignIn(server, server.google, 'member@relx.com', { next: '/admin/models' }),
      (error) => {
        const failure = error as { refusal?: string; location?: string; cookies?: string[] };
        return (
          failure.refusal === 'not_admin' &&
          failure.location === '/admin/login?error=not_admin&next=%2Fadmin%2Fmodels' &&
          !(failure.cookies ?? []).some((value) => value.startsWith('maka_admin='))
        );
      },
    );
    assert.equal((await server.db.selectFrom('admin_sessions').selectAll().execute()).length, 0);
    const refused = await server.db
      .selectFrom('audit_events')
      .select('action')
      .where('action', '=', 'admin.signin_refused')
      .execute();
    assert.equal(refused.length, 1);
  });
});

test('a sign-in completes only in the browser that started it', async () => {
  await withServer(async (server) => {
    // The provider's callback link, opened somewhere else.
    await assert.rejects(
      consoleSignIn(server, server.google, BOSS, { otherBrowser: true }),
      (error) => (error as { refusal?: string }).refusal === 'expired',
    );
    assert.equal((await server.db.selectFrom('admin_sessions').selectAll().execute()).length, 0);
    await consoleSignIn(server, server.google, BOSS);
  });
});

test('a return path is resolved as the browser will, and kept inside the console', async () => {
  assert.equal(consoleReturnPath('/admin/models?tab=routes'), '/admin/models?tab=routes');
  assert.equal(consoleReturnPath('/admin/张'), '/admin/%E5%BC%A0');
  for (const outside of [
    '/admin/../v1/me',
    '/admin/x/../api/users',
    '/admin/api/users',
    '/admin/login?next=/admin/',
    '//evil.example/admin/',
    '/\\evil.example/admin/',
    'https://evil.example/admin/',
    'admin/models',
    42,
  ]) {
    assert.equal(consoleReturnPath(outside), '/admin/', String(outside));
  }
  await withServer(async (server) => {
    // Written as typed, not encoded: it still lands there.
    const boss = await consoleSignIn(server, server.google, BOSS, { next: '/admin/张' });
    assert.ok(boss.cookie);
  });
});

test('the sign-in page needs no session; a provider leads to it, and a return path stays inside the console', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maka-console-'));
  try {
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>console</title>');
    await withServer(
      async (server) => {
        const page = await server.app.inject({ method: 'GET', url: '/admin/login' });
        assert.equal(page.statusCode, 200);
        assert.match(page.body, /<title>console<\/title>/);
        assert.match(String(page.headers['content-security-policy']), /script-src 'self'/);

        const start = await server.app.inject({
          method: 'GET',
          url: '/admin/login/google',
          query: { next: '/admin/models' },
        });
        assert.equal(start.statusCode, 302);
        assert.match(String(start.headers.location), /^https:\/\/idp\.test\/google\/authorize/);
        const unknown = await server.app.inject({
          method: 'GET',
          url: '/admin/login/nobody',
          query: { next: '//evil.example/admin/' },
        });
        assert.equal(unknown.headers.location, '/admin/login');

        // Signed in already: on to where the page was asked to go.
        const boss = await consoleSignIn(server, server.google, BOSS, { next: '/admin/models' });
        const again = await server.app.inject({
          method: 'GET',
          url: '/admin/login',
          query: { next: '/admin/usage' },
          headers: { cookie: boss.cookie },
        });
        assert.equal(again.headers.location, '/admin/usage');
      },
      { consoleDir: dir },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('without a session the API says so and the page sends the browser to sign in', async () => {
  await withServer(async (server) => {
    // The server's own address leads to the console.
    const home = await server.app.inject({ method: 'GET', url: '/' });
    assert.equal(home.statusCode, 302);
    assert.equal(home.headers.location, '/admin/');
    const api = await server.app.inject({ method: 'GET', url: '/admin/api/users' });
    assert.equal(api.statusCode, 401);
    const page = await server.app.inject({ method: 'GET', url: '/admin/members' });
    assert.equal(page.statusCode, 302);
    assert.equal(page.headers.location, '/admin/login?next=%2Fadmin%2Fmembers');
    // A desktop's bearer token is not a console session.
    const refreshToken = await desktop(server, BOSS);
    const tokens = (await refresh(server, refreshToken)).json() as { access_token: string };
    const withToken = await server.app.inject({
      method: 'GET',
      url: '/admin/api/users',
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    assert.equal(withToken.statusCode, 401);
  });
});

test('a change needs the CSRF token and, when the browser says, this origin', async () => {
  await withServer(async (server) => {
    const boss = await consoleSignIn(server, server.google, BOSS);
    const change = (headers: Record<string, string>) =>
      server.app.inject({
        method: 'PUT',
        url: '/admin/api/quotas/default/week',
        headers: { cookie: boss.cookie, 'content-type': 'application/json', ...headers },
        payload: JSON.stringify({ limit: 100 }),
      });
    assert.equal((await change({})).statusCode, 403);
    assert.equal((await change({ 'x-maka-csrf': 'guess' })).statusCode, 403);
    assert.equal(
      (await change({ 'x-maka-csrf': boss.csrfToken, origin: 'https://evil.example' })).statusCode,
      403,
    );
    assert.equal(
      (await change({ 'x-maka-csrf': boss.csrfToken, origin: PUBLIC_URL })).statusCode,
      200,
    );
    assert.equal((await change({ 'x-maka-csrf': boss.csrfToken })).statusCode, 200);
    // The page sends JSON; a form post is not the page.
    assert.equal(
      (
        await server.app.inject({
          method: 'PUT',
          url: '/admin/api/quotas/default/week',
          headers: {
            cookie: boss.cookie,
            'x-maka-csrf': boss.csrfToken,
            'content-type': 'application/x-www-form-urlencoded',
          },
          payload: 'limit=100',
        })
      ).statusCode,
      415,
    );
  });
});

test('unlinking a sign-in method also signs out the console sessions it began', async () => {
  await withServer(async (server) => {
    const boss = await consoleSignIn(server, server.google, BOSS);
    await consoleSignIn(server, server.google, 'ops@relx.com').catch(() => undefined);
    const opsId = await userId(server, 'ops@relx.com');
    await consoleCall(server, boss, 'PATCH', `/users/${opsId}`, { orgRole: 'org_admin' });
    const ops = await consoleSignIn(server, server.google, 'ops@relx.com');
    assert.equal((await consoleCall(server, ops, 'GET', '/users')).statusCode, 200);
    const unlinked = await consoleCall(server, boss, 'DELETE', `/users/${opsId}/links/google`);
    assert.equal(unlinked.statusCode, 200);
    assert.equal((await consoleCall(server, ops, 'GET', '/users')).statusCode, 401);
    assert.equal((await consoleCall(server, boss, 'GET', '/users')).statusCode, 200);
  });
});

test('a session ends after twelve hours, at sign-out, and the moment its holder stops being an administrator', async () => {
  await withServer(async (server) => {
    const boss = await consoleSignIn(server, server.google, BOSS);
    const second = await consoleSignIn(server, server.google, 'ops@relx.com').catch(
      () => undefined,
    );
    assert.equal(second, undefined, 'ops is a member until promoted');
    const opsId = await userId(server, 'ops@relx.com');
    assert.equal(
      (await consoleCall(server, boss, 'PATCH', `/users/${opsId}`, { orgRole: 'org_admin' }))
        .statusCode,
      200,
    );
    const ops = await consoleSignIn(server, server.google, 'ops@relx.com');
    assert.equal((await consoleCall(server, ops, 'GET', '/users')).statusCode, 200);
    // Demoted, even by something other than the console: out at once, not
    // when the session would have ended.
    await server.db
      .updateTable('users')
      .set({ org_role: 'member' })
      .where('id', '=', opsId)
      .execute();
    assert.equal((await consoleCall(server, ops, 'GET', '/users')).statusCode, 401);

    const signOut = await consoleCall(server, boss, 'POST', '/session/sign-out', {});
    assert.equal(signOut.statusCode, 200);
    assert.match(String([signOut.headers['set-cookie']].flat()[0]), /maka_admin=;/);
    assert.equal((await consoleCall(server, boss, 'GET', '/users')).statusCode, 401);

    const again = await consoleSignIn(server, server.google, BOSS);
    server.advance(12 * 60 * 60 * 1000 + 1);
    assert.equal((await consoleCall(server, again, 'GET', '/users')).statusCode, 401);
  });
});

test('people: listed with their devices, searched, promoted, and never left without an administrator', async () => {
  await withServer(async (server) => {
    const boss = await consoleSignIn(server, server.google, BOSS);
    const aliceRefresh = await desktop(server, 'alice@relx.com');
    await desktop(server, 'bob@relx.com');
    const list = (await consoleCall(server, boss, 'GET', '/users')).json() as ConsoleUser[];
    assert.deepEqual(
      list.map((user) => [user.email, user.orgRole, user.activeDevices]),
      [
        ['alice@relx.com', 'member', 1],
        ['bob@relx.com', 'member', 1],
        [BOSS, 'org_admin', 0],
      ],
    );
    const found = (
      await consoleCall(server, boss, 'GET', '/users?query=ALI')
    ).json() as ConsoleUser[];
    assert.deepEqual(
      found.map((user) => user.email),
      ['alice@relx.com'],
    );

    // Nobody removes their own access, and the last administrator stays one.
    const bossId = await userId(server, BOSS);
    const self = await consoleCall(server, boss, 'PATCH', `/users/${bossId}`, {
      orgRole: 'member',
    });
    assert.equal(self.statusCode, 409);
    const aliceId = await userId(server, 'alice@relx.com');
    await consoleCall(server, boss, 'PATCH', `/users/${aliceId}`, { orgRole: 'org_admin' });
    const alice = await consoleSignIn(server, server.google, 'alice@relx.com');
    await consoleCall(server, alice, 'PATCH', `/users/${bossId}`, { status: 'deactivated' });
    const last = await consoleCall(server, alice, 'PATCH', `/users/${aliceId}`, {
      orgRole: 'member',
    });
    assert.equal(last.statusCode, 409);
    assert.match((last.json() as { error: { message: string } }).error.message, /own|at least one/);

    // Deactivated: every desktop and the console are signed out.
    const bobId = await userId(server, 'bob@relx.com');
    const detail = (
      await consoleCall(server, alice, 'PATCH', `/users/${bobId}`, { status: 'deactivated' })
    ).json() as ConsoleUserDetail;
    assert.equal(detail.status, 'deactivated');
    assert.equal(detail.activeDevices, 0);
    assert.equal(detail.devices[0]?.revokeReason, 'account_deactivated');
    // Boss was deactivated above: out of the console at once.
    assert.equal((await consoleCall(server, boss, 'GET', '/users')).statusCode, 401);

    const aliceDetail = (
      await consoleCall(server, alice, 'GET', `/users/${aliceId}`)
    ).json() as ConsoleUserDetail;
    assert.deepEqual(
      aliceDetail.links.map((link) => link.provider),
      ['google'],
    );
    assert.deepEqual(
      aliceDetail.quotas.map((quota) => [quota.period, quota.limit, quota.source]),
      [
        ['week', null, 'none'],
        ['month', null, 'none'],
      ],
    );
    // Signing one desktop out: its refresh token stops working.
    const deviceId = aliceDetail.devices[0]!.id;
    const revoked = await consoleCall(
      server,
      alice,
      'POST',
      `/users/${aliceId}/devices/${deviceId}/revoke`,
      {},
    );
    assert.equal(revoked.statusCode, 200);
    assert.equal((await refresh(server, aliceRefresh)).statusCode, 400);
    assert.equal((await consoleCall(server, alice, 'GET', '/users/not-a-uuid')).statusCode, 404);
  });
});

test('allowances: the default, a person of their own, and removing either', async () => {
  await withServer(async (server) => {
    const boss = await consoleSignIn(server, server.google, BOSS);
    await desktop(server, 'alice@relx.com');
    const aliceId = await userId(server, 'alice@relx.com');
    await consoleCall(server, boss, 'PUT', '/quotas/default/week', { limit: 500 });
    await consoleCall(server, boss, 'PUT', '/quotas/default/month', { limit: 1500 });
    const own = await consoleCall(server, boss, 'PUT', `/quotas/users/${aliceId}/week`, {
      limit: 2000,
    });
    const quotas = own.json() as ConsoleQuotas;
    assert.deepEqual(quotas.defaults, { week: 500, month: 1500 });
    assert.deepEqual(quotas.users, [
      {
        userId: aliceId,
        email: 'alice@relx.com',
        // No name from the provider: the email's local part.
        name: 'alice',
        limits: { week: 2000, month: null },
      },
    ]);
    const detail = (
      await consoleCall(server, boss, 'GET', `/users/${aliceId}`)
    ).json() as ConsoleUserDetail;
    assert.deepEqual(
      detail.quotas.map((quota) => [quota.period, quota.limit, quota.source]),
      [
        ['week', 2000, 'user'],
        ['month', 1500, 'default'],
      ],
    );
    const removed = await consoleCall(server, boss, 'PUT', '/quotas/default/month', {
      limit: null,
    });
    assert.deepEqual((removed.json() as ConsoleQuotas).defaults, { week: 500, month: null });
    assert.equal(
      (await consoleCall(server, boss, 'PUT', '/quotas/default/day', { limit: 1 })).statusCode,
      400,
    );
    assert.equal(
      (await consoleCall(server, boss, 'PUT', '/quotas/default/week', { limit: -1 })).statusCode,
      400,
    );
  });
});

test('the usage report sums the window by person and by model; the audit log pages newest first', async () => {
  await withServer(async (server) => {
    const boss = await consoleSignIn(server, server.google, BOSS);
    await desktop(server, 'alice@relx.com');
    const aliceId = await userId(server, 'alice@relx.com');
    const at = (daysAgo: number) =>
      new Date(server.clock.now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const usage = (
      daysAgo: number,
      units: number,
      status: 'ok' | 'error' | 'cancelled' = 'ok',
    ) => ({
      id: randomUUID(),
      cost_weight: 1,
      at: at(daysAgo),
      user_id: aliceId,
      session_id: null,
      model_id: 'm_sonnet',
      model_provider_id: randomUUID(),
      quality: 'reported' as const,
      api_protocol: 'anthropic-messages' as const,
      input_tokens: 100,
      output_tokens: 20,
      cache_write_tokens: 0,
      cache_read_tokens: 50,
      weighted_units: units,
      status,
      http_status: status === 'ok' ? 200 : 500,
      latency_ms: 10,
      client_version: '0.2.0',
      upstream_request_id: null,
    });
    // A person's own stop is counted, but is not a failure.
    const records = [usage(1, 10), usage(2, 5.5, 'error'), usage(3, 0, 'cancelled'), usage(40, 99)];
    await server.db.insertInto('model_usage').values(records).execute();
    const report = (
      await consoleCall(server, boss, 'GET', '/usage?days=30')
    ).json() as ConsoleUsageReport;
    assert.equal(report.totals.requests, 3);
    assert.equal(report.totals.errors, 1);
    assert.equal(report.totals.units, 15.5);
    assert.equal(report.totals.cacheReadTokens, 150);
    assert.deepEqual(
      report.byUser.map((row) => [row.email, row.units]),
      [['alice@relx.com', 15.5]],
    );
    assert.deepEqual(
      report.byModel.map((row) => [row.modelId, row.requests]),
      [['m_sonnet', 3]],
    );
    assert.equal((await consoleCall(server, boss, 'GET', '/usage?days=0')).statusCode, 400);

    for (let index = 0; index < 105; index += 1) {
      await consoleCall(server, boss, 'PUT', '/quotas/default/week', { limit: index });
    }
    const first = (await consoleCall(server, boss, 'GET', '/audit')).json() as ConsoleAuditPage;
    assert.equal(first.entries.length, 100);
    assert.equal(first.entries[0]?.action, 'quota.set');
    assert.equal(first.entries[0]?.actor?.email, BOSS);
    assert.equal(first.entries[0]?.detail.limit, 104);
    assert.equal(first.entries[0]?.detail.via, 'admin-console');
    assert.ok(first.nextBefore);
    const rest = (
      await consoleCall(server, boss, 'GET', `/audit?before=${first.nextBefore}`)
    ).json() as ConsoleAuditPage;
    assert.ok(rest.entries.every((entry) => Number(entry.id) < Number(first.nextBefore)));
    assert.equal(
      (await consoleCall(server, boss, 'GET', '/audit?before=9999999999999999999')).statusCode,
      400,
    );
    const signIns = (
      await consoleCall(server, boss, 'GET', '/audit?action=admin.')
    ).json() as ConsoleAuditPage;
    assert.deepEqual(
      signIns.entries.map((entry) => entry.action),
      ['admin.signed_in'],
    );
  });
});

test('the page is served to an administrator with a strict policy; its assets are immutable and fenced in', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maka-console-'));
  try {
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><title>console</title>');
    await writeFile(join(dir, 'assets', 'app-1234.js'), 'console.log(1)');
    await withServer(
      async (server) => {
        const boss = await consoleSignIn(server, server.google, BOSS);
        const page = await server.app.inject({
          method: 'GET',
          url: '/admin/members/abc',
          headers: { cookie: boss.cookie },
        });
        assert.equal(page.statusCode, 200);
        assert.match(page.body, /<title>console<\/title>/);
        assert.match(String(page.headers['content-security-policy']), /script-src 'self'/);
        assert.equal(page.headers['x-frame-options'], 'DENY');
        assert.equal(page.headers['cache-control'], 'no-store');
        const asset = await server.app.inject({ method: 'GET', url: '/admin/assets/app-1234.js' });
        assert.equal(asset.statusCode, 200);
        assert.match(String(asset.headers['content-type']), /javascript/);
        assert.match(String(asset.headers['cache-control']), /immutable/);
        const escape = await server.app.inject({
          method: 'GET',
          url: '/admin/assets/..%2Findex.html',
        });
        assert.equal(escape.statusCode, 404);
        // An address the server does not have: a page for a browser, JSON for a program.
        const lost = await server.app.inject({
          method: 'GET',
          url: '/nowhere/at-all',
          headers: { accept: 'text/html,application/xhtml+xml' },
        });
        assert.equal(lost.statusCode, 404);
        assert.match(lost.body, /<title>console<\/title>/);
        const lostProgram = await server.app.inject({ method: 'GET', url: '/nowhere/at-all' });
        assert.equal(lostProgram.statusCode, 404);
        assert.equal((lostProgram.json() as { error: { code: string } }).error.code, 'not_found');
        const lostApi = await server.app.inject({
          method: 'GET',
          url: '/v1/nothing',
          headers: { accept: 'text/html' },
        });
        assert.equal((lostApi.json() as { error: { code: string } }).error.code, 'not_found');
        const unknownApi = await consoleCall(server, boss, 'GET', '/nothing');
        assert.equal(unknownApi.statusCode, 404);
        assert.equal((unknownApi.json() as { error: { code: string } }).error.code, 'not_found');
      },
      { consoleDir: dir },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
