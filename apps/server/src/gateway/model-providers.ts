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

// Calling a provider account: its settings and sealed credential, and the
// request the desktop's SDK built, sent on with three kinds of change only —
// the provider's model id where the protocol names it, the organization's
// credential in place of the employee's token, and the envelope a cloud
// platform or the metering needs. The messages themselves are not touched.

import { GoogleAuth } from 'google-auth-library';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import {
  MODEL_INTEGRATIONS,
  type ModelApiProtocol,
  type ModelIntegrationId,
} from '@maka/core/model-gateway';
import type { ServerContext } from '../context.js';
import type { ModelProvidersTable } from '../db/schema.js';

export type ModelProviderRow = Selectable<ModelProvidersTable>;

const baseUrl = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      // An empty one (`…/v1?`) parses away but stays in what is stored.
      !value.includes('?') &&
      !value.includes('#')
    );
  }, 'Use an HTTP(S) address without credentials, query or fragment');

/** The non-secret settings, as stored: only the keys the integration knows. */
export function validateProviderConfig(
  integration: ModelIntegrationId,
  value: unknown,
): Record<string, unknown> {
  if (integration === 'vertex')
    return z
      .strictObject({
        projectId: z
          .string()
          .trim()
          // Optionally domain-scoped: example.com:project.
          .regex(/^(?:[a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
        region: z
          .string()
          .trim()
          .regex(/^[a-z0-9-]{2,40}$/),
      })
      .parse(value);
  return z
    .strictObject({
      baseUrl: MODEL_INTEGRATIONS[integration].group === 'custom' ? baseUrl : baseUrl.optional(),
    })
    .parse(value);
}

/**
 * A Google service-account key and nothing else: other credential types
 * (external accounts, impersonation) name URLs the server would then fetch.
 */
const serviceAccount = z
  .object({
    type: z.literal('service_account'),
    client_email: z.string().email(),
    private_key: z.string().min(1),
    private_key_id: z.string().optional(),
    project_id: z.string().optional(),
    client_id: z.string().optional(),
  })
  // The download carries further fixed fields (auth_uri, token_uri, …); they
  // are dropped, and the library's own endpoints are used.
  .transform(({ type, client_email, private_key, private_key_id, project_id, client_id }) => ({
    type,
    client_email,
    private_key,
    ...(private_key_id ? { private_key_id } : {}),
    ...(project_id ? { project_id } : {}),
    ...(client_id ? { client_id } : {}),
  }));

/** The credential, as it is sealed. */
export function validateProviderCredential(
  integration: ModelIntegrationId,
  value: unknown,
): Record<string, unknown> {
  if (MODEL_INTEGRATIONS[integration].auth === 'service-account')
    return z.strictObject({ serviceAccount }).parse(value);
  return z.strictObject({ apiKey: z.string().trim().min(1).max(16384) }).parse(value);
}

/** The API root requests and model lists go to, with its version segment. */
export function providerBaseUrl(
  integration: ModelIntegrationId,
  config: Record<string, unknown>,
): string {
  const definition = MODEL_INTEGRATIONS[integration];
  const raw = String(config.baseUrl ?? definition.baseUrl).replace(/\/+$/, '');
  // A custom service's address is read the way the desktop reads it when it
  // calls the service itself: as given, with Anthropic's /v1 made single.
  if (integration === 'custom-anthropic') return `${raw.replace(/\/v1$/i, '')}/v1`;
  if (integration === 'custom-chat') return raw;
  if (integration === 'custom-responses') return raw.replace(/\/responses$/i, '');
  if (definition.discovery === 'google') return /\/v1(?:beta)?$/.test(raw) ? raw : `${raw}/v1beta`;
  return /\/v\d+(?:beta)?$/.test(raw) ? raw : `${raw}/v1`;
}

/** Vertex AI's host for a region: global, the US/EU multi-regions, or one region. */
export function vertexHost(region: string): string {
  if (region === 'global') return 'aiplatform.googleapis.com';
  if (region === 'us' || region === 'eu') return `aiplatform.${region}.rep.googleapis.com`;
  return `${region}-aiplatform.googleapis.com`;
}

export function openCredential(ctx: ServerContext, row: ModelProviderRow): Record<string, unknown> {
  return validateProviderCredential(
    row.integration,
    JSON.parse(ctx.secrets.open(row.credential_sealed, `model-provider:${row.id}`)),
  );
}

export function sealCredential(
  ctx: ServerContext,
  id: string,
  credential: Record<string, unknown>,
): string {
  return ctx.secrets.seal(JSON.stringify(credential), `model-provider:${id}`);
}

const VERTEX_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

/** A bearer for Vertex AI from a service-account key. */
export async function vertexBearer(auth: GoogleAuth): Promise<string> {
  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();
  const value = headers.get('authorization');
  if (!value) throw new Error('No Vertex AI access token');
  return value;
}

export function vertexAuth(credential: Record<string, unknown>): GoogleAuth {
  return new GoogleAuth({
    credentials: credential.serviceAccount as object,
    scopes: VERTEX_SCOPES,
  });
}

/** Connection failures that happen before a request is written: sending again is safe. */
const NOT_SENT_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** The provider could not be reached, or its credential could not be prepared. */
export class ProviderUnreachableError extends Error {
  constructor(
    /** Nothing was sent and the connection itself failed: the request may be tried again as it is. */
    readonly notSent: boolean,
    /** A short, secret-free reason for the server log. */
    readonly reason: string,
  ) {
    super('The model provider could not be reached');
    this.name = 'ProviderUnreachableError';
  }
}

function reasonOf(error: unknown): { code: string; notSent: boolean } {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const code = String(
    (cause as { code?: unknown }).code ?? (cause as { name?: unknown }).name ?? 'unknown',
  );
  return { code, notSent: NOT_SENT_CODES.has(code) };
}

/** A model id in a resource path; `@version` stays as Vertex's own SDK writes it. */
const pathSegment = (id: string) => encodeURIComponent(id).replaceAll('%40', '@');

/** Top-level fields that would let an employee steer billing or routing. */
const ORGANIZATION_FIELDS = ['workspace_id', 'user_profile_id'] as const;
/**
 * OpenRouter's own: models and routes the administrator did not publish,
 * provider and data-policy preferences, and plugins billed per request
 * (web search) that no token count covers.
 */
const OPENROUTER_FIELDS = ['models', 'fallbacks', 'route', 'provider', 'plugins'] as const;

export class ModelProviderTransport {
  readonly #vertex = new Map<string, { revision: number; auth: GoogleAuth }>();

  constructor(
    readonly ctx: ServerContext,
    readonly fetchImpl: typeof fetch = fetch,
    /** Tests stand in for Google's token service. */
    readonly vertexToken?: (row: ModelProviderRow) => Promise<string>,
  ) {}

  /**
   * Send one request on. Answers with the provider's response, whatever its
   * status; throws ProviderUnreachableError when there is none.
   */
  async send(input: {
    readonly row: ModelProviderRow;
    readonly protocol: ModelApiProtocol;
    readonly providerModel: string;
    readonly body: Record<string, unknown>;
    readonly stream: boolean;
    readonly anthropicBeta: string | undefined;
    readonly signal: AbortSignal;
  }): Promise<Response> {
    const { row, protocol, providerModel, stream, signal } = input;
    let url: string;
    const headers = new Headers({
      'content-type': 'application/json',
      accept: stream ? 'text/event-stream' : 'application/json',
    });
    const body: Record<string, unknown> = { ...input.body };
    for (const field of ORGANIZATION_FIELDS) delete body[field];
    if (row.integration === 'openrouter') for (const field of OPENROUTER_FIELDS) delete body[field];
    try {
      const credential = openCredential(this.ctx, row);
      const config = validateProviderConfig(row.integration, row.config);
      if (row.integration === 'vertex') {
        headers.set('authorization', await this.#vertexBearer(row, credential));
        const anthropic = protocol === 'anthropic-messages';
        const method = anthropic
          ? stream
            ? 'streamRawPredict'
            : 'rawPredict'
          : stream
            ? 'streamGenerateContent?alt=sse'
            : 'generateContent';
        url = `https://${vertexHost(String(config.region))}/v1/projects/${config.projectId}/locations/${config.region}/publishers/${anthropic ? 'anthropic' : 'google'}/models/${pathSegment(providerModel)}:${method}`;
        delete body.model;
        if (anthropic) {
          body.anthropic_version = 'vertex-2023-10-16';
          if (input.anthropicBeta) headers.set('anthropic-beta', input.anthropicBeta);
        }
      } else {
        const base = providerBaseUrl(row.integration, config);
        if (protocol === 'anthropic-messages') {
          url = `${base}/messages`;
          headers.set('x-api-key', String(credential.apiKey));
          headers.set('anthropic-version', '2023-06-01');
          if (input.anthropicBeta) headers.set('anthropic-beta', input.anthropicBeta);
          body.model = providerModel;
        } else if (protocol === 'google-generate') {
          url = `${base}/models/${pathSegment(providerModel)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
          headers.set('x-goog-api-key', String(credential.apiKey));
          delete body.model;
        } else {
          url = `${base}/${protocol === 'openai-chat' ? 'chat/completions' : 'responses'}`;
          headers.set('authorization', `Bearer ${credential.apiKey}`);
          body.model = providerModel;
        }
      }
    } catch (error) {
      // A credential that does not open or a key Google refuses fails the
      // same way every time: nothing to retry.
      throw new ProviderUnreachableError(false, `prepare:${reasonOf(error).code}`);
    }
    // Conversations stay with the desktop: nothing is kept at the provider.
    if (protocol === 'openai-responses') body.store = false;
    // Chat Completions reports usage in a stream only when asked to.
    if (protocol === 'openai-chat' && stream)
      body.stream_options = {
        ...(typeof body.stream_options === 'object' && body.stream_options !== null
          ? body.stream_options
          : {}),
        include_usage: true,
      };
    try {
      return await this.fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
        // A redirect would carry the credential somewhere unchosen.
        redirect: 'manual',
      });
    } catch (error) {
      if (signal.aborted) throw error;
      const { code, notSent } = reasonOf(error);
      throw new ProviderUnreachableError(notSent, code);
    }
  }

  async #vertexBearer(row: ModelProviderRow, credential: Record<string, unknown>) {
    if (this.vertexToken) return `Bearer ${await this.vertexToken(row)}`;
    let entry = this.#vertex.get(row.id);
    // A new key is a new revision: the cached client goes with the old one.
    if (!entry || entry.revision !== row.revision) {
      entry = { revision: row.revision, auth: vertexAuth(credential) };
      this.#vertex.set(row.id, entry);
    }
    return vertexBearer(entry.auth);
  }
}
