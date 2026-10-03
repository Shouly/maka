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

// The web through the organisation server. The server holds the web
// service's key and runs searches and page reads; this signs each request
// with the person's account and reads the answer back in the tools' terms.

import type {
  WebSearchErrorReason,
  WebSearchResponse,
  WebSearchResultRow,
} from '@maka/core/web-search';
import {
  CLIENT_VERSION_HEADER,
  type PlatformErrorBody,
  type PlatformWebFetchResponse,
  type PlatformWebSearchRequest,
  type PlatformWebSearchResponse,
  WEB_FETCH_PATH,
  WEB_SEARCH_PATH,
} from '@maka/platform-protocol';
import {
  type OrganizationAccessToken,
  OrganizationAccountUnavailableError,
  type OrganizationAccountUnavailableReason,
} from './organization-model-fetch.js';

/** What a status means when no organization server wrote the body. */
const PROXY_STATUS_CODES: Readonly<Record<number, PlatformErrorBody['error']['code']>> = {
  401: 'unauthenticated',
  429: 'rate_limited',
  503: 'web_access_unavailable',
};

/** The server's own search runs to ten seconds, a page read to thirty; this leaves them room. */
const SEARCH = { timeoutMs: 30_000, maxBytes: 512 * 1024 } as const;
const FETCH = { timeoutMs: 60_000, maxBytes: 2 * 1024 * 1024 } as const;

/** The account a request is signed with, and the server it belongs to. */
export interface OrganizationAccount extends OrganizationAccessToken {
  readonly serverUrl: string;
}

/** The signed-in account; `forceRefresh` after the server refused its token. */
export type OrganizationAccountSource = (options: {
  readonly forceRefresh: boolean;
  readonly signal: AbortSignal;
}) => Promise<OrganizationAccount>;

/** Why nothing came back: WebSearch's reasons, and a page the service could not read. */
interface Refusal {
  readonly ok: false;
  readonly reason: WebSearchErrorReason | 'page_failed';
  readonly message: string;
}

export async function searchThroughOrganization(input: {
  readonly account: OrganizationAccountSource;
  readonly fetchFn: typeof fetch;
  readonly request: PlatformWebSearchRequest;
  /** The caller stopping: the search stops and this throws its reason. */
  readonly signal?: AbortSignal;
}): Promise<WebSearchResponse> {
  const answer = await call({ ...input, ...SEARCH, path: WEB_SEARCH_PATH, body: input.request });
  if (!answer.ok)
    return {
      ok: false,
      reason: answer.reason === 'page_failed' ? 'network_error' : answer.reason,
      message: answer.message,
    };
  const results = (answer.body as Partial<PlatformWebSearchResponse> | undefined)?.results;
  return Array.isArray(results) ? { ok: true, results: results.flatMap(row) } : unreadable();
}

export async function fetchThroughOrganization(input: {
  readonly account: OrganizationAccountSource;
  readonly fetchFn: typeof fetch;
  readonly url: string;
  /** The caller stopping: the read stops and this throws its reason. */
  readonly signal?: AbortSignal;
}): Promise<{ readonly ok: true; readonly url: string; readonly content: string } | Refusal> {
  const answer = await call({ ...input, ...FETCH, path: WEB_FETCH_PATH, body: { url: input.url } });
  if (!answer.ok) return answer;
  const page = answer.body as Partial<PlatformWebFetchResponse> | undefined;
  return typeof page?.url === 'string' && typeof page.content === 'string' && page.content
    ? { ok: true, url: page.url, content: page.content }
    : unreadable();
}

const UNREAD = Symbol('unread');

async function call(input: {
  readonly account: OrganizationAccountSource;
  readonly fetchFn: typeof fetch;
  readonly path: string;
  readonly body: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}): Promise<{ readonly ok: true; readonly body: unknown } | Refusal> {
  const signal = input.signal
    ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)])
    : AbortSignal.timeout(input.timeoutMs);
  const send = (account: OrganizationAccount) =>
    input.fetchFn(`${account.serverUrl.replace(/\/+$/, '')}${input.path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${account.accessToken}`,
        [CLIENT_VERSION_HEADER]: account.clientVersion,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input.body),
      // The account's token goes to its server and nowhere else.
      redirect: 'manual',
      signal,
    });
  try {
    const account = await input.account({ forceRefresh: false, signal });
    let response = await send(account);
    // The token lives minutes and can lapse between two calls: one more try.
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {});
      const fresh = await input.account({ forceRefresh: true, signal });
      if (fresh.accessToken === account.accessToken) return notSignedIn('sign_in_expired');
      response = await send(fresh);
    }
    // Not JSON reads as no body; too long or cut off on the way, as unread.
    const body = await boundedJson(response, input.maxBytes).catch((error: unknown) =>
      error instanceof SyntaxError ? undefined : UNREAD,
    );
    // Stopped or out of time while reading: the catch below says which.
    signal.throwIfAborted();
    if (!response.ok) return refusal(response.status, body === UNREAD ? undefined : body);
    if (body === UNREAD)
      return {
        ok: false,
        reason: 'network_error',
        message: "The organization server's answer could not be read.",
      };
    return { ok: true, body };
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason;
    if (error instanceof OrganizationAccountUnavailableError) return notSignedIn(error.reason);
    if (signal.aborted)
      return {
        ok: false,
        reason: 'timeout',
        message: `The organization server did not answer within ${input.timeoutMs / 1000} seconds.`,
      };
    return {
      ok: false,
      reason: 'network_error',
      message: 'The organization server could not be reached.',
    };
  }
}

function refusal(status: number, body: unknown): Refusal {
  const failure = (body as Partial<PlatformErrorBody> | undefined)?.error;
  const message = typeof failure?.message === 'string' ? failure.message : undefined;
  if (failure?.code === undefined && status === 504)
    return {
      ok: false,
      reason: 'timeout',
      message: 'The organization server did not answer in time.',
    };
  // A proxy in front of the server refuses without the server's error body.
  switch (failure?.code ?? PROXY_STATUS_CODES[status]) {
    case 'unauthenticated':
      return notSignedIn('sign_in_expired');
    case 'web_access_unavailable':
    case 'upgrade_required':
      return { ok: false, reason: 'unavailable', message: message ?? 'Web access is unavailable.' };
    case 'not_found':
      return {
        ok: false,
        reason: 'unavailable',
        message: 'The organization server does not offer web search and fetch.',
      };
    case 'rate_limited':
      return {
        ok: false,
        reason: 'rate_limited',
        message: message ?? 'Too many web requests at once.',
      };
    case 'invalid_request':
      return { ok: false, reason: 'invalid_query', message: message ?? 'The request was refused.' };
    case 'web_fetch_failed':
      return {
        ok: false,
        reason: 'page_failed',
        message: message ?? 'The page could not be read.',
      };
    default:
      return {
        ok: false,
        reason: 'network_error',
        message: message ?? `The organization server answered HTTP ${status}.`,
      };
  }
}

function notSignedIn(reason: OrganizationAccountUnavailableReason): Refusal {
  switch (reason) {
    case 'upgrade_required':
      return { ok: false, reason: 'unavailable', message: 'Update Maka to use the web.' };
    case 'server_unreachable':
      return {
        ok: false,
        reason: 'network_error',
        message: 'The organization server could not be reached.',
      };
    case 'not_offered':
      return {
        ok: false,
        reason: 'not_signed_in',
        message: 'The web needs the Maka app, signed in to the organization account.',
      };
    default:
      return {
        ok: false,
        reason: 'not_signed_in',
        message: 'Sign in to the organization account in Maka to use the web.',
      };
  }
}

function unreadable(): {
  readonly ok: false;
  readonly reason: 'network_error';
  readonly message: string;
} {
  return {
    ok: false,
    reason: 'network_error',
    message: 'The organization server answered in a shape Maka cannot read.',
  };
}

/** A result the transcript can show: an http(s) address, plain text around it. */
function row(value: unknown): WebSearchResultRow[] {
  const item = value as { title?: unknown; url?: unknown; snippet?: unknown } | null;
  if (typeof item?.url !== 'string') return [];
  let url: URL;
  try {
    url = new URL(item.url);
  } catch {
    return [];
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
  return [
    {
      title: typeof item.title === 'string' && item.title ? item.title : url.href,
      url: url.href,
      snippet: typeof item.snippet === 'string' ? item.snippet : '',
      source: url.hostname,
    },
  ];
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) return undefined;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('The organization server answered with too much');
    }
    chunks.push(next.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
