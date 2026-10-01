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

// The gateway's own refusals. Everything else on its paths is the provider's
// answer, passed on as it came; these are the gateway's words, and say so.

import type { FastifyReply } from 'fastify';
import type { ModelApiProtocol } from '@maka/core/model-gateway';
import { GATEWAY_ERROR_HEADER, type PlatformErrorCode } from '@maka/platform-protocol';

/** The protocol a gateway path speaks, for answering in its error shape. */
export function protocolOfPath(url: string): ModelApiProtocol {
  if (url.startsWith('/model/gemini/')) return 'google-generate';
  if (url.startsWith('/model/openai/v1/responses')) return 'openai-responses';
  if (url.startsWith('/model/openai/')) return 'openai-chat';
  return 'anthropic-messages';
}

/**
 * The gateway's own refusal, in the protocol's error shape so the SDK shows
 * its message, with `maka` and the GATEWAY_ERROR_HEADER saying it is the
 * gateway's. Nothing was sent to a provider.
 */
export function gatewayError(
  reply: FastifyReply,
  protocol: ModelApiProtocol,
  status: number,
  code: PlatformErrorCode,
  message: string,
  options: { readonly retry?: boolean; readonly retryAt?: number } = {},
): FastifyReply {
  const maka = { code, ...(options.retryAt ? { retryAt: options.retryAt } : {}) };
  const body =
    protocol === 'anthropic-messages'
      ? {
          type: 'error',
          error: {
            type:
              status === 401
                ? 'authentication_error'
                : status === 403
                  ? 'permission_error'
                  : status === 429
                    ? 'rate_limit_error'
                    : status === 400
                      ? 'invalid_request_error'
                      : 'api_error',
            message,
          },
          maka,
        }
      : protocol === 'google-generate'
        ? {
            error: {
              code: status,
              status:
                status === 401
                  ? 'UNAUTHENTICATED'
                  : status === 403
                    ? 'PERMISSION_DENIED'
                    : status === 429
                      ? 'RESOURCE_EXHAUSTED'
                      : status === 400
                        ? 'INVALID_ARGUMENT'
                        : 'UNAVAILABLE',
              message,
            },
            maka,
          }
        : { error: { type: 'maka_gateway_error', code, message }, maka };
  return reply
    .status(status)
    .header(GATEWAY_ERROR_HEADER, code)
    .header('x-should-retry', String(options.retry ?? false))
    .header('cache-control', 'no-store')
    .send(body);
}
