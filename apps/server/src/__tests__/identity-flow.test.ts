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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { decodeTokenResponse, type PlatformMe } from '@maka/platform-protocol';
import { isAllowedDesktopRedirect } from '../identity/routes.js';
import { IdentityRefused } from '../identity/providers/types.js';
import { purgeExpiredSignIns } from '../identity/housekeeping.js';
import { REFRESH_RETRY_GRACE_MS } from '../identity/sessions.js';
import {
  browserSignIn,
  exchangeCode,
  LOOPBACK,
  PUBLIC_URL,
  refresh,
  startTestServer,
  type TestServer,
} from './support.js';

async function withServer(fn: (server: TestServer) => Promise<void>) {
  const server = await startTestServer();
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

async function signIn(server: TestServer, email = 'ada@relx.com', subject = 'relx-1') {
  const code = `code-${subject}-${server.clock.now.getTime()}`;
  server.relx.answers.set(code, { provider: 'relx-sso', subject, email, name: 'Ada' });
  const { redirect } = await browserSignIn(server, server.relx, code);
  const token = await exchangeCode(server, redirect.searchParams.get('code') ?? '');
  assert.equal(token.statusCode, 200, token.body);
  return decodeTokenResponse(token.json());
}

async function me(server: TestServer, accessToken: string) {
  return server.app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

test('a desktop signs in through the browser and gets tokens the server honours', async () => {
  await withServer(async (server) => {
    const code = 'relx-code';
    server.relx.answers.set(code, {
      provider: 'relx-sso',
      subject: 'u-1',
      email: 'Ada@RELX.com',
      name: 'Ada',
    });
    const { redirect } = await browserSignIn(server, server.relx, code);
    assert.equal(`${redirect.origin}${redirect.pathname}`, LOOPBACK);
    assert.equal(redirect.searchParams.get('state'), 'client-state');

    const tokens = decodeTokenResponse(
      (await exchangeCode(server, redirect.searchParams.get('code') ?? '')).json(),
    );
    assert.equal(tokens.expires_in, 900);
    assert.equal(tokens.refresh_expires_at, server.clock.now.getTime() + 7 * 24 * 3600 * 1000);

    const profile = (await me(server, tokens.access_token)).json() as PlatformMe;
    assert.equal(profile.email, 'ada@relx.com');
    assert.equal(profile.orgRole, 'member');

    // Anyone can check the token against the published keys.
    const jwks = (await server.app.inject({ method: 'GET', url: '/.well-known/jwks.json' })).json();
    const { payload } = await jwtVerify(tokens.access_token, createLocalJWKSet(jwks), {
      issuer: PUBLIC_URL,
      audience: 'maka-platform',
      currentDate: server.clock.now,
    });
    assert.equal(payload.sub, profile.id);

    const actions = (
      await server.db.selectFrom('audit_events').select('action').orderBy('id').execute()
    ).map((row) => row.action);
    assert.deepEqual(actions, ['user.created', 'session.created']);
  });
});

test('only loopback IP literals and the app scheme are accepted as redirects', () => {
  assert.equal(isAllowedDesktopRedirect('http://127.0.0.1:51234/callback'), true);
  assert.equal(isAllowedDesktopRedirect('http://[::1]:51234/callback'), true);
  assert.equal(isAllowedDesktopRedirect('maka://oauth/callback'), true);
  assert.equal(isAllowedDesktopRedirect('http://localhost:51234/callback'), false);
  assert.equal(isAllowedDesktopRedirect('http://127.0.0.1/callback'), false);
  assert.equal(isAllowedDesktopRedirect('https://evil.example/callback'), false);
  assert.equal(isAllowedDesktopRedirect('http://127.0.0.1:51234/cb#frag'), false);
});

test('a code is refused without its verifier, on a different redirect, twice, or late', async () => {
  await withServer(async (server) => {
    const codeFor = async (subject: string) => {
      server.relx.answers.set(subject, {
        provider: 'relx-sso',
        subject,
        email: `${subject}@relx.com`,
      });
      const { redirect } = await browserSignIn(server, server.relx, subject);
      return redirect.searchParams.get('code') ?? '';
    };
    const wrongVerifier = await exchangeCode(server, await codeFor('a'), {
      code_verifier: 'w'.repeat(43),
    });
    assert.equal(wrongVerifier.json().error, 'invalid_grant');

    const wrongRedirect = await exchangeCode(server, await codeFor('b'), {
      redirect_uri: 'http://127.0.0.1:9/other',
    });
    assert.equal(wrongRedirect.json().error, 'invalid_grant');

    const code = await codeFor('c');
    assert.equal((await exchangeCode(server, code)).statusCode, 200);
    assert.equal((await exchangeCode(server, code)).json().error, 'invalid_grant');

    const late = await codeFor('d');
    server.advance(61_000);
    assert.equal((await exchangeCode(server, late)).json().error, 'invalid_grant');

    const wrongClient = await exchangeCode(server, await codeFor('e'), {
      client_id: 'someone-else',
    });
    assert.equal(wrongClient.statusCode, 401);
  });
});

test('a refresh token rotates, and replaying an old one signs the device out', async () => {
  await withServer(async (server) => {
    const first = await signIn(server);
    const second = decodeTokenResponse((await refresh(server, first.refresh_token)).json());
    assert.notEqual(second.refresh_token, first.refresh_token);
    assert.equal(second.session_id, first.session_id);
    assert.equal(second.refresh_expires_at, first.refresh_expires_at);

    server.advance(REFRESH_RETRY_GRACE_MS + 1000);
    const replay = await refresh(server, first.refresh_token);
    assert.equal(replay.json().error, 'invalid_grant');
    // The whole session is gone, including the token that was legitimately next.
    assert.equal((await refresh(server, second.refresh_token)).json().error, 'invalid_grant');
    assert.equal((await me(server, second.access_token)).statusCode, 401);
    const session = await server.db
      .selectFrom('device_sessions')
      .select('revoke_reason')
      .where('id', '=', first.session_id)
      .executeTakeFirstOrThrow();
    assert.equal(session.revoke_reason, 'refresh_token_reuse');
  });
});

test('a refresh the desktop never got an answer to can be retried briefly, once its successor is unused', async () => {
  await withServer(async (server) => {
    const first = await signIn(server);
    // The answer to this exchange is lost on the way back.
    const lost = decodeTokenResponse((await refresh(server, first.refresh_token)).json());
    server.advance(10_000);
    const retried = await refresh(server, first.refresh_token);
    assert.equal(retried.statusCode, 200, retried.body);
    const next = decodeTokenResponse(retried.json());
    assert.equal(next.session_id, first.session_id);
    // The lost successor is retired unused; the session lives on.
    assert.equal((await refresh(server, lost.refresh_token)).json().error, 'invalid_grant');
    const fine = await refresh(server, next.refresh_token);
    assert.equal(fine.statusCode, 200, fine.body);

    // Once the successor has been used, the old token is a replay again.
    const replay = await refresh(server, first.refresh_token);
    assert.equal(replay.json().error, 'invalid_grant');
    const session = await server.db
      .selectFrom('device_sessions')
      .select('revoke_reason')
      .where('id', '=', first.session_id)
      .executeTakeFirstOrThrow();
    assert.equal(session.revoke_reason, 'refresh_token_reuse');
  });
});

test('no refresh outlives the provider sign-in by more than seven days', async () => {
  await withServer(async (server) => {
    let tokens = await signIn(server);
    for (let day = 1; day <= 6; day += 1) {
      server.advance(24 * 3600 * 1000);
      tokens = decodeTokenResponse((await refresh(server, tokens.refresh_token)).json());
    }
    server.advance(24 * 3600 * 1000 + 1000);
    assert.match((await refresh(server, tokens.refresh_token)).json().error_description, /expired/);
  });
});

test('an access token stops working after fifteen minutes', async () => {
  await withServer(async (server) => {
    const tokens = await signIn(server);
    server.advance(14 * 60 * 1000);
    assert.equal((await me(server, tokens.access_token)).statusCode, 200);
    server.advance(2 * 60 * 1000);
    assert.equal((await me(server, tokens.access_token)).statusCode, 401);
  });
});

test('a deactivated person is locked out at once and cannot sign in again', async () => {
  await withServer(async (server) => {
    const tokens = await signIn(server);
    await server.db.updateTable('users').set({ status: 'deactivated' }).execute();
    assert.equal((await me(server, tokens.access_token)).statusCode, 401);
    assert.match(
      (await refresh(server, tokens.refresh_token)).json().error_description,
      /deactivated/,
    );

    server.relx.answers.set('again', {
      provider: 'relx-sso',
      subject: 'relx-1',
      email: 'ada@relx.com',
    });
    const { redirect } = await browserSignIn(server, server.relx, 'again');
    assert.equal(redirect.searchParams.get('error'), 'access_denied');
    assert.equal(redirect.searchParams.get('error_description'), 'account_deactivated');
  });
});

test('one email is one person across providers, and a known subject keeps its account', async () => {
  await withServer(async (server) => {
    const viaRelx = await signIn(server, 'ada@relx.com', 'relx-1');
    server.google.answers.set('g', {
      provider: 'google',
      subject: 'google-9',
      email: 'ada@relx.com',
    });
    const { redirect } = await browserSignIn(server, server.google, 'g');
    const viaGoogle = decodeTokenResponse(
      (await exchangeCode(server, redirect.searchParams.get('code') ?? '')).json(),
    );
    const [first, second] = await Promise.all([
      me(server, viaRelx.access_token),
      me(server, viaGoogle.access_token),
    ]);
    assert.equal((first.json() as PlatformMe).id, (second.json() as PlatformMe).id);
    assert.equal(
      Number(
        (
          await server.db
            .selectFrom('users')
            .select((eb) => eb.fn.countAll().as('n'))
            .executeTakeFirstOrThrow()
        ).n,
      ),
      1,
    );

    // The provider renames the person: the subject still finds them.
    const renamed = await signIn(server, 'ada.lovelace@relx.com', 'relx-1');
    const profile = (await me(server, renamed.access_token)).json() as PlatformMe;
    assert.equal(profile.id, (first.json() as PlatformMe).id);
    assert.equal(profile.email, 'ada.lovelace@relx.com');
  });
});

test('an email outside the allowed domains cannot sign in or be created', async () => {
  const server = await startTestServer({ allowedEmailDomains: ['relx.com'] });
  try {
    server.relx.answers.set('x', {
      provider: 'relx-sso',
      subject: 'x',
      email: 'mallory@evil.example',
    });
    const { redirect } = await browserSignIn(server, server.relx, 'x');
    assert.equal(redirect.searchParams.get('error'), 'access_denied');
    assert.equal(redirect.searchParams.get('error_description'), 'domain_not_allowed');
    assert.equal((await server.db.selectFrom('users').select('id').execute()).length, 0);

    server.google.answers.set('y', new IdentityRefused('email_not_verified', 'no'));
    const refused = await browserSignIn(server, server.google, 'y');
    assert.equal(refused.redirect.searchParams.get('error_description'), 'email_not_verified');
  } finally {
    await server.close();
  }
});

test('a provider callback already registered under another path is served there', async () => {
  // Reusing relx-copilot's registration: Google comes back to /auth/google/callback.
  const server = await startTestServer(
    {},
    { googleCallbackUrl: `${PUBLIC_URL}/auth/google/callback` },
  );
  try {
    server.google.answers.set('g', { provider: 'google', subject: 'g', email: 'g@relx.com' });
    const authorize = await server.app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      query: {
        client_id: 'maka-desktop',
        response_type: 'code',
        redirect_uri: LOOPBACK,
        code_challenge: 'c'.repeat(43),
        code_challenge_method: 'S256',
        state: 's',
        provider: 'google',
      },
    });
    const toGoogle = new URL(String(authorize.headers.location));
    assert.equal(toGoogle.searchParams.get('redirect_uri'), `${PUBLIC_URL}/auth/google/callback`);
    const back = await server.app.inject({
      method: 'GET',
      url: '/auth/google/callback',
      query: { code: 'g', state: toGoogle.searchParams.get('state') ?? '' },
    });
    assert.equal(back.statusCode, 302);
    assert.ok(new URL(String(back.headers.location)).searchParams.get('code'));
  } finally {
    await server.close();
  }
});

test('without a domain list, the identity providers alone decide who signs in', async () => {
  const server = await startTestServer({ allowedEmailDomains: [] });
  try {
    server.google.answers.set('g', {
      provider: 'google',
      subject: 'g',
      email: 'grace@elsevier.com',
    });
    const { redirect } = await browserSignIn(server, server.google, 'g');
    const tokens = await exchangeCode(server, redirect.searchParams.get('code') ?? '');
    assert.equal(tokens.statusCode, 200);
  } finally {
    await server.close();
  }
});

test('nothing accepts an email from the client: the relx-copilot impersonation route does not exist', async () => {
  await withServer(async (server) => {
    const attempt = await server.app.inject({
      method: 'POST',
      url: '/api/v1/auth/sso/callback',
      payload: { provider: 'enterprise', sub: 'x', email: 'boss@relx.com' },
    });
    assert.equal(attempt.statusCode, 404);
    assert.equal((await server.db.selectFrom('users').select('id').execute()).length, 0);
  });
});

test('a bootstrap admin email becomes an org admin on first sign-in', async () => {
  await withServer(async (server) => {
    const tokens = await signIn(server, 'boss@relx.com', 'boss');
    assert.equal(
      ((await me(server, tokens.access_token)).json() as PlatformMe).orgRole,
      'org_admin',
    );
  });
});

test('signing out revokes the device', async () => {
  await withServer(async (server) => {
    const tokens = await signIn(server);
    const revoke = await server.app.inject({
      method: 'POST',
      url: '/oauth/revoke',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `token=${encodeURIComponent(tokens.refresh_token)}`,
    });
    assert.equal(revoke.statusCode, 200);
    assert.equal((await me(server, tokens.access_token)).statusCode, 401);
    assert.equal((await refresh(server, tokens.refresh_token)).json().error, 'invalid_grant');
  });
});

test('a sign-in callback is honoured once and expires', async () => {
  await withServer(async (server) => {
    server.relx.answers.set('once', { provider: 'relx-sso', subject: 's', email: 's@relx.com' });
    const authorize = await server.app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      query: {
        client_id: 'maka-desktop',
        response_type: 'code',
        redirect_uri: LOOPBACK,
        code_challenge: 'c'.repeat(43),
        code_challenge_method: 'S256',
        state: 's',
      },
    });
    const link = /href="(\/login\/relx-sso\/start\?txn=[^"]+)"/.exec(authorize.body)?.[1] ?? '';
    const start = await server.app.inject({ method: 'GET', url: link });
    const state = new URL(String(start.headers.location)).searchParams.get('state') ?? '';
    const callback = () =>
      server.app.inject({
        method: 'GET',
        url: '/login/relx-sso/callback',
        query: { code: 'once', state },
      });
    assert.equal((await callback()).statusCode, 302);
    assert.equal((await callback()).statusCode, 400);

    const stale = await server.app.inject({ method: 'GET', url: link });
    assert.equal(stale.statusCode, 400, 'a consumed transaction cannot start again');
  });
});

test('an authorize request without PKCE goes back to the app with an error', async () => {
  await withServer(async (server) => {
    const response = await server.app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      query: {
        client_id: 'maka-desktop',
        response_type: 'code',
        redirect_uri: LOOPBACK,
        state: 's',
      },
    });
    assert.equal(response.statusCode, 302);
    assert.equal(
      new URL(String(response.headers.location)).searchParams.get('error'),
      'invalid_request',
    );
    const foreign = await server.app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      query: { client_id: 'maka-desktop', redirect_uri: 'https://evil.example/cb' },
    });
    assert.equal(foreign.statusCode, 400, 'never redirects to an unvetted address');
  });
});

test('a desktop older than the minimum version is told to upgrade', async () => {
  const server = await startTestServer({ minimumClientVersion: '0.3.0' });
  try {
    const old = await server.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-maka-client-version': '0.2.9' },
    });
    assert.equal(old.statusCode, 426);
    assert.deepEqual(old.json().error, {
      code: 'upgrade_required',
      message: 'Update Maka to 0.3.0 or later',
      minimumClientVersion: '0.3.0',
    });
    const current = await server.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-maka-client-version': '0.3.0' },
    });
    assert.equal(current.statusCode, 401);
  } finally {
    await server.close();
  }
});

test('a provider named by the desktop skips the chooser; an unknown one falls back to it', async () => {
  await withServer(async (server) => {
    const authorize = (provider: string) =>
      server.app.inject({
        method: 'GET',
        url: '/oauth/authorize',
        query: {
          client_id: 'maka-desktop',
          response_type: 'code',
          redirect_uri: LOOPBACK,
          code_challenge: 'c'.repeat(43),
          code_challenge_method: 'S256',
          state: 's',
          provider,
        },
      });
    const direct = await authorize('google');
    assert.equal(direct.statusCode, 302);
    const toGoogle = new URL(String(direct.headers.location));
    assert.equal(toGoogle.host, 'idp.test');
    assert.equal(toGoogle.pathname, '/google/authorize');
    // The state sent straight to the provider is honoured by its callback.
    server.google.answers.set('g', { provider: 'google', subject: 'g', email: 'g@relx.com' });
    const callback = await server.app.inject({
      method: 'GET',
      url: '/login/google/callback',
      query: { code: 'g', state: toGoogle.searchParams.get('state') ?? '' },
    });
    assert.ok(new URL(String(callback.headers.location)).searchParams.get('code'));

    const unknown = await authorize('facebook');
    assert.equal(unknown.statusCode, 200);
    assert.match(unknown.body, /\/login\/relx-sso\/start/);
  });
});

test('the server describes itself', async () => {
  await withServer(async (server) => {
    const metadata = (
      await server.app.inject({ method: 'GET', url: '/.well-known/maka-platform' })
    ).json();
    assert.deepEqual(metadata.identityProviders, [
      { id: 'relx-sso', displayName: 'RELX SSO' },
      { id: 'google', displayName: 'Google' },
    ]);
    assert.equal(metadata.tokenEndpoint, `${PUBLIC_URL}/oauth/token`);
    assert.equal((await server.app.inject({ method: 'GET', url: '/healthz' })).json().ok, true);
  });
});

test('a second person the same provider knows under a taken email is refused, not handed the account', async () => {
  await withServer(async (server) => {
    const ada = await signIn(server, 'ada@relx.com', 'relx-old');
    await server.db.updateTable('users').set({ org_role: 'org_admin' }).execute();
    // The mailbox now belongs to someone new at RELX SSO.
    server.relx.answers.set('newcomer', {
      provider: 'relx-sso',
      subject: 'relx-new',
      email: 'ada@relx.com',
    });
    const { redirect } = await browserSignIn(server, server.relx, 'newcomer');
    assert.equal(redirect.searchParams.get('error_description'), 'identity_conflict');
    const links = await server.db.selectFrom('identity_links').select('subject').execute();
    assert.deepEqual(
      links.map((link) => link.subject),
      ['relx-old'],
    );
    const conflict = await server.db
      .selectFrom('audit_events')
      .select('action')
      .where('action', '=', 'identity.conflict')
      .execute();
    assert.equal(conflict.length, 1);
    // The person already there is untouched.
    assert.equal((await me(server, ada.access_token)).statusCode, 200);
  });
});

test('a deactivated account gains no new sign-in link while it is refused', async () => {
  await withServer(async (server) => {
    await signIn(server, 'ada@relx.com', 'relx-1');
    await server.db.updateTable('users').set({ status: 'deactivated' }).execute();
    server.google.answers.set('g', { provider: 'google', subject: 'g-1', email: 'ada@relx.com' });
    const { redirect } = await browserSignIn(server, server.google, 'g');
    assert.equal(redirect.searchParams.get('error_description'), 'account_deactivated');
    const links = await server.db.selectFrom('identity_links').select('provider').execute();
    assert.deepEqual(
      links.map((link) => link.provider),
      ['relx-sso'],
    );
  });
});

test('a code redeemed twice revokes the session it bought', async () => {
  await withServer(async (server) => {
    server.relx.answers.set('c', { provider: 'relx-sso', subject: 'c', email: 'c@relx.com' });
    const { redirect } = await browserSignIn(server, server.relx, 'c');
    const code = redirect.searchParams.get('code') ?? '';
    const first = decodeTokenResponse((await exchangeCode(server, code)).json());
    assert.equal((await exchangeCode(server, code)).json().error, 'invalid_grant');
    assert.equal((await me(server, first.access_token)).statusCode, 401);
    const session = await server.db
      .selectFrom('device_sessions')
      .select('revoke_reason')
      .where('id', '=', first.session_id)
      .executeTakeFirstOrThrow();
    assert.equal(session.revoke_reason, 'code_reuse');
  });
});

test('signing out is in the audit log', async () => {
  await withServer(async (server) => {
    const tokens = await signIn(server);
    await server.app.inject({
      method: 'POST',
      url: '/oauth/revoke',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        token: tokens.refresh_token,
        client_id: 'maka-desktop',
      }).toString(),
    });
    const events = await server.db
      .selectFrom('audit_events')
      .select(['action', 'target_id'])
      .where('action', '=', 'session.revoked')
      .execute();
    assert.deepEqual(events, [{ action: 'session.revoked', target_id: tokens.session_id }]);
  });
});

test('expired sign-in leftovers are purged after a day', async () => {
  await withServer(async (server) => {
    await signIn(server);
    await server.app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      query: {
        client_id: 'maka-desktop',
        response_type: 'code',
        redirect_uri: LOOPBACK,
        code_challenge: 'x'.repeat(43),
        code_challenge_method: 'S256',
        state: 's',
      },
    });
    assert.deepEqual(await purgeExpiredSignIns(server.ctx), { transactions: 0, refreshTokens: 0 });
    server.advance(8 * 24 * 60 * 60 * 1000 + 1);
    const purged = await purgeExpiredSignIns(server.ctx);
    assert.equal(purged.transactions, 2);
    assert.equal(purged.refreshTokens, 1);
  });
});

test('a registered callback path under /login/ other than the default is served too', async () => {
  const server = await startTestServer({}, { googleCallbackUrl: `${PUBLIC_URL}/login/google/cb` });
  try {
    server.google.answers.set('g', { provider: 'google', subject: 'g', email: 'g@relx.com' });
    const authorize = await server.app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      query: {
        client_id: 'maka-desktop',
        response_type: 'code',
        redirect_uri: LOOPBACK,
        code_challenge: 'c'.repeat(43),
        code_challenge_method: 'S256',
        state: 's',
        provider: 'google',
      },
    });
    const toGoogle = new URL(String(authorize.headers.location));
    const back = await server.app.inject({
      method: 'GET',
      url: '/login/google/cb',
      query: { code: 'g', state: toGoogle.searchParams.get('state') ?? '' },
    });
    assert.equal(back.statusCode, 302);
  } finally {
    await server.close();
  }
});
