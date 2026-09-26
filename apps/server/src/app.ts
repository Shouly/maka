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

// Assembles the HTTP server from its modules. Everything it needs is passed
// in, so tests build the same server over an in-process database.

import formbody from '@fastify/formbody';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  PLATFORM_API_VERSION,
  PLATFORM_METADATA_PATH,
  type PlatformMetadata,
} from '@maka/platform-protocol';
import type { ServerContext } from './context.js';
import { clientVersionGate, sendPlatformError } from './http/common.js';
import { registerAnthropicGateway } from './gateway/anthropic-routes.js';
import { UpstreamClients } from './gateway/upstream-clients.js';
import type { AccessTokens } from './identity/access-tokens.js';
import type { IdentityProvider } from './identity/providers/types.js';
import { registerIdentityRoutes } from './identity/routes.js';

export interface ServerDependencies {
  readonly providers: ReadonlyMap<string, IdentityProvider>;
  readonly accessTokens: AccessTokens;
  /** Upstream model clients; tests pass one over a fake fetch. */
  readonly upstreamClients?: UpstreamClients;
  /** Omit to log nothing (tests). */
  readonly logger?: { readonly level: string };
}

/** A hop count becomes "trust the nearest N proxies"; addresses pass through. */
function fastifyTrustProxy(
  value: false | number | string,
): boolean | string | ((address: string, hop: number) => boolean) {
  if (typeof value !== 'number') return value;
  return (_address, hop) => hop < value;
}

export async function buildServer(
  ctx: ServerContext,
  deps: ServerDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({
    // Paths only: sign-in callbacks carry authorization codes in their query.
    logger: deps.logger
      ? {
          level: deps.logger.level,
          serializers: {
            req: (request: { method: string; url: string; ip?: string }) => ({
              method: request.method,
              path: request.url.split('?')[0],
              remoteAddress: request.ip,
            }),
          },
        }
      : false,
    trustProxy: fastifyTrustProxy(ctx.config.trustProxy),
    bodyLimit: 1024 * 1024,
  });
  await app.register(formbody);
  app.addHook('onRequest', clientVersionGate(ctx));

  app.setErrorHandler((error, request, reply) => {
    const failure = error as { statusCode?: number; message?: string };
    const status = failure.statusCode ?? 500;
    if (status < 500) {
      return sendPlatformError(
        reply,
        status,
        'invalid_request',
        failure.message ?? 'Invalid request',
      );
    }
    request.log.error({ err: error }, 'request failed');
    return sendPlatformError(reply, 500, 'upstream_unavailable', 'Internal server error');
  });
  app.setNotFoundHandler((_request, reply) =>
    sendPlatformError(reply, 404, 'not_found', 'Not found'),
  );

  app.get('/healthz', async () => {
    await ctx.db.selectFrom('users').select('id').limit(1).execute();
    return { ok: true };
  });

  app.get(PLATFORM_METADATA_PATH, async () => {
    const base = ctx.config.publicUrl;
    const metadata: PlatformMetadata = {
      apiVersion: PLATFORM_API_VERSION,
      identityProviders: [...deps.providers.values()].map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
      })),
      issuer: base,
      authorizationEndpoint: `${base}/oauth/authorize`,
      tokenEndpoint: `${base}/oauth/token`,
      revocationEndpoint: `${base}/oauth/revoke`,
      jwksUri: `${base}/.well-known/jwks.json`,
      ...(ctx.config.minimumClientVersion
        ? { minimumClientVersion: ctx.config.minimumClientVersion }
        : {}),
    };
    return metadata;
  });

  app.get('/.well-known/jwks.json', async (_request, reply) =>
    reply.header('cache-control', 'public, max-age=300').send(await deps.accessTokens.jwks()),
  );

  registerIdentityRoutes(app, ctx, deps);
  await registerAnthropicGateway(app, ctx, {
    accessTokens: deps.accessTokens,
    clients: deps.upstreamClients ?? new UpstreamClients(ctx),
  });
  return app;
}
