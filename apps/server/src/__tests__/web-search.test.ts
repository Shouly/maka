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
import type { PlatformErrorBody, PlatformWebSearchResponse } from '@maka/platform-protocol';
import type { ConsoleWebSearch } from '../admin-console/types.js';
import { accessToken } from './gateway-support.js';
import { consoleCall, consoleSignIn, startTestServer, type TestServer } from './support.js';

const GOOD_KEY = 'tvly-good';

/** Tavily as the tests need it: one good key, and whatever `answer` says to a search or read. */
function tavily(answer: (body: Record<string, unknown>) => Response | Promise<Response>) {
  const searches: { authorization: string; body: Record<string, unknown> }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const authorization = new Headers(init?.headers).get('authorization') ?? '';
    if (url.href === 'https://api.tavily.com/usage')
      return authorization === `Bearer ${GOOD_KEY}`
        ? Response.json({ key: { usage: 0, limit: 1000 } })
        : Response.json({ detail: { error: 'Unauthorized' } }, { status: 401 });
    assert.ok(['/search', '/extract'].includes(url.pathname), url.href);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    searches.push({ authorization, body: { path: url.pathname, ...body } });
    return answer(body);
  };
  return { fetch, searches };
}

async function setUp(server: TestServer) {
  const admin = await consoleSignIn(server, server.google, 'boss@relx.com');
  const put = async (patch: Record<string, unknown>) =>
    consoleCall(server, admin, 'PUT', '/web-search', patch);
  const call = (url: string) => async (token: string | undefined, body: Record<string, unknown>) =>
    server.app.inject({
      method: 'POST',
      url,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      payload: JSON.stringify(body),
    });
  return { admin, put, search: call('/tools/web-search'), read: call('/tools/web-fetch') };
}

test('an administrator saves a Tavily key, checked with Tavily first, and everyone signed in searches with it', async () => {
  const service = tavily(() =>
    Response.json({
      results: [
        {
          title: '  Maka\n release  notes ',
          url: 'https://maka.test/notes',
          content: 'x'.repeat(500),
        },
        { title: '', url: 'https://example.com/a', content: 'About A' },
        { title: 'Not a web page', url: 'javascript:alert(1)', content: 'dropped' },
      ],
    }),
  );
  const server = await startTestServer({}, { searchFetch: service.fetch });
  try {
    const { admin, put, search } = await setUp(server);
    const initial = (await consoleCall(server, admin, 'GET', '/web-search')).json();
    assert.deepEqual(initial, {
      provider: 'tavily',
      configured: false,
      enabled: false,
      revision: 0,
    });

    // A key Tavily refuses is never kept.
    const refused = await put({ expectedRevision: 0, apiKey: 'tvly-wrong' });
    assert.equal(refused.statusCode, 400);
    assert.equal(refused.json().error.code, 'credentials_rejected');
    assert.equal(
      (await server.db.selectFrom('web_search_settings').selectAll().execute()).length,
      0,
    );

    const saved = (
      await put({ expectedRevision: 0, apiKey: ` ${GOOD_KEY} ` })
    ).json() as ConsoleWebSearch;
    assert.equal(saved.configured, true);
    assert.equal(saved.enabled, true);
    assert.equal(saved.revision, 1);
    const row = await server.db
      .selectFrom('web_search_settings')
      .selectAll()
      .executeTakeFirstOrThrow();
    assert.ok(!row.credential_sealed.includes(GOOD_KEY), 'the key is sealed');
    const audit = await server.db
      .selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'web_search.updated')
      .execute();
    assert.deepEqual(
      audit.map((entry) => entry.detail),
      [{ changed: ['key'], enabled: true, via: 'admin-console' }],
    );

    const token = await accessToken(server);
    const answer = await search(token, {
      query: '  maka release ',
      limit: 3,
      allowedDomains: ['maka.test'],
      blockedDomains: ['spam.test'],
    });
    assert.equal(answer.statusCode, 200);
    assert.deepEqual(service.searches, [
      {
        authorization: `Bearer ${GOOD_KEY}`,
        body: {
          path: '/search',
          query: 'maka release',
          max_results: 3,
          search_depth: 'basic',
          include_domains: ['maka.test'],
          exclude_domains: ['spam.test'],
        },
      },
    ]);
    const { results } = answer.json() as PlatformWebSearchResponse;
    assert.deepEqual(
      results.map((result) => [result.title, result.url, result.snippet.length]),
      [
        ['Maka release notes', 'https://maka.test/notes', 400],
        ['https://example.com/a', 'https://example.com/a', 7],
      ],
    );
    // Five results when the tool does not say.
    await search(token, { query: 'maka' });
    assert.equal(service.searches[1]?.body.max_results, 5);
  } finally {
    await server.close();
  }
});

test('nobody searches before a key is saved, while it is switched off, or without signing in', async () => {
  const service = tavily(() => Response.json({ results: [] }));
  const server = await startTestServer({}, { searchFetch: service.fetch });
  try {
    const { put, search } = await setUp(server);
    const token = await accessToken(server);
    const refusal = async (body: Record<string, unknown>, withToken = true) => {
      const answer = await search(withToken ? token : undefined, body);
      return [answer.statusCode, (answer.json() as PlatformErrorBody).error];
    };

    assert.deepEqual(await refusal({ query: 'maka' }, false), [
      401,
      { code: 'unauthenticated', message: 'Sign in again' },
    ]);
    assert.deepEqual(await refusal({ query: 'maka' }), [
      503,
      { code: 'web_access_unavailable', message: 'An administrator has not set up web access yet' },
    ]);
    assert.equal(
      (await put({ expectedRevision: 0, enabled: true })).json().error.code,
      'invalid_request',
    );

    await put({ expectedRevision: 0, apiKey: GOOD_KEY });
    const off = (await put({ expectedRevision: 1, enabled: false })).json() as ConsoleWebSearch;
    assert.deepEqual([off.configured, off.enabled, off.revision], [true, false, 2]);
    assert.deepEqual(await refusal({ query: 'maka' }), [
      503,
      { code: 'web_access_unavailable', message: 'An administrator has turned web access off' },
    ]);
    // A change made from an old page is refused.
    assert.equal(
      (await put({ expectedRevision: 1, enabled: true })).json().error.code,
      'revision_conflict',
    );
    await put({ expectedRevision: 2, enabled: true });

    for (const body of [
      { query: '' },
      { query: 'x'.repeat(201) },
      { query: 'maka', limit: 11 },
      { query: 'maka', allowedDomains: Array.from({ length: 21 }, (_, i) => `d${i}.test`) },
      { query: 'maka', extra: true },
      { query: 'maka', blockedDomains: ['example.com/path'] },
    ])
      assert.equal((await refusal(body))[0], 400, JSON.stringify(body).slice(0, 60));
    assert.equal(service.searches.length, 0, 'nothing refused reached Tavily');
  } finally {
    await server.close();
  }
});

test("Tavily's refusals come back in the server's own words", async () => {
  let next: () => Response | Promise<Response> = () => Response.json({ results: [] });
  const service = tavily(() => next());
  const server = await startTestServer({}, { searchFetch: service.fetch });
  try {
    const { put, search } = await setUp(server);
    await put({ expectedRevision: 0, apiKey: GOOD_KEY });
    const token = await accessToken(server);
    const cases: [() => Response | Promise<Response>, number, string][] = [
      [() => Response.json({}, { status: 401 }), 503, 'web_access_unavailable'],
      [() => Response.json({}, { status: 403 }), 503, 'web_access_unavailable'],
      [() => Response.json({}, { status: 400 }), 400, 'invalid_request'],
      [() => Response.json({}, { status: 422 }), 400, 'invalid_request'],
      [() => Response.json({}, { status: 429 }), 429, 'rate_limited'],
      [() => Response.json({}, { status: 432 }), 503, 'web_access_unavailable'],
      [() => Response.json({}, { status: 433 }), 503, 'web_access_unavailable'],
      [() => Response.json({}, { status: 500 }), 502, 'upstream_unavailable'],
      [() => new Response('not json'), 502, 'upstream_unavailable'],
      [
        () => {
          throw new TypeError('fetch failed');
        },
        502,
        'upstream_unavailable',
      ],
    ];
    for (const [answer, status, code] of cases) {
      next = answer;
      const reply = await search(token, { query: 'maka' });
      assert.deepEqual([reply.statusCode, reply.json().error.code], [status, code]);
    }
    // Without Retry-After the refusal names no time to come back.
    next = () => Response.json({}, { status: 429 });
    assert.equal('retryAt' in (await search(token, { query: 'maka' })).json().error, false);
    next = () => Response.json({}, { status: 429, headers: { 'retry-after': '7' } });
    const limited = await search(token, { query: 'maka' });
    assert.equal(limited.statusCode, 429);
    assert.deepEqual(limited.json().error, {
      code: 'rate_limited',
      message: 'Too many web requests at once; try again shortly',
      retryAt: server.clock.now.getTime() + 7000,
    });
  } finally {
    await server.close();
  }
});

test('a key with invisible characters is refused before Tavily is asked, and a new key keeps the switch', async () => {
  const service = tavily(() => Response.json({ results: [] }));
  let usageChecks = 0;
  const counted: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/usage')) usageChecks += 1;
    return service.fetch(input, init);
  };
  const server = await startTestServer({}, { searchFetch: counted });
  try {
    const { admin, put } = await setUp(server);
    for (const apiKey of [`${GOOD_KEY}\u200b`, 'tvly-two\nlines', 'tvly with space']) {
      const refused = await put({ expectedRevision: 0, apiKey });
      assert.equal(refused.statusCode, 400, JSON.stringify(apiKey));
      assert.equal(refused.json().error.code, 'invalid_request');
    }
    assert.equal(usageChecks, 0);

    await put({ expectedRevision: 0, apiKey: GOOD_KEY });
    await put({ expectedRevision: 1, enabled: false });
    const replaced = (await put({ expectedRevision: 2, apiKey: GOOD_KEY })).json();
    // What the page reads back names no key.
    assert.deepEqual(replaced, {
      provider: 'tavily',
      configured: true,
      enabled: false,
      revision: 3,
      updatedAt: server.clock.now.getTime(),
    });
    assert.deepEqual((await consoleCall(server, admin, 'GET', '/web-search')).json(), replaced);
    const audit = await server.db
      .selectFrom('audit_events')
      .select('detail')
      .where('action', '=', 'web_search.updated')
      .orderBy('id')
      .execute();
    assert.deepEqual(
      audit.map((entry) => (entry.detail as { changed: string[] }).changed),
      [['key'], ['enabled'], ['key']],
    );
  } finally {
    await server.close();
  }
});

test('WebFetch reads one page through Tavily with the same key, and says why a page could not be read', async () => {
  let next: (body: Record<string, unknown>) => Response = () =>
    Response.json({
      results: [
        { url: 'https://maka.test/final', raw_content: `  # Maka\n\n${'x'.repeat(250_000)}` },
      ],
      failed_results: [],
    });
  const service = tavily((body) => next(body));
  const server = await startTestServer({}, { searchFetch: service.fetch });
  try {
    const { put, read } = await setUp(server);
    const token = await accessToken(server);
    assert.equal(
      (await read(token, { url: 'https://maka.test/page' })).json().error.code,
      'web_access_unavailable',
    );
    await put({ expectedRevision: 0, apiKey: GOOD_KEY });

    const page = await read(token, { url: 'https://maka.test/page' });
    assert.equal(page.statusCode, 200);
    const { url, content } = page.json() as { url: string; content: string };
    assert.equal(url, 'https://maka.test/final');
    assert.ok(content.startsWith('# Maka'));
    assert.equal(content.length, 200_000, 'cut to the wire limit');
    assert.deepEqual(service.searches.at(-1), {
      authorization: `Bearer ${GOOD_KEY}`,
      body: {
        path: '/extract',
        urls: 'https://maka.test/page',
        extract_depth: 'basic',
        format: 'markdown',
      },
    });

    next = () =>
      Response.json({
        results: [],
        failed_results: [{ url: 'https://maka.test/gone', error: 'HTTP 404 Not Found' }],
      });
    const gone = await read(token, { url: 'https://maka.test/gone' });
    assert.equal(gone.statusCode, 422);
    assert.deepEqual(gone.json().error, {
      code: 'web_fetch_failed',
      message: 'HTTP 404 Not Found',
    });

    // Read, but nothing in it: Tavily gave no reason, so the server names one.
    next = () => Response.json({ results: [{ url: 'https://maka.test/empty', raw_content: ' ' }] });
    assert.deepEqual((await read(token, { url: 'https://maka.test/empty' })).json().error, {
      code: 'web_fetch_failed',
      message: 'The page had no readable content',
    });

    // Without a usable address of its own, the page is the one asked for.
    next = () => Response.json({ results: [{ url: 'javascript:void(0)', raw_content: 'Hello' }] });
    assert.deepEqual((await read(token, { url: 'https://maka.test/b' })).json(), {
      url: 'https://maka.test/b',
      content: 'Hello',
    });

    next = () => Response.json({ results: [{ url: 'https://maka.test/c', raw_content: 'Hi' }] });
    assert.deepEqual(
      (await read(token, { url: 'https://maka.test/c' })).json(),
      { url: 'https://maka.test/c', content: 'Hi' },
      'a missing failed_results is not an error',
    );

    // Not Tavily's answer shape: Tavily's fault, not the page's.
    next = () => Response.json({ answer: 'no results array' });
    const odd = await read(token, { url: 'https://maka.test/d' });
    assert.deepEqual([odd.statusCode, odd.json().error.code], [502, 'upstream_unavailable']);

    next = () => Response.json({}, { status: 401 });
    assert.equal(
      (await read(token, { url: 'https://maka.test/a' })).json().error.code,
      'web_access_unavailable',
    );

    const sent = service.searches.length;
    for (const body of [
      { url: 'ftp://maka.test/a' },
      { url: 'not a url' },
      { url: 'https://maka.test', extra: 1 },
      { url: `https://maka.test/${'x'.repeat(2048)}` },
      { url: 'https://someone:secret@maka.test/private' },
      {},
    ])
      assert.equal((await read(token, body)).statusCode, 400, JSON.stringify(body).slice(0, 60));
    // Signing in comes before anything else is looked at.
    assert.equal((await read(undefined, { url: 'not a url' })).statusCode, 401);
    assert.equal(service.searches.length, sent, 'nothing refused reached Tavily');
  } finally {
    await server.close();
  }
});

test('a key is kept when Tavily cannot be reached to check it', async () => {
  const unreachable: typeof fetch = async () => {
    throw new TypeError('fetch failed');
  };
  const server = await startTestServer({}, { searchFetch: unreachable });
  try {
    const { put } = await setUp(server);
    const saved = await put({ expectedRevision: 0, apiKey: GOOD_KEY });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(
      [saved.json().configured, saved.json().enabled, saved.json().revision],
      [true, true, 1],
    );
  } finally {
    await server.close();
  }
});
