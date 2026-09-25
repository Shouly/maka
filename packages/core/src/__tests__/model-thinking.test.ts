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
import {
  type ConnectionThinkingContext,
  normalizeModelOverrides,
  modelOverride,
  resolveModelThinking,
  resolveThinkingLevel,
  thinkingOptionsForModel,
  thinkingVariantsForModel,
  supportsRelayFastServiceTier,
} from '../model-thinking.js';
import { isRelayProviderType } from '../llm-connections.js';

test('declarable relay levels are every intensity tier but off', () => {
  // `off` is a disable-wire encoding (reasoning_effort 'none'), not an
  // intensity tier — a hybrid UI/data contract keeps it out of declarations.
  assert.deepEqual(normalizeModelOverrides({ m: { thinkingLevels: ['off', 'low'] } }), {
    m: { thinkingLevels: ['low'] },
  });
  assert.deepEqual(normalizeModelOverrides({ m: { thinkingLevels: ['off'] } }), { m: {} });
  const declaredOff = {
    providerType: 'openai-compatible',
    modelOverrides: { m: { thinkingLevels: ['off', 'low'] } },
  } as const;
  assert.deepEqual([...resolveModelThinking(declaredOff, 'm').levels], ['low']);
});

test('resolveModelThinking takes the highest source that speaks', () => {
  // gpt-6-sol is in the catalog (models.dev) with none..max.
  const catalogOnly = resolveModelThinking({ providerType: 'openai-codex' }, 'gpt-6-sol');
  assert.equal(catalogOnly.source, 'catalog');
  assert.deepEqual(catalogOnly.levels, ['off', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(catalogOnly.defaultLevel, undefined);

  // The provider's own list outranks the catalog and brings its default.
  const advertised = resolveModelThinking(
    {
      providerType: 'openai-codex',
      models: [
        { id: 'gpt-6-sol', thinkingLevels: ['low', 'high', 'max'], defaultThinkingLevel: 'high' },
      ],
    },
    'gpt-6-sol',
  );
  assert.equal(advertised.source, 'provider');
  assert.deepEqual(advertised.levels, ['low', 'high', 'max']);
  assert.equal(advertised.defaultLevel, 'high');
  assert.equal(advertised.reasoning, 'yes');

  // The user's declaration outranks both; a provider default outside it is dropped.
  const declared = resolveModelThinking(
    {
      providerType: 'openai-compatible',
      models: [{ id: 'm', thinkingLevels: ['low', 'high'], defaultThinkingLevel: 'high' }],
      modelOverrides: { m: { thinkingLevels: ['low'] } },
    },
    'm',
  );
  assert.equal(declared.source, 'user');
  assert.deepEqual(declared.levels, ['low']);
  assert.equal(declared.defaultLevel, undefined);
});

test('resolveModelThinking tells an unknown model from a non-reasoning one', () => {
  const unknown = resolveModelThinking({ providerType: 'openai-compatible' }, 'mystery-model');
  assert.deepEqual(unknown, { levels: [], source: 'none', reasoning: 'unknown' });

  const plain = resolveModelThinking(
    {
      providerType: 'openai-compatible',
      models: [{ id: 'instruct', capabilities: { reasoning: false } }],
    },
    'instruct',
  );
  assert.equal(plain.reasoning, 'no');

  const reasonsWithoutKnob = resolveModelThinking(
    {
      providerType: 'openai-compatible',
      models: [{ id: 'reasoner', capabilities: { reasoning: true } }],
    },
    'reasoner',
  );
  assert.deepEqual(reasonsWithoutKnob.levels, []);
  assert.equal(reasonsWithoutKnob.reasoning, 'yes');

  // The user's own capability declaration outranks the provider row.
  const declaredReasoner = resolveModelThinking(
    {
      providerType: 'openai-compatible',
      models: [{ id: 'm', capabilities: { reasoning: false } }],
      modelOverrides: { m: { capabilities: { reasoning: true } } },
    },
    'm',
  );
  assert.equal(declaredReasoner.reasoning, 'yes');
});

test('relay profiles preserve the fast service tier declaration', () => {
  assert.deepEqual(normalizeModelOverrides({ m: { serviceTier: 'fast' } }), {
    m: { serviceTier: 'fast' },
  });
  assert.deepEqual(normalizeModelOverrides({ m: { serviceTier: 'unknown' } }), { m: {} });
});

test('Fast visibility mirrors the pinned OpenAI SDK priority-processing families', () => {
  const cases = [
    ['gpt-4o', true],
    ['gpt-4.1', true],
    ['gpt-5', true],
    ['gpt-5.1', true],
    ['gpt-5-nano', false],
    ['gpt-5-chat-latest', false],
    ['o3-mini', true],
    ['o4-mini', true],
    ['plain-relay-id', false],
  ] as const;
  for (const [modelId, expected] of cases) {
    assert.equal(supportsRelayFastServiceTier('openai-responses-compatible', modelId), expected);
    assert.equal(supportsRelayFastServiceTier('openai-compatible', modelId), false);
  }
});

test('modelOverride returns undefined without a usable declaration', () => {
  const connection = {
    providerType: 'openai-compatible',
    modelOverrides: {
      empty: {},
      junk: 'nope',
      badLevels: { thinkingLevels: 'low' },
      unknownLevels: { thinkingLevels: ['turbo'] },
      offOnly: { thinkingLevels: ['off'] },
      badVision: { vision: 'yes' },
    },
  } as unknown as ConnectionThinkingContext;
  for (const modelId of [
    'missing',
    'empty',
    'junk',
    'badLevels',
    'unknownLevels',
    'offOnly',
    'badVision',
  ]) {
    assert.deepEqual(
      modelOverride(connection, modelId),
      ['missing', 'junk'].includes(modelId) ? undefined : {},
      modelId,
    );
  }
});

test('modelOverride normalizes order, keeps explicit vision:false, and bounds context windows', () => {
  const connection = {
    providerType: 'openai-compatible',
    modelOverrides: {
      reasoner: { thinkingLevels: ['high', 'low', 'turbo'], vision: false },
      visual: { vision: true },
    },
  } as unknown as ConnectionThinkingContext;
  // Declared levels keep display order; unknown values are dropped;
  // vision:false is a meaningful DISABLE, distinct from absence (Auto).
  assert.deepEqual(modelOverride(connection, 'reasoner'), {
    thinkingLevels: ['low', 'high'],
    vision: false,
  });
  assert.deepEqual(modelOverride(connection, 'visual'), { vision: true });

  const windowed = (contextWindow: unknown) =>
    ({
      providerType: 'openai-compatible' as const,
      modelOverrides: { m: { contextWindow } },
    }) as unknown as ConnectionThinkingContext;
  assert.deepEqual(modelOverride(windowed(128_000), 'm'), { contextWindow: 128_000 });
  // Unusable values degrade to "no declaration", not to a lie.
  for (const bad of [0, -1, 1.5, 2 ** 60, '128000', null]) {
    assert.deepEqual(modelOverride(windowed(bad), 'm'), {}, JSON.stringify(bad));
  }
});

test('modelOverride honours a declaration on any provider', () => {
  const profiles = { m: { vision: true, contextWindow: 64_000 } };
  // A declaration is a user statement about one model, and the reason to make
  // one — Maka has no other way to learn the fact — is not confined to relays:
  // it holds for any model newer than the bundled snapshot, and for every
  // model on a provider with no model-list endpoint (#1584).
  for (const providerType of [
    'openai-compatible',
    'openai-responses-compatible',
    'anthropic',
    'volcengine-agent-plan',
  ] as const) {
    assert.deepEqual(modelOverride({ providerType, modelOverrides: profiles }, 'm'), {
      vision: true,
      contextWindow: 64_000,
    });
  }
  // Absent stays absent: an undeclared model falls through to the metadata chain.
  assert.equal(
    modelOverride({ providerType: 'anthropic', modelOverrides: profiles }, 'other'),
    undefined,
  );
});

test('isRelayProviderType only accepts the two custom OpenAI relay providers', () => {
  assert.equal(isRelayProviderType('openai-compatible'), true);
  assert.equal(isRelayProviderType('openai-responses-compatible'), true);
  assert.equal(isRelayProviderType('openai'), false);
  assert.equal(isRelayProviderType('anthropic'), false);
});

test('normalizeModelOverrides sanitizes write-side tables', () => {
  const sanitized = normalizeModelOverrides({
    reasoner: { thinkingLevels: ['high', 'low', 'turbo'], vision: true, contextWindow: 200_000 },
    empty: {},
    junk: 'not-an-entry',
    huge: { contextWindow: 2 ** 60 },
    '': { vision: true },
    [`${'x'.repeat(513)}`]: { vision: true },
  });
  assert.deepEqual(sanitized, {
    empty: {},
    huge: {},
    reasoner: { thinkingLevels: ['low', 'high'], vision: true, contextWindow: 200_000 },
  });
  assert.equal(normalizeModelOverrides({}), undefined);
  assert.equal(normalizeModelOverrides(undefined), undefined);
  assert.equal(normalizeModelOverrides({ junk: 'not-an-entry' }), undefined);
  // Relay-supplied ids may be prototype keys; the table defines them as own
  // data properties or the entries would vanish on the next enumeration.
  const hostile = normalizeModelOverrides(
    JSON.parse('{"__proto__":{"vision":true},"toString":{"contextWindow":64}}'),
  );
  assert.deepEqual(Object.keys(hostile ?? {}).sort(), ['__proto__', 'toString']);
  assert.equal(JSON.stringify(hostile).includes('"__proto__"'), true);
});

test('resolveThinkingLevel discards levels the model does not offer', () => {
  const relay = {
    providerType: 'openai-compatible',
    modelOverrides: { m: { thinkingLevels: ['off', 'low'] } },
  } as const;
  assert.equal(resolveThinkingLevel(relay, 'm', 'low'), 'low');
  // `off` is not declarable for relays: a stray entry degrades to absent.
  assert.equal(resolveThinkingLevel(relay, 'm', 'off'), undefined);
  assert.equal(resolveThinkingLevel(relay, 'm', 'max'), undefined);
  assert.equal(resolveThinkingLevel(relay, 'm', undefined), undefined);
  assert.equal(resolveThinkingLevel({ providerType: 'openai' }, 'gpt-5.5', 'xhigh'), 'xhigh');
  // A level only the provider advertised passes the gate too.
  const codex = {
    providerType: 'openai-codex',
    models: [{ id: 'future-model', thinkingLevels: ['low', 'max'] as ['low', 'max'] }],
  } as const;
  assert.equal(resolveThinkingLevel(codex, 'future-model', 'max'), 'max');
  assert.equal(resolveThinkingLevel(codex, 'future-model', 'medium'), undefined);
});

test('Alibaba Token Plan exposes the formal Qwen3.8 effort and disable contract', () => {
  for (const providerType of ['alibaba-token-plan-cn', 'alibaba-token-plan'] as const) {
    assert.deepEqual(
      [...thinkingVariantsForModel(providerType, 'qwen3.8-max')],
      ['off', 'low', 'medium', 'xhigh'],
      providerType,
    );
    assert.equal(resolveThinkingLevel({ providerType }, 'qwen3.8-max', 'off'), 'off', providerType);
  }
});

// Reasoning replay has no toggle: DeepSeek-like relays require
// reasoning_content in tool-call history (400 otherwise), and other relays
// ignore it, so the runtime replays unconditionally. That contract is
// enforced per provider by the runtime provider-contract matrix, not here.
