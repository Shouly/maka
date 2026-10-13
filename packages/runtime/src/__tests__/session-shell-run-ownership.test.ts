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
import { test, type TestContext } from 'node:test';
import type { ShellRunSnapshotResult } from '@maka/core/events';
import { createSessionStore, SessionNotFoundError } from '@maka/storage/session-store';
import { BackendRegistry, SessionManager } from '../session-manager.js';
import type { ShellRunProcessManager } from '../shell-run-manager.js';

const REF = 'maka://runtime/background-tasks/inherited-task';

for (const relation of ['parentSessionId', 'revisionParentSessionId'] as const) {
  test(`shell list and point reads tolerate a deleted ${relation}, not storage failures`, async (t) => {
    const { manager, store, ancestor, parent, child } = await harness(t, relation);
    const list = () => manager.listShellRunUpdates(child.id);
    const get = () => manager.getShellRunUpdate(child.id, REF);
    const expected = {
      kind: 'source_owned',
      sourceSessionId: parent.id,
      ownerSessionId: ancestor.id,
    };
    assert.deepEqual((await list())[0]?.ownership, expected);
    assert.deepEqual((await get())?.ownership, expected);

    // A real SQLite Session miss uses session_not_found, not ENOENT.
    // Test both a gap further up the chain and the immediate parent's deletion.
    for (const deleted of [ancestor.id, parent.id]) {
      await store.remove(deleted);
      await assert.rejects(store.readHeader(deleted), SessionNotFoundError);
      const unavailable = { kind: 'source_unavailable', sourceSessionId: parent.id };
      const updates = await list();
      assert.equal(updates.length, 1);
      assert.deepEqual(updates[0]?.ownership, unavailable);
      assert.deepEqual((await get())?.ownership, unavailable);
      assert.equal(updates[0]?.result.status, 'running', 'do not invent a terminal task outcome');
    }

    const readHeader = store.readHeader.bind(store);
    const ioFailure = Object.assign(new Error('metadata read failed'), { code: 'EIO' });
    t.mock.method(store, 'readHeader', async (id: string) => {
      if (id === parent.id) throw ioFailure;
      return readHeader(id);
    });
    await assert.rejects(list, (error) => error === ioFailure);
    await assert.rejects(get, (error) => error === ioFailure);
  });
}

test('a missing queried Session is not a missing optional ancestor', async (t) => {
  const { manager, store, child } = await harness(t, 'parentSessionId');
  await store.remove(child.id);
  await assert.rejects(manager.listShellRunUpdates(child.id), SessionNotFoundError);
  await assert.rejects(manager.getShellRunUpdate(child.id, REF), SessionNotFoundError);
});

test('shell process read failures still propagate instead of becoming source_unavailable', async (t) => {
  const { manager, shellRuns, child } = await harness(t, 'parentSessionId');
  const failure = Object.assign(new Error('shell store read failed'), { code: 'EIO' });
  t.mock.method(shellRuns, 'inspectResource', async () => {
    throw failure;
  });
  await assert.rejects(manager.listShellRunUpdates(child.id), (error) => error === failure);
  await assert.rejects(manager.getShellRunUpdate(child.id, REF), (error) => error === failure);
});

async function harness(t: TestContext, relation: 'parentSessionId' | 'revisionParentSessionId') {
  const root = await mkdtemp(join(tmpdir(), 'maka-shell-ownership-'));
  const store = createSessionStore(root);
  t.after(async () => {
    await store.close?.();
    await rm(root, { recursive: true, force: true });
  });
  const input = {
    cwd: root,
    llmConnectionSlug: 'fake',
    model: 'fake-model',
    permissionMode: 'ask' as const,
  };
  const ancestor = await store.create(input);
  const lineage = (id: string, index: number) =>
    relation === 'parentSessionId'
      ? { parentSessionId: id }
      : {
          revisionRootSessionId: ancestor.id,
          revisionParentSessionId: id,
          revisionOfTurnId: 'turn-1',
          revisionIndex: index,
          revisionState: 'committed' as const,
        };
  const parent = await store.create({ ...input, ...lineage(ancestor.id, 2) });
  const child = await store.create({ ...input, ...lineage(parent.id, 3) });
  const result: ShellRunSnapshotResult = {
    kind: 'shell_run',
    ref: REF,
    mode: 'pipes',
    status: 'running',
    cwd: root,
    cmd: 'sleep 1',
    startedAt: 1,
    updatedAt: 1,
    revision: 1,
    output: {
      mode: 'pipes',
      stdout: 'first output',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      redacted: false,
    },
  };
  const shellRuns = {
    listSessionUpdates: async () => [],
    getSessionUpdate: async () => null,
    inspectResource: async (id: string) => {
      // A cached shell record can outlive its Session's durable deletion.
      if (id === ancestor.id) return result;
      throw Object.assign(new Error('Shell run was not found'), { code: 'ENOENT' });
    },
  };
  const manager = new SessionManager({
    store,
    backends: new BackendRegistry(),
    shellRuns: shellRuns as unknown as ShellRunProcessManager,
    newId: () => 'unused',
    now: () => 1,
  });
  // Only the transcript projection is stubbed here. Ancestor metadata and its
  // typed deletion behavior come from SQLite; the Host integration test uses
  // the real copied ledger as well.
  t.mock.method(manager, 'getMessages', async () => [
    {
      type: 'tool_call' as const,
      id: 'bash-call',
      turnId: 'turn-1',
      ts: 1,
      toolName: 'Bash',
      args: { command: 'sleep 1' },
    },
    {
      type: 'tool_result' as const,
      id: 'bash-result',
      turnId: 'turn-1',
      ts: 2,
      toolUseId: 'bash-call',
      isError: false,
      content: result,
    },
  ]);
  return { manager, store, shellRuns, ancestor, parent, child };
}
