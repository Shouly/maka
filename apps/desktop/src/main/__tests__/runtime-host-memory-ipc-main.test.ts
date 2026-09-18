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
import test from 'node:test';
import type { MemoryMutateInput, MemoryQueryInput } from '@maka/runtime-host/protocol';
import {
  readRuntimeHostMemoryFiles,
  registerRuntimeHostMemoryIpc,
  writeRuntimeHostMemoryFiles,
} from '../runtime-host-memory-ipc-main.js';

const FILE = {
  path: '/topics/food.md',
  byteLength: 21,
  updatedAt: 1_700_000_000_000,
  description: 'what they eat',
  aliases: [],
  sources: ['chat'],
};
const DOCUMENT = {
  path: '/topics/food.md',
  content: '- [stated] drinks tea',
  version: 'abcdef012345',
  byteLength: 21,
  updatedAt: 1_700_000_000_000,
};

function fakeClient(log: string[]) {
  return {
    queryMemory: async (input: MemoryQueryInput) => {
      log.push(`query ${input.kind}${input.kind === 'read' ? ` ${input.path}` : ''}`);
      return input.kind === 'list'
        ? {
            kind: 'list' as const,
            enabled: true,
            incognitoActive: false,
            directoryPath: '/tmp/root/memory',
            files: [FILE],
          }
        : { kind: 'document' as const, document: input.path === DOCUMENT.path ? DOCUMENT : null };
    },
    mutateMemory: async (input: MemoryMutateInput) => {
      log.push(`mutate ${input.kind} ${input.path} ${input.ifVersion}`);
      if (input.kind === 'delete') return { kind: 'deleted' as const };
      return input.ifVersion === 'new' && input.path === DOCUMENT.path
        ? { kind: 'rejected' as const, reason: 'exists' as const, current: DOCUMENT }
        : { kind: 'written' as const, version: 'fedcba543210', byteLength: input.content.length };
    },
    updateRuntimePolicy: async (build: (policy: unknown) => unknown) => {
      log.push(`policy ${JSON.stringify(build({}))}`);
      return {};
    },
  };
}

function register(log: string[], allowLocalPaths?: boolean) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerRuntimeHostMemoryIpc({
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel, handler as (...args: unknown[]) => unknown);
      },
    },
    client: fakeClient(log) as never,
    ...(allowLocalPaths === undefined ? {} : { allowLocalPaths }),
  });
  return handlers;
}

test('lists the files with the folder, and hides the folder for a remote Host', async () => {
  const log: string[] = [];
  const local = await register(log).get('memory:list')?.({});
  assert.deepEqual(local, {
    enabled: true,
    incognitoActive: false,
    directoryPath: '/tmp/root/memory',
    files: [FILE],
  });
  const remote = (await register(log, false).get('memory:list')?.({})) as { directoryPath: string };
  assert.equal(remote.directoryPath, '');
});

test('reads, writes and deletes pass the version through untouched', async () => {
  const log: string[] = [];
  const handlers = register(log);
  assert.deepEqual(await handlers.get('memory:read')?.({}, '/topics/food.md'), DOCUMENT);
  assert.equal(await handlers.get('memory:read')?.({}, '/missing.md'), null);
  assert.deepEqual(
    await handlers.get('memory:write')?.({}, { path: '/profile.md', content: 'x', ifVersion: 'new' }),
    { kind: 'written', version: 'fedcba543210', byteLength: 1 },
  );
  assert.deepEqual(
    await handlers.get('memory:write')?.({}, { path: '/profile.md', content: 'x' }),
    { kind: 'rejected', reason: 'invalid_path', current: null },
  );
  assert.deepEqual(
    await handlers.get('memory:delete')?.({}, { path: '/topics/food.md', ifVersion: 'abcdef012345' }),
    { kind: 'deleted' },
  );
  assert.deepEqual(log, [
    'query read /topics/food.md',
    'query read /missing.md',
    'mutate write /profile.md new',
    'mutate delete /topics/food.md abcdef012345',
  ]);
});

test('the switch writes the policy and answers with the fresh listing', async () => {
  const log: string[] = [];
  const state = (await register(log).get('memory:setEnabled')?.({}, false)) as { enabled: boolean };
  assert.equal(state.enabled, true);
  assert.deepEqual(log, ['policy {"kind":"set_memory","value":{"enabled":false}}', 'query list']);
});

test('the configuration export reads every file, and the import replaces or creates each', async () => {
  const log: string[] = [];
  const client = fakeClient(log) as never;
  assert.deepEqual(await readRuntimeHostMemoryFiles(client), {
    '/topics/food.md': '- [stated] drinks tea',
  });
  await writeRuntimeHostMemoryFiles(client, {
    '/topics/food.md': 'replaced',
    '/people/sam.md': 'created',
  });
  assert.deepEqual(log.slice(2), [
    'query read /topics/food.md',
    'mutate write /topics/food.md abcdef012345',
    'query read /people/sam.md',
    'mutate write /people/sam.md new',
  ]);
});
