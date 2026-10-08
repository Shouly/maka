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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { McpCallResult, McpToolBinding } from '@maka/core/mcp';
import type { McpClientManager } from '@maka/mcp';
import { mcpProxyToolName, mcpResultFileText } from '@maka/runtime/mcp-tools';
import type { MakaTool } from '@maka/runtime/tool-runtime';
import { connectRuntimeHost, type RuntimeHostConnection } from '@maka/runtime-host/client';
import {
  CLIENT_CAPABILITY_MAX_RESULT_BYTES,
  decodeClientCapabilityResult,
  RUNTIME_HOST_PROTOCOL_VERSION,
} from '@maka/runtime-host/protocol';
import {
  createUnavailableDomainOperationHandlers,
  defineInteractiveRuntimeHostComposition,
  RuntimeHostKernel,
} from '@maka/runtime-host/server';
import {
  HostClientCapabilityCoordinator,
  RuntimePolicyActivationGate,
  clientCapabilityCoordinatorTestAdmission,
} from '@maka/runtime-host/test-only/client-capability-host';
import { resolveStorageRoot, tryAcquireInteractiveRootOwner } from '@maka/storage/root-authority';
import { createMcpCapabilityProvider } from '../mcp-capability-provider.js';

// An MCP tool connected in the CLI runs here; the Host bounds its result and
// saves what is too long to show. These calls go over the real channel.

const SESSION_ID = 'session-mcp';

test('a CLI MCP result the protocol carries reaches the Host as the server sent it', {
  timeout: 30_000,
}, async () => {
  const small: McpCallResult = {
    content: [
      { type: 'text', text: 'summary' },
      { type: 'resource', uri: 'file:///notes.md', mimeType: 'text/markdown', text: '# notes\n' },
    ],
    structuredContent: { rows: [{ index: 0, label: 'value 0' }] },
  };
  const long: McpCallResult = {
    content: [{ type: 'text', text: 'line\n'.repeat(96_000) }],
    structuredContent: {
      rows: Array.from({ length: 2_000 }, (_, index) => ({ index, label: `value ${index}` })),
    },
  };
  await withCliMcpHost([small, long], async (call) => {
    assert.deepEqual(await call(), small, 'every block and structuredContent, unchanged');

    const { notice, file } = saved(await call());
    assert.match(notice, /^Output too long to show \([\d,]+ characters\)\. The full output/u);
    assert.equal(await file, mcpResultFileText(long).text);
  });
});

const UNCARRIED: readonly { what: string; result: McpCallResult; last: string }[] = [
  {
    what: 'more blocks than the protocol carries',
    result: {
      content: Array.from({ length: 300 }, (_, index) => ({
        type: 'text' as const,
        text: `block ${index} ${'x'.repeat(200)}`,
      })),
    },
    last: `--- text ---\nblock 299 ${'x'.repeat(200)}`,
  },
  {
    what: 'a larger structuredContent than the protocol carries',
    result: {
      content: [{ type: 'text', text: 'summary' }],
      structuredContent: {
        rows: Array.from({ length: 3_000 }, (_, index) => ({ index, label: `value ${index}` })),
      },
    },
    last: '"label": "value 2999"',
  },
];

for (const { what, result, last } of UNCARRIED) {
  test(`a CLI MCP result with ${what} reaches the Host as its saved text, all of it`, {
    timeout: 30_000,
  }, async () => {
    assert.throws(() => decodeClientCapabilityResult(result));
    await withCliMcpHost([result], async (call) => {
      const { file } = saved(await call());
      const text = mcpResultFileText(result).text;
      assert.ok(text.includes(last));
      assert.equal(await file, `--- text ---\n${text}`);
    });
  });
}

test('a CLI MCP result past the protocol byte limit fails the call naming the CLI', {
  timeout: 60_000,
}, async () => {
  const result: McpCallResult = {
    content: [{ type: 'text', text: 'x'.repeat(CLIENT_CAPABILITY_MAX_RESULT_BYTES) }],
  };
  await withCliMcpHost([result], async (call) => {
    await assert.rejects(call(), (error: Error) => {
      assert.match(error.message, /larger than the 24 MiB this CLI client can return/u);
      assert.doesNotMatch(error.message, /Desktop/u);
      return true;
    });
  });
});

/** The notice the Host's tool returned, and the file it names. */
function saved(output: unknown): { notice: string; file: Promise<string> } {
  const content = (output as McpCallResult).content;
  assert.equal(content.length, 1);
  const notice = content[0]?.type === 'text' ? content[0].text : '';
  const path = /saved to (\S+);/u.exec(notice)?.[1] ?? assert.fail(`Not saved: ${notice}`);
  return { notice, file: readFile(path, 'utf8') };
}

/**
 * A Host that saves long tool results, with the CLI's MCP provider for one
 * tool registered on a real connection. `call` runs the Host's tool for it;
 * the tool returns `results` in turn.
 */
async function withCliMcpHost(
  results: readonly McpCallResult[],
  run: (call: () => Promise<unknown>) => Promise<void>,
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), 'maka-cli-mcp-result-'));
  const hostRoot = join(base, 'host');
  let host: RuntimeHostKernel | undefined;
  let connection: RuntimeHostConnection | undefined;
  let release: (() => void) | undefined;
  try {
    const owner = await tryAcquireInteractiveRootOwner(
      await resolveStorageRoot({ path: hostRoot, kind: 'interactive' }),
    );
    assert.ok(owner);
    let coordinator: HostClientCapabilityCoordinator | undefined;
    host = await RuntimeHostKernel.start({
      owner,
      idleGraceMs: 60_000,
      composition: defineInteractiveRuntimeHostComposition(async () => {
        coordinator = new HostClientCapabilityCoordinator({
          ...clientCapabilityCoordinatorTestAdmission(),
          activation: new RuntimePolicyActivationGate(),
          onModelToolsChanged: () => undefined,
          toolResultRoot: join(base, 'tool-results'),
        });
        return {
          handlers: {
            ...createUnavailableDomainOperationHandlers(),
            ...coordinator.handlers,
          },
          clientCapabilities: coordinator,
          releaseConnection: (connectionId) => coordinator?.releaseConnection(connectionId),
          beginDrain: () => coordinator?.beginDrain(),
          recover: async () => undefined,
          close: async () => coordinator?.close(),
        };
      }),
    });

    const connected = await connectRuntimeHost({
      rootPath: hostRoot,
      clientInstanceId: 'cli-mcp-result',
      protocol: { min: RUNTIME_HOST_PROTOCOL_VERSION, max: RUNTIME_HOST_PROTOCOL_VERSION },
    });
    if (connected.kind !== 'connected') throw new Error('Unable to connect to Runtime Host');
    connection = connected.connection;
    let next = 0;
    const manager = {
      toolSnapshot: () => ({
        revision: 1,
        tools: [
          {
            binding: 'binding' as McpToolBinding,
            descriptor: {
              serverId: 'srv',
              name: 'fetch',
              inputSchema: { type: 'object' as const },
            },
          },
        ],
      }),
      callTool: async () => results[next++] ?? assert.fail('Unexpected MCP call'),
    } satisfies Pick<McpClientManager, 'toolSnapshot' | 'callTool'>;
    const provider = createMcpCapabilityProvider(manager);
    assert.ok(provider);
    await connection.replaceClientCapabilities(provider);

    assert.ok(coordinator);
    assert.deepEqual(await coordinator.bindSession(SESSION_ID, connection.connectionId), {
      ok: true,
    });
    const snapshot = coordinator.snapshotForSession(SESSION_ID);
    release = () => snapshot?.release();
    const tool: MakaTool =
      snapshot?.tools.find((candidate) => candidate.name === mcpProxyToolName('srv', 'fetch')) ??
      assert.fail('Expected the CLI MCP tool on the Host');
    let calls = 0;
    await run(async () =>
      tool.impl(
        {},
        {
          sessionId: SESSION_ID,
          turnId: 'turn-mcp',
          cwd: hostRoot,
          toolCallId: `call-${++calls}`,
          abortSignal: new AbortController().signal,
          emitOutput: () => undefined,
        },
      ),
    );
  } finally {
    release?.();
    await connection?.close().catch(() => undefined);
    await host?.close().catch(() => undefined);
    await rm(base, { recursive: true, force: true });
  }
}
