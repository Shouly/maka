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

// WebFetch: the organisation server reads the page with the organisation's
// key (web-access.ts) and the page comes back as markdown. Nothing is
// fetched from this machine.

import { fetchThroughOrganization } from '@maka/runtime/organization-web';
import type { MakaTool } from '@maka/runtime/tool-runtime';
import { buildWebFetchTool } from '@maka/runtime/web-fetch-tool';
import { type HostWebAccessInput, openHostWebAccess } from './web-access.js';

export interface HostWebFetchService {
  /** The page as markdown and the address it was read at; throws why it could not be read. */
  fetch(input: {
    readonly url: string;
    readonly abortSignal?: AbortSignal;
  }): Promise<{ readonly url: string; readonly content: string }>;
}

export function createHostWebFetchService(input: HostWebAccessInput): HostWebFetchService {
  return {
    fetch: async ({ url, abortSignal }) => {
      const access = await openHostWebAccess(input);
      if (!access.ok) throw new Error(access.message);
      try {
        const page = await fetchThroughOrganization({
          account: access.account,
          fetchFn: access.fetchFn,
          url,
          ...(abortSignal ? { signal: abortSignal } : {}),
        });
        if (!page.ok)
          throw new Error(
            page.reason === 'page_failed'
              ? `The page could not be read: ${page.message}`
              : page.message,
          );
        return { url: page.url, content: page.content };
      } finally {
        await access.close();
      }
    },
  };
}

export function createHostWebFetchToolFromService(service: HostWebFetchService): MakaTool {
  return buildWebFetchTool({
    fetch: ({ url, abortSignal }) =>
      service.fetch({ url, ...(abortSignal ? { abortSignal } : {}) }),
  });
}
