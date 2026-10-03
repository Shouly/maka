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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultRuntimePolicy } from '@maka/core/runtime-policy';
import { WEB_SEARCH_DEFAULT_LIMIT } from '@maka/core/web-search';
import type { ProxiedFetchProxy } from '@maka/runtime/network/scoped-fetch-transport';
import { OrganizationAccountUnavailableError } from '@maka/runtime/organization-model-fetch';
import type { MakaToolContext } from '@maka/runtime/tool-runtime';
import type {
  ResolveHostOutboundExecutionResult,
  RuntimePolicyOperationCoordinator,
} from '@maka/storage/runtime-policy-stores';
import type { HostOrganizationSession } from '../server/organization-session.js';
import {
  createHostWebSearchService,
  createHostWebSearchToolFromService,
} from '../server/web-search-tool.js';

const SERVER = 'https://org.example/';

/** A signed-in account whose token changes on every forced refresh. */
function account(
  options: { readonly refused?: OrganizationAccountUnavailableError } = {},
): HostOrganizationSession & { readonly refreshes: number } {
  let refreshes = 0;
  return {
    get refreshes() {
      return refreshes;
    },
    accessToken: async () => {
      throw new Error('web search asks for the account, not a token for one server');
    },
    account: async (request = {}) => {
      if (options.refused) throw options.refused;
      if (request.forceRefresh) refreshes += 1;
      return { serverUrl: SERVER, accessToken: `token-${refreshes}`, clientVersion: '1.2.3' };
    },
  };
}

function tool(input: {
  readonly session: () => HostOrganizationSession;
  readonly proxy?: ResolveHostOutboundExecutionResult;
  readonly fetch?: typeof fetch;
  readonly onTransport?: (proxy: ProxiedFetchProxy | null) => void;
  readonly onClose?: () => void;
}) {
  const policy: Pick<RuntimePolicyOperationCoordinator, 'resolveHostOutboundExecution'> = {
    resolveHostOutboundExecution: async () =>
      input.proxy ?? {
        kind: 'ready',
        networkProxy: createDefaultRuntimePolicy().networkProxy,
        secretMaterial: {},
      },
  };
  return createHostWebSearchToolFromService(
    createHostWebSearchService({
      organizationSession: input.session,
      policy,
      createFetchTransport: (proxy) => {
        input.onTransport?.(proxy);
        return {
          fetch:
            input.fetch ??
            (async () => {
              throw new Error('no network in this test');
            }),
          close: async () => input.onClose?.(),
        };
      },
    }),
  );
}

test("WebSearch asks the organization server with the account's token, through the network proxy", async () => {
  const networkProxy = {
    ...createDefaultRuntimePolicy().networkProxy,
    enabled: true,
    protocol: 'https' as const,
    host: 'proxy.example',
    port: 8443,
    authEnabled: true,
    username: 'proxy-user',
    bypassList: ['one.example'],
    autoBypassDomains: ['two.example'],
  };
  let proxy: ProxiedFetchProxy | null | undefined;
  let closed = 0;
  const sent: { url: string; init: RequestInit | undefined }[] = [];
  const search = tool({
    session: () => account(),
    proxy: {
      kind: 'ready',
      networkProxy,
      secretMaterial: {
        networkProxy: {
          locator: { scope: 'network_proxy', kind: 'password' },
          credentialId: 'proxy-credential',
          revision: 4,
          secret: 'proxy-secret',
        },
      },
    },
    onTransport: (candidate) => {
      proxy = candidate;
    },
    onClose: () => {
      closed += 1;
    },
    fetch: async (url, init) => {
      sent.push({ url: String(url), init });
      return Response.json({
        results: [
          { title: 'Maka', url: 'https://maka.example/current', snippet: 'Current information.' },
          { title: '', url: 'https://other.example/a', snippet: '' },
          { title: 'Not a page', url: 'ftp://files.example/a', snippet: 'dropped' },
        ],
      });
    },
  });

  const result = await search.impl(
    {
      query: ' latest Maka ',
      allowed_domains: ['maka.example'],
      blocked_domains: ['spam.example'],
    },
    context(),
  );
  assert.deepEqual(proxy, {
    enabled: true,
    type: 'https',
    host: 'proxy.example',
    port: 8443,
    username: 'proxy-user',
    password: 'proxy-secret',
    bypassList: ['one.example', 'two.example'],
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.url, 'https://org.example/tools/web-search');
  const headers = new Headers(sent[0]?.init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer token-0');
  assert.equal(headers.get('x-maka-client-version'), '1.2.3');
  assert.equal(sent[0]?.init?.redirect, 'manual');
  assert.deepEqual(JSON.parse(String(sent[0]?.init?.body)), {
    query: 'latest Maka',
    limit: WEB_SEARCH_DEFAULT_LIMIT,
    allowedDomains: ['maka.example'],
    blockedDomains: ['spam.example'],
  });
  assert.equal(closed, 1);
  assert.deepEqual(result, {
    kind: 'web_search',
    provider: 'tavily',
    query: 'latest Maka',
    rows: [
      {
        title: 'Maka',
        url: 'https://maka.example/current',
        snippet: 'Current information.',
        source: 'maka.example',
      },
      {
        title: 'https://other.example/a',
        url: 'https://other.example/a',
        snippet: '',
        source: 'other.example',
      },
    ],
  });
  assert.doesNotMatch(JSON.stringify(result), /token-0|proxy-secret/);
});

test('without a signed-in account WebSearch says so', async () => {
  let transports = 0;
  const offline = tool({
    session: () => {
      throw new OrganizationAccountUnavailableError('not_offered');
    },
    onTransport: () => {
      transports += 1;
    },
  });
  assert.deepEqual(await offline.impl({ query: 'maka' }, context()), {
    kind: 'web_search_error',
    ok: false,
    provider: 'tavily',
    query: 'maka',
    reason: 'not_signed_in',
    message: 'The web needs the Maka app, signed in to the organization account.',
  });
  assert.equal(transports, 0, 'nothing is sent without an account');

  const signedOut = tool({
    session: () => account({ refused: new OrganizationAccountUnavailableError('signed_out') }),
  });
  const result = (await signedOut.impl({ query: 'maka' }, context())) as {
    reason: string;
    message: string;
  };
  assert.deepEqual(
    [result.reason, result.message],
    ['not_signed_in', 'Sign in to the organization account in Maka to use the web.'],
  );
});

test('without the network proxy credential WebSearch says so and sends nothing', async () => {
  let transports = 0;
  const search = tool({
    session: () => account(),
    proxy: {
      kind: 'credential_not_configured',
      status: {
        locator: { scope: 'network_proxy', kind: 'password' },
        configured: false,
        credentialId: null,
        revision: null,
        updatedAt: null,
      },
    },
    onTransport: () => {
      transports += 1;
    },
  });
  const result = (await search.impl({ query: 'maka' }, context())) as {
    reason: string;
    message: string;
  };
  assert.deepEqual(
    [result.reason, result.message],
    ['network_error', 'Configure the network proxy credential before using the web.'],
  );
  assert.equal(transports, 0);
});

test('a refused token is refreshed once, and the server refusals become the tool reasons', async () => {
  const session = account();
  const tokens: string[] = [];
  const once = tool({
    session: () => session,
    fetch: async (_url, init) => {
      const token = new Headers(init?.headers).get('authorization') ?? '';
      tokens.push(token);
      return token === 'Bearer token-0'
        ? Response.json(
            { error: { code: 'unauthenticated', message: 'Sign in again' } },
            { status: 401 },
          )
        : Response.json({ results: [] });
    },
  });
  assert.deepEqual(await once.impl({ query: 'maka' }, context()), {
    kind: 'web_search',
    provider: 'tavily',
    query: 'maka',
    rows: [],
  });
  assert.deepEqual(tokens, ['Bearer token-0', 'Bearer token-1']);

  for (const [status, code, reason] of [
    [503, 'web_access_unavailable', 'unavailable'],
    [429, 'rate_limited', 'rate_limited'],
    [502, 'upstream_unavailable', 'network_error'],
  ] as const) {
    const refused = tool({
      session: () => account(),
      fetch: async () =>
        Response.json({ error: { code, message: `server says ${code}` } }, { status }),
    });
    const result = (await refused.impl({ query: 'maka' }, context())) as {
      reason: string;
      message: string;
    };
    assert.deepEqual([result.reason, result.message], [reason, `server says ${code}`]);
  }
});

test('WebSearch closes its transport when the owning turn is cancelled mid-request', async () => {
  const abort = new AbortController();
  let closed = false;
  let started!: () => void;
  const sent = new Promise<void>((resolve) => {
    started = resolve;
  });
  const search = tool({
    session: () => account(),
    onClose: () => {
      closed = true;
    },
    fetch: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        started();
      }),
  });
  const running = Promise.resolve(
    search.impl({ query: 'cancel me' }, { ...context(), abortSignal: abort.signal }),
  );
  await sent;
  const reason = new DOMException('Turn stopped', 'AbortError');
  abort.abort(reason);
  await assert.rejects(running, (error: unknown) => error === reason);
  assert.equal(closed, true);
});

function context(): MakaToolContext {
  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    cwd: '/tmp',
    toolCallId: 'tool-1',
    abortSignal: new AbortController().signal,
    emitOutput: () => {},
  };
}
