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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { memoryFileVersion } from '@maka/core/memory-filesystem';
import { createDefaultRuntimePolicy, type RuntimePolicy } from '@maka/core/runtime-policy';
import { TOOL_NAMES } from '@maka/core/tool-names';
import type { MakaToolContext } from '@maka/runtime/tool-runtime';
import { openInteractiveMemoryFileStoreForWrite } from '@maka/storage/memory-file-store';
import {
  resolveRootControlNamespace,
  resolveStorageRoot,
  tryAcquireInteractiveRootOwner,
} from '@maka/storage/root-authority';
import { HostMemoryCoordinator } from '../server/memory-coordinator.js';
import type { ConnectionContext } from '../server/operation-dispatcher.js';

// A root's control directory lives under the real home, not the temp root.
const controlRootIds = new Set<string>();
after(async () => {
  for (const rootId of controlRootIds) {
    await rm(join(resolveRootControlNamespace(), rootId), { recursive: true, force: true });
  }
});

const CONTEXT = { connectionId: 'test', principal: 'client' } as unknown as ConnectionContext;
const PROFILE = [
  '---',
  'name: profile',
  'description: who they are',
  'sources: [chat]',
  '---',
  '',
  '- [stated] engineer on the platform team',
  '',
].join('\n');
const FOOD = [
  '---',
  'name: food',
  'description: what they eat',
  'aliases: [diet]',
  'sources: [chat]',
  '---',
  '',
  '- [stated] drinks tea',
  '',
].join('\n');

async function withCoordinator(
  policy: Partial<RuntimePolicy>,
  run: (coordinator: HostMemoryCoordinator) => Promise<void>,
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), 'maka-memory-coordinator-'));
  const capability = await resolveStorageRoot({
    path: join(base, 'interactive'),
    kind: 'interactive',
  });
  controlRootIds.add(capability.rootId);
  const owner = await tryAcquireInteractiveRootOwner(capability);
  assert.ok(owner);
  if (!owner) return;
  try {
    const coordinator = new HostMemoryCoordinator({
      store: await openInteractiveMemoryFileStoreForWrite(owner.lease),
      runtimePolicy: {
        getSnapshot: async () => ({
          revision: 1,
          policy: { ...createDefaultRuntimePolicy(), ...policy },
        }),
      },
    });
    await run(coordinator);
  } finally {
    await owner.close();
    await rm(base, { recursive: true, force: true });
  }
}

describe('Host memory coordinator', () => {
  test('the settings page and the model read and write the same files', async () => {
    await withCoordinator({}, async (coordinator) => {
      const written = await coordinator.handlers['memory.mutate'](
        { kind: 'write', path: '/topics/food.md', content: FOOD, ifVersion: 'new' },
        CONTEXT,
      );
      assert.equal(written.ok, true);
      if (!written.ok) return;
      assert.deepEqual(written.result, {
        kind: 'written',
        version: memoryFileVersion(FOOD),
        byteLength: Buffer.byteLength(FOOD),
      });

      const listed = await coordinator.handlers['memory.query']({ kind: 'list' }, CONTEXT);
      assert.equal(listed.ok, true);
      if (!listed.ok || listed.result.kind !== 'list') return;
      assert.equal(listed.result.enabled, true);
      assert.match(listed.result.directoryPath, /memory$/);
      assert.deepEqual(listed.result.files, [
        {
          path: '/topics/food.md',
          byteLength: Buffer.byteLength(FOOD),
          updatedAt: listed.result.files[0]!.updatedAt,
          description: 'what they eat',
          aliases: ['diet'],
          sources: ['chat'],
        },
      ]);

      // The model's read tool sees the page's write.
      const read = coordinator.tools.find((tool) => tool.name === TOOL_NAMES.memoryRead)!;
      const text = (await read.impl({ path: '/topics/food.md' }, toolContext())) as string;
      assert.match(
        text,
        new RegExp(`^\\[updated: .*\\] \\[version: ${memoryFileVersion(FOOD)}\\]`),
      );
      assert.ok(text.endsWith(FOOD));

      // A stale page write is refused with the current content.
      const stale = await coordinator.handlers['memory.mutate'](
        { kind: 'write', path: '/topics/food.md', content: 'x', ifVersion: 'deadbeefdead' },
        CONTEXT,
      );
      assert.equal(stale.ok, true);
      if (!stale.ok) return;
      assert.equal(stale.result.kind, 'rejected');
      if (stale.result.kind !== 'rejected') return;
      assert.equal(stale.result.reason, 'version_conflict');
      assert.equal(stale.result.current?.content, FOOD);

      const deleted = await coordinator.handlers['memory.mutate'](
        { kind: 'delete', path: '/topics/food.md', ifVersion: memoryFileVersion(FOOD) },
        CONTEXT,
      );
      assert.deepEqual(deleted, { ok: true, result: { kind: 'deleted' } });
      const gone = await coordinator.handlers['memory.query'](
        { kind: 'read', path: '/topics/food.md' },
        CONTEXT,
      );
      assert.deepEqual(gone, { ok: true, result: { kind: 'document', document: null } });
    });
  });

  test('the prompt carries profile and preferences in full and everything else as a listing line', async () => {
    await withCoordinator({}, async (coordinator) => {
      await coordinator.handlers['memory.mutate'](
        { kind: 'write', path: '/profile.md', content: PROFILE, ifVersion: 'new' },
        CONTEXT,
      );
      await coordinator.handlers['memory.mutate'](
        { kind: 'write', path: '/topics/food.md', content: FOOD, ifVersion: 'new' },
        CONTEXT,
      );
      const projection = await coordinator.readPromptProjection({
        revision: 1,
        policy: createDefaultRuntimePolicy(),
      });
      assert.ok(projection.revision);
      const body = projection.body ?? '';
      assert.match(body, /^<user_memory_snapshot>\n/);
      assert.match(body, /<profile>\n- \[stated\] engineer on the platform team\n<\/profile>/);
      assert.doesNotMatch(body, /<preferences>/);
      assert.match(
        body,
        /<memory_listing>\n[^\n]*\n\/topics\/food\.md — what they eat \(aliases: diet\) \[sources: chat\]\n<\/memory_listing>/,
      );
      assert.doesNotMatch(body, /drinks tea/);
      assert.doesNotMatch(body, /\/profile\.md/);
    });
  });

  test('memory off or incognito: no prompt block, tools refuse, the page is told why', async () => {
    for (const policy of [
      { memory: { enabled: false } },
      { privacy: { incognitoActive: true } },
    ] satisfies Partial<RuntimePolicy>[]) {
      await withCoordinator(policy, async (coordinator) => {
        assert.deepEqual(
          await coordinator.readPromptProjection({
            revision: 1,
            policy: { ...createDefaultRuntimePolicy(), ...policy },
          }),
          { revision: null },
        );
        const list = coordinator.tools.find((tool) => tool.name === TOOL_NAMES.memoryList)!;
        await assert.rejects(
          list.impl({}, toolContext()) as Promise<unknown>,
          /MemoryList failed: memory is (off in incognito|turned off in Settings)/,
        );
        const write = await coordinator.handlers['memory.mutate'](
          { kind: 'write', path: '/profile.md', content: PROFILE, ifVersion: 'new' },
          CONTEXT,
        );
        assert.equal(write.ok, true);
        if (!write.ok) return;
        assert.equal(write.result.kind, 'rejected');
        if (write.result.kind !== 'rejected') return;
        assert.equal(write.result.reason, 'memory' in policy ? 'disabled' : 'incognito');
        // Listing still works so the page can show the files and the switch.
        const listed = await coordinator.handlers['memory.query']({ kind: 'list' }, CONTEXT);
        assert.equal(listed.ok, true);
      });
    }
  });

  test('while the Host drains, the tools say so rather than blaming the Settings switch', async () => {
    await withCoordinator({}, async (coordinator) => {
      coordinator.beginDrain();
      const list = coordinator.tools.find((tool) => tool.name === TOOL_NAMES.memoryList)!;
      await assert.rejects(
        list.impl({}, toolContext()) as Promise<unknown>,
        /MemoryList failed: memory is unavailable while Copilot shuts down/,
      );
      const write = await coordinator.handlers['memory.mutate'](
        { kind: 'write', path: '/profile.md', content: PROFILE, ifVersion: 'new' },
        CONTEXT,
      );
      assert.equal(write.ok, false);
      if (write.ok) return;
      assert.equal(write.error.code, 'host_draining');
    });
  });
});

function toolContext(): MakaToolContext {
  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    cwd: '/tmp',
    toolCallId: 'call-1',
    abortSignal: new AbortController().signal,
    emitOutput: () => {},
  };
}
