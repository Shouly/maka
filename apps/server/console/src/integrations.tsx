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

// The provider services an administrator can add, as the console shows them:
// the four groups and their cards (the three compatible APIs are one card,
// the API a choice inside it), a service's mark, its name in a row, and a
// catalog model's abilities in a few words.

import { MODEL_INTEGRATIONS, type ModelIntegrationId } from '@maka/core/model-gateway';
import type { ModelExecutionContract } from '@maka/core/model-gateway';
import type { ConsoleModelProvider } from '../../src/admin-console/types.js';
import { Anthropicon } from '@desktop/components/icons/Anthropicon.js';
import { cn } from '@desktop/lib/cn.js';
import { ProviderBrandMark } from '@desktop/lib/ported/provider-brand-marks.js';
import type { ConsoleCopy, ConsoleLocale } from './copy.js';
import { formatCompact } from './format.js';

/** A card in the add flow's first step. */
export type IntegrationChoice =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'openrouter'
  | 'vertex'
  | 'custom';
export type CustomIntegration = 'custom-anthropic' | 'custom-chat' | 'custom-responses';

export const CUSTOM_INTEGRATIONS: readonly CustomIntegration[] = [
  'custom-anthropic',
  'custom-chat',
  'custom-responses',
];

export const INTEGRATION_GROUPS: readonly {
  readonly group: keyof ConsoleCopy['integrations']['groups'];
  readonly choices: readonly IntegrationChoice[];
}[] = [
  { group: 'official', choices: ['anthropic', 'openai', 'gemini'] },
  { group: 'aggregator', choices: ['openrouter'] },
  { group: 'cloud', choices: ['vertex'] },
  { group: 'custom', choices: ['custom'] },
];

export function isCustom(integration: ModelIntegrationId): integration is CustomIntegration {
  return MODEL_INTEGRATIONS[integration].group === 'custom';
}

export function choiceOf(integration: ModelIntegrationId): IntegrationChoice {
  return isCustom(integration) ? 'custom' : integration;
}

/** A card's title: the service's own name, or the compatible-API card's. */
export function choiceLabel(copy: ConsoleCopy, choice: IntegrationChoice): string {
  return choice === 'custom' ? copy.integrations.custom : MODEL_INTEGRATIONS[choice].label;
}

/** A provider's service in a row: a compatible service names its API. */
export function integrationLabel(copy: ConsoleCopy, integration: ModelIntegrationId): string {
  const label = MODEL_INTEGRATIONS[integration].label;
  return isCustom(integration) ? copy.integrations.customLabel(label) : label;
}

/** Where a provider's requests go, as its settings say. */
export function providerAddress(provider: Pick<ConsoleModelProvider, 'integration' | 'config'>): {
  readonly url: string;
  readonly official: boolean;
} {
  const configured = provider.config.baseUrl;
  if (typeof configured === 'string' && configured) return { url: configured, official: false };
  return { url: MODEL_INTEGRATIONS[provider.integration].baseUrl, official: true };
}

export function configText(
  provider: Pick<ConsoleModelProvider, 'config'>,
  key: 'projectId' | 'region',
): string {
  const value = provider.config[key];
  return typeof value === 'string' ? value : '';
}

/** "200K 上下文 · 图片 · 工具 · 思考": what a model takes and can do. */
export function capabilitySummary(
  copy: ConsoleCopy,
  locale: ConsoleLocale,
  contract: ModelExecutionContract,
): string {
  const text = copy.integrations.capabilities;
  const { capabilities } = contract;
  return [
    capabilities.contextWindow
      ? text.context(formatCompact(locale, capabilities.contextWindow))
      : undefined,
    capabilities.inputModalities.includes('image') ? text.image : undefined,
    capabilities.inputModalities.includes('pdf') ? text.pdf : undefined,
    capabilities.supportsTools ? text.tools : undefined,
    capabilities.supportsReasoning ? text.thinking : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Mark(props: { choice: IntegrationChoice; size: 16 | 20 }) {
  switch (props.choice) {
    case 'anthropic':
      return <ProviderBrandMark type="anthropic" />;
    case 'openai':
      return <ProviderBrandMark type="openai" />;
    case 'gemini':
      return <ProviderBrandMark type="google" />;
    case 'openrouter':
      return <ProviderBrandMark type="openrouter" />;
    case 'vertex':
      return <Anthropicon name="globe" size={props.size} />;
    case 'custom':
      return <Anthropicon name="code" size={props.size} />;
  }
}

/**
 * A service's mark on a white tile with a half-pixel ring, as provider marks
 * are drawn in Maka's Settings: 24px in rows and headers, 36px on cards.
 */
export function IntegrationMark(props: {
  integration: ModelIntegrationId | IntegrationChoice;
  size?: 'sm' | 'md';
}) {
  const choice =
    props.integration === 'custom' ? 'custom' : choiceOf(props.integration as ModelIntegrationId);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center bg-surface-3 text-text-secondary shadow-[inset_0_0_0_0.5px_var(--alpha-3)]',
        props.size === 'md'
          ? 'size-9 rounded-lg [&>img]:size-5 [&>svg]:size-5'
          : 'size-6 rounded-[6.5px] [&>img]:size-4 [&>svg]:size-4',
      )}
    >
      <Mark choice={choice} size={props.size === 'md' ? 20 : 16} />
    </span>
  );
}
