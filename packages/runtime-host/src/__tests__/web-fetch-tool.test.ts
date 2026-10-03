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
import type { ProxiedFetchProxy } from '@maka/runtime/network/scoped-fetch-transport';
import { OrganizationAccountUnavailableError } from '@maka/runtime/organization-model-fetch';
import type { MakaToolContext } from '@maka/runtime/tool-runtime';
import type {
  ResolveHostOutboundExecutionResult,
  RuntimePolicyOperationCoordinator,
} from '@maka/storage/runtime-policy-stores';
import type { HostOrganizationSession } from '../server/organization-session.js';
import {
  createHostWebFetchService,
  createHostWebFetchToolFromService,
} from '../server/web-fetch-tool.js';

const session: HostOrganizationSession = {
  accessToken: async () => {
    throw new Error('web fetch asks for the account, not a token for one server');
  },
  account: async () => ({
    serverUrl: 'https://org.example',
    accessToken: 'token',
    clientVersion: '1.2.3',
  }),
};

function tool(input: {
  readonly session?: () => HostOrganizationSession;
  readonly outbound?: ResolveHostOutboundExecutionResult;
  readonly fetch?: typeof fetch;
  readonly onTransport?: (proxy: ProxiedFetchProxy | null) => void;
  readonly onClose?: () => void;
}) {
  const policy: Pick<RuntimePolicyOperationCoordinator, 'resolveHostOutboundExecution'> = {
    resolveHostOutboundExecution: async () =>
      input.outbound ?? {
        kind: 'ready',
        networkProxy: createDefaultRuntimePolicy().networkProxy,
        secretMaterial: {},
      },
  };
  return createHostWebFetchToolFromService(
    createHostWebFetchService({
      organizationSession: input.session ?? (() => session),
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

test('WebFetch reads the page through the organization server, under the address it was read at', async () => {
  const networkProxy = {
    ...createDefaultRuntimePolicy().networkProxy,
    enabled: true,
    protocol: 'http' as const,
    host: 'proxy.example',
    port: 8080,
    authEnabled: true,
    username: 'proxy-user',
    bypassList: ['direct.example'],
    autoBypassDomains: [],
  };
  let proxy: ProxiedFetchProxy | null | undefined;
  let closed = 0;
  const sent: { url: string; body: unknown; authorization: string | null }[] = [];
  const fetchTool = tool({
    outbound: {
      kind: 'ready',
      networkProxy,
      secretMaterial: {
        networkProxy: {
          locator: { scope: 'network_proxy', kind: 'password' },
          credentialId: 'proxy-credential',
          revision: 2,
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
      sent.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        authorization: new Headers(init?.headers).get('authorization'),
      });
      return Response.json({ url: 'https://example.com/moved', content: '# Hello\n\nThe page.' });
    },
  });

  const result = await fetchTool.impl({ url: 'https://example.com/page' }, context());
  assert.equal(result, 'URL: https://example.com/moved\n\n# Hello\n\nThe page.');
  assert.deepEqual(sent, [
    {
      url: 'https://org.example/tools/web-fetch',
      body: { url: 'https://example.com/page' },
      authorization: 'Bearer token',
    },
  ]);
  assert.deepEqual(proxy, {
    enabled: true,
    type: 'http',
    host: 'proxy.example',
    port: 8080,
    username: 'proxy-user',
    password: 'proxy-secret',
    bypassList: ['direct.example'],
  });
  assert.equal(closed, 1);
});

test('WebFetch says why a page could not be read, and never fetches without an account', async () => {
  let transports = 0;
  const offline = tool({
    session: () => {
      throw new OrganizationAccountUnavailableError('not_offered');
    },
    onTransport: () => {
      transports += 1;
    },
  });
  await assert.rejects(
    Promise.resolve(offline.impl({ url: 'https://example.com' }, context())),
    /The web needs the Maka app, signed in to the organization account\./,
  );
  assert.equal(transports, 0);

  const gone = tool({
    fetch: async () =>
      Response.json(
        { error: { code: 'web_fetch_failed', message: 'HTTP 404 Not Found' } },
        { status: 422 },
      ),
  });
  await assert.rejects(
    Promise.resolve(gone.impl({ url: 'https://example.com/gone' }, context())),
    /The page could not be read: HTTP 404 Not Found/,
  );

  const noProxyCredential = tool({
    outbound: {
      kind: 'credential_not_configured',
      status: {
        locator: { scope: 'network_proxy', kind: 'password' },
        configured: false,
        credentialId: null,
        revision: null,
        updatedAt: null,
      },
    },
  });
  await assert.rejects(
    Promise.resolve(noProxyCredential.impl({ url: 'https://example.com' }, context())),
    /Configure the network proxy credential/,
  );
});

test('WebFetch closes its transport when the owning turn is cancelled mid-request', async () => {
  const abort = new AbortController();
  let closed = false;
  let started!: () => void;
  const sent = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetchTool = tool({
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
    fetchTool.impl(
      { url: 'https://example.com' },
      {
        ...context(),
        abortSignal: abort.signal,
      },
    ),
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
