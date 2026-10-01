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

// What an organization model is, shared by the server that publishes it and
// the desktop that calls it: the provider integrations an administrator can
// connect, and the execution contract each published model carries. The
// desktop builds every request with its own SDK adapter for the contract's
// protocol; the server only forwards it (see platform-protocol).

/** Exact request wire. Adapters, rather than users, own message serialization. */
export type ModelApiProtocol =
  | 'anthropic-messages'
  | 'openai-chat'
  | 'openai-responses'
  | 'google-generate';

/**
 * How the desktop calls a model: the wire, and the provider type whose
 * existing direct-connection rules (thinking options, native tools, caching)
 * apply. A compatible service gets the compatible provider type, so nothing
 * only the vendor's own API implements is switched on for it.
 */
export const EXECUTION_PROFILES = {
  anthropic: { apiProtocol: 'anthropic-messages', providerType: 'anthropic' },
  'openai-responses': { apiProtocol: 'openai-responses', providerType: 'openai' },
  google: { apiProtocol: 'google-generate', providerType: 'google' },
  'openrouter-chat': { apiProtocol: 'openai-chat', providerType: 'openrouter' },
  'compatible-anthropic': {
    apiProtocol: 'anthropic-messages',
    providerType: 'anthropic-compatible',
  },
  'compatible-chat': { apiProtocol: 'openai-chat', providerType: 'openai-compatible' },
  'compatible-responses': {
    apiProtocol: 'openai-responses',
    providerType: 'openai-responses-compatible',
  },
} as const;
export type ExecutionProfileId = keyof typeof EXECUTION_PROFILES;

export interface GatewayModelCapabilities {
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly inputModalities: readonly ('text' | 'image' | 'audio' | 'video' | 'pdf')[];
  readonly supportsTools: boolean;
  readonly supportsReasoning: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly parallelToolCalls?: boolean;
  readonly thinkingLevels?: readonly (
    | 'off'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max'
  )[];
  readonly defaultThinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

/**
 * Fixed when the model is published and never changed under it: a different
 * wire or model is a different organization model.
 */
export interface ModelExecutionContract {
  readonly apiProtocol: ModelApiProtocol;
  readonly profileId: ExecutionProfileId;
  /** The provider's own model id, given to the SDK; never the `m_…` organization id. */
  readonly sdkModelId: string;
  /** Where the desktop looks up what the catalog does not say (knowledge cutoff and the like). */
  readonly metadataRef?: { readonly providerType: string; readonly modelId: string };
  readonly capabilities: GatewayModelCapabilities;
}

export type ModelIntegrationGroup = 'official' | 'aggregator' | 'cloud' | 'custom';

/**
 * The provider accounts an administrator can connect. `profiles` are the
 * contracts its models may be published under: one, except Vertex AI, whose
 * Claude and Gemini models each keep their publisher's own wire.
 */
export const MODEL_INTEGRATIONS = {
  anthropic: {
    label: 'Anthropic',
    group: 'official',
    profiles: ['anthropic'],
    baseUrl: 'https://api.anthropic.com/v1',
    discovery: 'anthropic',
    auth: 'api-key',
  },
  openai: {
    label: 'OpenAI',
    group: 'official',
    profiles: ['openai-responses'],
    baseUrl: 'https://api.openai.com/v1',
    discovery: 'openai',
    auth: 'api-key',
  },
  gemini: {
    label: 'Google Gemini',
    group: 'official',
    profiles: ['google'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    discovery: 'google',
    auth: 'api-key',
  },
  openrouter: {
    label: 'OpenRouter',
    group: 'aggregator',
    profiles: ['openrouter-chat'],
    baseUrl: 'https://openrouter.ai/api/v1',
    discovery: 'openrouter',
    auth: 'api-key',
  },
  vertex: {
    label: 'Google Vertex AI',
    group: 'cloud',
    profiles: ['anthropic', 'google'],
    baseUrl: '',
    discovery: 'vertex',
    auth: 'service-account',
  },
  'custom-anthropic': {
    label: 'Anthropic Messages',
    group: 'custom',
    profiles: ['compatible-anthropic'],
    baseUrl: '',
    discovery: 'anthropic',
    auth: 'api-key',
  },
  'custom-chat': {
    label: 'OpenAI Chat Completions',
    group: 'custom',
    profiles: ['compatible-chat'],
    baseUrl: '',
    discovery: 'openai',
    auth: 'api-key',
  },
  'custom-responses': {
    label: 'OpenAI Responses',
    group: 'custom',
    profiles: ['compatible-responses'],
    baseUrl: '',
    discovery: 'openai',
    auth: 'api-key',
  },
} as const satisfies Record<
  string,
  {
    readonly label: string;
    readonly group: ModelIntegrationGroup;
    readonly profiles: readonly ExecutionProfileId[];
    readonly baseUrl: string;
    readonly discovery: 'anthropic' | 'openai' | 'google' | 'openrouter' | 'vertex';
    readonly auth: 'api-key' | 'service-account';
  }
>;
export type ModelIntegrationId = keyof typeof MODEL_INTEGRATIONS;

export function isModelIntegration(value: unknown): value is ModelIntegrationId {
  return typeof value === 'string' && Object.hasOwn(MODEL_INTEGRATIONS, value);
}

/** A contract that is not one this build implements: refused, never guessed at. */
export class ExecutionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionContractError';
  }
}

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Fail closed on an unknown profile or an inconsistent wire, on both desktop and server. */
export function decodeExecutionContract(value: unknown): ModelExecutionContract {
  if (
    !object(value) ||
    typeof value.profileId !== 'string' ||
    !Object.hasOwn(EXECUTION_PROFILES, value.profileId)
  )
    throw new ExecutionContractError('Unknown model execution profile');
  const profile = EXECUTION_PROFILES[value.profileId as ExecutionProfileId];
  if (
    value.apiProtocol !== profile.apiProtocol ||
    typeof value.sdkModelId !== 'string' ||
    !value.sdkModelId.trim()
  )
    throw new ExecutionContractError('Invalid model execution contract');
  const c = value.capabilities;
  if (
    !object(c) ||
    !Array.isArray(c.inputModalities) ||
    !c.inputModalities.every((m) => ['text', 'image', 'audio', 'pdf', 'video'].includes(m)) ||
    ['supportsTools', 'supportsReasoning', 'supportsStructuredOutput'].some(
      (k) => typeof c[k] !== 'boolean',
    )
  )
    throw new ExecutionContractError('Invalid model capabilities');
  for (const k of ['contextWindow', 'maxOutputTokens'])
    if (
      c[k] !== undefined &&
      (typeof c[k] !== 'number' || !Number.isSafeInteger(c[k]) || c[k] <= 0)
    )
      throw new ExecutionContractError('Invalid token limit');
  if (c.parallelToolCalls !== undefined && typeof c.parallelToolCalls !== 'boolean')
    throw new ExecutionContractError('Invalid parallel tool support');
  if (
    c.thinkingLevels !== undefined &&
    (!Array.isArray(c.thinkingLevels) ||
      !c.thinkingLevels.every((l) => THINKING_LEVELS.includes(l)))
  )
    throw new ExecutionContractError('Invalid thinking levels');
  if (
    c.defaultThinkingLevel !== undefined &&
    (!Array.isArray(c.thinkingLevels) || !c.thinkingLevels.includes(c.defaultThinkingLevel))
  )
    throw new ExecutionContractError('Invalid default thinking level');
  if (
    value.metadataRef !== undefined &&
    (!object(value.metadataRef) ||
      typeof value.metadataRef.providerType !== 'string' ||
      typeof value.metadataRef.modelId !== 'string')
  )
    throw new ExecutionContractError('Invalid model metadata reference');
  return value as unknown as ModelExecutionContract;
}
