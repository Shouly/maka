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

// Reading what a provider account offers. The model list comes from the
// provider (with the account's own credential), and each listed model is
// turned into the contract it would be published under here, on the server:
// what the page later sends back is only which ids to publish, checked
// against this snapshot. Reading a list runs no model.

import { createHmac } from 'node:crypto';
import { z } from 'zod';
import {
  EXECUTION_PROFILES,
  type ExecutionProfileId,
  type GatewayModelCapabilities,
  isModelIntegration,
  MODEL_INTEGRATIONS,
  type ModelExecutionContract,
  type ModelIntegrationId,
} from '@maka/core/model-gateway';
import type { ProviderType } from '@maka/core/llm-connections';
import { lookupModelMetadata } from '@maka/core/model-metadata';
import { thinkingVariantsForModel } from '@maka/core/model-thinking';
import { type AdminActor, AdminRefused } from '../administration.js';
import type { ServerContext } from '../context.js';
import { newId } from '../crypto/tokens.js';
import {
  type ModelProviderRow,
  openCredential,
  providerBaseUrl,
  validateProviderConfig,
  validateProviderCredential,
  vertexAuth,
  vertexBearer,
} from '../gateway/model-providers.js';
import type { ConsoleCatalogModel, ConsoleModelCatalog } from './types.js';

/** A provider account as the add flow describes it, checked; the name is optional. */
export interface ProviderDraft {
  readonly integration: ModelIntegrationId;
  readonly name?: string;
  readonly config: Record<string, unknown>;
  readonly credential: Record<string, unknown>;
}

/** How the catalog reaches providers; tests stand in for both. */
export interface CatalogDeps {
  readonly fetch: typeof fetch;
  /** A Vertex AI bearer for a service-account credential. */
  readonly vertexToken?: (credential: Record<string, unknown>) => Promise<string>;
}

const SNAPSHOT_TTL_MS = 15 * 60 * 1000;
const PAGE_LIMIT = 20;
/** The most models one list may hold, and so the most one publish may select. */
export const MODEL_LIMIT = 2000;

const providerModelId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  // OpenRouter's latest-model aliases start with ~; Vertex pins a version with @.
  .regex(/^~?[a-zA-Z0-9][a-zA-Z0-9._:/@+-]*$/);

export function validatedDraft(value: unknown): ProviderDraft {
  const draft = z
    .strictObject({
      integration: z.string(),
      name: z.string().trim().max(100).optional(),
      config: z.record(z.string(), z.unknown()),
      credential: z.record(z.string(), z.unknown()),
    })
    .parse(value);
  if (!isModelIntegration(draft.integration))
    throw new AdminRefused(400, 'Unsupported integration');
  return {
    integration: draft.integration,
    ...(draft.name ? { name: draft.name } : {}),
    config: validateProviderConfig(draft.integration, draft.config),
    credential: validateProviderCredential(draft.integration, draft.credential),
  };
}

export function storedDraft(ctx: ServerContext, row: ModelProviderRow): ProviderDraft {
  return {
    integration: row.integration,
    name: row.name,
    config: row.config,
    credential: openCredential(ctx, row),
  };
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/**
 * What a snapshot is bound to: the account (credential included, as a keyed
 * hash — never stored) and, for a saved provider, its revision. Not the name.
 */
export function fingerprint(
  ctx: ServerContext,
  draft: ProviderDraft,
  provider?: ModelProviderRow,
): string {
  const key = createHmac('sha256', ctx.config.masterKey).update('catalog-snapshot').digest();
  return createHmac('sha256', key)
    .update(
      canonical({
        integration: draft.integration,
        config: draft.config,
        credential: draft.credential,
        providerId: provider?.id,
        revision: provider?.revision,
      }),
    )
    .digest('hex');
}

const positive = (v: unknown) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined;
const obj = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};

/** What a provider's list says of one model, where it says it. */
interface ListedFacts {
  readonly displayName?: unknown;
  readonly contextWindow?: unknown;
  readonly maxOutputTokens?: unknown;
  readonly inputModalities?: unknown;
  /** OpenRouter's parameter list: decides tools, reasoning and structured output. */
  readonly supportedParameters?: unknown;
}

/**
 * One listed model as it would be published. What the list says narrows the
 * known model facts; nothing missing turns into a capability.
 */
export function catalogModel(
  profileId: ExecutionProfileId,
  id: string,
  facts: ListedFacts = {},
  sdkModelId = id,
): ConsoleCatalogModel {
  const profile = EXECUTION_PROFILES[profileId];
  const providerType = profile.providerType as ProviderType;
  const metadata = lookupModelMetadata(providerType, sdkModelId);
  const parameters = Array.isArray(facts.supportedParameters)
    ? (facts.supportedParameters as string[])
    : undefined;
  // Optional features stay off unless known; tool use, which an agent cannot do
  // without, is off only when the list or the known facts say so — as on the
  // desktop's own connections.
  const allow = (listed: boolean | undefined, known: boolean | undefined) =>
    listed !== undefined ? listed && known !== false : known === true;
  const unlessDenied = (listed: boolean | undefined, known: boolean | undefined) =>
    listed !== undefined ? listed && known !== false : known !== false;
  const knownModalities = metadata.modalities?.input;
  const inputModalities = (
    Array.isArray(facts.inputModalities) ? (facts.inputModalities as string[]) : undefined
  )
    ?.concat()
    .filter((m) => !knownModalities || knownModalities.includes(m as never));
  const supportsReasoning = allow(
    parameters?.some((p) => p === 'reasoning' || p === 'reasoning_effort'),
    metadata.capabilities?.reasoning,
  );
  const thinkingLevels = thinkingVariantsForModel(providerType, sdkModelId);
  const contextWindow = positive(facts.contextWindow) ?? metadata.contextWindow;
  const maxOutputTokens = positive(facts.maxOutputTokens) ?? metadata.maxOutputTokens;
  const capabilities: GatewayModelCapabilities = {
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    inputModalities: (inputModalities ?? knownModalities ?? ['text']).filter((m) =>
      ['text', 'image', 'audio', 'video', 'pdf'].includes(m),
    ) as GatewayModelCapabilities['inputModalities'],
    supportsTools: unlessDenied(
      parameters?.includes('tools'),
      metadata.capabilities?.functionCalling,
    ),
    supportsReasoning,
    supportsStructuredOutput: allow(
      parameters?.includes('response_format'),
      metadata.structuredOutput,
    ),
    ...(metadata.capabilities?.parallelToolCalls !== undefined
      ? { parallelToolCalls: metadata.capabilities.parallelToolCalls }
      : {}),
    ...(supportsReasoning && thinkingLevels?.length ? { thinkingLevels } : {}),
  };
  const contract: ModelExecutionContract = {
    apiProtocol: profile.apiProtocol,
    profileId,
    sdkModelId,
    metadataRef: { providerType, modelId: sdkModelId },
    capabilities,
  };
  const listedName = typeof facts.displayName === 'string' ? facts.displayName.trim() : '';
  return { id, displayName: listedName || metadata.displayName || id, contract };
}

class ListFailure extends Error {
  constructor(readonly reason: 'credentials' | 'unavailable' | 'invalid_response') {
    super(reason);
  }
}

/** Bounded, and secret-free when it fails: provider errors can echo account details. */
async function readJson(
  deps: CatalogDeps,
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Record<string, any>> {
  let response: Response;
  try {
    response = await deps.fetch(url, { headers, signal, redirect: 'manual' });
  } catch {
    throw new ListFailure('unavailable');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ListFailure(
      response.status === 401 || response.status === 403 ? 'credentials' : 'unavailable',
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ListFailure('invalid_response');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 8 * 1024 * 1024) throw new ListFailure('invalid_response');
      chunks.push(value);
    }
  } catch (error) {
    throw error instanceof ListFailure ? error : new ListFailure('unavailable');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  try {
    return obj(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    throw new ListFailure('invalid_response');
  }
}

/** Official OpenAI lists every model of the account; only chat models can run in Maka. */
const OPENAI_CHAT = /^(gpt-|o[1-9]|chatgpt-)/;
const OPENAI_NOT_CHAT = /embedding|tts|transcribe|realtime|audio|image|search|moderation/;
/** Vertex lists the publisher's whole catalogue; Maka can run its Claude and Gemini text models. */
const VERTEX_NOT_TEXT = /embedding|image|imagen|veo|tts|live|audio|lyria/;

/** Read the account's models. Throws ListFailure. */
async function listModels(
  draft: ProviderDraft,
  deps: CatalogDeps,
): Promise<{ models: ConsoleCatalogModel[]; skipped: number }> {
  const definition = MODEL_INTEGRATIONS[draft.integration];
  const signal = AbortSignal.timeout(20_000);
  const models = new Map<string, ConsoleCatalogModel>();
  let skipped = 0;
  const add = (read: () => ConsoleCatalogModel | undefined) => {
    try {
      const model = read();
      if (model) models.set(model.id, model);
    } catch {
      // One unreadable entry must not hide the rest of the list.
      skipped++;
    }
    if (models.size > MODEL_LIMIT) throw new ListFailure('invalid_response');
  };
  /** Walk a paged list; `next` gives the following page's cursor, if any. */
  const pages = async (
    first: URL,
    headers: Record<string, string>,
    cursorParam: string,
    entries: (page: Record<string, any>) => unknown,
    next: (page: Record<string, any>) => unknown,
    each: (entry: Record<string, any>) => void,
  ) => {
    const url = new URL(first);
    const seen = new Set<string>();
    for (let page = 0; ; page++) {
      const data = await readJson(deps, url, headers, signal);
      const list = entries(data);
      if (!Array.isArray(list)) throw new ListFailure('invalid_response');
      for (const entry of list) each(obj(entry));
      const cursor = next(data);
      if (cursor === undefined || cursor === null || cursor === '') return;
      if (typeof cursor !== 'string' || seen.has(cursor) || page + 1 >= PAGE_LIMIT)
        throw new ListFailure('invalid_response');
      seen.add(cursor);
      url.searchParams.set(cursorParam, cursor);
    }
  };
  const [profileId] = definition.profiles;

  if (definition.discovery === 'vertex') {
    let token: string;
    try {
      token = deps.vertexToken
        ? await deps.vertexToken(draft.credential)
        : (await vertexBearer(vertexAuth(draft.credential))).replace(/^Bearer /, '');
    } catch {
      // A key Google will not exchange for a token is a refused credential.
      throw new ListFailure('credentials');
    }
    const headers = { authorization: `Bearer ${token}` };
    for (const publisher of ['anthropic', 'google'] as const) {
      const url = new URL(
        `https://aiplatform.googleapis.com/v1beta1/publishers/${publisher}/models`,
      );
      url.searchParams.set('pageSize', '100');
      await pages(
        url,
        headers,
        'pageToken',
        (data) => data.publisherModels ?? [],
        (data) => data.nextPageToken,
        (entry) =>
          add(() => {
            const name = providerModelId.parse(
              String(entry.name ?? '').replace(/^publishers\/[^/]+\/models\//, ''),
            );
            if (VERTEX_NOT_TEXT.test(name)) return undefined;
            if (publisher === 'anthropic') {
              if (!name.startsWith('claude-')) return undefined;
              // Claude on Vertex is called by name@date where it has one.
              const version = String(entry.versionId ?? '');
              const id = /^\d{8}$/.test(version) ? `${name}@${version}` : name;
              return catalogModel('anthropic', id, {}, id.replace('@', '-'));
            }
            if (!name.startsWith('gemini-')) return undefined;
            return catalogModel('google', name);
          }),
      );
    }
    return { models: [...models.values()], skipped };
  }

  const base = providerBaseUrl(draft.integration, draft.config);
  const apiKey = String(draft.credential.apiKey);
  if (definition.discovery === 'anthropic') {
    const url = new URL(`${base}/models`);
    url.searchParams.set('limit', '100');
    await pages(
      url,
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      'after_id',
      (data) => data.data,
      (data) => (data.has_more ? data.last_id : undefined),
      (entry) =>
        add(() =>
          catalogModel(profileId, providerModelId.parse(entry.id), {
            displayName: entry.display_name,
            contextWindow: entry.max_input_tokens,
            maxOutputTokens: entry.max_tokens,
            ...(entry.capabilities?.image_input
              ? {
                  inputModalities: [
                    'text',
                    ...(entry.capabilities.image_input.supported ? ['image'] : []),
                    ...(entry.capabilities.pdf_input?.supported ? ['pdf'] : []),
                  ],
                }
              : {}),
          }),
        ),
    );
  } else if (definition.discovery === 'google') {
    const url = new URL(`${base}/models`);
    url.searchParams.set('pageSize', '100');
    await pages(
      url,
      { 'x-goog-api-key': apiKey },
      'pageToken',
      (data) => data.models,
      (data) => data.nextPageToken,
      (entry) =>
        add(() => {
          if (!entry.supportedGenerationMethods?.includes('generateContent')) return undefined;
          return catalogModel(
            profileId,
            providerModelId.parse(String(entry.name ?? '').replace(/^models\//, '')),
            {
              displayName: entry.displayName,
              contextWindow: entry.inputTokenLimit,
              maxOutputTokens: entry.outputTokenLimit,
            },
          );
        }),
    );
  } else if (definition.discovery === 'openrouter') {
    await pages(
      new URL(`${base}/models/user`),
      { authorization: `Bearer ${apiKey}` },
      'cursor',
      (data) => data.data,
      () => undefined,
      (entry) =>
        add(() => {
          const output = entry.architecture?.output_modalities;
          if (Array.isArray(output) && !output.includes('text')) return undefined;
          return catalogModel(profileId, providerModelId.parse(entry.id), {
            displayName: entry.name,
            contextWindow: entry.context_length,
            maxOutputTokens: entry.top_provider?.max_completion_tokens,
            inputModalities: entry.architecture?.input_modalities,
            supportedParameters: entry.supported_parameters,
          });
        }),
    );
  } else {
    await pages(
      new URL(`${base}/models`),
      { authorization: `Bearer ${apiKey}` },
      'after',
      (data) => data.data,
      () => undefined,
      (entry) =>
        add(() => {
          const id = providerModelId.parse(entry.id);
          // A compatible service's list is its own: only OpenAI's is sorted out by name.
          if (draft.integration === 'openai' && (!OPENAI_CHAT.test(id) || OPENAI_NOT_CHAT.test(id)))
            return undefined;
          return catalogModel(profileId, id);
        }),
    );
  }
  if (skipped > 0 && models.size === 0) throw new ListFailure('invalid_response');
  return { models: [...models.values()], skipped };
}

/** Whether the provider refused this credential (not: it could not be asked just now). */
export async function credentialRefused(draft: ProviderDraft, deps: CatalogDeps): Promise<boolean> {
  try {
    await listModels(draft, deps);
    return false;
  } catch (error) {
    return error instanceof ListFailure && error.reason === 'credentials';
  }
}

/**
 * Read the account's models and keep them as a snapshot the administrator
 * can publish from for fifteen minutes. For a saved provider, models already
 * published from it say so.
 */
export async function discoverModels(
  ctx: ServerContext,
  actor: AdminActor,
  draft: ProviderDraft,
  deps: CatalogDeps,
  provider?: ModelProviderRow,
): Promise<ConsoleModelCatalog> {
  let listed: Awaited<ReturnType<typeof listModels>>;
  try {
    listed = await listModels(draft, deps);
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof ListFailure ? error.reason : 'unavailable',
    };
  }
  const published = provider
    ? new Map(
        (
          await ctx.db
            .selectFrom('organization_models')
            .select(['id', 'provider_model'])
            .where('model_provider_id', '=', provider.id)
            .execute()
        ).map((row) => [row.provider_model, row.id]),
      )
    : new Map<string, string>();
  const models = listed.models.map((model) => {
    const publishedModelId = published.get(model.id);
    return publishedModelId ? { ...model, publishedModelId } : model;
  });
  const id = newId();
  const expiresAt = new Date(ctx.now().getTime() + SNAPSHOT_TTL_MS);
  await ctx.db
    .insertInto('provider_catalog_snapshots')
    .values({
      id,
      actor_id: actor.userId ?? 'cli',
      fingerprint: fingerprint(ctx, draft, provider),
      models: JSON.stringify(models),
      expires_at: expiresAt,
    })
    .execute();
  return {
    status: 'ready',
    snapshotId: id,
    expiresAt: expiresAt.getTime(),
    models,
    ...(listed.skipped > 0 ? { skippedModels: listed.skipped } : {}),
  };
}
