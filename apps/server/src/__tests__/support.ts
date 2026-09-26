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

// A server over an in-process Postgres (PGlite), with a movable clock and
// identity providers whose answers each test scripts.

import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { FastifyInstance } from 'fastify';
import { Kysely, PGliteDialect } from 'kysely';
import { buildServer } from '../app.js';
import type { ServerConfig } from '../config.js';
import type { ServerContext } from '../context.js';
import { localSecretBox } from '../crypto/secret-box.js';
import { pkceChallenge } from '../crypto/tokens.js';
import { migrateToLatest } from '../db/migrations.js';
import type { Database } from '../db/schema.js';
import { UpstreamClients } from '../gateway/upstream-clients.js';
import { AccessTokens } from '../identity/access-tokens.js';
import type { IdentityProvider, VerifiedIdentity } from '../identity/providers/types.js';
import { IdentityRefused } from '../identity/providers/types.js';

export const PUBLIC_URL = 'https://maka.test';
export const LOOPBACK = 'http://127.0.0.1:53682/callback';
export const VERIFIER = 'v'.repeat(43) + 'erifier-for-tests';

/** A provider that answers each authorization code with a scripted identity. */
export class ScriptedProvider implements IdentityProvider {
  readonly answers = new Map<string, VerifiedIdentity | IdentityRefused>();
  callbackUrl?: string;
  constructor(
    readonly id: string,
    readonly displayName: string,
  ) {}
  authorizationUrl({
    state,
    nonce,
    redirectUri,
  }: {
    state: string;
    nonce: string;
    redirectUri: string;
  }) {
    const url = new URL(`https://idp.test/${this.id}/authorize`);
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    url.searchParams.set('redirect_uri', redirectUri);
    return url.toString();
  }
  async exchange({ code }: { code: string }): Promise<VerifiedIdentity> {
    const answer = this.answers.get(code);
    if (!answer) throw new IdentityRefused('provider_error', 'unknown code');
    if (answer instanceof IdentityRefused) throw answer;
    return answer;
  }
}

export interface TestServer {
  readonly app: FastifyInstance;
  readonly ctx: ServerContext;
  readonly db: Kysely<Database>;
  readonly google: ScriptedProvider;
  readonly relx: ScriptedProvider;
  readonly clock: { now: Date };
  advance(ms: number): void;
  close(): Promise<void>;
}

export async function startTestServer(
  overrides: Partial<ServerConfig> = {},
  options: { upstreamFetch?: typeof fetch; googleCallbackUrl?: string } = {},
): Promise<TestServer> {
  const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: new PGlite() }) });
  await migrateToLatest(db);
  const clock = { now: new Date('2026-09-26T08:00:00Z') };
  const config: ServerConfig = {
    publicUrl: PUBLIC_URL,
    host: '127.0.0.1',
    port: 0,
    databaseUrl: 'pglite://memory',
    masterKey: new Uint8Array(randomBytes(32)),
    // As deployed: no domain fence unless a test asks for one.
    allowedEmailDomains: [],
    bootstrapAdminEmails: ['boss@relx.com'],
    trustProxy: false,
    ...overrides,
  };
  const ctx: ServerContext = {
    config,
    db,
    secrets: localSecretBox(config.masterKey),
    now: () => clock.now,
  };
  const accessTokens = new AccessTokens(ctx);
  await accessTokens.initialize();
  const google = new ScriptedProvider('google', 'Google');
  if (options.googleCallbackUrl) google.callbackUrl = options.googleCallbackUrl;
  const relx = new ScriptedProvider('relx-sso', 'RELX SSO');
  const app = await buildServer(ctx, {
    providers: new Map<string, IdentityProvider>([
      [relx.id, relx],
      [google.id, google],
    ]),
    accessTokens,
    ...(options.upstreamFetch
      ? { upstreamClients: new UpstreamClients(ctx, options.upstreamFetch) }
      : {}),
  });
  return {
    app,
    ctx,
    db,
    google,
    relx,
    clock,
    advance(ms) {
      clock.now = new Date(clock.now.getTime() + ms);
    },
    async close() {
      await app.close();
      await db.destroy();
    },
  };
}

export interface SignInResult {
  readonly redirect: URL;
}

/**
 * Walk the browser part of a sign-in: authorize, pick `provider`, come back
 * from it with `code`. Returns where the server sent the browser last.
 */
export async function browserSignIn(
  server: TestServer,
  provider: ScriptedProvider,
  code: string,
  options: { redirectUri?: string; state?: string; verifier?: string } = {},
): Promise<SignInResult> {
  const authorize = await server.app.inject({
    method: 'GET',
    url: '/oauth/authorize',
    query: {
      client_id: 'maka-desktop',
      response_type: 'code',
      redirect_uri: options.redirectUri ?? LOOPBACK,
      code_challenge: pkceChallenge(options.verifier ?? VERIFIER),
      code_challenge_method: 'S256',
      state: options.state ?? 'client-state',
      device_name: 'Test Mac',
    },
  });
  if (authorize.statusCode !== 200) throw new Error(`authorize answered ${authorize.statusCode}`);
  const link = new RegExp(`href="(/login/${provider.id}/start\\?txn=[^"]+)"`).exec(
    authorize.body,
  )?.[1];
  if (!link) throw new Error('No provider link on the sign-in page');
  const start = await server.app.inject({ method: 'GET', url: link.replaceAll('&amp;', '&') });
  if (start.statusCode !== 302) throw new Error(`start answered ${start.statusCode}`);
  const toProvider = new URL(String(start.headers.location));
  const state = toProvider.searchParams.get('state') ?? '';
  const callback = await server.app.inject({
    method: 'GET',
    url: `/login/${provider.id}/callback`,
    query: { code, state },
  });
  if (callback.statusCode !== 302)
    throw new Error(`callback answered ${callback.statusCode}: ${callback.body}`);
  return { redirect: new URL(String(callback.headers.location)) };
}

export async function exchangeCode(
  server: TestServer,
  code: string,
  overrides: Record<string, string> = {},
) {
  return server.app.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'maka-desktop',
      code,
      code_verifier: VERIFIER,
      redirect_uri: LOOPBACK,
      ...overrides,
    }).toString(),
  });
}

export async function refresh(server: TestServer, refreshToken: string) {
  return server.app.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: 'maka-desktop',
      refresh_token: refreshToken,
    }).toString(),
  });
}
