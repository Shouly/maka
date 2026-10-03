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

// POST /tools/web-search and /tools/web-fetch: the desktop's WebSearch and
// WebFetch tools, run with the organization's key, which stays here. Anyone
// signed in may use them; queries and addresses are neither logged nor kept.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  type PlatformWebFetchResponse,
  type PlatformWebSearchResponse,
  WEB_FETCH_PATH,
  WEB_FETCH_URL_MAX_LENGTH,
  WEB_SEARCH_DOMAINS_MAX,
  WEB_SEARCH_LIMIT_MAX,
  WEB_SEARCH_PATH,
  WEB_SEARCH_QUERY_MAX_LENGTH,
} from '@maka/platform-protocol';
import type { ServerContext } from '../context.js';
import { authenticate, sendPlatformError } from '../http/common.js';
import type { AccessTokens } from '../identity/access-tokens.js';
import { type WebSearchDeps, webSearchKey } from './settings.js';
import { type TavilyFailure, tavilyExtract, tavilySearch } from './tavily.js';

const DEFAULT_LIMIT = 5;

const domains = z
  .array(
    z
      .string()
      .trim()
      .max(253)
      .regex(/^[^\s/]+$/),
  )
  .max(WEB_SEARCH_DOMAINS_MAX)
  .optional();
const searchSchema = z.strictObject({
  query: z.string().trim().min(1).max(WEB_SEARCH_QUERY_MAX_LENGTH),
  limit: z.number().int().min(1).max(WEB_SEARCH_LIMIT_MAX).optional(),
  allowedDomains: domains,
  blockedDomains: domains,
});
const fetchSchema = z.strictObject({
  url: z
    .string()
    .max(WEB_FETCH_URL_MAX_LENGTH)
    .refine((value) => {
      try {
        const url = new URL(value);
        // A user name or password in the address would go to the web service.
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
      } catch {
        return false;
      }
    })
    .transform((value) => new URL(value).href),
});

export function registerWebSearch(
  app: FastifyInstance,
  ctx: ServerContext,
  deps: WebSearchDeps & { readonly accessTokens: AccessTokens },
): void {
  const inFlight = new Set<AbortController>();
  app.addHook('preClose', async () => {
    for (const controller of inFlight) controller.abort();
  });

  /** Signed in, a key to use and the asker still there; then `run`. */
  const withKey = async (
    request: FastifyRequest,
    reply: FastifyReply,
    run: (key: string, signal: AbortSignal) => Promise<FastifyReply>,
  ) => {
    if (!(await authenticate(ctx, deps.accessTokens, request, reply))) return reply;
    const key = await webSearchKey(ctx);
    if ('unavailable' in key)
      return sendPlatformError(
        reply,
        503,
        'web_access_unavailable',
        key.unavailable === 'disabled'
          ? 'An administrator has turned web access off'
          : 'An administrator has not set up web access yet',
      );
    // Gone before Tavily was asked: nothing to spend the organization's plan on.
    if (reply.raw.destroyed || request.raw.socket?.destroyed) return reply;
    const asker = new AbortController();
    const onClose = () => {
      if (!reply.raw.writableFinished) asker.abort();
    };
    reply.raw.on('close', onClose);
    inFlight.add(asker);
    try {
      return await run(key.key, asker.signal);
    } finally {
      inFlight.delete(asker);
      reply.raw.off('close', onClose);
    }
  };

  /** Tavily's refusals, in the server's words. */
  const refuse = (
    request: FastifyRequest,
    reply: FastifyReply,
    outcome: {
      readonly failure: TavilyFailure;
      readonly retryAfterMs?: number;
      readonly status?: number;
    },
    refusedInput: string,
  ) => {
    switch (outcome.failure) {
      case 'key_refused':
        request.log.warn('Tavily refused the organization web service key');
        return sendPlatformError(
          reply,
          503,
          'web_access_unavailable',
          "The web service refused the organization's key; ask an administrator",
        );
      case 'limit_reached':
        request.log.warn("The organization's Tavily plan limit is reached");
        return sendPlatformError(
          reply,
          503,
          'web_access_unavailable',
          "The organization's web service plan has run out; ask an administrator",
        );
      case 'rate_limited':
        return sendPlatformError(
          reply,
          429,
          'rate_limited',
          'Too many web requests at once; try again shortly',
          outcome.retryAfterMs ? { retryAt: ctx.now().getTime() + outcome.retryAfterMs } : {},
        );
      case 'query_refused':
        return sendPlatformError(reply, 400, 'invalid_request', refusedInput);
      case 'unavailable':
        request.log.warn({ status: outcome.status }, 'Tavily did not answer');
        return sendPlatformError(
          reply,
          502,
          'upstream_unavailable',
          'The web service did not answer; try again',
        );
    }
  };

  app.post(WEB_SEARCH_PATH, async (request, reply) => {
    const parsed = searchSchema.safeParse(request.body);
    return withKey(request, reply, async (key, signal) => {
      if (!parsed.success)
        return sendPlatformError(reply, 400, 'invalid_request', searchRefusalOf(parsed.error));
      const { query, limit, allowedDomains, blockedDomains } = parsed.data;
      const outcome = await tavilySearch(
        deps.fetch,
        key,
        {
          query,
          limit: limit ?? DEFAULT_LIMIT,
          ...(allowedDomains ? { allowedDomains } : {}),
          ...(blockedDomains ? { blockedDomains } : {}),
        },
        signal,
      );
      if (!outcome.ok)
        return refuse(
          request,
          reply,
          outcome,
          'The web service could not run this search; check the query and the domains',
        );
      const body: PlatformWebSearchResponse = { results: outcome.results };
      return reply.header('cache-control', 'no-store').send(body);
    });
  });

  app.post(WEB_FETCH_PATH, async (request, reply) => {
    const parsed = fetchSchema.safeParse(request.body);
    return withKey(request, reply, async (key, signal) => {
      if (!parsed.success)
        return sendPlatformError(
          reply,
          400,
          'invalid_request',
          `Send one http or https URL of at most ${WEB_FETCH_URL_MAX_LENGTH} characters`,
        );
      const outcome = await tavilyExtract(deps.fetch, key, parsed.data.url, signal);
      if (outcome.ok) {
        const body: PlatformWebFetchResponse = { url: outcome.url, content: outcome.content };
        return reply.header('cache-control', 'no-store').send(body);
      }
      if (outcome.failure === 'page_failed')
        return sendPlatformError(reply, 422, 'web_fetch_failed', outcome.error);
      return refuse(request, reply, outcome, 'The web service could not read this address');
    });
  });
}

/** What was wrong with a search, naming the field. */
function searchRefusalOf(error: z.ZodError): string {
  const field = error.issues[0]?.path[0];
  switch (field) {
    case 'query':
      return `Send a query of 1 to ${WEB_SEARCH_QUERY_MAX_LENGTH} characters`;
    case 'limit':
      return `Ask for 1 to ${WEB_SEARCH_LIMIT_MAX} results`;
    case 'allowedDomains':
    case 'blockedDomains':
      return `Name at most ${WEB_SEARCH_DOMAINS_MAX} domains, each a host name`;
    default:
      return 'Send a query, and optionally a limit and domain lists, and nothing else';
  }
}
