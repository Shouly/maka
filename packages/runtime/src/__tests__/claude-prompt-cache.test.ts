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
import type { LanguageModelV4Prompt } from '@ai-sdk/provider';
import type { RuntimeExecutionConnection } from '@maka/core/llm-connections';
import {
  placeAnthropicCacheBreakpoints,
  placeOpenRouterCacheBreakpoints,
} from '../claude-prompt-cache.js';
import { buildProviderOptions, getAIModel } from '../model-factory.js';

const EPHEMERAL = { type: 'ephemeral' };

/** Where a body asks to be cached: `top`, `system`, or `m<index>:<block>`. */
function breakpoints(body: any): string[] {
  const found: string[] = body.cache_control ? ['top'] : [];
  if (Array.isArray(body.system) && body.system.some((block: any) => block.cache_control)) {
    found.push('system');
  }
  body.messages.forEach((message: any, index: number) => {
    if (!Array.isArray(message.content)) return;
    message.content.forEach((block: any, at: number) => {
      if (block.cache_control) found.push(`m${index}:${at}`);
    });
  });
  return found;
}

const anthropicTurn = () => ({
  model: 'claude-opus-5-5',
  cache_control: EPHEMERAL,
  system: [{ type: 'text', text: 'You are Maka.' }],
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Read a.txt' }] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Read it.', signature: 'sig' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.txt' } },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'hello' }] },
  ],
});

test('a Claude request is cached at its system prompt and where the previous request ended', () => {
  const body = anthropicTurn();
  const placed = placeAnthropicCacheBreakpoints(body) as any;
  assert.deepEqual(breakpoints(placed), ['top', 'system', 'm0:0']);
  assert.deepEqual(placed.system, [
    { type: 'text', text: 'You are Maka.', cache_control: EPHEMERAL },
  ]);
  // The caller's body is left as it was.
  assert.deepEqual(breakpoints(body), ['top']);

  // The next step ended the previous request on the tool result: the read is pinned there.
  const next = anthropicTurn();
  next.messages.push(
    { role: 'assistant', content: [{ type: 'text', text: 'It says hello.' }] } as any,
    { role: 'user', content: [{ type: 'text', text: 'Thanks' }] },
  );
  assert.deepEqual(breakpoints(placeAnthropicCacheBreakpoints(next)), ['top', 'system', 'm2:0']);
});

test('the first request has only its system prompt to pin, and a string prompt becomes a block', () => {
  const placed = placeAnthropicCacheBreakpoints({
    cache_control: EPHEMERAL,
    system: 'You are Maka.',
    messages: [{ role: 'user', content: 'Hi' }],
  }) as any;
  assert.deepEqual(placed.system, [
    { type: 'text', text: 'You are Maka.', cache_control: EPHEMERAL },
  ]);
  assert.equal(placed.messages[0].content, 'Hi');
  assert.deepEqual(breakpoints(placed), ['top', 'system']);
});

test('breakpoints never pass four, and never land on thinking or empty text', () => {
  const crowded = anthropicTurn() as any;
  crowded.tools = [
    { name: 'a', cache_control: EPHEMERAL },
    { name: 'b', cache_control: EPHEMERAL },
  ];
  // Top-level plus two tools leaves one: the system prompt takes it.
  assert.deepEqual(breakpoints(placeAnthropicCacheBreakpoints(crowded)), ['top', 'system']);
  crowded.tools.push({ name: 'c', cache_control: EPHEMERAL });
  assert.deepEqual(breakpoints(placeAnthropicCacheBreakpoints(crowded)), ['top']);

  const thinking = anthropicTurn() as any;
  thinking.messages[0].content = [{ type: 'redacted_thinking', data: 'x' }];
  thinking.system = [{ type: 'text', text: '' }];
  assert.deepEqual(breakpoints(placeAnthropicCacheBreakpoints(thinking)), ['top']);
});

test('OpenRouter pins only the system and user text parts it documents', () => {
  const toolLoop = {
    model: 'anthropic/claude-opus-5.5',
    cache_control: EPHEMERAL,
    messages: [
      { role: 'system', content: 'You are Maka.' },
      { role: 'user', content: 'Read a.txt' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't1' }] },
      { role: 'tool', tool_call_id: 't1', content: 'hello' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't2' }] },
      { role: 'tool', tool_call_id: 't2', content: 'world' },
    ],
  };
  const placed = placeOpenRouterCacheBreakpoints(toolLoop) as any;
  assert.deepEqual(placed.messages[0].content, [
    { type: 'text', text: 'You are Maka.', cache_control: EPHEMERAL },
  ]);
  // The previous request ended on a tool message: left to the lookback.
  assert.deepEqual(breakpoints(placed), ['top', 'm0:0']);
  assert.equal(placed.messages[3].content, 'hello');

  const nextTurn = {
    cache_control: EPHEMERAL,
    messages: [
      { role: 'system', content: 'You are Maka.' },
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'Again' },
    ],
  };
  assert.deepEqual(breakpoints(placeOpenRouterCacheBreakpoints(nextTurn)), ['top', 'm0:0', 'm1:0']);
});

const conversation: LanguageModelV4Prompt = [
  { role: 'system', content: 'You are Maka.' },
  { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
  { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
  { role: 'user', content: [{ type: 'text', text: 'Again' }] },
];

async function sentBody(connection: RuntimeExecutionConnection, modelId: string): Promise<any> {
  let body: any;
  const model = getAIModel({
    connection,
    apiKey: 'test-key',
    modelId,
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ error: { message: 'fixture refusal' } }, { status: 400 });
    },
  });
  await assert.rejects(
    async () =>
      await model.doGenerate({
        prompt: conversation,
        providerOptions: buildProviderOptions(connection, modelId),
      }),
  );
  return body;
}

const connection = (providerType: string, baseUrl: string): RuntimeExecutionConnection =>
  ({ slug: 'personal', providerType, baseUrl }) as RuntimeExecutionConnection;

test('Claude on the Anthropic API and on OpenRouter is sent all three breakpoints', async () => {
  const anthropic = await sentBody(
    connection('anthropic', 'https://anthropic.test/v1'),
    'claude-opus-5-5',
  );
  assert.deepEqual(breakpoints(anthropic), ['top', 'system', 'm0:0']);

  const openRouter = await sentBody(
    connection('openrouter', 'https://router.test/v1'),
    'anthropic/claude-opus-5.5',
  );
  assert.deepEqual(breakpoints(openRouter), ['top', 'm0:0', 'm1:0']);
  assert.equal(openRouter.messages[0].role, 'system');
});

test('services that only speak a protocol, and other OpenRouter models, are sent no breakpoints', async () => {
  const compatible = await sentBody(
    connection('anthropic-compatible', 'https://proxy.test/v1'),
    'claude-opus-5-5',
  );
  assert.deepEqual(breakpoints(compatible), []);
  const otherModel = await sentBody(
    connection('openrouter', 'https://router.test/v1'),
    'openai/gpt-5.6-sol',
  );
  assert.deepEqual(breakpoints(otherModel), []);
});
