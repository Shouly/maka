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
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ModelApiProtocol, ModelIntegrationId } from '@maka/core/model-gateway';
import type { ConsoleModel } from '../admin-console/types.js';
import { providerBaseUrl, validateProviderConfig } from '../gateway/model-providers.js';
import { nextPeriodStart, periodStart } from '../gateway/quota.js';
import { GatewayUsageMeter, weightedUnits } from '../gateway/usage.js';
import {
  accessToken,
  anthropicDraft,
  anthropicJson,
  anthropicStream,
  event,
  modelHeaders,
  publish,
} from './gateway-support.js';
import { consoleCall, startTestServer, type TestServer } from './support.js';

type LanguageModel = Pick<
  ReturnType<ReturnType<typeof createOpenAI>['chat']>,
  'doGenerate' | 'doStream'
>;

const requestBody = {
  model: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'Hi' }],
  max_tokens: 1024,
  stream: false,
};
const chatJson = () => ({
  id: 'chat_1',
  object: 'chat.completion',
  created: 1,
  model: 'gpt-4.1',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
  usage: {
    prompt_tokens: 100,
    completion_tokens: 40,
    prompt_tokens_details: { cached_tokens: 60 },
  },
});
const responsesJson = () => ({
  id: 'resp_1',
  object: 'response',
  created_at: 1,
  model: 'gpt-5.4',
  status: 'completed',
  output: [
    {
      id: 'msg_1',
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello', annotations: [] }],
    },
  ],
  usage: {
    input_tokens: 100,
    output_tokens: 40,
    input_tokens_details: { cached_tokens: 60 },
    output_tokens_details: { reasoning_tokens: 30 },
  },
});
const googleJson = () => ({
  candidates: [
    { content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP', index: 0 },
  ],
  usageMetadata: {
    promptTokenCount: 100,
    cachedContentTokenCount: 60,
    candidatesTokenCount: 10,
    thoughtsTokenCount: 30,
  },
  modelVersion: 'gemini-2.5-pro',
  responseId: 'google_1',
});

async function usage(s: TestServer) {
  return s.db.selectFrom('model_usage').selectAll().orderBy('at').execute();
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Usage is written when the answer has gone; a streamed one may finish just after. */
async function recordedUsage(s: TestServer, count = 1) {
  for (let i = 0; i < 200; i++) {
    const rows = await usage(s);
    if (rows.length >= count) return rows;
    await delay(10);
  }
  throw new Error('No usage was recorded');
}

/** One Anthropic model behind a stand-in provider that answers with `answer`. */
async function anthropicModel(answer: (url: string, init?: RequestInit) => Promise<Response>) {
  const sent: { url: string; headers: Headers; body: any }[] = [];
  const s = await startTestServer(
    {},
    {
      upstreamFetch: async (url, init) => {
        sent.push({
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        });
        return answer(String(url), init);
      },
    },
  );
  const p = await publish(s, anthropicDraft(), ['claude-sonnet-4-6']);
  return { s, sent, model: p.models[0]!, admin: p.admin, token: await accessToken(s) };
}

test('a request reaches the provider as the SDK built it, with the organization credential', async () => {
  const raw = anthropicStream();
  const { s, sent, model, token } = await anthropicModel(
    async () =>
      new Response(raw, {
        headers: { 'content-type': 'text/event-stream', 'request-id': 'up_123' },
      }),
  );
  try {
    const body = {
      ...requestBody,
      stream: true,
      workspace_id: 'caller-workspace',
      user_profile_id: 'caller-profile',
      future_field: { foo: 1 },
      tools: [{ name: 'read_file', input_schema: { type: 'object', properties: {} } }],
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 't', signature: 'signed-opaque' }],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }] },
      ],
    };
    const r = await s.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: { ...modelHeaders(model, token), 'x-api-key': 'untrusted', 'anthropic-beta': 'b1' },
      payload: body,
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.body, raw, 'the stream is not altered');
    assert.equal(r.headers['request-id'], 'up_123');
    assert.equal(r.headers['x-maka-error'], undefined);
    const [call] = sent;
    assert.equal(call!.url, 'https://anthropic.test/v1/messages');
    assert.equal(call!.body.model, 'claude-sonnet-4-6');
    assert.deepEqual(call!.body.messages, body.messages, 'messages are not rebuilt');
    assert.deepEqual(call!.body.tools, body.tools);
    assert.deepEqual(call!.body.future_field, { foo: 1 });
    assert.equal(call!.body.workspace_id, undefined, 'the caller cannot pick a workspace');
    assert.equal(call!.body.user_profile_id, undefined);
    assert.equal(call!.headers.get('x-api-key'), 'test-key-Anthropic');
    assert.equal(call!.headers.get('authorization'), null, 'the employee token stays here');
    assert.equal(call!.headers.get('anthropic-beta'), 'b1');
    const [row] = await recordedUsage(s);
    assert.equal(row!.status, 'ok');
    assert.equal(row!.quality, 'reported');
    assert.equal(
      row!.weighted_units,
      weightedUnits({ input: 100, output: 42, cacheWrite: 20, cacheRead: 300 }, 1),
    );
    assert.equal(row!.upstream_request_id, 'up_123');
  } finally {
    await s.close();
  }
});

test("the provider's refusals come back as the provider sent them, without a gateway mark", async () => {
  const cases = [
    { status: 400, error: { type: 'invalid_request_error', message: 'prompt is too long' } },
    { status: 401, error: { type: 'authentication_error', message: 'invalid x-api-key' } },
    { status: 429, error: { type: 'rate_limit_error', message: 'slow down' } },
    { status: 529, error: { type: 'overloaded_error', message: 'overloaded' } },
  ];
  let next = 0;
  const { s, model, token } = await anthropicModel(async () => {
    const c = cases[next++]!;
    return Response.json(
      { type: 'error', error: c.error },
      {
        status: c.status,
        headers: { 'retry-after': '7', 'x-should-retry': 'true', 'x-private': 'no' },
      },
    );
  });
  try {
    for (const c of cases) {
      const r = await s.app.inject({
        method: 'POST',
        url: '/model/anthropic/v1/messages',
        headers: modelHeaders(model, token),
        payload: requestBody,
      });
      assert.equal(r.statusCode, c.status);
      assert.deepEqual(r.json(), { type: 'error', error: c.error });
      assert.equal(r.headers['x-maka-error'], undefined, 'not the gateway speaking');
      assert.equal(r.headers['retry-after'], '7');
      assert.equal(r.headers['x-should-retry'], 'true');
      assert.equal(r.headers['x-private'], undefined, 'only the headers SDKs read');
    }
    const rows = await recordedUsage(s, cases.length);
    assert.deepEqual(
      rows.map((row) => [row.status, row.http_status, row.weighted_units]),
      cases.map((c) => ['error', c.status, 0]),
    );
  } finally {
    await s.close();
  }
});

test("the gateway's own refusals say so, and nothing reaches a provider", async () => {
  const { s, sent, model, admin, token } = await anthropicModel(async () =>
    Response.json(anthropicJson()),
  );
  try {
    const call = (headers: Record<string, string>, url = '/model/anthropic/v1/messages') =>
      s.app.inject({ method: 'POST', url, headers, payload: requestBody });
    const signedOut = await call({ ...modelHeaders(model, token), authorization: 'Bearer x' });
    assert.equal(signedOut.statusCode, 401);
    assert.equal(signedOut.headers['x-maka-error'], 'unauthenticated');
    assert.equal(signedOut.json().maka.code, 'unauthenticated');
    const old = await call({ ...modelHeaders(model, token), 'x-maka-gateway-version': '0' });
    assert.equal(old.statusCode, 409);
    assert.equal(old.headers['x-maka-error'], 'upgrade_required');
    const unknown = await call({ ...modelHeaders(model, token), 'x-maka-model-id': 'm_nope' });
    assert.equal(unknown.statusCode, 403);
    assert.equal(unknown.headers['x-maka-error'], 'model_not_allowed');
    const wrongPath = await call(modelHeaders(model, token), '/model/openai/v1/chat/completions');
    assert.equal(wrongPath.statusCode, 400);
    assert.equal(wrongPath.json().maka.code, 'invalid_request');

    // Switched off, either the model or its provider: refused at once.
    const off = await consoleCall(s, admin, 'PATCH', `/models/${model.id}`, {
      expectedRevision: model.revision,
      enabled: false,
    });
    assert.equal(off.statusCode, 200, off.body);
    assert.equal((await call(modelHeaders(model, token))).statusCode, 403);
    const back = off.json() as ConsoleModel;
    await consoleCall(s, admin, 'PATCH', `/models/${model.id}`, {
      expectedRevision: back.revision,
      enabled: true,
    });
    const provider = (
      await consoleCall(s, admin, 'GET', `/model-providers/${model.provider.id}`)
    ).json();
    await consoleCall(s, admin, 'PATCH', `/model-providers/${model.provider.id}`, {
      expectedRevision: provider.revision,
      enabled: false,
    });
    const providerOff = await call(modelHeaders(model, token));
    assert.equal(providerOff.statusCode, 403);
    assert.equal(providerOff.headers['x-maka-error'], 'model_not_allowed');
    assert.equal(sent.length, 0);
    assert.equal((await usage(s)).length, 0, 'a refusal costs nothing');
  } finally {
    await s.close();
  }
});

test('a used-up allowance is refused before the provider, with when it resets', async () => {
  const { s, sent, model, admin, token } = await anthropicModel(async () =>
    Response.json(anthropicJson()),
  );
  try {
    await consoleCall(s, admin, 'PUT', '/quotas/default/week', { limit: 100 });
    const first = await s.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: modelHeaders(model, token),
      payload: requestBody,
    });
    assert.equal(first.statusCode, 200);
    await recordedUsage(s);
    const second = await s.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: modelHeaders(model, token),
      payload: requestBody,
    });
    assert.equal(second.statusCode, 429);
    assert.equal(second.headers['x-maka-error'], 'quota_exceeded');
    assert.equal(second.headers['x-should-retry'], 'false', 'not until the allowance resets');
    assert.equal(second.json().maka.retryAt, nextPeriodStart('week', s.clock.now).getTime());
    assert.equal(sent.length, 1);
  } finally {
    await s.close();
  }
});

test('an unreachable provider is a 502 from the gateway; retried only when nothing was sent', async () => {
  const failures = [
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
  ];
  let next = 0;
  const { s, model, token } = await anthropicModel(async () => {
    throw failures[next++];
  });
  try {
    const answers = [];
    for (let i = 0; i < failures.length; i++)
      answers.push(
        await s.app.inject({
          method: 'POST',
          url: '/model/anthropic/v1/messages',
          headers: modelHeaders(model, token),
          payload: requestBody,
        }),
      );
    assert.deepEqual(
      answers.map((r) => [r.statusCode, r.headers['x-maka-error'], r.headers['x-should-retry']]),
      [
        [502, 'upstream_unavailable', 'true'],
        [502, 'upstream_unavailable', 'false'],
      ],
    );
    const rows = await recordedUsage(s, 2);
    assert.ok(rows.every((row) => row.status === 'error' && row.weighted_units === 0));
  } finally {
    await s.close();
  }
});

test('a replaced key is used from the next request on; the conversation goes on', async () => {
  const { s, sent, model, admin, token } = await anthropicModel(async () =>
    Response.json(anthropicJson()),
  );
  try {
    const send = () =>
      s.app.inject({
        method: 'POST',
        url: '/model/anthropic/v1/messages',
        headers: modelHeaders(model, token),
        payload: requestBody,
      });
    assert.equal((await send()).statusCode, 200);
    const provider = (
      await consoleCall(s, admin, 'GET', `/model-providers/${model.provider.id}`)
    ).json();
    const replaced = await consoleCall(s, admin, 'PATCH', `/model-providers/${model.provider.id}`, {
      expectedRevision: provider.revision,
      credential: { apiKey: 'rotated-key' },
    });
    assert.equal(replaced.statusCode, 200, replaced.body);
    assert.equal((await send()).statusCode, 200);
    assert.deepEqual(
      sent.map((call) => call.headers.get('x-api-key')),
      ['test-key-Anthropic', 'rotated-key'],
    );
  } finally {
    await s.close();
  }
});

test("OpenRouter's routes, provider preferences and per-request plugins are the organization's", async () => {
  const sent: any[] = [];
  const s = await startTestServer(
    {},
    {
      upstreamFetch: async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return Response.json(chatJson());
      },
    },
  );
  try {
    const p = await publish(
      s,
      { name: 'Router', integration: 'openrouter', config: {}, credential: { apiKey: 'or' } },
      ['anthropic/claude-sonnet-4.6'],
    );
    const r = await s.app.inject({
      method: 'POST',
      url: '/model/openai/v1/chat/completions',
      headers: modelHeaders(p.models[0]!, await accessToken(s)),
      payload: {
        model: 'anthropic/claude-sonnet-4.6',
        messages: [{ role: 'user', content: 'Hi' }],
        models: ['openai/gpt-5'],
        fallbacks: ['x'],
        route: 'fallback',
        provider: { data_collection: 'allow' },
        plugins: [{ id: 'web' }],
      },
    });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(sent[0].model, 'anthropic/claude-sonnet-4.6');
    for (const field of ['models', 'fallbacks', 'route', 'provider', 'plugins'])
      assert.equal(sent[0][field], undefined, field);
  } finally {
    await s.close();
  }
});

test('real SDKs call through each protocol path and read the native answers', async () => {
  const lanes: readonly {
    integration: ModelIntegrationId;
    id: string;
    wire: ModelApiProtocol;
    answer: () => object;
    factory: (baseURL: string, fetchFn: typeof fetch) => LanguageModel;
  }[] = [
    {
      integration: 'anthropic',
      id: 'claude-sonnet-4-6',
      wire: 'anthropic-messages',
      answer: anthropicJson,
      factory: (baseURL, fetch) =>
        createAnthropic({ baseURL, apiKey: 'desktop-placeholder', fetch }).chat(
          'claude-sonnet-4-6',
        ),
    },
    {
      integration: 'custom-chat',
      id: 'qwen3-coder',
      wire: 'openai-chat',
      answer: chatJson,
      factory: (baseURL, fetch) =>
        createOpenAI({ baseURL, apiKey: 'desktop-placeholder', fetch }).chat('qwen3-coder'),
    },
    {
      integration: 'openai',
      id: 'gpt-5.4',
      wire: 'openai-responses',
      answer: responsesJson,
      factory: (baseURL, fetch) =>
        createOpenAI({ baseURL, apiKey: 'desktop-placeholder', fetch }).responses('gpt-5.4'),
    },
    {
      integration: 'gemini',
      id: 'gemini-2.5-pro',
      wire: 'google-generate',
      answer: googleJson,
      factory: (baseURL, fetch) =>
        createGoogleGenerativeAI({ baseURL, apiKey: 'desktop-placeholder', fetch }).chat(
          'gemini-2.5-pro',
        ),
    },
    {
      integration: 'openrouter',
      id: 'anthropic/claude-sonnet-4.6',
      wire: 'openai-chat',
      answer: chatJson,
      factory: (baseURL, fetch) =>
        createOpenAICompatible({
          name: 'openrouter',
          baseURL,
          apiKey: 'placeholder',
          fetch,
        }).chatModel('anthropic/claude-sonnet-4.6'),
    },
  ];
  for (const lane of lanes) {
    let sent: { url: string; body: any; headers: Headers } | undefined;
    const s = await startTestServer(
      {},
      {
        upstreamFetch: async (url, init) => {
          sent = {
            url: String(url),
            body: JSON.parse(String(init?.body)),
            headers: new Headers(init?.headers),
          };
          return Response.json(lane.answer());
        },
      },
    );
    try {
      const p = await publish(
        s,
        {
          name: lane.integration,
          integration: lane.integration,
          config: lane.integration.startsWith('custom-')
            ? { baseUrl: 'https://custom.test/v1' }
            : {},
          credential: { apiKey: 'server-secret' },
        },
        [lane.id],
      );
      const m = p.models[0]!;
      assert.equal(m.contract.apiProtocol, lane.wire, lane.integration);
      const token = await accessToken(s);
      const gatewayFetch: typeof fetch = async (url, init) => {
        const parsed = new URL(String(url));
        const r = await s.app.inject({
          method: 'POST',
          url: parsed.pathname + parsed.search,
          headers: { ...Object.fromEntries(new Headers(init?.headers)), ...modelHeaders(m, token) },
          payload: String(init?.body),
        });
        return new Response(r.body, {
          status: r.statusCode,
          headers: Object.fromEntries(Object.entries(r.headers).map(([k, v]) => [k, String(v)])),
        });
      };
      const path =
        lane.wire === 'anthropic-messages'
          ? '/model/anthropic/v1'
          : lane.wire === 'google-generate'
            ? '/model/gemini/v1beta'
            : '/model/openai/v1';
      const result = await lane.factory(`https://maka.test${path}`, gatewayFetch).doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
        maxOutputTokens: 1024,
      });
      assert.equal(result.content.find((c) => c.type === 'text')?.text, 'Hello', lane.integration);
      assert.ok(sent, lane.integration);
      assert.ok(!JSON.stringify(sent.body).includes(m.id), 'the m_ id stays at the gateway');
      assert.ok(!sent.headers.get('authorization')?.includes(token));
      assert.equal(sent.headers.get('x-maka-model-id'), null);
      if (lane.wire === 'openai-responses') assert.equal(sent.body.store, false);
      if (lane.integration === 'openrouter')
        assert.equal(sent.url, 'https://openrouter.ai/api/v1/chat/completions');
      if (lane.wire === 'google-generate')
        assert.ok(sent.url.endsWith('/models/gemini-2.5-pro:generateContent'));
      const [row] = await recordedUsage(s);
      assert.equal(row!.status, 'ok', lane.integration);
      assert.equal(row!.quality, 'reported', lane.integration);
    } finally {
      await s.close();
    }
  }
});

test('Vertex AI: one provider lists Claude and Gemini, each called with its publisher envelope', async () => {
  for (const region of ['us-east5', 'eu']) {
    const sent: { url: string; headers: Headers; body: any }[] = [];
    const s = await startTestServer(
      {},
      {
        upstreamFetch: async (url, init) => {
          sent.push({
            url: String(url),
            headers: new Headers(init?.headers),
            body: JSON.parse(String(init?.body)),
          });
          return Response.json(
            String(url).includes('/anthropic/') ? anthropicJson() : googleJson(),
          );
        },
      },
    );
    try {
      const p = await publish(
        s,
        {
          name: 'Vertex',
          integration: 'vertex',
          config: { projectId: 'my-project', region },
          credential: {
            serviceAccount: {
              type: 'service_account',
              client_email: 'gateway@example.test',
              private_key: 'fixture-only',
              token_uri: 'https://elsewhere.test/token',
            },
          },
        },
        ['claude-sonnet-4-5@20250929', 'gemini-2.5-pro'],
      );
      const [claude, gemini] = p.models;
      assert.equal(claude!.contract.apiProtocol, 'anthropic-messages');
      assert.equal(claude!.contract.sdkModelId, 'claude-sonnet-4-5-20250929');
      assert.equal(gemini!.contract.apiProtocol, 'google-generate');
      const token = await accessToken(s);
      const host =
        region === 'eu'
          ? 'aiplatform.eu.rep.googleapis.com'
          : `${region}-aiplatform.googleapis.com`;
      const toClaude = await s.app.inject({
        method: 'POST',
        url: '/model/anthropic/v1/messages',
        headers: { ...modelHeaders(claude!, token), 'anthropic-beta': 'b1' },
        payload: requestBody,
      });
      assert.equal(toClaude.statusCode, 200, toClaude.body);
      const toGemini = await s.app.inject({
        method: 'POST',
        url: '/model/gemini/v1beta/models/gemini-2.5-pro:generateContent',
        headers: modelHeaders(gemini!, token),
        payload: {
          contents: [{ role: 'user', parts: [{ text: 'Hi', thoughtSignature: 'opaque' }] }],
        },
      });
      assert.equal(toGemini.statusCode, 200, toGemini.body);
      assert.equal(
        sent[0]!.url,
        `https://${host}/v1/projects/my-project/locations/${region}/publishers/anthropic/models/claude-sonnet-4-5@20250929:rawPredict`,
      );
      assert.equal(sent[0]!.body.anthropic_version, 'vertex-2023-10-16');
      assert.equal(sent[0]!.body.model, undefined);
      assert.equal(sent[0]!.headers.get('anthropic-beta'), 'b1');
      assert.equal(sent[0]!.headers.get('authorization'), 'Bearer test-google-access-token');
      assert.equal(
        sent[1]!.url,
        `https://${host}/v1/projects/my-project/locations/${region}/publishers/google/models/gemini-2.5-pro:generateContent`,
      );
      assert.equal(sent[1]!.body.contents[0].parts[0].thoughtSignature, 'opaque');
      // Only the key's own fields are kept: no URL from the upload is ever fetched.
      const stored = await s.db
        .selectFrom('model_providers')
        .select(['id', 'credential_sealed'])
        .executeTakeFirstOrThrow();
      const opened = JSON.parse(
        s.ctx.secrets.open(stored.credential_sealed, `model-provider:${stored.id}`),
      );
      assert.equal(opened.serviceAccount.token_uri, undefined);
    } finally {
      await s.close();
    }
  }
});

test('a Google credential other than a service-account key is refused', async () => {
  const s = await startTestServer();
  try {
    const { admin } = await publish(s, anthropicDraft(), ['claude-sonnet-4-6']);
    const r = await consoleCall(s, admin, 'POST', '/model-providers/discover', {
      draft: {
        integration: 'vertex',
        config: { projectId: 'my-project', region: 'global' },
        credential: {
          serviceAccount: {
            type: 'external_account',
            client_email: 'x@example.test',
            private_key: 'k',
            credential_source: { url: 'http://169.254.169.254/' },
          },
        },
      },
    });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error.code, 'invalid_request');
  } finally {
    await s.close();
  }
});

test('a person who hangs up stops the provider, and what was produced is recorded as cancelled', async () => {
  let aborted = false;
  const { s, model, token } = await anthropicModel(
    async (_url, init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(
              new TextEncoder().encode(
                event({
                  type: 'message_start',
                  message: { usage: { input_tokens: 100, output_tokens: 1 } },
                }) +
                  event({
                    type: 'content_block_delta',
                    delta: { text: 'Partial output before cancellation' },
                  }),
              ),
            );
            init?.signal?.addEventListener(
              'abort',
              () => {
                aborted = true;
                c.error(new Error('aborted'));
              },
              { once: true },
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );
  try {
    const address = await s.app.listen({ host: '127.0.0.1', port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/model/anthropic/v1/messages`, {
      method: 'POST',
      headers: { ...modelHeaders(model, token), 'content-type': 'application/json' },
      body: JSON.stringify({ ...requestBody, stream: true }),
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => {});
    const [row] = await recordedUsage(s);
    assert.equal(aborted, true);
    assert.equal(row!.status, 'cancelled');
    assert.equal(row!.quality, 'estimated');
    assert.equal(Number(row!.input_tokens), 100);
    assert.ok(Number(row!.output_tokens) > 1);
  } finally {
    await s.close();
  }
});

test('a stream that ends early, or reports an error inside, is passed on and recorded as such', async () => {
  for (const inband of [false, true]) {
    const raw =
      event({
        type: 'message_start',
        message: { usage: { input_tokens: 100, output_tokens: 1 } },
      }) +
      event({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'x'.repeat(4000) },
      }) +
      (inband
        ? event({ type: 'error', error: { type: 'overloaded_error', message: 'failed' } })
        : '');
    const { s, model, token } = await anthropicModel(
      async () => new Response(raw, { headers: { 'content-type': 'text/event-stream' } }),
    );
    try {
      const r = await s.app.inject({
        method: 'POST',
        url: '/model/anthropic/v1/messages',
        headers: modelHeaders(model, token),
        payload: { ...requestBody, stream: true },
      });
      assert.equal(r.statusCode, 200);
      assert.equal(r.body, raw, 'the client sees exactly what the provider sent');
      const [row] = await recordedUsage(s);
      assert.equal(row!.status, inband ? 'error' : 'incomplete');
      assert.equal(row!.quality, 'estimated');
      assert.equal(Number(row!.output_tokens), 1000);
    } finally {
      await s.close();
    }
  }
});

test('Gemini and Responses answers with any finish reason pass through unchanged', async () => {
  const blocked = {
    candidates: [{ content: { parts: [] }, finishReason: 'OTHER', index: 0 }],
    usageMetadata: { promptTokenCount: 50, totalTokenCount: 50 },
  };
  const incomplete = {
    ...responsesJson(),
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
  };
  const s = await startTestServer(
    {},
    {
      upstreamFetch: async (url) =>
        Response.json(String(url).endsWith('/responses') ? incomplete : blocked),
    },
  );
  try {
    const google = await publish(
      s,
      { name: 'Google', integration: 'gemini', config: {}, credential: { apiKey: 'g' } },
      ['gemini-2.5-pro'],
    );
    const openai = await publish(
      s,
      { name: 'OpenAI', integration: 'openai', config: {}, credential: { apiKey: 'o' } },
      ['gpt-5.4'],
      google.admin,
    );
    const token = await accessToken(s);
    const g = await s.app.inject({
      method: 'POST',
      url: '/model/gemini/v1beta/models/gemini-2.5-pro:generateContent',
      headers: modelHeaders(google.models[0]!, token),
      payload: { contents: [{ role: 'user', parts: [{ text: 'Hi' }] }] },
    });
    assert.equal(g.statusCode, 200);
    assert.deepEqual(g.json(), blocked);
    const o = await s.app.inject({
      method: 'POST',
      url: '/model/openai/v1/responses',
      headers: modelHeaders(openai.models[0]!, token),
      payload: { model: 'gpt-5.4', input: 'Hi' },
    });
    assert.equal(o.statusCode, 200);
    assert.deepEqual(o.json(), incomplete);
    const rows = await recordedUsage(s, 2);
    assert.deepEqual(
      rows.map((row) => row.status),
      ['ok', 'ok'],
    );
  } finally {
    await s.close();
  }
});

test('usage counts cached input and reasoning once, in every protocol', () => {
  const read = (protocol: ModelApiProtocol, answer: object) => {
    const meter = new GatewayUsageMeter(protocol, false);
    meter.feed(new TextEncoder().encode(JSON.stringify(answer)));
    meter.finish();
    return meter.result();
  };
  assert.deepEqual(read('anthropic-messages', anthropicJson()), {
    usage: { input: 100, output: 42, cacheWrite: 20, cacheRead: 300 },
    quality: 'reported',
  });
  // Cached tokens are part of OpenAI's input count; reasoning is part of its output.
  assert.deepEqual(read('openai-chat', chatJson()).usage, {
    input: 40,
    output: 40,
    cacheWrite: 0,
    cacheRead: 60,
  });
  assert.deepEqual(read('openai-responses', responsesJson()).usage, {
    input: 40,
    output: 40,
    cacheWrite: 0,
    cacheRead: 60,
  });
  // Gemini's thoughts are counted beside its candidates.
  assert.deepEqual(read('google-generate', googleJson()).usage, {
    input: 40,
    output: 40,
    cacheWrite: 0,
    cacheRead: 60,
  });
});

test('a streamed answer is read across any chunking, CRLF and multibyte splits', () => {
  const raw = anthropicStream().replaceAll('\n', '\r\n');
  const bytes = new TextEncoder().encode(raw);
  const meter = new GatewayUsageMeter('anthropic-messages', true);
  for (let i = 0; i < bytes.length; i += 7) meter.feed(bytes.slice(i, i + 7));
  meter.finish();
  assert.equal(meter.complete, true);
  assert.deepEqual(meter.result(), {
    usage: { input: 100, output: 42, cacheWrite: 20, cacheRead: 300 },
    quality: 'reported',
  });
  // Every split falls inside a three-byte character somewhere.
  const chatBytes = new TextEncoder().encode(
    `${event({ choices: [{ delta: { content: '你好世界' } }] })}${event({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } })}data: [DONE]\n\n`,
  );
  for (const size of [1, 2, 4, 5]) {
    const chat = new GatewayUsageMeter('openai-chat', true);
    for (let i = 0; i < chatBytes.length; i += size) chat.feed(chatBytes.slice(i, i + size));
    chat.finish();
    assert.equal(chat.complete, true, `chunks of ${size}`);
    assert.deepEqual(chat.result().usage, { input: 10, output: 2, cacheWrite: 0, cacheRead: 0 });
  }
});

test('an event too large to read is passed over, and the answer is still counted', () => {
  const huge = event({
    candidates: [{ content: { parts: [{ inlineData: { data: 'A'.repeat(9 * 1024 * 1024) } }] } }],
  });
  const tail = event({
    candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 1300 },
  });
  const bytes = new TextEncoder().encode(huge + tail);
  const meter = new GatewayUsageMeter('google-generate', true);
  const started = performance.now();
  for (let i = 0; i < bytes.length; i += 64 * 1024) meter.feed(bytes.slice(i, i + 64 * 1024));
  meter.finish();
  assert.ok(performance.now() - started < 2000, 'each chunk is searched once');
  assert.equal(meter.complete, true);
  assert.deepEqual(meter.result(), {
    usage: { input: 40, output: 1300, cacheWrite: 0, cacheRead: 0 },
    quality: 'reported',
  });
  // A whole JSON answer of that size is read too.
  const whole = new GatewayUsageMeter('google-generate', false);
  whole.feed(
    new TextEncoder().encode(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ inlineData: { data: 'A'.repeat(9 * 1024 * 1024) } }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 1300 },
      }),
    ),
  );
  whole.finish();
  assert.equal(whole.result().quality, 'reported');
  assert.equal(whole.result().usage.output, 1300);
});

test('an answer that broke off before its usage counts the request it was sent', async () => {
  const s = await startTestServer(
    {},
    {
      upstreamFetch: async () =>
        new Response(event({ type: 'response.output_text.delta', delta: 'Hello' }), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    },
  );
  try {
    const p = await publish(
      s,
      { name: 'OpenAI', integration: 'openai', config: {}, credential: { apiKey: 'o' } },
      ['gpt-5.4'],
    );
    const prompt = 'Summarise the attached report. '.repeat(1250);
    // As the OpenAI SDKs write an image: a data URL.
    const image = `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024)}`;
    const r = await s.app.inject({
      method: 'POST',
      url: '/model/openai/v1/responses',
      headers: modelHeaders(p.models[0]!, await accessToken(s)),
      payload: {
        model: 'gpt-5.4',
        stream: true,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: image },
            ],
          },
        ],
      },
    });
    assert.equal(r.statusCode, 200);
    const [row] = await recordedUsage(s);
    assert.equal(row!.status, 'incomplete');
    assert.equal(row!.quality, 'estimated');
    // The text by its length; the image as one image, not by its base64.
    const input = Number(row!.input_tokens);
    assert.ok(input >= 10_000 && input < 15_000, String(input));
  } finally {
    await s.close();
  }
});

test('the version gate refuses in the protocol shape, marked as the gateway, not to be retried', async () => {
  const s = await startTestServer({ minimumClientVersion: '9.0.0' });
  try {
    const r = await s.app.inject({
      method: 'POST',
      url: '/model/openai/v1/chat/completions',
      headers: { 'x-maka-client-version': '0.2.0' },
      payload: { model: 'x', messages: [] },
    });
    assert.equal(r.statusCode, 426);
    assert.equal(r.headers['x-maka-error'], 'upgrade_required');
    assert.equal(r.headers['x-should-retry'], 'false');
    assert.equal(r.json().maka.code, 'upgrade_required');
    assert.equal(r.json().error.type, 'maka_gateway_error');
  } finally {
    await s.close();
  }
});

test('a provider whose credential cannot be used is refused without inviting a retry, until the key is replaced', async () => {
  const { s, sent, model, admin, token } = await anthropicModel(async () =>
    Response.json(anthropicJson()),
  );
  try {
    // The sealed credential no longer opens (rotated master key, damaged row).
    await s.db.updateTable('model_providers').set({ credential_sealed: 'damaged' }).execute();
    const r = await s.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: modelHeaders(model, token),
      payload: requestBody,
    });
    assert.equal(r.statusCode, 502);
    assert.equal(r.headers['x-maka-error'], 'upstream_unavailable');
    assert.equal(r.headers['x-should-retry'], 'false', 'it would fail the same way again');
    assert.equal(sent.length, 0);
    const provider = await consoleCall(s, admin, 'GET', `/model-providers/${model.provider.id}`);
    const replaced = await consoleCall(s, admin, 'PATCH', `/model-providers/${model.provider.id}`, {
      expectedRevision: provider.json().revision,
      credential: { apiKey: 'replacement-key' },
    });
    assert.equal(replaced.statusCode, 200, replaced.body);
    const again = await s.app.inject({
      method: 'POST',
      url: '/model/anthropic/v1/messages',
      headers: modelHeaders(model, token),
      payload: requestBody,
    });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(sent[0]!.headers.get('x-api-key'), 'replacement-key');
  } finally {
    await s.close();
  }
});

test('a custom service is called at the address given, as the desktop calls it directly', () => {
  const at = (integration: ModelIntegrationId, baseUrl: string) =>
    providerBaseUrl(integration, validateProviderConfig(integration, { baseUrl }));
  assert.equal(
    at('custom-chat', 'https://generativelanguage.googleapis.com/v1beta/openai/'),
    'https://generativelanguage.googleapis.com/v1beta/openai',
  );
  assert.equal(at('custom-responses', 'https://llm.test/api/responses'), 'https://llm.test/api');
  assert.equal(
    at('custom-anthropic', 'https://llm.test/anthropic'),
    'https://llm.test/anthropic/v1',
  );
  assert.equal(
    at('custom-anthropic', 'https://llm.test/anthropic/v1/'),
    'https://llm.test/anthropic/v1',
  );
  // An official service's address override still gains its version.
  assert.equal(at('openai', 'https://proxy.test'), 'https://proxy.test/v1');
  assert.equal(providerBaseUrl('gemini', {}), 'https://generativelanguage.googleapis.com/v1beta');
  // An empty query or fragment parses away; it is refused all the same.
  for (const baseUrl of ['https://llm.test/v1?', 'https://llm.test/v1#'])
    assert.throws(() => validateProviderConfig('custom-chat', { baseUrl }));
});

test('periods begin Monday 00:00 UTC and on the 1st', () => {
  const wednesday = new Date('2026-09-30T15:00:00Z');
  assert.equal(periodStart('week', wednesday).toISOString(), '2026-09-28T00:00:00.000Z');
  assert.equal(nextPeriodStart('week', wednesday).toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(periodStart('month', wednesday).toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(nextPeriodStart('month', wednesday).toISOString(), '2026-10-01T00:00:00.000Z');
});
