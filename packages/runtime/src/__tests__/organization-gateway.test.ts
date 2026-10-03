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
import { generateText, isStepCount, streamText } from 'ai';
import { z } from 'zod';
import {
  EXECUTION_PROFILES,
  type ExecutionProfileId,
  type ModelExecutionContract,
} from '@maka/core/model-gateway';
import type { RuntimeExecutionConnection } from '@maka/core/llm-connections';
import { resolveModelThinking } from '@maka/core/model-thinking';
import { lookupConnectionModelMetadata, lookupModelMetadata } from '@maka/core/model-metadata';
import { decodeConnectionModel } from '@maka/core/runtime-policy';
import { buildProviderOptions, getAIModel } from '../model-factory.js';
import { resolveModelRuntime } from '../model-runtime.js';
import { fetchOrganizationCatalogModels } from '../model-fetcher.js';
import { ModelAdapter } from '../model-adapter.js';
import { resolveSelectedModelContextWindow } from '../context-budget-policy.js';
import { resolveNativeToolDeferral } from '../native-tool-deferral.js';
import { testConnection } from '../test-connection.js';
import {
  createOrganizationModelFetch,
  type OrganizationAccessToken,
} from '../organization-model-fetch.js';

function fixture(profileId: ExecutionProfileId, sdkModelId: string) {
  const profile = EXECUTION_PROFILES[profileId];
  const contract: ModelExecutionContract = {
    apiProtocol: profile.apiProtocol,
    profileId,
    sdkModelId,
    capabilities: {
      inputModalities: ['text', 'image'],
      supportsTools: true,
      supportsReasoning: true,
      supportsStructuredOutput: true,
      contextWindow: 200000,
      maxOutputTokens: 32000,
      thinkingLevels: ['low', 'high'],
    },
  };
  const connection: RuntimeExecutionConnection = {
    slug: 'organization',
    providerType: 'organization',
    baseUrl: 'https://organization.test',
    defaultModel: 'm_company',
    models: [
      {
        id: 'm_company',
        apiProtocol: profile.apiProtocol,
        executionContract: contract,
        availability: 'available',
        thinkingLevels: ['low', 'high'],
        contextWindow: 200000,
        maxOutputTokens: 32000,
        capabilities: { functionCalling: true, reasoning: true },
      },
    ],
  };
  return { contract, connection };
}

const catalogResponse = (models: readonly unknown[]) =>
  Response.json({ schemaVersion: 1, revision: '1', models });

for (const streaming of [false, true]) {
  test(`organization OpenRouter preserves the direct-client tool loop (${streaming ? 'SSE' : 'JSON'})`, async () => {
    const sdkModelId = 'anthropic/claude-opus-5.5';
    const requestsByRoute: Array<Array<Record<string, any>>> = [];
    for (const organization of [false, true]) {
      const requests: Array<Record<string, any>> = [];
      requestsByRoute.push(requests);
      const connection: RuntimeExecutionConnection = organization
        ? fixture('openrouter-chat', sdkModelId).connection
        : {
            slug: 'personal-router',
            providerType: 'openrouter',
            baseUrl: 'https://router.test/v1',
            defaultModel: sdkModelId,
          };
      const model = getAIModel({
        connection,
        apiKey: 'fixture-key',
        modelId: organization ? 'm_company' : sdkModelId,
        sessionId: 'tool-loop-session',
        fetch: async (url, init) => {
          requests.push(JSON.parse(String(init?.body)));
          assert.equal(
            new URL(String(url)).pathname,
            organization ? '/model/openai/v1/chat/completions' : '/v1/chat/completions',
          );
          assert.equal(
            new Headers(init?.headers).get('x-maka-model-id'),
            organization ? 'm_company' : null,
          );
          const first = requests.length === 1;
          const message = first
            ? {
                role: 'assistant',
                content: null,
                reasoning: 'Read the fixture.',
                // Optional provider extensions must not opt the original client into
                // a new signed-history contract during the gateway refactor.
                reasoning_details: [
                  {
                    type: 'reasoning.text',
                    text: 'Read the fixture.',
                    signature: 'fixture-signature',
                  },
                ],
                tool_calls: [
                  {
                    id: 'call-echo',
                    type: 'function',
                    function: { name: 'echo', arguments: '{"value":"hello"}' },
                  },
                ],
              }
            : { role: 'assistant', content: 'Echoed hello.' };
          const finishReason = first ? 'tool_calls' : 'stop';
          const usage = { prompt_tokens: 10, completion_tokens: 5 };
          if (!streaming)
            return Response.json({
              id: 'completion',
              created: 1,
              model: sdkModelId,
              choices: [{ index: 0, message, finish_reason: finishReason }],
              usage,
            });
          const chunk = (delta: unknown, finish_reason: string | null) => ({
            id: 'completion',
            object: 'chat.completion.chunk',
            created: 1,
            model: sdkModelId,
            choices: [{ index: 0, delta, finish_reason }],
            ...(finish_reason ? { usage } : {}),
          });
          const delta = {
            ...message,
            ...(message.tool_calls
              ? { tool_calls: message.tool_calls.map((call) => ({ ...call, index: 0 })) }
              : {}),
          };
          return new Response(
            [chunk(delta, null), chunk({}, finishReason)]
              .map((value) => `data: ${JSON.stringify(value)}\n\n`)
              .join('') + 'data: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          );
        },
      });
      const input = {
        model,
        prompt: 'Echo hello.',
        stopWhen: isStepCount(2),
        tools: {
          echo: {
            inputSchema: z.object({ value: z.string() }),
            execute: async ({ value }: { value: string }) => ({ echoed: value }),
          },
        },
      };
      const text = streaming ? await streamText(input).text : (await generateText(input)).text;
      assert.equal(text, 'Echoed hello.');
      assert.equal(requests.length, 2);
      const assistant = requests[1]!.messages.find((message: any) => message.role === 'assistant');
      assert.equal(assistant.reasoning, 'Read the fixture.');
      assert.equal(assistant.reasoning_details, undefined);
      assert.equal(assistant.tool_calls.length, 1);
      assert.doesNotMatch(JSON.stringify(requests[1]), /reasoning_details|fixture-signature/);
      assert.ok(requests[1]!.messages.some((message: any) => message.role === 'tool'));
    }
    assert.deepEqual(requestsByRoute[1], requestsByRoute[0]);
  });
}

test('each profile is called on its wire, for the provider model id, with nothing but the model id added', async () => {
  const lanes: readonly [ExecutionProfileId, string, string][] = [
    ['anthropic', 'claude-sonnet-4-6', '/model/anthropic/v1/messages'],
    ['openai-responses', 'gpt-5.4', '/model/openai/v1/responses'],
    ['google', 'gemini-2.5-pro', '/model/gemini/v1beta/models/gemini-2.5-pro:generateContent'],
    ['openrouter-chat', 'anthropic/claude-sonnet-4.6', '/model/openai/v1/chat/completions'],
    ['compatible-anthropic', 'claude-sonnet-4-6', '/model/anthropic/v1/messages'],
    ['compatible-chat', 'gpt-4.1', '/model/openai/v1/chat/completions'],
    ['compatible-responses', 'gpt-5.4', '/model/openai/v1/responses'],
  ];
  for (const [profileId, id, path] of lanes) {
    const { connection, contract } = fixture(profileId, id);
    const runtime = resolveModelRuntime(connection, 'm_company');
    assert.equal(runtime.sdkModelId, id);
    assert.equal(runtime.wire, contract.apiProtocol);
    let seen: any;
    const model = getAIModel({
      connection,
      apiKey: 'org-placeholder',
      modelId: 'm_company',
      sessionId: 'durable-session',
      fetch: async (url, init) => {
        seen = {
          url: String(url),
          headers: new Headers(init?.headers),
          body: JSON.parse(String(init?.body)),
        };
        return Response.json({ error: { message: 'rejected' } }, { status: 400 });
      },
    });
    assert.equal(model.modelId, id);
    await assert.rejects(
      async () =>
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          providerOptions: buildProviderOptions(connection, 'm_company', 'high'),
          maxOutputTokens: 5000,
        }),
    );
    assert.equal(new URL(seen.url).pathname, path, profileId);
    assert.equal(seen.headers.get('x-maka-model-id'), 'm_company', profileId);
    assert.deepEqual(
      [...seen.headers.keys()].filter((name: string) => name.startsWith('x-maka-')),
      ['x-maka-model-id'],
      profileId,
    );
    if (profileId !== 'google') assert.equal(seen.body.model, id, profileId);
    if (profileId === 'anthropic') assert.equal(seen.body.thinking.type, 'adaptive');
    if (profileId === 'openai-responses') {
      assert.equal(seen.body.store, false);
      assert.ok(seen.body.include.includes('reasoning.encrypted_content'));
      assert.equal(seen.body.previous_response_id, undefined);
      assert.equal(seen.body.reasoning.effort, 'high');
    }
  }
});

test('a compatible profile is called exactly as a compatible connection of its own is', () => {
  for (const [profileId, sdkModelId] of [
    ['compatible-anthropic', 'claude-sonnet-4-6'],
    ['compatible-chat', 'gpt-5.4'],
    ['compatible-responses', 'gpt-5.4'],
  ] as const) {
    const { connection } = fixture(profileId, sdkModelId);
    const {
      executionContract: _contract,
      availability: _availability,
      ...row
    } = connection.models![0]!;
    const own: RuntimeExecutionConnection = {
      slug: 'organization',
      providerType: EXECUTION_PROFILES[profileId].providerType,
      baseUrl: 'https://relay.test/v1',
      defaultModel: sdkModelId,
      models: [{ ...row, id: sdkModelId }],
    };
    const organization = resolveModelRuntime(connection, 'm_company');
    const direct = resolveModelRuntime(own, sdkModelId);
    assert.deepEqual(organization.adapter, direct.adapter, profileId);
    assert.equal(organization.wire, direct.wire, profileId);
    assert.deepEqual(organization.reasoningReplay, direct.reasoningReplay, profileId);
    assert.deepEqual(organization.applyPatchProfile, direct.applyPatchProfile, profileId);
    assert.equal(organization.parallelToolCalls, direct.parallelToolCalls, profileId);
    assert.equal(
      resolveNativeToolDeferral(organization, organization.sdkModelId!),
      resolveNativeToolDeferral(direct, sdkModelId),
      profileId,
    );
    assert.deepEqual(
      buildProviderOptions(connection, 'm_company', 'high'),
      buildProviderOptions(own, sdkModelId, 'high'),
      profileId,
    );
  }
});

test("a compatible profile gets none of the vendor's own features its vendor profile gets", async () => {
  // Prompt caching is Anthropic's own API's.
  const bodies = new Map<ExecutionProfileId, string>();
  for (const profileId of ['anthropic', 'compatible-anthropic'] as const) {
    const { connection } = fixture(profileId, 'claude-sonnet-4-6');
    const model = getAIModel({
      connection,
      apiKey: 'org-placeholder',
      modelId: 'm_company',
      fetch: async (_url, init) => {
        bodies.set(profileId, String(init?.body));
        return Response.json({ error: { message: 'rejected' } }, { status: 400 });
      },
    });
    await assert.rejects(
      async () =>
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
          providerOptions: buildProviderOptions(connection, 'm_company'),
        }),
    );
  }
  assert.match(bodies.get('anthropic')!, /"cache_control"/);
  assert.doesNotMatch(bodies.get('compatible-anthropic')!, /"cache_control"/);

  // The structured ApplyPatch tool is OpenAI's own Responses API's.
  assert.deepEqual(
    resolveModelRuntime(fixture('openai-responses', 'gpt-5.4').connection, 'm_company')
      .applyPatchProfile,
    { kind: 'openai-structured' },
  );
  assert.equal(
    resolveModelRuntime(fixture('compatible-responses', 'gpt-5.4').connection, 'm_company')
      .applyPatchProfile,
    null,
  );
});

test('organization off-only reasoning controls survive catalog decoding and reach the native SDK', async () => {
  for (const [profileId, sdkModelId] of [
    ['anthropic', 'claude-sonnet-4-5'],
    ['google', 'gemini-2.5-flash'],
  ] as const) {
    const initial = fixture(profileId, sdkModelId);
    const contract = {
      ...initial.contract,
      capabilities: { ...initial.contract.capabilities, thinkingLevels: ['off'] as const },
    };
    const models = await fetchOrganizationCatalogModels(
      'https://organization.test',
      'token',
      async () =>
        Response.json({
          schemaVersion: 1,
          revision: '1',
          models: [
            { id: 'm_company', displayName: sdkModelId, availability: 'available', contract },
          ],
        }),
    );
    assert.deepEqual(models[0]!.thinkingLevels, ['off']);
    const connection = { ...initial.connection, models };
    let body: any;
    const model = getAIModel({
      connection,
      apiKey: 'placeholder',
      modelId: 'm_company',
      sessionId: 's',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ error: { message: 'fixture refusal' } }, { status: 400 });
      },
    });
    await assert.rejects(
      async () =>
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
          providerOptions: buildProviderOptions(connection, 'm_company', 'off'),
          maxOutputTokens: 100,
        }),
    );
    if (profileId === 'anthropic') assert.deepEqual(body.thinking, { type: 'disabled' });
    else assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
  }
});

test('the catalog decodes every profile and keeps each contract as published', async () => {
  const profiles = Object.keys(EXECUTION_PROFILES) as ExecutionProfileId[];
  const models = profiles.map((p, i) => ({
    id: `m_${i}`,
    displayName: p,
    availability: i === 0 ? 'provider_disabled' : 'available',
    contract: fixture(p, p === 'google' ? 'gemini-2.5-pro' : 'model').contract,
  }));
  let version = '';
  const found = await fetchOrganizationCatalogModels(
    'https://organization.test',
    'token',
    async (_url, init) => {
      version = new Headers(init?.headers).get('x-maka-gateway-version') ?? '';
      return catalogResponse(models);
    },
  );
  assert.equal(version, '1');
  assert.equal(found.length, profiles.length);
  assert.equal(found[0]!.availability, 'provider_disabled');
  for (const [i, m] of found.entries()) {
    assert.deepEqual(m.executionContract, models[i]!.contract);
    assert.deepEqual(decodeConnectionModel(m), m);
  }
  // A catalog in another schema is refused whole.
  await assert.rejects(() =>
    fetchOrganizationCatalogModels('https://organization.test', 'token', async () =>
      Response.json({ schemaVersion: 2, revision: '5', models }),
    ),
  );
});

test('a model the desktop cannot use is left out of the catalog, and only that model', async (t) => {
  const warned = t.mock.method(console, 'warn', () => undefined);
  const good = fixture('anthropic', 'claude-sonnet-4-6').contract;
  const found = await fetchOrganizationCatalogModels(
    'https://organization.test',
    'token',
    async () =>
      catalogResponse([
        { id: 'm_first', displayName: 'First', availability: 'available', contract: good },
        {
          id: 'm_unwired',
          displayName: 'Unwired',
          availability: 'available',
          contract: { ...good, profileId: 'unwired' },
        },
        {
          id: 'm_mismatched',
          displayName: 'Mismatched',
          availability: 'available',
          contract: { ...good, apiProtocol: 'openai-chat' },
        },
        { id: 'm_state', displayName: 'State', availability: 'retired', contract: good },
        {
          id: 'm_newer',
          displayName: 'Newer',
          availability: 'available',
          // A field a newer server adds is not kept, and does not cost the model.
          contract: { ...good, futureField: true, capabilities: { ...good.capabilities, more: 1 } },
        },
      ]),
  );
  assert.deepEqual(
    found.map((model) => model.id),
    ['m_first', 'm_newer'],
  );
  assert.deepEqual(found[1]!.executionContract, good);
  assert.equal(warned.mock.callCount(), 3);
  assert.match(String(warned.mock.calls[0]!.arguments[0]), /m_unwired/);
});

test("what the catalog leaves out comes from the contract's metadata entry, never over what it says", async () => {
  const reference = lookupModelMetadata('anthropic', 'claude-sonnet-4-6');
  assert.ok(reference.knowledgeCutoff, 'the premise: the bundled metadata names a cutoff');
  assert.ok(reference.contextWindow, 'the premise: the bundled metadata names a window');
  const { contract } = fixture('compatible-anthropic', 'company-claude-alias');
  const capabilities = { ...contract.capabilities };
  delete (capabilities as { contextWindow?: number }).contextWindow;
  const [filled, stated] = await fetchOrganizationCatalogModels(
    'https://organization.test',
    'token',
    async () =>
      catalogResponse([
        {
          id: 'm_filled',
          displayName: 'Filled',
          availability: 'available',
          contract: {
            ...contract,
            capabilities,
            metadataRef: { providerType: 'anthropic', modelId: 'claude-sonnet-4-6' },
          },
        },
        {
          id: 'm_stated',
          displayName: 'Stated',
          availability: 'available',
          contract: {
            ...contract,
            metadataRef: { providerType: 'anthropic', modelId: 'claude-sonnet-4-6' },
          },
        },
      ]),
  );
  assert.equal(filled!.knowledgeCutoff, reference.knowledgeCutoff);
  assert.equal(filled!.contextWindow, reference.contextWindow);
  assert.equal(filled!.inputLimit, reference.inputLimit);
  assert.equal(stated!.contextWindow, 200000, "the catalog's own window stands");
  assert.equal(stated!.inputLimit, undefined, "and is not narrowed by the entry's");
  assert.equal(stated!.maxOutputTokens, 32000);
});

test("an organisation model's limits and cutoff resolve through its metadata entry", () => {
  const reference = lookupModelMetadata('anthropic', 'claude-sonnet-4-6');
  const { connection } = fixture('compatible-anthropic', 'company-claude-alias');
  // A stored row that says nothing of its own window or cutoff.
  const { contextWindow: _window, executionContract, ...row } = connection.models![0]!;
  const bare: RuntimeExecutionConnection = {
    ...connection,
    models: [
      {
        ...row,
        executionContract: {
          ...executionContract!,
          metadataRef: { providerType: 'anthropic', modelId: 'claude-sonnet-4-6' },
        },
      },
    ],
  };
  assert.deepEqual(
    lookupModelMetadata('organization', 'm_company'),
    {},
    'the organisation id itself describes nothing',
  );
  // What a Host composer reads for <knowledge_cutoff>.
  assert.equal(
    lookupConnectionModelMetadata(bare, 'm_company').knowledgeCutoff,
    reference.knowledgeCutoff,
  );
  // What the context budget reads.
  const window = Math.min(
    ...[reference.contextWindow, reference.inputLimit].filter(
      (value): value is number => value !== undefined,
    ),
  );
  assert.equal(resolveSelectedModelContextWindow(bare, 'm_company'), window);
});

test("only the gateway's own 401 earns a fresh token; the provider's 401 goes back as it came", async () => {
  const tokens: boolean[] = [];
  const sent: string[] = [];
  const respond: Response[] = [];
  const fetch = createOrganizationModelFetch({
    token: async ({ forceRefresh }): Promise<OrganizationAccessToken> => {
      tokens.push(forceRefresh);
      return { accessToken: forceRefresh ? 'fresh' : 'stale', clientVersion: '0.2.0' };
    },
    fetchFn: async (_url, init) => {
      const headers = new Headers(init?.headers);
      sent.push(headers.get('authorization')!);
      assert.equal(headers.get('x-api-key'), null, 'the SDK key never leaves');
      assert.equal(headers.get('x-maka-gateway-version'), '1');
      assert.equal(headers.get('x-maka-client-version'), '0.2.0');
      assert.equal(init?.redirect, 'manual');
      return respond.shift()!;
    },
  });
  const call = () =>
    fetch('https://organization.test/model/anthropic/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': 'organization-account' },
      body: '{}',
    });

  // The provider refused the organisation's key: a new account token cannot help.
  respond.push(
    Response.json(
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      { status: 401 },
    ),
  );
  assert.equal((await call()).status, 401);
  assert.deepEqual(tokens, [false]);
  assert.deepEqual(sent, ['Bearer stale']);

  // The gateway refused the account token: refreshed once and sent again.
  tokens.length = 0;
  sent.length = 0;
  respond.push(
    Response.json(
      { type: 'error', error: { type: 'authentication_error', message: 'Sign in again' } },
      { status: 401, headers: { 'x-maka-error': 'unauthenticated' } },
    ),
    Response.json({ ok: true }),
  );
  assert.equal((await call()).status, 200);
  assert.deepEqual(tokens, [false, true]);
  assert.deepEqual(sent, ['Bearer stale', 'Bearer fresh']);
});

test('organization Chat models send their selected reasoning effort and parallel-tool policy', async () => {
  for (const profile of ['openrouter-chat', 'compatible-chat'] as const) {
    const { connection } = fixture(profile, 'anthropic/claude-opus-5.5');
    connection.models![0]!.capabilities!.parallelToolCalls = false;
    let body: any;
    const model = getAIModel({
      connection,
      apiKey: 'test-key',
      modelId: 'm_company',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ error: { message: 'fixture refusal' } }, { status: 400 });
      },
    });
    await assert.rejects(
      async () =>
        await model.doGenerate({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
          providerOptions: buildProviderOptions(connection, 'm_company', 'high'),
        }),
    );
    assert.equal(body.reasoning_effort, 'high', profile);
    assert.equal(body.parallel_tool_calls, false, profile);
    // OpenRouter caches a Claude prompt only when asked; a custom service is
    // sent nothing it may not understand.
    assert.deepEqual(
      body.cache_control,
      profile === 'openrouter-chat' ? { type: 'ephemeral' } : undefined,
      profile,
    );
  }
});

test('organization Claude models are asked to cache as a direct Claude connection is', async () => {
  for (const [profile, sdkModelId, cached] of [
    ['anthropic', 'claude-opus-5-5', true],
    ['openrouter-chat', 'anthropic/claude-opus-5.5', true],
    ['compatible-anthropic', 'claude-opus-5-5', false],
  ] as const) {
    const { connection } = fixture(profile, sdkModelId);
    let body: any;
    const model = getAIModel({
      connection,
      apiKey: 'test-key',
      modelId: 'm_company',
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({ error: { message: 'fixture refusal' } }, { status: 400 });
      },
    });
    await assert.rejects(
      async () =>
        await model.doGenerate({
          prompt: [
            { role: 'system', content: 'You are Maka.' },
            { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
          ],
          providerOptions: buildProviderOptions(connection, 'm_company'),
        }),
    );
    const system = profile === 'openrouter-chat' ? body.messages[0].content : body.system;
    const systemEnd = Array.isArray(system) ? system.at(-1) : undefined;
    assert.equal(systemEnd?.cache_control?.type, cached ? 'ephemeral' : undefined, profile);
    assert.equal(body.cache_control?.type, cached ? 'ephemeral' : undefined, profile);
  }
});

test('organization OpenAI tools keep the same optional parameter semantics as direct OpenAI', async () => {
  for (const connection of [
    {
      slug: 'personal',
      providerType: 'openai',
      baseUrl: 'https://openai.test/v1',
      models: [{ id: 'gpt-5.4', apiProtocol: 'openai-responses' }],
    } as RuntimeExecutionConnection,
    fixture('openai-responses', 'gpt-5.4').connection,
  ]) {
    const modelId = connection.providerType === 'organization' ? 'm_company' : 'gpt-5.4';
    let body: any;
    const adapter = new ModelAdapter({
      connection,
      apiKey: 'test-key',
      modelId,
      newId: () => 'id',
      now: () => 0,
      modelFactory: (input) =>
        getAIModel({
          ...input,
          fetch: async (_url, init) => {
            body = JSON.parse(String(init?.body));
            return Response.json({ error: { message: 'fixture refusal' } }, { status: 400 });
          },
        }),
    });
    const result = await adapter.startStream({
      model: adapter.resolveModel(),
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Find files' }] }],
      tools: {
        Glob: { inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }) },
      },
      activeTools: ['Glob'],
      onStreamActivity: () => {},
      abortSignal: new AbortController().signal,
      repairToolCall: async () => null,
    });
    for await (const event of result.events) void event;
    const tool = body.tools.find((entry: any) => entry.name === 'Glob');
    assert.equal(tool.strict, false, connection.providerType);
    assert.deepEqual(tool.parameters.required, ['pattern']);
  }
});

test('the organisation connection is not probed from here, and does not read as retired', async () => {
  const { connection } = fixture('anthropic', 'claude-sonnet-4-6');
  let sent = 0;
  const result = await testConnection(
    { ...connection, name: 'organization.test', enabled: true, createdAt: 1, updatedAt: 1 },
    'organization-account',
    'm_company',
    {
      fetch: async () => {
        sent += 1;
        return Response.json({});
      },
    },
  );
  assert.equal(result.ok, false);
  assert.match(result.errorMessage ?? '', /managed by your organization/);
  assert.doesNotMatch(result.errorMessage ?? '', /retired/);
  assert.equal(sent, 0, 'nothing spent from its allowance');
});

test("an organisation model's picker and its request agree on thinking", () => {
  const { connection: base, contract } = fixture('anthropic', 'claude-sonnet-4-6');
  const { thinkingLevels: _levels, ...capabilities } = contract.capabilities;
  const { thinkingLevels: _rowLevels, ...row } = base.models![0]!;
  const organization = (supportsReasoning: boolean): RuntimeExecutionConnection => ({
    ...base,
    models: [
      {
        ...row,
        capabilities: { ...row.capabilities, reasoning: supportsReasoning },
        executionContract: {
          ...contract,
          capabilities: { ...capabilities, supportsReasoning },
          metadataRef: { providerType: 'anthropic', modelId: 'claude-sonnet-4-6' },
        },
      },
    ],
  });
  const own: RuntimeExecutionConnection = {
    slug: 'anthropic',
    providerType: 'anthropic',
    defaultModel: 'claude-sonnet-4-6',
  };

  // The contract names no levels: the entry it names does, for the picker and
  // the request alike, and each offered level is asked for as the same model
  // on a person's own connection asks for it.
  const reasoning = organization(true);
  const picker = resolveModelThinking(reasoning, 'm_company');
  assert.deepEqual(picker.levels, resolveModelThinking(own, 'claude-sonnet-4-6').levels);
  assert.ok(picker.levels.length > 0, 'the premise: the entry offers levels');
  for (const level of [undefined, ...picker.levels]) {
    assert.deepEqual(
      buildProviderOptions(reasoning, 'm_company', level),
      buildProviderOptions(own, 'claude-sonnet-4-6', level),
      String(level),
    );
  }

  // The contract says it does not reason: the picker offers nothing, and the
  // request asks for no thinking, not even the provider type's default.
  const silent = organization(false);
  const none = resolveModelThinking(silent, 'm_company');
  assert.deepEqual(none.levels, []);
  assert.equal(none.reasoning, 'no');
  assert.ok(
    (buildProviderOptions(own, 'claude-sonnet-4-6').anthropic as Record<string, unknown>).thinking,
    'the premise: the same model on its own asks for thinking by default',
  );
  for (const level of [undefined, ...picker.levels]) {
    const options = buildProviderOptions(silent, 'm_company', level);
    assert.deepEqual(
      options,
      { anthropic: { cacheControl: { type: 'ephemeral' } } },
      String(level),
    );
  }
});
