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
import {
  WEB_SEARCH_DEFAULT_LIMIT,
  normalizeWebSearchLimit,
  normalizeWebSearchQuery,
  type WebSearchErrorReason,
  type WebSearchResponse,
} from '@maka/core/web-search';
import type { ToolResultOutput } from './model-protocol.js';
import { toolResultOutput } from './tool-result-output.js';
import type { MakaTool } from './tool-runtime.js';

const WEB_SEARCH_TOOL_NAME = TOOL_NAMES.webSearch;

interface WebSearchExecutor {
  search(input: {
    readonly query: string;
    readonly limit: number;
    readonly allowedDomains?: readonly string[];
    readonly blockedDomains?: readonly string[];
    readonly sessionId: string;
    readonly abortSignal?: AbortSignal;
  }): Promise<WebSearchResponse>;
}

const domainListSchema = z.array(z.string().trim().min(1).max(253)).max(20).optional();

/**
 * What the model reads back. The shape follows the reference harness: a
 * header naming the query, a JSON array of links, and a reminder to cite —
 * plus each link's snippet, which the reference omits and which saves a
 * WebFetch when the snippet already answers the question.
 */
export function webSearchToolResultToModelOutput(output: unknown): ToolResultOutput {
  const record = output as { kind?: unknown } | null;
  if (record && record.kind === 'web_search') {
    const result = output as {
      query: string;
      rows: ReadonlyArray<{ title: string; url: string; snippet: string }>;
    };
    const links = result.rows.map((row) => ({
      title: row.title,
      url: row.url,
      ...(row.snippet ? { snippet: row.snippet } : {}),
    }));
    return toolResultOutput(
      [
        `Web search results for query: "${result.query}"`,
        '',
        `Links: ${JSON.stringify(links)}`,
        '',
        '',
        'REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.',
      ].join('\n'),
      false,
    );
  }
  if (record && record.kind === 'web_search_error') {
    const failure = output as { reason: string; message: string };
    return toolResultOutput(`Web search failed (${failure.reason}): ${failure.message}`, true);
  }
  return toolResultOutput(output, false);
}

/** Builds the canonical model tool while leaving policy and transport ownership to its executor. */
export function buildWebSearchTool(executor: WebSearchExecutor): MakaTool {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    activityKind: 'websearch',
    categoryHint: 'web_read',
    displayName: 'Web search',
    description: [
      'Search the web. Returns result blocks with titles, URLs and snippets.',
      '',
      "- Use it for anything about the present-day world — prices, versions, who holds a role, what is newest — rather than answering from memory; today's date arrives with the turn.",
      '- `allowed_domains` / `blocked_domains` filter results.',
      '- After answering from results, end with a "Sources:" list of the URLs you used as markdown links.',
      '- Read a result page with WebFetch when the snippet is not enough. No results is a normal answer, not an error.',
    ].join('\n'),
    parameters: z
      .object({
        query: z.string().min(2).max(200).describe('The search query to use'),
        allowed_domains: domainListSchema.describe(
          'Only include search results from these domains',
        ),
        blocked_domains: domainListSchema.describe(
          'Never include search results from these domains',
        ),
      })
      .strict(),
    toModelOutput: ({ output }) => webSearchToolResultToModelOutput(output),
    impl: async ({ query, allowed_domains, blocked_domains }, context) => {
      const normalizedQuery = normalizeWebSearchQuery(query);
      if (!normalizedQuery) {
        return webSearchError('invalid_query', 'Web search requires a valid query.');
      }
      const response = await executor.search({
        query: normalizedQuery,
        limit: normalizeWebSearchLimit(WEB_SEARCH_DEFAULT_LIMIT),
        ...(allowed_domains?.length ? { allowedDomains: allowed_domains } : {}),
        ...(blocked_domains?.length ? { blockedDomains: blocked_domains } : {}),
        sessionId: context.sessionId,
        ...(context.abortSignal ? { abortSignal: context.abortSignal } : {}),
      });
      if (!response.ok) return webSearchError(response.reason, response.message, normalizedQuery);
      return {
        kind: 'web_search' as const,
        provider: response.provider ?? response.results[0]?.provider ?? ('tavily' as const),
        query: normalizedQuery,
        rows: response.results.map((row) => ({
          title: row.title,
          url: row.url,
          snippet: row.snippet,
          source: row.source,
        })),
      };
    },
  };
}

function webSearchError(reason: WebSearchErrorReason, message: string, query?: string) {
  return {
    kind: 'web_search_error' as const,
    ok: false as const,
    provider: 'tavily' as const,
    ...(query ? { query } : {}),
    reason,
    message,
  };
}
