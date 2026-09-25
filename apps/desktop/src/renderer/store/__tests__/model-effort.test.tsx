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

// The composer model chip's effort readout, and the Models settings line that
// says where the model catalog came from.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import type { ChatModelChoice } from '@maka/core/chat-model-choice';
import type { UiLocale } from '@maka/core/ui-locale';
import { LocaleProvider } from '@maka/ui';
import { TooltipProvider } from '../../components/ui/tooltip.js';
import { ModelMenu } from '../../components/composer/ModelMenu.js';
import { modelCatalogDescription } from '../../components/settings/models/ModelCatalogStatusRow.js';
import { getSettingsModelsCopy } from '../../locales/settings-models-copy.js';

function choice(overrides: Partial<ChatModelChoice>): ChatModelChoice {
  return {
    connectionId: 'c1',
    connectionSlug: 'codex',
    providerType: 'openai-codex',
    providerLabel: 'OpenAI',
    model: 'gpt-6-sol',
    label: 'GPT-6 Sol',
    isDefault: true,
    thinkingLevels: ['low', 'medium', 'high'],
    thinkingSource: 'provider',
    reasoningSupport: 'yes',
    thinkingDeclarable: false,
    ...overrides,
  };
}

function chip(model: ChatModelChoice, current?: 'low' | 'high', locale: UiLocale = 'zh-CN') {
  const html = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale,
      children: createElement(TooltipProvider, {
        children: createElement(ModelMenu, {
          choices: [model],
          current: { connectionSlug: model.connectionSlug, model: model.model },
          thinking: { current, onChange: () => {} },
          onPick: () => {},
          onOpenSettings: () => {},
        }),
      }),
    }),
  );
  return parseHTML(html).document.querySelector('button')?.textContent ?? '';
}

test('the chip names the level in force and leaves the model name room', () => {
  // Model default with a provider-declared default: the chip shows that level
  // alone; "model default" is the menu's word, not the chip's.
  assert.equal(chip(choice({ defaultThinkingLevel: 'high' })), 'GPT-6 Sol高');
  assert.equal(
    chip(choice({ defaultThinkingLevel: 'medium' }), undefined, 'en'),
    'GPT-6 SolMedium',
  );
  // A chosen level wins over the default.
  assert.equal(chip(choice({ defaultThinkingLevel: 'high' }), 'low'), 'GPT-6 Sol低');
  // Nothing chosen and no known default: the model name alone.
  assert.equal(chip(choice({})), 'GPT-6 Sol');
  // A stored level the model no longer offers is dropped on the wire, so the
  // chip shows the default in force instead.
  assert.equal(
    chip(choice({ thinkingLevels: ['medium', 'high'], defaultThinkingLevel: 'high' }), 'low'),
    'GPT-6 Sol高',
  );
});

test('a model with no levels shows no effort on the chip', () => {
  assert.equal(
    chip(choice({ thinkingLevels: [], thinkingSource: 'none', reasoningSupport: 'unknown' })),
    'GPT-6 Sol',
  );
});

test('the catalog line says which table is in force and the last failure', () => {
  const zh = getSettingsModelsCopy('zh-CN');
  assert.equal(
    modelCatalogDescription(
      { active: 'bundled', fetchedAt: null, lastAttempt: null, nextAttemptAt: null },
      zh,
      'zh-CN',
    ),
    '使用随应用内置的模型目录',
  );
  const failed = modelCatalogDescription(
    {
      active: 'cache',
      fetchedAt: Date.UTC(2026, 8, 24, 2, 0),
      lastAttempt: { at: 1, outcome: 'failed', error: 'timeout' },
      nextAttemptAt: 2,
    },
    zh,
    'zh-CN',
  );
  assert.match(failed, /^models\.dev · .+ 更新（本机缓存）。最近一次刷新失败：timeout$/);
  const en = modelCatalogDescription(
    {
      active: 'refreshed',
      fetchedAt: Date.UTC(2026, 8, 24, 2, 0),
      lastAttempt: { at: 1, outcome: 'unchanged' },
      nextAttemptAt: 2,
    },
    getSettingsModelsCopy('en'),
    'en',
  );
  assert.match(en, /^models\.dev · updated .+$/);
});
