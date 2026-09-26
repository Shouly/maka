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
import { decodeTokenResponse, type PlatformModelCatalog } from '@maka/platform-protocol';
import { newId } from '../crypto/tokens.js';
import { nextPeriodStart, periodStart } from '../gateway/quota.js';
import { AnthropicStreamMeter, weightedUnits } from '../gateway/usage.js';
import { browserSignIn, exchangeCode, startTestServer, type TestServer } from './support.js';

const SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"up","usage":{"input_tokens":100,"cache_creation_input_tokens":20,"cache_read_input_tokens":300,"output_tokens":1}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n');

interface UpstreamCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** An Anthropic API stand-in. `plan` answers each call in turn: a status, or 'stream' / 'json'. */
function fakeAnthropic(plan: (number | 'stream' | 'json' | 'slow')[]) {
  const calls: UpstreamCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const step = plan[Math.min(calls.length - 1, plan.length - 1)];
    if (typeof step === 'number') {
      return Response.json(
        { type: 'error', error: { type: 'api_error', message: `upstream ${step}` } },
        { status: step },
      );
    }
    if (step === 'json') {
      return Response.json(
        { id: 'msg', type: 'message', content: [], usage: { input_tokens: 10, output_tokens: 5 } },
        { headers: { 'request-id': 'req_json' } },
      );
    }
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        if (step === 'slow') {
          controller.enqueue(
            encoder.encode(SSE.slice(0, SSE.indexOf('event: content_block_start'))),
          );
          await new Promise((resolve) => setTimeout(resolve, 5_000));
        }
        controller.enqueue(encoder.encode(SSE));
        controller.close();
      },
      cancel() {},
    });
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream', 'request-id': 'req_stream' },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

async function seedGateway(server: TestServer, routes: { name: string; priority: number }[]) {
  const now = server.clock.now;
  for (const route of routes) {
    const id = newId();
    await server.db
      .insertInto('upstreams')
      .values({
        id,
        name: route.name,
        kind: 'anthropic',
        config: JSON.stringify({ baseUrl: `https://${route.name}.test` }),
        credential_sealed: server.ctx.secrets.seal(
          JSON.stringify({ apiKey: `key-${route.name}` }),
          `upstream:${id}`,
        ),
        enabled: true,
        updated_at: now,
      })
      .execute();
    await server.db
      .insertInto('models')
      .values({
        id: 'claude-opus-5',
        protocol: 'anthropic',
        display_name: 'Claude Opus 5',
        capabilities: JSON.stringify({
          contextWindow: 1_000_000,
          thinkingLevels: ['low', 'high'],
          supportsTools: true,
        }),
        cost_weight: 2,
        enabled: true,
        sort_order: 0,
        updated_at: now,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
    await server.db
      .insertInto('model_routes')
      .values({
        model_id: 'claude-opus-5',
        upstream_id: id,
        upstream_model: `${route.name}-opus`,
        priority: route.priority,
      })
      .execute();
  }
}

async function accessToken(server: TestServer, email = 'ada@relx.com'): Promise<string> {
  const code = `c-${email}-${server.clock.now.getTime()}`;
  server.relx.answers.set(code, { provider: 'relx-sso', subject: email, email });
  const { redirect } = await browserSignIn(server, server.relx, code);
  return decodeTokenResponse(
    (await exchangeCode(server, redirect.searchParams.get('code') ?? '')).json(),
  ).access_token;
}

const message = (overrides: Record<string, unknown> = {}) => ({
  model: 'claude-opus-5',
  max_tokens: 1024,
  stream: true,
  messages: [{ role: 'user', content: 'Hi' }],
  ...overrides,
});

async function usageRows(server: TestServer) {
  return server.db.selectFrom('usage_events').selectAll().orderBy('id').execute();
}

test('a stream passes through byte for byte, reaches the upstream as the org, and is metered', async () => {
  const upstream = fakeAnthropic(['stream']);
  const server = await startTestServer({}, { upstreamFetch: upstream.fetchImpl });
  try {
    await seedGateway(server, [{ name: 'primary', priority: 0 }]);
    const token = await accessToken(server);
    const response = await server.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: {
        authorization: `Bearer ${token}`,
        'anthropic-beta': 'interleaved-thinking-2025-05-14',
        'x-maka-client-version': '0.3.0',
      },
      payload: message(),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'text/event-stream');
    assert.equal(response.body, SSE, 'the stream is not altered');

    const [call] = upstream.calls;
    assert.equal(call?.url, 'https://primary.test/v1/messages?beta=true');
    assert.equal(call?.headers['x-api-key'], 'key-primary', 'the org key, never the person token');
    assert.equal(call?.headers.authorization, undefined);
    assert.match(call?.headers['anthropic-beta'] ?? '', /interleaved-thinking-2025-05-14/);
    assert.equal(call?.body.model, 'primary-opus');
    assert.equal(call?.body.stream, true);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const [row] = await usageRows(server);
    assert.equal(row?.status, 'ok');
    assert.deepEqual(
      [row?.input_tokens, row?.output_tokens, row?.cache_write_tokens, row?.cache_read_tokens].map(
        Number,
      ),
      [100, 42, 20, 300],
    );
    assert.equal(
      row?.weighted_units,
      weightedUnits({ input: 100, output: 42, cacheWrite: 20, cacheRead: 300 }, 2),
    );
    assert.equal(row?.client_version, '0.3.0');
    assert.equal(row?.upstream_request_id, 'req_stream');
  } finally {
    await server.close();
  }
});

test('a non-streaming answer is metered from its usage', async () => {
  const upstream = fakeAnthropic(['json']);
  const server = await startTestServer({}, { upstreamFetch: upstream.fetchImpl });
  try {
    await seedGateway(server, [{ name: 'primary', priority: 0 }]);
    const response = await server.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: { 'x-api-key': await accessToken(server) },
      payload: message({ stream: false }),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().id, 'msg');
    const [row] = await usageRows(server);
    assert.deepEqual([Number(row?.input_tokens), Number(row?.output_tokens)], [10, 5]);
  } finally {
    await server.close();
  }
});

test('an upstream failure before any answer falls over to the next; a bad request does not', async () => {
  const upstream = fakeAnthropic([529, 'stream']);
  const server = await startTestServer({}, { upstreamFetch: upstream.fetchImpl });
  try {
    await seedGateway(server, [
      { name: 'primary', priority: 0 },
      { name: 'backup', priority: 1 },
    ]);
    const token = await accessToken(server);
    const response = await server.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: message(),
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(
      upstream.calls.map((call) => new URL(call.url).host),
      ['primary.test', 'backup.test'],
    );

    const invalid = fakeAnthropic([400]);
    const strict = await startTestServer({}, { upstreamFetch: invalid.fetchImpl });
    try {
      await seedGateway(strict, [
        { name: 'primary', priority: 0 },
        { name: 'backup', priority: 1 },
      ]);
      const refused = await strict.app.inject({
        method: 'POST',
        url: '/model/anthropic/v1/messages',
        headers: { authorization: `Bearer ${await accessToken(strict)}` },
        payload: message(),
      });
      assert.equal(refused.statusCode, 400);
      assert.equal(refused.json().error.message, 'upstream 400');
      assert.equal(invalid.calls.length, 1);
    } finally {
      await strict.close();
    }
  } finally {
    await server.close();
  }
});

test('every upstream failing answers 502 in the Anthropic shape', async () => {
  const upstream = fakeAnthropic([500]);
  const server = await startTestServer({}, { upstreamFetch: upstream.fetchImpl });
  try {
    await seedGateway(server, [{ name: 'primary', priority: 0 }]);
    const response = await server.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: { authorization: `Bearer ${await accessToken(server)}` },
      payload: message(),
    });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.json(), {
      type: 'error',
      error: { type: 'overloaded_error', message: 'The model provider could not be reached' },
      maka: { code: 'upstream_unavailable' },
    });
    assert.equal((await usageRows(server))[0]?.status, 'error');
  } finally {
    await server.close();
  }
});

test('a disabled model is refused and left out of the catalog; no one unsigned gets in', async () => {
  const upstream = fakeAnthropic(['stream']);
  const server = await startTestServer({}, { upstreamFetch: upstream.fetchImpl });
  try {
    await seedGateway(server, [{ name: 'primary', priority: 0 }]);
    await server.db.updateTable('models').set({ enabled: false }).execute();
    const token = await accessToken(server);
    const hidden = await server.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: { authorization: `Bearer ${token}` },
      payload: message(),
    });
    assert.equal(hidden.statusCode, 403);
    assert.equal(hidden.json().maka.code, 'model_not_allowed');
    const catalog = (
      await server.app.inject({
        method: 'GET',
        url: '/model/catalog',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json() as PlatformModelCatalog;
    assert.deepEqual(catalog.models, []);

    // Enabled, it is everyone's.
    await server.db.updateTable('models').set({ enabled: true }).execute();
    const visible = (
      await server.app.inject({
        method: 'GET',
        url: '/model/catalog',
        headers: { authorization: `Bearer ${token}` },
      })
    ).json() as PlatformModelCatalog;
    assert.deepEqual(visible.models, [
      {
        id: 'claude-opus-5',
        protocol: 'anthropic',
        displayName: 'Claude Opus 5',
        contextWindow: 1_000_000,
        thinkingLevels: ['low', 'high'],
        supportsTools: true,
      },
    ]);

    const anonymous = await server.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      payload: message(),
    });
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.json().error.type, 'authentication_error');
    assert.equal(upstream.calls.length, 0);
  } finally {
    await server.close();
  }
});

test('an exhausted allowance answers 429 with when it resets', async () => {
  const upstream = fakeAnthropic(['stream']);
  const server = await startTestServer({}, { upstreamFetch: upstream.fetchImpl });
  try {
    await seedGateway(server, [{ name: 'primary', priority: 0 }]);
    let token = await accessToken(server);
    await server.db
      .insertInto('quotas')
      .values({
        id: newId(),
        scope: 'user_default',
        scope_id: null,
        period: 'week',
        limit_units: 500,
        updated_at: server.clock.now,
      })
      .execute();
    const send = () =>
      server.app.inject({
        method: 'POST',
        url: '/model/anthropic/v1/messages',
        headers: { authorization: `Bearer ${token}` },
        payload: message(),
      });
    assert.equal((await send()).statusCode, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const refused = await send();
    assert.equal(refused.statusCode, 429);
    const resetAt = nextPeriodStart('week', server.clock.now).getTime();
    assert.deepEqual(refused.json().maka, { code: 'quota_exceeded', retryAt: resetAt });
    assert.ok(Number(refused.headers['retry-after']) > 0);
    assert.equal(upstream.calls.length, 1);

    // A new week starts afresh (with a fresh sign-in: the old token expired long ago).
    server.clock.now = new Date(resetAt + 1000);
    token = await accessToken(server, 'ada@relx.com');
    assert.equal((await send()).statusCode, 200);
  } finally {
    await server.close();
  }
});

test('periods begin Monday 00:00 UTC and on the 1st', () => {
  const thursday = new Date('2026-09-24T15:00:00Z');
  assert.equal(periodStart('week', thursday).toISOString(), '2026-09-21T00:00:00.000Z');
  assert.equal(nextPeriodStart('week', thursday).toISOString(), '2026-09-28T00:00:00.000Z');
  assert.equal(periodStart('month', thursday).toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(
    nextPeriodStart('month', new Date('2026-12-31T23:00:00Z')).toISOString(),
    '2027-01-01T00:00:00.000Z',
  );
  assert.equal(
    periodStart('week', new Date('2026-09-27T23:59:00Z')).toISOString(),
    '2026-09-21T00:00:00.000Z',
  );
});

test('a person who hangs up mid-stream is billed for what was produced, as cancelled', async () => {
  const upstream = fakeAnthropic(['slow']);
  const server = await startTestServer({}, { upstreamFetch: upstream.fetchImpl });
  try {
    await seedGateway(server, [{ name: 'primary', priority: 0 }]);
    const token = await accessToken(server);
    const address = await server.app.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    const response = await fetch(`${address}/model/anthropic/v1/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(message()),
      signal: abort.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    abort.abort();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const [row] = await usageRows(server);
    assert.equal(row?.status, 'cancelled');
    assert.equal(Number(row?.input_tokens), 100, 'the input already sent is billed');
  } finally {
    await server.close();
  }
});

test('the meter reads CRLF-separated events and estimates output a stream stopped before counting', () => {
  const encoder = new TextEncoder();
  const crlf = new AnthropicStreamMeter();
  const bytes = encoder.encode(SSE.replaceAll('\n', '\r\n'));
  // Byte by byte, so every CRLF is also split across chunks.
  for (const byte of bytes) crlf.push(new Uint8Array([byte]));
  assert.deepEqual(crlf.charge(), { input: 100, output: 42, cacheWrite: 20, cacheRead: 300 });

  const stopped = new AnthropicStreamMeter();
  stopped.push(encoder.encode(SSE.slice(0, SSE.indexOf('event: message_delta'))));
  stopped.push(
    encoder.encode(
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"' +
        'x'.repeat(400) +
        '你好"}}\n\n',
    ),
  );
  // "Hello" (2) + 400 ASCII (100) + 2 CJK (2); message_start's own count was 1.
  assert.equal(stopped.charge().output, 104);
});

test("the caller cannot pick the organization's workspace or profile through body fields", async () => {
  const upstream = fakeAnthropic(['json']);
  const server = await startTestServer({}, { upstreamFetch: upstream.fetchImpl });
  try {
    await seedGateway(server, [{ name: 'primary', priority: 0 }]);
    const response = await server.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: { authorization: `Bearer ${await accessToken(server)}` },
      payload: message({ stream: false, workspace_id: 'wrkspc_other', user_profile_id: 'someone' }),
    });
    assert.equal(response.statusCode, 200);
    const [call] = upstream.calls;
    assert.equal(call?.body.workspace_id, undefined);
    assert.equal(call?.body.user_profile_id, undefined);
    assert.equal(call?.headers['anthropic-workspace-id'], undefined);
    assert.equal(call?.headers['anthropic-user-profile-id'], undefined);
  } finally {
    await server.close();
  }
});

test('an upstream that refuses the organization (401/403/404) hands over to the next route', async () => {
  const upstream = fakeAnthropic([404, 'stream']);
  const server = await startTestServer({}, { upstreamFetch: upstream.fetchImpl });
  try {
    await seedGateway(server, [
      { name: 'primary', priority: 0 },
      { name: 'backup', priority: 1 },
    ]);
    const response = await server.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: { authorization: `Bearer ${await accessToken(server)}` },
      payload: message(),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(upstream.calls.length, 2);
  } finally {
    await server.close();
  }
});

test('a used-up allowance says not to retry, and names the later reset when two are used up', async () => {
  const upstream = fakeAnthropic(['stream']);
  const server = await startTestServer({}, { upstreamFetch: upstream.fetchImpl });
  try {
    await seedGateway(server, [{ name: 'primary', priority: 0 }]);
    const token = await accessToken(server);
    for (const period of ['week', 'month'] as const) {
      await server.db
        .insertInto('quotas')
        .values({
          id: newId(),
          scope: 'user_default',
          scope_id: null,
          period,
          limit_units: 1,
          updated_at: server.clock.now,
        })
        .execute();
    }
    const send = () =>
      server.app.inject({
        method: 'POST',
        url: '/model/anthropic/v1/messages',
        headers: { authorization: `Bearer ${token}` },
        payload: message(),
      });
    assert.equal((await send()).statusCode, 200);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const refused = await send();
    assert.equal(refused.statusCode, 429);
    assert.equal(refused.headers['x-should-retry'], 'false');
    const week = nextPeriodStart('week', server.clock.now).getTime();
    const month = nextPeriodStart('month', server.clock.now).getTime();
    assert.equal(refused.json().maka.retryAt, Math.max(week, month));
  } finally {
    await server.close();
  }
});

test('a weight or limit that is not a finite number cannot be stored', async () => {
  const server = await startTestServer();
  try {
    await assert.rejects(
      server.db
        .insertInto('models')
        .values({
          id: 'nan-model',
          protocol: 'anthropic',
          display_name: 'NaN',
          capabilities: '{}',
          cost_weight: Number.NaN,
          enabled: true,
          sort_order: 0,
          updated_at: server.clock.now,
        })
        .execute(),
    );
    await assert.rejects(
      server.db
        .insertInto('quotas')
        .values({
          id: newId(),
          scope: 'user_default',
          scope_id: null,
          period: 'week',
          limit_units: Number.POSITIVE_INFINITY,
          updated_at: server.clock.now,
        })
        .execute(),
    );
  } finally {
    await server.close();
  }
});

test('the gateway takes any JSON, answers malformed bodies in the Anthropic shape', async () => {
  const upstream = fakeAnthropic(['json']);
  const server = await startTestServer({}, { upstreamFetch: upstream.fetchImpl });
  try {
    await seedGateway(server, [{ name: 'primary', priority: 0 }]);
    const token = await accessToken(server);
    // A tool input may carry a "__proto__" key; it is data, passed on as is.
    const body =
      '{"model":"claude-opus-5","max_tokens":10,"messages":[{"role":"user","content":"Hi"},' +
      '{"role":"assistant","content":[{"type":"tool_use","id":"t","name":"x","input":{"__proto__":{"a":1}}}]},' +
      '{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"ok"}]}]}';
    const accepted = await server.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: body,
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    const sent = JSON.stringify(upstream.calls[0]?.body.messages);
    assert.ok(sent.includes('"__proto__":{"a":1}'));

    const broken = await server.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: '{"model":',
    });
    assert.equal(broken.statusCode, 400);
    assert.equal(broken.json().type, 'error');
    assert.equal(broken.json().error.type, 'invalid_request_error');
    assert.equal(broken.json().maka.code, 'invalid_request');
  } finally {
    await server.close();
  }
});
