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

// WebSearch, offered on every turn: the organisation server searches with
// the organisation's key (web-access.ts). Without a signed-in account the
// tool says so; it never searches anywhere else.

import type { WebSearchResponse } from '@maka/core/web-search';
import { searchThroughOrganization } from '@maka/runtime/organization-web';
import type { MakaTool } from '@maka/runtime/tool-runtime';
import { buildWebSearchTool } from '@maka/runtime/web-search-tool';
import { type HostWebAccessInput, openHostWebAccess } from './web-access.js';

export interface HostWebSearchService {
  search(input: {
    readonly query: string;
    readonly limit: number;
    readonly allowedDomains?: readonly string[];
    readonly blockedDomains?: readonly string[];
    readonly abortSignal?: AbortSignal;
  }): Promise<WebSearchResponse>;
}

export function createHostWebSearchService(input: HostWebAccessInput): HostWebSearchService {
  return {
    search: async ({ query, limit, allowedDomains, blockedDomains, abortSignal }) => {
      const access = await openHostWebAccess(input);
      if (!access.ok) return access;
      try {
        return await searchThroughOrganization({
          account: access.account,
          fetchFn: access.fetchFn,
          request: {
            query,
            limit,
            ...(allowedDomains ? { allowedDomains } : {}),
            ...(blockedDomains ? { blockedDomains } : {}),
          },
          ...(abortSignal ? { signal: abortSignal } : {}),
        });
      } finally {
        await access.close();
      }
    },
  };
}

export function createHostWebSearchToolFromService(service: HostWebSearchService): MakaTool {
  return buildWebSearchTool({
    search: ({ query, limit, allowedDomains, blockedDomains, abortSignal }) =>
      service.search({
        query,
        limit,
        ...(allowedDomains ? { allowedDomains } : {}),
        ...(blockedDomains ? { blockedDomains } : {}),
        ...(abortSignal ? { abortSignal } : {}),
      }),
  });
}
