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

// The three decisions "add a connection" makes that are not layout: which
// writer performs the create, which fields the chosen provider actually
// demands, and which models a verified endpoint starts with.
//
// They live outside the component because each one used to be a special case
// buried in a submit handler, and none of them was observable from a test.

import {
  PROVIDER_REGISTRY,
  providerAuthRequiresSecret,
  providerAuthSupportsApiKey,
  validateSlug,
  type ModelInfo,
  type ProviderType,
  type SlugValidationIssue,
} from '@maka/core/llm-connections';

/**
 * Which writer creates the connection.
 *
 * `host` is the Runtime Host's onboarding pair (`verify` then `save`): it
 * probes the endpoint with the credential BEFORE anything is persisted, so a
 * mistyped key never leaves a dead connection behind. `legacy` is the plain
 * `connections.create`, which writes first and discovers afterwards.
 *
 * The Host path admits any provider with a credential slot
 * (`providerAuthSupportsApiKey`, or OAuth — and OAuth never reaches this form),
 * and it takes an endpoint override, so a provider that ships no `baseUrl`
 * goes through it too. That is a change from the pre-rewrite rule, which sent
 * every endpoint-less provider down the legacy path: the wire has carried
 * `baseUrl` since the custom relays were added to onboarding, and routing them
 * around verification meant the one provider class most likely to be
 * misconfigured was the one class that never got checked.
 *
 * Cloudflare stays legacy because its endpoint is composed from an account id
 * rather than typed, and a keyless local runtime stays legacy because the Host
 * rejects a provider with no credential slot outright.
 */
export type AddProviderRoute = 'host' | 'legacy';

export function addProviderRoute(providerType: ProviderType): AddProviderRoute {
  if (providerType === 'cloudflare-workers-ai') return 'legacy';
  return providerAuthSupportsApiKey(providerType) ? 'host' : 'legacy';
}

export type AddProviderField = 'slug' | 'apiKey' | 'accountId' | 'baseUrl' | 'form';

export type AddProviderIssue =
  | { readonly field: 'slug'; readonly reason: 'invalid'; readonly detail: SlugValidationIssue }
  | { readonly field: 'slug'; readonly reason: 'duplicate' }
  | { readonly field: 'apiKey'; readonly reason: 'required' }
  | { readonly field: 'accountId'; readonly reason: 'required' }
  | { readonly field: 'baseUrl'; readonly reason: 'required' }
  | { readonly field: 'form'; readonly reason: 'experimental' };

export interface AddProviderDraft {
  readonly providerType: ProviderType;
  readonly slug: string;
  readonly existingSlugs: readonly string[];
  readonly apiKey: string;
  readonly cloudflareAccountId: string;
  readonly baseUrl: string;
}

/**
 * The field gate, in the order the form reports it — first issue wins, so the
 * user fixes one thing at a time rather than being handed a wall.
 *
 * Reason codes rather than sentences: the component owns the localized copy,
 * and a test asserting `{field, reason}` keeps saying the same thing after a
 * rewording.
 *
 * The base-URL rule is the one that matters for the company gateway: its
 * registry entry ships no `baseUrl` and no `baseUrlTemplate`, so an empty
 * field here is a blocking, named error rather than a request that goes out to
 * an empty address and comes back as a generic network failure.
 *
 * There is deliberately no rule for the model id. A provider that ships a
 * recommended default does not ask, and one that does not can discover its
 * catalog — requiring a typed id ahead of either demands a guess about a list
 * the app is about to fetch.
 */
export function validateAddProviderDraft(draft: AddProviderDraft): AddProviderIssue | null {
  const defaults = PROVIDER_REGISTRY[draft.providerType];
  const slugIssue = validateSlug(draft.slug);
  if (slugIssue) return { field: 'slug', reason: 'invalid', detail: slugIssue };
  if (draft.existingSlugs.includes(draft.slug)) return { field: 'slug', reason: 'duplicate' };
  const isCloudflareWorkersAi = draft.providerType === 'cloudflare-workers-ai';
  if (isCloudflareWorkersAi && !draft.cloudflareAccountId.trim()) {
    return { field: 'accountId', reason: 'required' };
  }
  // The endpoint is reported before the credential, and only for the providers
  // that need both. It is the field a user is least likely to know they owe —
  // a key is obviously required, an address the operator hands out is not — and
  // a key checked first would send them looking for the wrong thing.
  //
  // Cloudflare composes its endpoint from the account id above, so it is not
  // missing one; it has not built it yet.
  const requiresBaseUrl = !defaults.baseUrl && !defaults.baseUrlTemplate && !isCloudflareWorkersAi;
  if (requiresBaseUrl && !draft.baseUrl.trim()) return { field: 'baseUrl', reason: 'required' };
  const requiresApiKey =
    providerAuthRequiresSecret(draft.providerType) &&
    providerAuthSupportsApiKey(draft.providerType);
  if (requiresApiKey && !draft.apiKey.trim()) return { field: 'apiKey', reason: 'required' };
  if (defaults.status === 'phase3-experimental') return { field: 'form', reason: 'experimental' };
  return null;
}

/** Whether this provider's setup form has to ask for an endpoint. */
export function addProviderRequiresBaseUrl(providerType: ProviderType): boolean {
  const defaults = PROVIDER_REGISTRY[providerType];
  return !defaults.baseUrl && !defaults.baseUrlTemplate && providerType !== 'cloudflare-workers-ai';
}

/** A stable display order for a freshly discovered catalog. */
export function stableOnboardingModels(models: readonly ModelInfo[]): ModelInfo[] {
  return [...models].sort((left, right) => {
    const leftLabel = left.displayName?.trim() || left.id;
    const rightLabel = right.displayName?.trim() || right.id;
    return leftLabel.localeCompare(rightLabel) || left.id.localeCompare(right.id);
  });
}

/** The models a just-verified connection starts with: the recommended one, or the first. */
export function initialOnboardingModelIds(
  models: readonly ModelInfo[],
  recommendedModelId: string,
): string[] {
  if (models.some((model) => model.id === recommendedModelId)) return [recommendedModelId];
  const first = stableOnboardingModels(models)[0];
  return first ? [first.id] : [];
}

/**
 * The enabled-model list in the order the Host reads it: the chosen default
 * first, then the rest in catalog order. The Host takes the head of this list
 * as the connection's default model, so the ordering is a decision, not a
 * presentation detail.
 */
export function orderedOnboardingModelIds(input: {
  readonly models: readonly ModelInfo[];
  readonly selectedIds: readonly string[];
  readonly defaultId: string;
}): string[] {
  const selected = new Set(input.selectedIds);
  const rest = input.models
    .map((model) => model.id)
    .filter((modelId) => selected.has(modelId) && modelId !== input.defaultId);
  return selected.has(input.defaultId) ? [input.defaultId, ...rest] : rest;
}

/** The endpoint a legacy create writes, with Cloudflare's template filled in. */
export function resolveCreateBaseUrl(input: {
  readonly providerType: ProviderType;
  readonly baseUrl: string;
  readonly cloudflareAccountId: string;
}): string | undefined {
  if (input.providerType === 'cloudflare-workers-ai') {
    return PROVIDER_REGISTRY[input.providerType].baseUrlTemplate?.replace(
      '${CLOUDFLARE_ACCOUNT_ID}',
      encodeURIComponent(input.cloudflareAccountId.trim()),
    );
  }
  return input.baseUrl.trim() || undefined;
}
