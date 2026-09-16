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
import { z } from 'zod';
import type { MakaTool } from './tool-runtime.js';

const WEB_FETCH_TOOL_NAME = TOOL_NAMES.webFetch;
export const WEB_FETCH_MODEL_OUTPUT_MAX_BYTES = 50 * 1024;
const WEB_FETCH_TRUNCATION_MARKER =
  '\n\n…[WebFetch content truncated to fit the 50 KB model-output limit]';
const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  }, 'URL must use HTTP or HTTPS.');

export interface WebFetchExecutor {
  fetch(input: {
    readonly url: string;
    readonly sessionId: string;
    readonly abortSignal?: AbortSignal;
  }): Promise<string>;
  /**
   * Answers `prompt` against the fetched page with a small, fast model, the
   * way the reference harness does. Optional: a host without an auxiliary
   * model returns the page itself, and the output says so.
   */
  answer?(input: {
    readonly url: string;
    readonly prompt: string;
    readonly content: string;
    readonly sessionId: string;
    readonly abortSignal?: AbortSignal;
  }): Promise<string>;
}

const WEB_FETCH_NO_ANSWER_MODEL_NOTE =
  'No summarising model is available in this session, so the page content follows instead of an answer to the prompt.';

/** Builds the model-facing tool while the host owns policy and transport. */
export function buildWebFetchTool(executor: WebFetchExecutor): MakaTool {
  return {
    name: WEB_FETCH_TOOL_NAME,
    categoryHint: 'web_read',
    displayName: 'Web fetch',
    description: [
      'Fetches a URL, converts the page to markdown, and answers `prompt` against it using a small fast model.',
      '',
      '- Fails on authenticated/private URLs — use an authenticated MCP tool for those instead.',
      '- Fails on localhost and other hostnames without a dot; for a local server, use curl via Bash.',
      '- Only http:// and https:// are accepted. Redirects are followed by the fetcher; the answer names the page it read.',
      "- The answer is another model's reading of the page, not the page itself: when you need exact wording, ask for it verbatim in `prompt`.",
      '- Do not work around a failed or blocked fetch with Bash, scripts, or a cache, archive or mirror of the same page; tell the user the content was not reachable.',
    ].join('\n'),
    parameters: z
      .object({
        url: httpUrlSchema.describe('The URL to fetch content from'),
        prompt: z
          .string()
          .trim()
          .min(1)
          .max(2_000)
          .describe('The prompt to run on the fetched content'),
      })
      .strict(),
    impl: async ({ url, prompt }, context) => {
      const canonicalUrl = new URL(httpUrlSchema.parse(url)).toString();
      const content = await executor.fetch({
        url: canonicalUrl,
        sessionId: context.sessionId,
        ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
      });
      if (executor.answer) {
        const answer = await executor.answer({
          url: canonicalUrl,
          prompt,
          content: truncateWebFetchOutput(content),
          sessionId: context.sessionId,
          ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
        });
        return answer;
      }
      return `${WEB_FETCH_NO_ANSWER_MODEL_NOTE}\n\n${truncateWebFetchOutput(content)}`;
    },
  };
}

/** Removes network reading from the model-visible turn while privacy mode is active. */
export function routeWebFetchTools(
  tools: readonly MakaTool[],
  privacy: { readonly incognitoActive: boolean },
): MakaTool[] {
  return privacy.incognitoActive
    ? tools.filter((tool) => tool.name !== WEB_FETCH_TOOL_NAME)
    : [...tools];
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
