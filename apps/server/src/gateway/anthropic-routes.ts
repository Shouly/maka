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

// The model gateway's Anthropic door (design §5.1): POST
// /model/anthropic/v1/messages. The body is the Anthropic Messages API as the
// desktop sent it; only `model` is swapped for the upstream's name. The answer
// streams back byte for byte while its usage is metered on the way.

import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CLIENT_VERSION_HEADER,
  GATEWAY_PATHS,
  type GatewayErrorDetail,
  MODEL_CATALOG_PATH,
  type PlatformErrorCode,
  type PlatformModelCatalog,
} from '@maka/platform-protocol';
import type { ServerContext } from '../context.js';
import { type Principal, resolvePrincipal, sendPlatformError } from '../http/common.js';
import type { AccessTokens } from '../identity/access-tokens.js';
import { modelForRequest, toPlatformModel, visibleModels } from './catalog.js';
import { exceededQuota } from './quota.js';
import type { UpstreamClients, UpstreamRow } from './upstream-clients.js';
import {
  AnthropicStreamMeter,
  applyAnthropicUsage,
  emptyUsage,
  recordUsage,
  type TokenUsage,
} from './usage.js';

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MESSAGES_PATH = `${GATEWAY_PATHS.anthropic}/messages`;

/**
 * Body fields the SDK would turn into upstream headers — which of the
 * organization's workspaces runs the request, whose profile it is billed to.
 * Those are the organization's to set, never the caller's.
 */
const HEADER_FIELDS = ['workspace_id', 'user_profile_id'] as const;

/** Anthropic's error shape, so SDKs show `message`; `maka` says why in terms the desktop maps. */
export function anthropicError(
  reply: FastifyReply,
  status: number,
  type: string,
  message: string,
  maka: GatewayErrorDetail,
  retryAfterSeconds?: number,
) {
  if (retryAfterSeconds !== undefined)
    reply.header('retry-after', String(Math.max(1, Math.ceil(retryAfterSeconds))));
  // An allowance that is used up does not come back by retrying.
  if (maka.code === 'quota_exceeded') reply.header('x-should-retry', 'false');
  return reply
    .status(status)
    .header('cache-control', 'no-store')
    .send({ type: 'error', error: { type, message }, maka });
}

/** Desktop SDKs send the access token as a bearer token or as the provider's API-key header. */
export function gatewayToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice('Bearer '.length).trim();
  const apiKey = request.headers['x-api-key'] ?? request.headers['x-goog-api-key'];
  return typeof apiKey === 'string' ? apiKey.trim() : '';
}

interface UpstreamFailure {
  readonly status?: number;
  readonly body?: unknown;
  readonly retryAfter?: string;
  /** Another route may succeed where this one did not. */
  readonly retryable: boolean;
}

/**
 * SDK errors come from several copies of the SDK, so they are read by shape,
 * not class. A 401/403/404 is this upstream's problem (a revoked key, a
 * project without access, a model missing in its region), so the next route
 * gets the request. An error with no status that is not a connection failure
 * is the SDK refusing the body before sending it: the caller's to fix.
 */
function upstreamFailure(error: unknown): UpstreamFailure {
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') {
    const headers = (error as { headers?: { get?: (name: string) => string | null } }).headers;
    const retryAfter = typeof headers?.get === 'function' ? headers.get('retry-after') : null;
    return {
      status,
      body: (error as { error?: unknown }).error,
      ...(retryAfter ? { retryAfter } : {}),
      retryable:
        status === 401 ||
        status === 403 ||
        status === 404 ||
        status === 408 ||
        status === 409 ||
        status === 429 ||
        status >= 500,
    };
  }
  if ((error as { constructor?: { name?: unknown } }).constructor?.name === 'AnthropicError') {
    return {
      status: 400,
      body: {
        type: 'error',
        error: { type: 'invalid_request_error', message: (error as Error).message },
      },
      retryable: false,
    };
  }
  return { retryable: true };
}

/**
 * The gateway speaks Anthropic's error shape even for failures Fastify raises
 * before the handler runs (a body too large, JSON that does not parse), and
 * parses JSON as is: Fastify's default refuses any `__proto__` key, which a
 * tool input may legitimately carry, and the body is only ever re-serialized.
 */
export async function registerAnthropicGateway(
  app: FastifyInstance,
  ctx: ServerContext,
  deps: { readonly accessTokens: AccessTokens; readonly clients: UpstreamClients },
): Promise<void> {
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: MAX_BODY_BYTES },
      (_request, body, done) => {
        try {
          done(null, JSON.parse(body as string));
        } catch {
          done(
            Object.assign(new Error('The body is not valid JSON'), { statusCode: 400 }),
            undefined,
          );
        }
      },
    );
    scope.setErrorHandler((error, request, reply) => {
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      if (status >= 500) request.log.error({ err: error }, 'gateway request failed');
      return status < 500
        ? anthropicError(
            reply,
            status,
            status === 413 ? 'request_too_large' : 'invalid_request_error',
            (error as Error).message,
            { code: 'invalid_request' },
          )
        : anthropicError(reply, 500, 'api_error', 'Internal server error', {
            code: 'upstream_unavailable',
          });
    });
    registerRoutes(scope, ctx, deps);
  });
}

function registerRoutes(
  app: FastifyInstance,
  ctx: ServerContext,
  deps: { readonly accessTokens: AccessTokens; readonly clients: UpstreamClients },
): void {
  app.get(MODEL_CATALOG_PATH, async (request, reply) => {
    const principal = await resolvePrincipal(ctx, deps.accessTokens, gatewayToken(request));
    if (!principal) return sendPlatformError(reply, 401, 'unauthenticated', 'Sign in again');
    const catalog: PlatformModelCatalog = {
      models: (await visibleModels(ctx)).map(toPlatformModel),
    };
    return reply.header('cache-control', 'no-store').send(catalog);
  });

  app.post(MESSAGES_PATH, { bodyLimit: MAX_BODY_BYTES }, async (request, reply) => {
    const startedAt = performance.now();
    const principal = await resolvePrincipal(ctx, deps.accessTokens, gatewayToken(request));
    if (!principal) {
      return anthropicError(
        reply,
        401,
        'authentication_error',
        'Sign in to your company account again',
        {
          code: 'unauthenticated',
        },
      );
    }
    const body = request.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return anthropicError(reply, 400, 'invalid_request_error', 'The body must be a JSON object', {
        code: 'invalid_request',
      });
    }
    const requested = (body as Record<string, unknown>).model;
    const model =
      typeof requested === 'string'
        ? await modelForRequest(ctx, 'anthropic', requested)
        : undefined;
    if (!model) {
      return anthropicError(
        reply,
        403,
        'permission_error',
        `The model ${typeof requested === 'string' ? requested : ''} is not available to you`,
        { code: 'model_not_allowed' },
      );
    }
    const exceeded = await exceededQuota(ctx, principal.userId);
    if (exceeded) {
      return anthropicError(
        reply,
        429,
        'rate_limit_error',
        `Your model allowance for this period is used up; it resets at ${new Date(exceeded.retryAt).toISOString()}`,
        { code: 'quota_exceeded', retryAt: exceeded.retryAt },
        (exceeded.retryAt - ctx.now().getTime()) / 1000,
      );
    }
    const routes = await ctx.db
      .selectFrom('model_routes')
      .innerJoin('upstreams', 'upstreams.id', 'model_routes.upstream_id')
      .selectAll('upstreams')
      .select(['model_routes.upstream_model'])
      .where('model_routes.model_id', '=', model.id)
      .where('upstreams.enabled', '=', true)
      .orderBy('model_routes.priority')
      .execute();

    const clientVersion = request.headers[CLIENT_VERSION_HEADER];
    const record = (fields: {
      upstream: UpstreamRow | null;
      usage: TokenUsage;
      status: 'ok' | 'error' | 'cancelled';
      httpStatus: number | null;
      upstreamRequestId?: string | null;
    }) =>
      recordUsage(ctx, {
        userId: principal.userId,
        sessionId: principal.sessionId,
        modelId: model.id,
        upstreamId: fields.upstream?.id ?? null,
        protocol: 'anthropic',
        usage: fields.usage,
        costWeight: model.cost_weight,
        status: fields.status,
        httpStatus: fields.httpStatus,
        latencyMs: performance.now() - startedAt,
        clientVersion: typeof clientVersion === 'string' ? clientVersion.slice(0, 64) : null,
        upstreamRequestId: fields.upstreamRequestId ?? null,
      }).catch((error) => request.log.error({ err: error }, 'recording usage failed'));

    const abort = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableFinished) abort.abort();
    };
    reply.raw.on('close', onClose);
    // Gone while auth, quota and routes were being looked up: its 'close'
    // fired before anyone listened, and nothing is sent upstream.
    // (The socket, not the request: a request whose body has been read is
    // itself "destroyed" on current Node, with its caller still waiting.)
    if (reply.raw.destroyed || request.raw.socket?.destroyed === true) {
      reply.raw.off('close', onClose);
      await record({ upstream: null, usage: emptyUsage(), status: 'cancelled', httpStatus: null });
      return reply;
    }
    const betaHeader = request.headers['anthropic-beta'];
    const betas =
      typeof betaHeader === 'string'
        ? betaHeader
            .split(',')
            .map((beta) => beta.trim())
            .filter(Boolean)
        : [];

    let lastFailure: UpstreamFailure | undefined;
    for (const route of routes) {
      const upstream: UpstreamRow = route;
      let response: Response;
      try {
        const client = deps.clients.anthropicFamily(upstream);
        const upstreamBody: Record<string, unknown> = {
          ...(body as Record<string, unknown>),
          model: route.upstream_model,
        };
        for (const field of HEADER_FIELDS) delete upstreamBody[field];
        const options = { signal: abort.signal };
        response = await (betas.length > 0
          ? client.beta.messages.create({ ...upstreamBody, betas } as never, options)
          : client.messages.create(upstreamBody as never, options)
        ).asResponse();
      } catch (error) {
        if (abort.signal.aborted) {
          await record({ upstream, usage: emptyUsage(), status: 'cancelled', httpStatus: null });
          return reply;
        }
        lastFailure = upstreamFailure(error);
        request.log.warn(
          {
            upstream: upstream.name,
            status: lastFailure.status,
            err: lastFailure.status ? undefined : error,
          },
          'upstream request failed',
        );
        if (lastFailure.retryable) continue;
        break;
      }
      return relay(request, reply, response, upstream, record);
    }

    reply.raw.off('close', onClose);
    await record({
      upstream: null,
      usage: emptyUsage(),
      status: 'error',
      httpStatus: lastFailure?.status ?? null,
    });
    // A request the upstream judged malformed is the caller's to fix; say so as is.
    if (lastFailure?.status === 400 || lastFailure?.status === 413 || lastFailure?.status === 422) {
      return reply
        .status(lastFailure.status)
        .header('cache-control', 'no-store')
        .send(lastFailure.body);
    }
    const code: PlatformErrorCode = 'upstream_unavailable';
    if (lastFailure?.status === 429) {
      const retryAfter = Number(lastFailure.retryAfter);
      return anthropicError(
        reply,
        429,
        'rate_limit_error',
        'The model provider is busy; try again shortly',
        {
          code: 'rate_limited',
        },
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      );
    }
    return anthropicError(
      reply,
      routes.length === 0 ? 503 : 502,
      routes.length === 0 ? 'api_error' : 'overloaded_error',
      routes.length === 0
        ? 'This model has no provider configured'
        : 'The model provider could not be reached',
      { code },
    );
  });
}

async function relay(
  request: FastifyRequest,
  reply: FastifyReply,
  response: Response,
  upstream: UpstreamRow,
  record: (fields: {
    upstream: UpstreamRow | null;
    usage: TokenUsage;
    status: 'ok' | 'error' | 'cancelled';
    httpStatus: number | null;
    upstreamRequestId?: string | null;
  }) => Promise<void>,
) {
  const upstreamRequestId = response.headers.get('request-id');
  const contentType = response.headers.get('content-type') ?? 'application/json';
  reply
    .status(response.status)
    .header('content-type', contentType)
    .header('cache-control', 'no-store');
  if (upstreamRequestId) reply.header('x-upstream-request-id', upstreamRequestId);

  if (!contentType.includes('text/event-stream') || !response.body) {
    let text: string;
    try {
      text = await response.text();
    } catch {
      // The caller hung up (or the upstream dropped) before the answer arrived.
      await record({
        upstream,
        usage: emptyUsage(),
        status: 'cancelled',
        httpStatus: response.status,
        upstreamRequestId,
      });
      return reply;
    }
    const usage = emptyUsage();
    try {
      applyAnthropicUsage(usage, (JSON.parse(text) as { usage?: unknown }).usage);
    } catch {
      // Not JSON: nothing to meter.
    }
    await record({ upstream, usage, status: 'ok', httpStatus: response.status, upstreamRequestId });
    return reply.send(text);
  }

  const meter = new AnthropicStreamMeter();
  let settled = false;
  const settle = (status: 'ok' | 'error' | 'cancelled') => {
    if (settled) return;
    settled = true;
    void record({
      upstream,
      usage: meter.charge(),
      status,
      httpStatus: response.status,
      upstreamRequestId,
    });
  };
  const metered = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        meter.push(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        settle('ok');
      },
    }),
  );
  const stream = Readable.fromWeb(metered as import('node:stream/web').ReadableStream<Uint8Array>);
  // The upstream failed mid-answer.
  stream.on('error', () => settle('error'));
  // However the stream ends without finishing — the caller hung up, Fastify
  // tore it down — it is still recorded, with what had streamed.
  stream.on('close', () => settle('cancelled'));
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) {
      stream.destroy();
      settle('cancelled');
    }
  });
  request.log.debug({ upstream: upstream.name }, 'streaming from upstream');
  return reply.send(stream);
}
