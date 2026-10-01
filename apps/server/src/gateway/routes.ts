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

// The model gateway (design §7): one path per protocol the desktop's SDKs
// speak. Each request is checked — the employee signed in, the organization
// model open to them and its provider on, the allowance not used up — then
// sent to the model's one provider with the organization's credential, and
// the provider's answer comes back as it was sent: status, body, stream,
// errors included. The gateway reads the usage off it on the way and records
// one row when the request ends. It keeps no conversation state.

import { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { decodeExecutionContract, type ModelApiProtocol } from '@maka/core/model-gateway';
import {
  CLIENT_VERSION_HEADER,
  GATEWAY_MODEL_HEADER,
  GATEWAY_SCHEMA_VERSION,
  GATEWAY_VERSION_HEADER,
  MODEL_CATALOG_PATH,
  type PlatformErrorCode,
} from '@maka/platform-protocol';
import type { ServerContext } from '../context.js';
import { newId } from '../crypto/tokens.js';
import { resolvePrincipal } from '../http/common.js';
import type { AccessTokens } from '../identity/access-tokens.js';
import { organizationCatalog } from './catalog.js';
import { gatewayError, protocolOfPath } from './errors.js';
import { type ModelProviderTransport, ProviderUnreachableError } from './model-providers.js';
import { exceededQuota } from './quota.js';
import { emptyUsage, estimateRequestTokens, GatewayUsageMeter, weightedUnits } from './usage.js';

/** Long enough for a non-streamed answer to be written; any byte starts it again. */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const BODY_LIMIT = 32 * 1024 * 1024;
/** What of the provider's response headers the client's SDK reads. */
const FORWARDED_HEADERS = [
  'content-type',
  'request-id',
  'x-request-id',
  'retry-after',
  'retry-after-ms',
  'x-should-retry',
] as const;

const header = (request: FastifyRequest, name: string) =>
  typeof request.headers[name] === 'string' ? (request.headers[name] as string) : '';
const bearer = (request: FastifyRequest) =>
  header(request, 'authorization').replace(/^Bearer /, '');

const ENDPOINTS: readonly (readonly [string, ModelApiProtocol])[] = [
  ['/model/anthropic/v1/messages', 'anthropic-messages'],
  ['/model/openai/v1/chat/completions', 'openai-chat'],
  ['/model/openai/v1/responses', 'openai-responses'],
  ['/model/gemini/v1beta/models/:operation', 'google-generate'],
];

export async function registerModelGateway(
  app: FastifyInstance,
  ctx: ServerContext,
  deps: { readonly accessTokens: AccessTokens; readonly transport: ModelProviderTransport },
): Promise<void> {
  const inFlight = new Set<AbortController>();
  app.addHook('preClose', async () => {
    for (const controller of inFlight) controller.abort();
  });

  app.get(MODEL_CATALOG_PATH, async (request, reply) => {
    if (header(request, GATEWAY_VERSION_HEADER) !== String(GATEWAY_SCHEMA_VERSION))
      return gatewayError(reply, 'anthropic-messages', 409, 'upgrade_required', 'Update Maka');
    if (!(await resolvePrincipal(ctx, deps.accessTokens, bearer(request))))
      return gatewayError(reply, 'anthropic-messages', 401, 'unauthenticated', 'Sign in again');
    return reply.header('cache-control', 'no-store').send(await organizationCatalog(ctx));
  });

  await app.register(async (gateway) => {
    gateway.setErrorHandler((error, request, reply) => {
      const status = (error as { statusCode?: number }).statusCode ?? 500;
      const protocol = protocolOfPath(request.url);
      if (status >= 500) request.log.error({ err: error }, 'model gateway request failed');
      return gatewayError(
        reply,
        protocol,
        status < 500 ? 400 : 502,
        status < 500 ? 'invalid_request' : 'upstream_unavailable',
        status < 500 ? 'The request could not be read' : 'The gateway could not send the request',
      );
    });
    // Large conversations (images, documents) are normal here.
    gateway.removeContentTypeParser('application/json');
    gateway.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: BODY_LIMIT },
      (_request, raw, done) => {
        try {
          done(null, JSON.parse(String(raw)));
        } catch (error) {
          done(error as Error);
        }
      },
    );

    for (const [path, protocol] of ENDPOINTS)
      gateway.post(path, { bodyLimit: BODY_LIMIT }, async (request, reply) => {
        const refuse = (
          status: number,
          code: PlatformErrorCode,
          message: string,
          options?: { retry?: boolean; retryAt?: number },
        ) => gatewayError(reply, protocol, status, code, message, options);

        if (header(request, GATEWAY_VERSION_HEADER) !== String(GATEWAY_SCHEMA_VERSION))
          return refuse(409, 'upgrade_required', 'Update Maka to use the organization models');
        const principal = await resolvePrincipal(ctx, deps.accessTokens, bearer(request));
        if (!principal) return refuse(401, 'unauthenticated', 'Sign in again');

        const body = request.body;
        if (!body || typeof body !== 'object' || Array.isArray(body))
          return refuse(400, 'invalid_request', 'Send a JSON object');
        let stream = (body as Record<string, unknown>).stream === true;
        if (protocol === 'google-generate') {
          const operation = String((request.params as { operation: string }).operation);
          const method = /:(generateContent|streamGenerateContent)$/.exec(operation)?.[1];
          if (!method) return refuse(400, 'invalid_request', 'Unknown model operation');
          stream = method === 'streamGenerateContent';
        }

        const modelId = header(request, GATEWAY_MODEL_HEADER);
        const model = modelId
          ? await ctx.db
              .selectFrom('organization_models')
              .innerJoin(
                'model_providers',
                'model_providers.id',
                'organization_models.model_provider_id',
              )
              .selectAll('model_providers')
              .select([
                'organization_models.contract',
                'organization_models.cost_weight',
                'organization_models.provider_model',
                'organization_models.enabled as model_enabled',
              ])
              .where('organization_models.id', '=', modelId)
              .executeTakeFirst()
          : undefined;
        if (!model || !model.model_enabled || !model.enabled)
          return refuse(403, 'model_not_allowed', 'This model is not available to you');
        let contract;
        try {
          contract = decodeExecutionContract(model.contract);
        } catch (error) {
          request.log.error({ err: error, modelId }, 'stored model contract does not decode');
          return refuse(502, 'upstream_unavailable', 'This model is misconfigured');
        }
        if (contract.apiProtocol !== protocol)
          return refuse(400, 'invalid_request', 'This model is called through another path');

        const quota = await exceededQuota(ctx, principal.userId);
        if (quota)
          return refuse(429, 'quota_exceeded', 'Your model allowance is used up', {
            retryAt: quota.retryAt,
          });

        // Gone already: nothing is sent, and nothing is recorded.
        if (reply.raw.destroyed || request.raw.socket?.destroyed === true) return reply;

        const controller = new AbortController();
        inFlight.add(controller);
        let idle: NodeJS.Timeout | undefined;
        const touch = () => {
          clearTimeout(idle);
          idle = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
          idle.unref();
        };
        let cancelled = false;
        const onClose = () => {
          if (!reply.raw.writableFinished) {
            cancelled = true;
            controller.abort();
          }
        };
        reply.raw.on('close', onClose);
        const release = () => {
          clearTimeout(idle);
          inFlight.delete(controller);
          reply.raw.off('close', onClose);
        };

        const started = performance.now();
        const meter = new GatewayUsageMeter(protocol, stream, () => estimateRequestTokens(body));
        let recorded = false;
        /** `refused`: the provider answered with an error, or was never reached — no work to count. */
        const record = async (
          status: 'ok' | 'error' | 'cancelled' | 'incomplete',
          httpStatus: number | null,
          upstreamRequestId: string | null,
          refused = false,
        ) => {
          if (recorded) return;
          recorded = true;
          const { usage, quality } = refused
            ? { usage: emptyUsage(), quality: 'reported' as const }
            : meter.result();
          await ctx.db
            .insertInto('model_usage')
            .values({
              id: newId(),
              at: ctx.now(),
              cost_weight: model.cost_weight,
              user_id: principal.userId,
              session_id: principal.sessionId,
              model_id: modelId,
              model_provider_id: model.id,
              api_protocol: protocol,
              input_tokens: usage.input,
              output_tokens: usage.output,
              cache_write_tokens: usage.cacheWrite,
              cache_read_tokens: usage.cacheRead,
              weighted_units: weightedUnits(usage, model.cost_weight),
              quality,
              status,
              http_status: httpStatus,
              latency_ms: Math.round(performance.now() - started),
              client_version: header(request, CLIENT_VERSION_HEADER).slice(0, 64) || null,
              upstream_request_id: upstreamRequestId?.slice(0, 200) ?? null,
            })
            .execute()
            .catch((error: unknown) =>
              request.log.error({ err: error }, 'recording model usage failed'),
            );
        };

        let response: Response;
        touch();
        try {
          response = await deps.transport.send({
            row: model,
            protocol,
            providerModel: model.provider_model,
            body: body as Record<string, unknown>,
            stream,
            anthropicBeta: header(request, 'anthropic-beta') || undefined,
            signal: controller.signal,
          });
        } catch (error) {
          release();
          if (cancelled) {
            await record('cancelled', null, null);
            return reply;
          }
          const unreachable = error instanceof ProviderUnreachableError ? error : undefined;
          request.log.warn(
            { provider: model.name, reason: unreachable?.reason ?? 'timeout' },
            'model provider unreachable',
          );
          await record('error', null, null, true);
          return refuse(502, 'upstream_unavailable', 'The model provider could not be reached', {
            retry: unreachable?.notSent ?? false,
          });
        }
        touch();

        const upstreamRequestId =
          response.headers.get('request-id') ?? response.headers.get('x-request-id');
        reply.status(response.status).header('cache-control', 'no-store');
        for (const name of FORWARDED_HEADERS) {
          const value = response.headers.get(name);
          if (value !== null) reply.header(name, value);
        }
        if (stream && response.ok) reply.header('x-accel-buffering', 'no');
        const upstream = response.body;
        if (!upstream) {
          release();
          await record(
            response.ok ? 'ok' : 'error',
            response.status,
            upstreamRequestId,
            !response.ok,
          );
          return reply.send();
        }

        async function* relay() {
          const reader = upstream!.getReader();
          let ended = false;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              touch();
              meter.feed(value);
              yield value;
            }
            ended = true;
          } finally {
            release();
            await reader.cancel().catch(() => {});
            reader.releaseLock();
            if (ended) meter.finish();
            await record(
              !response.ok || meter.failed
                ? 'error'
                : cancelled
                  ? 'cancelled'
                  : ended && (meter.complete || !stream)
                    ? 'ok'
                    : 'incomplete',
              response.status,
              upstreamRequestId,
              !response.ok,
            );
          }
        }
        return reply.send(Readable.from(relay()));
      });
  });
}
