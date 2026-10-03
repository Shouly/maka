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

import { TOOL_NAMES } from '@maka/core/tool-names';
import { WEB_FETCH_URL_MAX_LENGTH } from '@maka/platform-protocol';
import { z } from 'zod';
import type { MakaTool } from './tool-runtime.js';

const WEB_FETCH_TOOL_NAME = TOOL_NAMES.webFetch;
export const WEB_FETCH_MODEL_OUTPUT_MAX_BYTES = 50 * 1024;
const WEB_FETCH_TRUNCATION_MARKER =
  '\n\n…[WebFetch content truncated to fit the 50 KB model-output limit]';
const httpUrlSchema = z
  .string()
  .max(WEB_FETCH_URL_MAX_LENGTH)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'URL must use HTTP or HTTPS.');

export interface WebFetchExecutor {
  /** The page as markdown, and the address it was read at; throws why it could not be read. */
  fetch(input: {
    readonly url: string;
    readonly sessionId: string;
    readonly abortSignal?: AbortSignal;
  }): Promise<{ readonly url: string; readonly content: string }>;
}

/** The model's WebFetch: the page itself, as the web service read it. */
export function buildWebFetchTool(executor: WebFetchExecutor): MakaTool {
  return {
    name: WEB_FETCH_TOOL_NAME,
    activityKind: 'webfetch',
    categoryHint: 'web_read',
    displayName: 'Web fetch',
    description: [
      'Fetch a web page at a given URL and return its full extracted content.',
      '',
      '- Only fetch EXACT URLs provided by the user or returned by WebSearch / WebFetch — never guess or construct a URL.',
      '- Cannot access content behind authentication or login walls.',
      '- If nothing can be extracted from the page, the call fails — fall back to WebSearch or tell the user.',
    ].join('\n'),
    parameters: z
      .object({
        url: httpUrlSchema.describe('The exact URL of the web page to fetch.'),
      })
      .strict(),
    impl: async ({ url }, context) => {
      const page = await executor.fetch({
        url: new URL(httpUrlSchema.parse(url)).toString(),
        sessionId: context.sessionId,
        ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
      });
      return `URL: ${page.url}\n\n${truncateWebFetchOutput(page.content)}`;
    },
  };
}

function truncateWebFetchOutput(content: string): string {
  if (Buffer.byteLength(content, 'utf8') <= WEB_FETCH_MODEL_OUTPUT_MAX_BYTES) return content;
  const markerBytes = Buffer.byteLength(WEB_FETCH_TRUNCATION_MARKER, 'utf8');
  const contentBytes = WEB_FETCH_MODEL_OUTPUT_MAX_BYTES - markerBytes;
  // The extra UTF-16 unit keeps a split surrogate outside the retained bytes.
  const kept = Buffer.from(content.slice(0, contentBytes + 1), 'utf8')
    .subarray(0, contentBytes)
    .toString('utf8')
    .replace(/�+$/, '');
  return kept + WEB_FETCH_TRUNCATION_MARKER;
}
