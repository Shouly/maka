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
import { describe, test } from 'node:test';

import { resolveNativeToolDeferral } from '../native-tool-deferral.js';
import type { ResolvedModelRuntime } from '../model-runtime.js';

type Wire = Pick<ResolvedModelRuntime, 'wire' | 'adapter'>;

const anthropic = { wire: 'anthropic-messages', adapter: { kind: 'anthropic' } } as unknown as Wire;
const openAiResponses = {
  wire: 'openai-responses',
  adapter: { kind: 'openai' },
} as unknown as Wire;
const codex = {
  wire: 'openai-responses',
  adapter: { kind: 'openai-codex' },
} as unknown as Wire;
const compatible = {
  wire: 'openai-chat',
  adapter: { kind: 'openai-compatible' },
} as unknown as Wire;

describe('resolveNativeToolDeferral', () => {
  test('current Claude models defer natively', () => {
    for (const id of [
      'claude-opus-5',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-6',
      'claude-haiku-4-5',
      'claude-fable-5-1',
    ]) {
      assert.equal(resolveNativeToolDeferral(anthropic, id), 'anthropic', id);
    }
  });

  test('Claude models older than tool search keep the withholding path', () => {
    for (const id of [
      'claude-opus-4-1-20250805',
      'claude-opus-4-0',
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-2.1',
    ]) {
      assert.equal(resolveNativeToolDeferral(anthropic, id), undefined, id);
    }
  });

  test('OpenAI Responses defers from gpt-5.4 on', () => {
    for (const id of ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5', 'gpt-5.6-luna', 'gpt-6-astra']) {
      assert.equal(resolveNativeToolDeferral(openAiResponses, id), 'openai-responses', id);
    }
  });

  test('OpenAI models before tool search keep the withholding path', () => {
    for (const id of ['gpt-5.3-codex', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'o3']) {
      assert.equal(resolveNativeToolDeferral(openAiResponses, id), undefined, id);
    }
  });

  test('Codex is the same wire and validates the same parameters', () => {
    // openai/codex#19486: its own backend answers `Deferred tools require
    // tools.tool_search`, which is a request it understood.
    assert.equal(resolveNativeToolDeferral(codex, 'gpt-6-astra'), 'openai-responses');
    assert.equal(resolveNativeToolDeferral(codex, 'gpt-5.6-sol'), 'openai-responses');
    assert.equal(resolveNativeToolDeferral(codex, 'gpt-5.3-codex'), undefined);
  });

  test('a wire with no notion of deferral keeps the withholding path', () => {
    // An OpenAI-compatible chat endpoint is not the Responses API, whatever
    // model it happens to be serving.
    assert.equal(resolveNativeToolDeferral(compatible, 'gpt-5.4'), undefined);
    assert.equal(resolveNativeToolDeferral(compatible, 'deepseek-chat'), undefined);
  });

  test('an unnamed model claims nothing', () => {
    assert.equal(resolveNativeToolDeferral(anthropic, '   '), undefined);
  });

  test('a model this cannot identify is treated as unsupported, not as new', () => {
    // An `anthropic` connection can point anywhere, and a gateway answers to
    // names that were never Anthropic's. Guessing "new enough" there sends a
    // parameter the endpoint may reject outright.
    for (const id of ['mock-model-id', 'claude-custom', 'my-gateway/claude', 'anthropic.claude']) {
      assert.equal(resolveNativeToolDeferral(anthropic, id), undefined, id);
    }
  });
});
