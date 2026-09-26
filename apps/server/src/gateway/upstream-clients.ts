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

// Upstream clients for the Anthropic protocol: the official SDKs for the
// Claude API and Google Vertex AI. The SDK builds each platform's URL, auth
// and body adjustments; the gateway only asks for the raw response
// (`.asResponse()`) and passes its bytes through.
//
// Amazon Bedrock (the SDK's Mantle client) is not wired yet: its AWS
// credential packages, installed at the workspace root, would also satisfy an
// optional peer of the desktop's `openai` dependency and ship with the app.
// It needs the server's dependencies isolated first.

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { GoogleAuth } from 'google-auth-library';
import type { Selectable } from 'kysely';
import { z } from 'zod';
import type { ServerContext } from '../context.js';
import type { UpstreamsTable } from '../db/schema.js';

export type UpstreamRow = Selectable<UpstreamsTable>;

/** What the gateway needs from any of the SDK clients. */
interface RawCall {
  asResponse(): Promise<Response>;
}
export interface AnthropicFamilyClient {
  messages: { create(body: never, options?: unknown): RawCall };
  beta: { messages: { create(body: never, options?: unknown): RawCall } };
}

const anthropicConfig = z.object({ baseUrl: z.url().optional() });
const anthropicCredential = z.object({ apiKey: z.string().min(1) });
const vertexConfig = z.object({ projectId: z.string().min(1), region: z.string().min(1) });
const vertexCredential = z.object({ serviceAccount: z.record(z.string(), z.unknown()) });

/** Validate an upstream's settings before they are stored. */
export function validateUpstream(
  kind: UpstreamRow['kind'],
  config: unknown,
  credential: unknown,
): void {
  switch (kind) {
    case 'anthropic':
      anthropicConfig.parse(config);
      anthropicCredential.parse(credential);
      return;
    case 'vertex':
      vertexConfig.parse(config);
      vertexCredential.parse(credential);
      return;
    default:
      throw new Error(`Upstream kind ${kind} is not supported yet`);
  }
}

const COMMON = { maxRetries: 0, timeout: 10 * 60 * 1000 } as const;

/** The Vertex SDK's own default, spelled out so ANTHROPIC_VERTEX_BASE_URL cannot redirect it. */
function vertexBaseUrl(region: string): string {
  if (region === 'global') return 'https://aiplatform.googleapis.com/v1';
  if (region === 'us' || region === 'eu')
    return `https://aiplatform.${region}.rep.googleapis.com/v1`;
  return `https://${region}-aiplatform.googleapis.com/v1`;
}

function build(
  row: UpstreamRow,
  credential: unknown,
  fetchImpl?: typeof fetch,
): AnthropicFamilyClient {
  const fetchOption = fetchImpl ? { fetch: fetchImpl } : {};
  switch (row.kind) {
    case 'anthropic': {
      const config = anthropicConfig.parse(row.config);
      const { apiKey } = anthropicCredential.parse(credential);
      // Every connection setting is explicit: the SDK would otherwise take
      // ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN from this server's environment.
      return new Anthropic({
        apiKey,
        authToken: null,
        baseURL: config.baseUrl ?? 'https://api.anthropic.com',
        ...COMMON,
        ...fetchOption,
      }) as unknown as AnthropicFamilyClient;
    }
    case 'vertex': {
      const config = vertexConfig.parse(row.config);
      const { serviceAccount } = vertexCredential.parse(credential);
      return new AnthropicVertex({
        projectId: config.projectId,
        region: config.region,
        baseURL: vertexBaseUrl(config.region),
        googleAuth: new GoogleAuth({
          credentials: serviceAccount,
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        }),
        ...COMMON,
        ...fetchOption,
      }) as unknown as AnthropicFamilyClient;
    }
    default:
      throw new Error(`Upstream ${row.name} (${row.kind}) does not speak the Anthropic protocol`);
  }
}

/**
 * One client per upstream, rebuilt when the upstream changes. The credential
 * is opened only here, in memory, and never logged.
 */
export class UpstreamClients {
  readonly #cache = new Map<string, { version: number; client: AnthropicFamilyClient }>();

  constructor(
    private readonly ctx: ServerContext,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  anthropicFamily(row: UpstreamRow): AnthropicFamilyClient {
    const version = row.updated_at.getTime();
    const cached = this.#cache.get(row.id);
    if (cached && cached.version === version) return cached.client;
    const credential = row.credential_sealed
      ? (JSON.parse(this.ctx.secrets.open(row.credential_sealed, `upstream:${row.id}`)) as unknown)
      : {};
    const client = build(row, credential, this.fetchImpl);
    this.#cache.set(row.id, { version, client });
    return client;
  }
}
