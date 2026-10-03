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

/**
 * WebSearch's contracts, shared by the tool and the transcript. The search
 * itself runs on the organization server, with the organization's key.
 */

/** One result as the transcript shows it: plain text, never HTML. */
export interface WebSearchResultRow {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  /** Hostname extracted from `url` so the renderer doesn't reparse. */
  readonly source: string;
}

export type WebSearchErrorReason =
  | 'invalid_query'
  /** No organization account to search with: signed out, expired, or no desktop app. */
  | 'not_signed_in'
  /** The organization has no web search: not set up, switched off, or its key refused. */
  | 'unavailable'
  | 'rate_limited'
  | 'network_error'
  | 'timeout';

/** Discriminated response: success = array, error = typed object. */
export type WebSearchResponse =
  | { readonly ok: true; readonly results: ReadonlyArray<WebSearchResultRow> }
  | { readonly ok: false; readonly reason: WebSearchErrorReason; readonly message: string };

export const WEB_SEARCH_QUERY_MAX_CHARS = 200;
export const WEB_SEARCH_DEFAULT_LIMIT = 5;
export const WEB_SEARCH_MAX_LIMIT = 10;

/** Returns `null` when the raw value isn't a usable query. */
export function normalizeWebSearchQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > WEB_SEARCH_QUERY_MAX_CHARS) {
    return trimmed.slice(0, WEB_SEARCH_QUERY_MAX_CHARS);
  }
  return trimmed;
}

/** Clamps `raw` to `[1, WEB_SEARCH_MAX_LIMIT]`, default `WEB_SEARCH_DEFAULT_LIMIT`. */
export function normalizeWebSearchLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return WEB_SEARCH_DEFAULT_LIMIT;
  const rounded = Math.trunc(raw);
  if (rounded < 1) return 1;
  if (rounded > WEB_SEARCH_MAX_LIMIT) return WEB_SEARCH_MAX_LIMIT;
  return rounded;
}
