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

// The admin console under /admin (design §3.2): its sign-in, its JSON API at
// /admin/api, and the page itself, a single-page app built into
// dist/console and served from here. Every API call needs an administrator's
// console session; every change also needs the session's CSRF token.

import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PlatformErrorCode } from '@maka/platform-protocol';
import {
  type AdminActor,
  AdminRefused,
  auditPage,
  listQuotas,
  listUsers,
  revokeDevice,
  setQuota,
  unlinkIdentity,
  updateUser,
  usageReport,
  userDetail,
} from '../administration.js';
import { z } from 'zod';
import {
  createModelProvider,
  deleteModel,
  deleteModelProvider,
  listModelProviders,
  listModels,
  modelProviderById,
  modelProviderDetail,
  publishToProvider,
  updateModel,
  updateModelProvider,
} from '../model-management.js';
import { recordAudit } from '../audit.js';
import type { ServerContext } from '../context.js';
import { sendPlatformError } from '../http/common.js';
import type { IdentityProvider } from '../identity/providers/types.js';
import {
  ADMIN_PATH,
  type AdminPrincipal,
  clearAdminCookie,
  consoleSession,
  resolveAdminSession,
  revokeAdminSession,
  sameOriginChange,
} from './session.js';
import { consoleLoginPath, consoleReturnPath, startConsoleSignIn } from './sign-in.js';
import { CONSOLE_CSRF_HEADER, type ConsoleErrorCode, type ConsoleQuotaPeriod } from './types.js';
import { type CatalogDeps, discoverModels, storedDraft, validatedDraft } from './model-catalog.js';

/** Where the built page lives: dist/console, beside this module's dist/admin-console. */
const DEFAULT_CONSOLE_DIR = fileURLToPath(new URL('../console/', import.meta.url));

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.json': 'application/json',
  '.map': 'application/json',
};

const PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  // The component library positions menus and dialogs with inline styles.
  "style-src 'self' 'unsafe-inline'",
  // Identity providers' profile pictures.
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/** Answer with the console's page, which routes on the client. */
export type SendConsolePage = (reply: FastifyReply, status?: number) => Promise<FastifyReply>;

/** Registers the console and returns its page sender, which also draws the server's 404 for browsers. */
export async function registerAdminConsole(
  app: FastifyInstance,
  ctx: ServerContext,
  deps: {
    readonly providers: ReadonlyMap<string, IdentityProvider>;
    /** The built page; tests point it elsewhere or at nothing. */
    readonly consoleDir?: string;
    /** How providers' model lists are read. */
    readonly catalog: CatalogDeps;
  },
): Promise<SendConsolePage> {
  const consoleDir = resolve(deps.consoleDir ?? DEFAULT_CONSOLE_DIR);

  // A browser opening the server's address is someone looking for the
  // console; the API has nothing to show there.
  app.get('/', (_request, reply) => reply.redirect(`${ADMIN_PATH}/`, 302));
  app.get(ADMIN_PATH, (_request, reply) => reply.redirect(`${ADMIN_PATH}/`, 302));

  // The sign-in page is the console's own, drawn in the design system; it
  // needs no session. Someone already signed in goes on to the console.
  app.get(`${ADMIN_PATH}/login`, async (request, reply) => {
    const next = (request.query as Record<string, unknown>).next;
    if (await resolveAdminSession(ctx, request)) {
      return reply.redirect(consoleReturnPath(next), 302);
    }
    return sendPage(reply);
  });

  app.get(`${ADMIN_PATH}/login/:provider`, async (request, reply) => {
    const provider = deps.providers.get((request.params as { provider: string }).provider);
    const next = (request.query as Record<string, unknown>).next;
    if (!provider) {
      return reply.redirect(consoleLoginPath({ next: consoleReturnPath(next) }), 302);
    }
    return startConsoleSignIn(ctx, reply, provider, next);
  });

  await app.register(
    async (api) => {
      const principals = new WeakMap<FastifyRequest, AdminPrincipal>();
      api.addHook('preHandler', async (request, reply) => {
        const principal = await resolveAdminSession(ctx, request);
        if (!principal) {
          return sendPlatformError(reply, 401, 'unauthenticated', 'Sign in to the admin console');
        }
        const changes = request.method !== 'GET' && request.method !== 'HEAD';
        if (changes && !sameOriginChange(ctx, request, principal, CONSOLE_CSRF_HEADER)) {
          return sendPlatformError(
            reply,
            403,
            'forbidden',
            'This change did not come from the console',
          );
        }
        // The page sends JSON; the server's form parser is for OAuth clients.
        const type = request.headers['content-type'];
        if (changes && type !== undefined && !type.startsWith('application/json')) {
          return sendPlatformError(reply, 415, 'invalid_request', 'Send JSON');
        }
        principals.set(request, principal);
      });

      const actorOf = (request: FastifyRequest): AdminActor => ({
        userId: principals.get(request)!.userId,
        via: 'admin-console',
        ip: request.ip,
      });

      /** Run a handler; an organization rule's refusal is an answer, not a failure. */
      const handle =
        (run: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
        async (request: FastifyRequest, reply: FastifyReply) => {
          try {
            const result = await run(request, reply);
            if (reply.sent) return reply;
            return reply.header('cache-control', 'no-store').send(result ?? {});
          } catch (error) {
            const refuse = (status: number, code: ConsoleErrorCode, message: string) =>
              reply
                .status(status)
                .header('cache-control', 'no-store')
                .send({ error: { code, message } });
            if (error instanceof z.ZodError)
              return refuse(400, 'invalid_request', 'Some fields are missing or malformed');
            // A unique key taken by a change that landed meanwhile: a provider's
            // name, or a model another publish added first.
            if ((error as { code?: string }).code === '23505')
              return (error as { constraint?: string }).constraint === 'model_providers_name_key'
                ? refuse(409, 'name_taken', 'This name is taken')
                : refuse(
                    409,
                    'revision_conflict',
                    'This was changed elsewhere; reload and try again',
                  );
            if (error instanceof AdminRefused)
              return refuse(
                error.status,
                error.code ?? (error.status === 404 ? 'not_found' : 'invalid_request'),
                error.message,
              );
            throw error;
          }
        };

      const params = (request: FastifyRequest) => request.params as Record<string, string>;
      const query = (request: FastifyRequest) => request.query as Record<string, unknown>;

      api.get(
        '/session',
        handle(async (request) => consoleSession(ctx, principals.get(request)!)),
      );
      api.post(
        '/session/sign-out',
        handle(async (request, reply) => {
          const principal = principals.get(request)!;
          await revokeAdminSession(ctx, principal.sessionId);
          await recordAudit(
            ctx.db,
            {
              action: 'admin.signed_out',
              actorUserId: principal.userId,
              targetType: 'admin_session',
              targetId: principal.sessionId,
              detail: { via: 'admin-console' },
              ip: request.ip,
            },
            ctx.now(),
          );
          clearAdminCookie(ctx, reply);
          return {};
        }),
      );

      api.get(
        '/users',
        handle(async (request) => {
          const needle = query(request).query;
          return listUsers(ctx, typeof needle === 'string' ? { query: needle } : {});
        }),
      );
      api.get(
        '/users/:id',
        handle(async (request) => userDetail(ctx, params(request).id!)),
      );
      api.patch(
        '/users/:id',
        handle(async (request) => {
          const body = objectBody(request);
          await updateUser(ctx, actorOf(request), params(request).id!, {
            ...(body.orgRole !== undefined ? { orgRole: body.orgRole as never } : {}),
            ...(body.status !== undefined ? { status: body.status as never } : {}),
          });
          return userDetail(ctx, params(request).id!);
        }),
      );
      api.delete(
        '/users/:id/links/:provider',
        handle(async (request) => {
          const { id, provider } = params(request);
          await unlinkIdentity(ctx, actorOf(request), id!, provider!);
          return userDetail(ctx, id!);
        }),
      );
      api.post(
        '/users/:id/devices/:deviceId/revoke',
        handle(async (request) => {
          const { id, deviceId } = params(request);
          await revokeDevice(ctx, actorOf(request), id!, deviceId!);
          return userDetail(ctx, id!);
        }),
      );

      api.get(
        '/model-providers',
        handle(async () => listModelProviders(ctx)),
      );
      api.get(
        '/model-providers/:id',
        handle(async (request) => modelProviderDetail(ctx, params(request).id!)),
      );
      // Read a provider account's model list, for one not yet saved.
      api.post(
        '/model-providers/discover',
        handle(async (request) =>
          discoverModels(
            ctx,
            actorOf(request),
            validatedDraft(objectBody(request).draft),
            deps.catalog,
          ),
        ),
      );
      api.post(
        '/model-providers',
        handle(async (request) => createModelProvider(ctx, actorOf(request), objectBody(request))),
      );
      // Read a saved provider's model list again, to publish more of it.
      api.post(
        '/model-providers/:id/discover',
        handle(async (request) => {
          const row = await modelProviderById(ctx, params(request).id!);
          return discoverModels(ctx, actorOf(request), storedDraft(ctx, row), deps.catalog, row);
        }),
      );
      api.post(
        '/model-providers/:id/publish',
        handle(async (request) =>
          publishToProvider(ctx, actorOf(request), params(request).id!, objectBody(request)),
        ),
      );
      api.patch(
        '/model-providers/:id',
        handle(async (request) =>
          updateModelProvider(
            ctx,
            actorOf(request),
            params(request).id!,
            objectBody(request),
            deps.catalog,
          ),
        ),
      );
      api.delete(
        '/model-providers/:id',
        handle(async (request) => {
          await deleteModelProvider(
            ctx,
            actorOf(request),
            params(request).id!,
            objectBody(request),
          );
          return {};
        }),
      );
      api.get(
        '/models',
        handle(async () => listModels(ctx)),
      );
      api.patch(
        '/models/:id',
        handle(async (request) =>
          updateModel(ctx, actorOf(request), params(request).id!, objectBody(request)),
        ),
      );
      api.delete(
        '/models/:id',
        handle(async (request) => {
          await deleteModel(ctx, actorOf(request), params(request).id!, objectBody(request));
          return {};
        }),
      );
      api.get(
        '/quotas',
        handle(async () => listQuotas(ctx)),
      );
      api.put(
        '/quotas/default/:period',
        handle(async (request) => {
          await setQuota(
            ctx,
            actorOf(request),
            { scope: 'user_default' },
            params(request).period as ConsoleQuotaPeriod,
            limitField(objectBody(request).limit),
          );
          return listQuotas(ctx);
        }),
      );
      api.put(
        '/quotas/users/:userId/:period',
        handle(async (request) => {
          const { userId, period } = params(request);
          await setQuota(
            ctx,
            actorOf(request),
            { scope: 'user', userId: userId! },
            period as ConsoleQuotaPeriod,
            limitField(objectBody(request).limit),
          );
          return listQuotas(ctx);
        }),
      );

      api.get(
        '/usage',
        handle(async (request) => {
          const days = Number(query(request).days ?? 30);
          return usageReport(ctx, days);
        }),
      );
      api.get(
        '/audit',
        handle(async (request) => {
          const { before, action } = query(request);
          return auditPage(ctx, {
            ...(typeof before === 'string' ? { before } : {}),
            ...(typeof action === 'string' && action ? { action } : {}),
          });
        }),
      );
      // A path under the API that names nothing is not the page.
      api.all('/*', (_request, reply) => sendPlatformError(reply, 404, 'not_found', 'Not found'));
    },
    { prefix: `${ADMIN_PATH}/api` },
  );

  app.get(`${ADMIN_PATH}/assets/*`, async (request, reply) => {
    const relative = (request.params as { '*': string })['*'];
    const file = resolve(consoleDir, 'assets', relative);
    if (!file.startsWith(`${resolve(consoleDir, 'assets')}${sep}`)) {
      return sendPlatformError(reply, 404, 'not_found', 'Not found');
    }
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return sendPlatformError(reply, 404, 'not_found', 'Not found');
    }
    return (
      reply
        .header('content-type', CONTENT_TYPES[extname(file)] ?? 'application/octet-stream')
        // Built names carry their content hash, so they never change in place.
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(body)
    );
  });

  /** The page, which routes on the client; unbuilt, it says how to build it. */
  const sendPage: SendConsolePage = async (reply, status = 200) => {
    let page: Buffer;
    try {
      page = await readFile(resolve(consoleDir, 'index.html'));
    } catch {
      // A missing page is the 404 it was asked for, not the server down.
      return reply
        .status(status === 200 ? 503 : status)
        .header('content-type', 'text/plain; charset=utf-8')
        .send('The admin console has not been built (npm --workspace @maka/server run build).');
    }
    return reply
      .status(status)
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('content-security-policy', PAGE_POLICY)
      .header('x-frame-options', 'DENY')
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'same-origin')
      .send(page);
  };

  // Every other path under /admin is the page, for an administrator.
  app.get(`${ADMIN_PATH}/*`, async (request, reply) => {
    if (!(await resolveAdminSession(ctx, request))) {
      const next = consoleReturnPath(request.url.split('?')[0]);
      return reply.redirect(consoleLoginPath({ next }), 302);
    }
    return sendPage(reply);
  });
  return sendPage;
}

/**
 * Whether a request that found nothing came from someone's browser, which is
 * shown the console's 404 page, rather than from a program, which is answered
 * in JSON: a page navigation asks for HTML, and the API's paths never do.
 */
export function wantsNotFoundPage(request: FastifyRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const path = request.url.split('?')[0] ?? '';
  if (/^\/(?:admin\/api|admin\/assets|model|v1|oauth|\.well-known)(?:\/|$)/.test(path))
    return false;
  return String(request.headers.accept ?? '').includes('text/html');
}

function objectBody(request: FastifyRequest): Record<string, unknown> {
  const body = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AdminRefused(400, 'Send a JSON object');
  }
  return body as Record<string, unknown>;
}

function limitField(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number') throw new AdminRefused(400, 'The allowance is a number or null');
  return value;
}
