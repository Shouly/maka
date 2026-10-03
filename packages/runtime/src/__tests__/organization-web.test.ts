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
import { OrganizationAccountUnavailableError } from '../organization-model-fetch.js';
import { fetchThroughOrganization, searchThroughOrganization } from '../organization-web.js';

const ACCOUNT = { serverUrl: 'https://org.example', accessToken: 'token', clientVersion: '1.0.0' };

type Account = Parameters<typeof searchThroughOrganization>[0]['account'];

const search = (fetchFn: typeof fetch, account: Account = async () => ACCOUNT) =>
  searchThroughOrganization({ account, fetchFn, request: { query: 'maka' } });

test('a refused token whose refresh brings no new one reads as signed out', async () => {
  let refreshes = 0;
  const result = await search(
    async () =>
      Response.json(
        { error: { code: 'unauthenticated', message: 'Sign in again' } },
        { status: 401 },
      ),
    async () => {
      refreshes += 1;
      return ACCOUNT;
    },
  );
  assert.equal(refreshes, 2, 'one refresh, which handed back the same token');
  assert.deepEqual(result, {
    ok: false,
    reason: 'not_signed_in',
    message: 'Sign in to the organization account in Maka to use the web.',
  });
});

test('a refused token is refreshed once and the search sent again with the new one', async () => {
  const sent: string[] = [];
  let token = 0;
  const result = await search(
    async (_url, init) => {
      const authorization = new Headers(init?.headers).get('authorization') ?? '';
      sent.push(authorization);
      return authorization === 'Bearer token-1'
        ? Response.json({
            results: [{ title: 'Maka', url: 'https://maka.example/a', snippet: 'About Maka' }],
          })
        : Response.json({ error: { code: 'unauthenticated', message: 'x' } }, { status: 401 });
    },
    async ({ forceRefresh }) => {
      if (forceRefresh) token += 1;
      return { ...ACCOUNT, accessToken: `token-${token}` };
    },
  );
  assert.deepEqual(sent, ['Bearer token-0', 'Bearer token-1']);
  assert.deepEqual(result, {
    ok: true,
    results: [
      {
        title: 'Maka',
        url: 'https://maka.example/a',
        snippet: 'About Maka',
        source: 'maka.example',
      },
    ],
  });
});

test("a proxy's bare refusals are read by their status", async () => {
  const cases = [
    [429, 'rate_limited'],
    [503, 'unavailable'],
    [504, 'timeout'],
    [500, 'network_error'],
  ] as const;
  for (const [status, reason] of cases) {
    const result = await search(async () => new Response('<html>gateway</html>', { status }));
    assert.equal(result.ok ? 'ok' : result.reason, reason, String(status));
  }
});

test('why the account cannot sign is what the tool reports', async () => {
  const cases = [
    ['signed_out', 'not_signed_in'],
    ['sign_in_expired', 'not_signed_in'],
    ['not_offered', 'not_signed_in'],
    ['upgrade_required', 'unavailable'],
    ['server_unreachable', 'network_error'],
  ] as const;
  for (const [cause, reason] of cases) {
    const result = await search(
      async () => {
        throw new Error('nothing is sent without a token');
      },
      async () => {
        throw new OrganizationAccountUnavailableError(cause);
      },
    );
    assert.equal(result.ok ? 'ok' : result.reason, reason, cause);
  }
});

test('a server without web search, an unreadable or oversized answer and a dead network each say so', async () => {
  const notFound = await search(async () =>
    Response.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 }),
  );
  assert.deepEqual(notFound, {
    ok: false,
    reason: 'unavailable',
    message: 'The organization server does not offer web search and fetch.',
  });
  const garbled = await search(async () => new Response('<html>proxy</html>'));
  assert.deepEqual(garbled, {
    ok: false,
    reason: 'network_error',
    message: 'The organization server answered in a shape Maka cannot read.',
  });
  const oversized = await search(async () => new Response(`"${'x'.repeat(600 * 1024)}"`));
  assert.deepEqual(oversized, {
    ok: false,
    reason: 'network_error',
    message: "The organization server's answer could not be read.",
  });
  const offline = await search(async () => {
    throw new TypeError('fetch failed');
  });
  assert.deepEqual(offline, {
    ok: false,
    reason: 'network_error',
    message: 'The organization server could not be reached.',
  });
});

test('the caller stopping stops the search and is not reported as a failure', async () => {
  const stop = new AbortController();
  const reason = new DOMException('Turn stopped', 'AbortError');
  const running = searchThroughOrganization({
    account: async () => ACCOUNT,
    fetchFn: (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        // As fetch does: a signal already stopped rejects at once.
        if (init?.signal?.aborted) return reject(init.signal.reason);
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    request: { query: 'maka' },
    signal: stop.signal,
  });
  stop.abort(reason);
  await assert.rejects(running, (error: unknown) => error === reason);
});

test('a page is read through the server, and a page it could not read says why', async () => {
  const sent: { url: string; body: unknown }[] = [];
  const read = (answer: Response) =>
    fetchThroughOrganization({
      account: async () => ACCOUNT,
      fetchFn: async (url, init) => {
        sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        return answer;
      },
      url: 'https://maka.example/page',
    });
  assert.deepEqual(
    await read(Response.json({ url: 'https://maka.example/final', content: '# Maka' })),
    { ok: true, url: 'https://maka.example/final', content: '# Maka' },
  );
  assert.deepEqual(sent[0], {
    url: 'https://org.example/tools/web-fetch',
    body: { url: 'https://maka.example/page' },
  });
  assert.deepEqual(
    await read(
      Response.json(
        { error: { code: 'web_fetch_failed', message: 'HTTP 404 Not Found' } },
        { status: 422 },
      ),
    ),
    { ok: false, reason: 'page_failed', message: 'HTTP 404 Not Found' },
  );
  const empty = await read(Response.json({ url: 'https://maka.example/final', content: '' }));
  assert.equal(empty.ok ? 'ok' : empty.reason, 'network_error');
});
