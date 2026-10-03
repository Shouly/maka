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

// Tavily, the organization's web service. Its key stays on the server: the
// desktop asks /tools/web-search and /tools/web-fetch and gets the results.

import {
  type PlatformWebSearchResult,
  WEB_FETCH_CONTENT_MAX_LENGTH,
  WEB_FETCH_URL_MAX_LENGTH,
} from '@maka/platform-protocol';

const API = 'https://api.tavily.com';
const TIMEOUT_MS = 10_000;
/** Reading a page can take Tavily longer than a search. */
const EXTRACT_TIMEOUT_MS = 30_000;
const RESPONSE_MAX_BYTES = 1_048_576;
const EXTRACT_RESPONSE_MAX_BYTES = 8 * 1_048_576;
const PAGE_ERROR_MAX = 300;
const TITLE_MAX = 240;
const SNIPPET_MAX = 400;

export interface TavilyQuery {
  readonly query: string;
  readonly limit: number;
  readonly allowedDomains?: readonly string[];
  readonly blockedDomains?: readonly string[];
}

/** Why Tavily gave no results, sorted for the caller to answer in its own words. */
export type TavilyFailure =
  | 'key_refused'
  | 'limit_reached'
  | 'rate_limited'
  | 'query_refused'
  | 'unavailable';

type Refused = {
  readonly ok: false;
  readonly failure: TavilyFailure;
  readonly retryAfterMs?: number;
  /** For `unavailable`: Tavily's status, when it answered at all. */
  readonly status?: number;
};

export type TavilyOutcome =
  | { readonly ok: true; readonly results: readonly PlatformWebSearchResult[] }
  | Refused;

export type TavilyExtractOutcome =
  | { readonly ok: true; readonly url: string; readonly content: string }
  | Refused
  /** Tavily answered, but could not read this page; `error` is its reason. */
  | { readonly ok: false; readonly failure: 'page_failed'; readonly error: string };

/** One search. `signal` ends it early when the asker has gone. */
export async function tavilySearch(
  fetchFn: typeof fetch,
  apiKey: string,
  query: TavilyQuery,
  signal?: AbortSignal,
): Promise<TavilyOutcome> {
  const answer = await post(
    fetchFn,
    apiKey,
    '/search',
    {
      query: query.query,
      max_results: query.limit,
      search_depth: 'basic',
      ...(query.allowedDomains?.length ? { include_domains: query.allowedDomains } : {}),
      ...(query.blockedDomains?.length ? { exclude_domains: query.blockedDomains } : {}),
    },
    { timeoutMs: TIMEOUT_MS, maxBytes: RESPONSE_MAX_BYTES, signal },
  );
  if (!answer.ok) return answer;
  const results = rows(answer.body, query.limit);
  return results ? { ok: true, results } : { ok: false, failure: 'unavailable' };
}

/** One page, read as markdown. `signal` ends it early when the asker has gone. */
export async function tavilyExtract(
  fetchFn: typeof fetch,
  apiKey: string,
  url: string,
  signal?: AbortSignal,
): Promise<TavilyExtractOutcome> {
  const answer = await post(
    fetchFn,
    apiKey,
    '/extract',
    { urls: url, extract_depth: 'basic', format: 'markdown' },
    { timeoutMs: EXTRACT_TIMEOUT_MS, maxBytes: EXTRACT_RESPONSE_MAX_BYTES, signal },
  );
  if (!answer.ok) return answer;
  const body = answer.body as { results?: unknown; failed_results?: unknown } | null;
  // Not Tavily's answer shape: Tavily's fault, not the page's.
  if (!Array.isArray(body?.results)) return { ok: false, failure: 'unavailable' };
  const read = body.results[0] as { url?: unknown; raw_content?: unknown } | undefined;
  const content = typeof read?.raw_content === 'string' ? read.raw_content.trim() : '';
  if (content) {
    return {
      ok: true,
      url: webUrl(read?.url) ?? url,
      content: wholeCharacters(content.slice(0, WEB_FETCH_CONTENT_MAX_LENGTH)),
    };
  }
  const failed = Array.isArray(body?.failed_results)
    ? (body.failed_results[0] as { error?: unknown } | undefined)
    : undefined;
  return {
    ok: false,
    failure: 'page_failed',
    error: clip(text(failed?.error) || 'The page had no readable content', PAGE_ERROR_MAX),
  };
}

/** One call to Tavily: its JSON answer, or why there is none. */
async function post(
  fetchFn: typeof fetch,
  apiKey: string,
  path: string,
  payload: Record<string, unknown>,
  limits: { readonly timeoutMs: number; readonly maxBytes: number; readonly signal?: AbortSignal },
): Promise<{ readonly ok: true; readonly body: unknown } | Refused> {
  let response: Response;
  try {
    response = await fetchFn(`${API}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: limits.signal
        ? AbortSignal.any([limits.signal, AbortSignal.timeout(limits.timeoutMs)])
        : AbortSignal.timeout(limits.timeoutMs),
      redirect: 'error',
    });
  } catch {
    return { ok: false, failure: 'unavailable' };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403)
      return { ok: false, failure: 'key_refused' };
    // 432: the plan's limit; 433: the pay-as-you-go limit.
    if (response.status === 432 || response.status === 433)
      return { ok: false, failure: 'limit_reached' };
    // A query, domain or address Tavily cannot use: trying again changes nothing.
    if (response.status === 400 || response.status === 422)
      return { ok: false, failure: 'query_refused' };
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      return {
        ok: false,
        failure: 'rate_limited',
        ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterMs: seconds * 1000 } : {}),
      };
    }
    return { ok: false, failure: 'unavailable', status: response.status };
  }
  try {
    return { ok: true, body: await boundedJson(response, limits.maxBytes) };
  } catch {
    return { ok: false, failure: 'unavailable' };
  }
}

/**
 * Whether Tavily refuses this key, asked of its usage endpoint, which runs no
 * search. Not reaching Tavily is not a refusal: the key is kept, and a
 * search says so if it is wrong after all.
 */
export async function tavilyKeyRefused(fetchFn: typeof fetch, apiKey: string): Promise<boolean> {
  try {
    const response = await fetchFn(`${API}/usage`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    await response.body?.cancel().catch(() => {});
    return response.status === 401 || response.status === 403;
  } catch {
    return false;
  }
}

function rows(raw: unknown, limit: number): PlatformWebSearchResult[] | undefined {
  const candidates = (raw as { results?: unknown } | null)?.results;
  if (!Array.isArray(candidates)) return undefined;
  const results: PlatformWebSearchResult[] = [];
  for (const candidate of candidates) {
    if (results.length >= limit) break;
    const row = candidate as { title?: unknown; url?: unknown; content?: unknown } | null;
    const url = webUrl(row?.url);
    if (!url) continue;
    results.push({
      title: clip(text(row?.title) || url, TITLE_MAX),
      url,
      snippet: clip(text(row?.content), SNIPPET_MAX),
    });
  }
  return results;
}

/** An http(s) address short enough to show; anything else is dropped. */
function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > WEB_FETCH_URL_MAX_LENGTH) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const text = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

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
      throw new Error('Tavily answered with too much');
    }
    chunks.push(next.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** A cut that split a surrogate pair keeps only whole characters. */
function wholeCharacters(value: string): string {
  return /[\uD800-\uDBFF]$/.test(value) ? value.slice(0, -1) : value;
}
