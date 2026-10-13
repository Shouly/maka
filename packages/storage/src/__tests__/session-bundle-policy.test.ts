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
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { CreateSessionInput } from '@maka/core/runtime-inputs';
import type { RuntimeEvent } from '@maka/core/runtime-event';
import { createSessionStore } from '../session-store.js';
import { exportSessionBundleState, importSessionBundleState } from '../session-bundle-policy.js';
import { createSqliteArtifactStoreWriteAuthority } from '../artifact-store.js';
import { createSqliteRuntimeStore } from '../sqlite-runtime-store.js';

test('exports one Session as filtered SQLite', async () => {
  const base = await mkdtemp(join(tmpdir(), 'maka-session-bundle-'));
  const stateRoot = join(base, 'state');
  const configRoot = join(base, 'config');
  const destinationRoot = join(base, 'bundle');
  await mkdir(configRoot, { recursive: true });
  const sessions = createSessionStore(stateRoot);
  try {
    const selected = await sessions.create(input('Selected'));
    const excluded = await sessions.create(input('Excluded'));
    await sessions.appendMessage(selected.id, message('selected-message'));
    await sessions.appendMessage(excluded.id, message('excluded-message'));
    await sessions.close?.();
    const sourceDatabase = new DatabaseSync(join(stateRoot, 'runtime.sqlite'));
    sourceDatabase
      .prepare('INSERT INTO usage_pricing_overrides(model_key, record_json) VALUES (?, ?)')
      .run('private-model', '{}');
    sourceDatabase.close();

    const plan = await exportSessionBundleState({
      stateRoot,
      configRoot,
      destinationRoot,
      sessionId: selected.id,
    });
    assert.deepEqual(plan.includedEntries, ['runtime.sqlite']);
    const database = new DatabaseSync(join(destinationRoot, 'runtime.sqlite'), { readOnly: true });
    try {
      const ids = database
        .prepare('SELECT session_id FROM session_metadata ORDER BY session_id')
        .all()
        .map((row) => (row as { session_id: string }).session_id);
      assert.deepEqual(ids, [selected.id]);
      assert.equal(
        (
          database.prepare('SELECT COUNT(*) AS count FROM session_messages').get() as {
            count: number;
          }
        ).count,
        1,
      );
      assert.equal(
        (
          database.prepare('SELECT COUNT(*) AS count FROM usage_pricing_overrides').get() as {
            count: number;
          }
        ).count,
        0,
      );
    } finally {
      database.close();
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('an exported copy retains stable files and frozen task output after the original workspace is removed', async () => {
  const base = await mkdtemp(join(tmpdir(), 'maka-bundle-bindings-'));
  const sourceRoot = join(base, 'source');
  const bundleRoot = join(base, 'bundle');
  const targetRoot = join(base, 'imported');
  const sessions = createSessionStore(sourceRoot);
  const artifacts = createSqliteArtifactStoreWriteAuthority(sourceRoot);
  let targetId: string;
  try {
    const source = await sessions.create(input('Original'));
    const target = await sessions.create(input('Copied'));
    targetId = target.id;
    await artifacts.store.create({
      id: 'historical-file',
      sessionId: source.id,
      turnId: 'turn-1',
      name: 'report.md',
      kind: 'file',
      source: 'user_delivery',
      content: 'report bytes',
    });
    await artifacts.store.copyConversationArtifacts({
      sourceSessionId: source.id,
      targetSessionId: target.id,
      turnIds: ['turn-1'],
    });
    await artifacts.store.create({
      id: 'saved-snapshot',
      sessionId: target.id,
      turnId: 'saved-output-snapshot',
      name: 'old-output.txt',
      kind: 'file',
      source: 'saved_tool_output',
      content: 'immutable output',
      taskOutputSnapshotOf: 'sr_task',
    });
    await artifacts.store.freezeMissingTaskOutput(target.id, 'sr_missing');
  } finally {
    artifacts.close();
    await sessions.close?.();
  }
  try {
    await exportSessionBundleState({
      stateRoot: sourceRoot,
      configRoot: join(base, 'config'),
      destinationRoot: bundleRoot,
      sessionId: targetId,
    });
    await rm(sourceRoot, { recursive: true, force: true });
    await importSessionBundleState({
      stateRoot: targetRoot,
      bundleStateRoot: bundleRoot,
      sourceStateRoot: sourceRoot,
    });
    const imported = createSessionStore(targetRoot);
    const files = createSqliteArtifactStoreWriteAuthority(targetRoot);
    try {
      assert.deepEqual(
        (await imported.list()).map((session) => session.id),
        [targetId],
      );
      assert.deepEqual(await files.store.readTextInSession(targetId, 'historical-file'), {
        ok: true,
        text: 'report bytes',
      });
      assert.equal(
        (await files.store.getInSession(targetId, 'historical-file')).record?.id,
        'historical-file',
      );
      assert.equal(
        (await files.store.readTaskOutputSnapshots(targetId)).get('sr_task'),
        'saved-snapshot',
      );
      assert.equal((await files.store.readTaskOutputSnapshots(targetId)).get('sr_missing'), null);
      assert.deepEqual(await files.store.readTextInSession(targetId, 'saved-snapshot'), {
        ok: true,
        text: 'immutable output',
      });
      assert.equal((await files.store.readTaskOutputSnapshots('unrelated')).size, 0);
    } finally {
      files.close();
      await imported.close?.();
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('bundle import preserves deleted hand-back receipts without exporting their old Blob or source Session', async () => {
  const base = await mkdtemp(join(tmpdir(), 'maka-bundle-handoff-'));
  const sourceRoot = join(base, 'source');
  const bundleRoot = join(base, 'bundle');
  const targetRoot = join(base, 'target');
  const sessions = createSessionStore(sourceRoot);
  const artifacts = createSqliteArtifactStoreWriteAuthority(sourceRoot);
  try {
    const parent = await sessions.create(input('Parent'));
    const child = await sessions.create(input('Source'));
    const other = await sessions.create(input('Excluded receiver'));
    const report = {
      id: 'deleted-report',
      sessionId: child.id,
      turnId: 'turn',
      name: 'report.txt',
      kind: 'file' as const,
      source: 'user_delivery' as const,
      content: 'report',
      now: 1,
    };
    await artifacts.store.create(report);
    const handoff = {
      sourceSessionId: child.id,
      targetSessionId: parent.id,
      artifactIds: [report.id],
    };
    await artifacts.store.retainChildArtifacts(handoff);
    await artifacts.store.retainChildArtifacts({ ...handoff, targetSessionId: other.id });
    await artifacts.store.deleteUserArtifactInSession(parent.id, report.id);
    artifacts.close();
    await sessions.close?.();
    await exportSessionBundleState({
      stateRoot: sourceRoot,
      configRoot: join(base, 'config'),
      destinationRoot: bundleRoot,
      sessionId: parent.id,
    });
    const database = new DatabaseSync(join(bundleRoot, 'runtime.sqlite'), { readOnly: true });
    try {
      assert.deepEqual(
        database
          .prepare('SELECT session_id FROM artifact_handoffs')
          .all()
          .map((row) => row.session_id),
        [parent.id],
      );
      assert.equal(database.prepare('SELECT count(*) AS n FROM artifact_objects').get()!.n, 0);
    } finally {
      database.close();
    }
    await importSessionBundleState({
      stateRoot: targetRoot,
      bundleStateRoot: bundleRoot,
      sourceStateRoot: sourceRoot,
    });
    const imported = createSqliteArtifactStoreWriteAuthority(targetRoot);
    try {
      // Make the same source readable again: the receipt, not source absence,
      // must prevent the deleted receiver holding from being restored.
      await imported.store.create(report);
      assert.deepEqual(await imported.store.retainChildArtifacts(handoff), []);
      assert.equal(await imported.store.getRecordInSession(parent.id, report.id), undefined);
    } finally {
      imported.close();
    }
  } finally {
    artifacts.close();
    await sessions.close?.();
    await rm(base, { recursive: true, force: true });
  }
});

test('retains only the selected Session partial stream segments', async () => {
  const base = await mkdtemp(join(tmpdir(), 'maka-session-bundle-partials-'));
  const stateRoot = join(base, 'state');
  const configRoot = join(base, 'config');
  const destinationRoot = join(base, 'bundle');
  const databasePath = join(stateRoot, 'runtime.sqlite');
  await mkdir(configRoot, { recursive: true });
  const sessions = createSessionStore(stateRoot);
  try {
    const selected = await sessions.create(input('Selected'));
    const excluded = await sessions.create(input('Excluded'));
    await sessions.close?.();

    const runtime = createSqliteRuntimeStore(databasePath);
    try {
      await runtime.appendRuntimeEvent(
        selected.id,
        'selected-run',
        partialEvent(selected.id, 'selected-run', 'selected', 1, 'a'),
      );
      await runtime.appendRuntimeEvent(
        selected.id,
        'selected-run',
        partialEvent(selected.id, 'selected-run', 'selected', 2, 'b'),
      );
      await runtime.appendRuntimeEvent(
        excluded.id,
        'excluded-run',
        partialEvent(excluded.id, 'excluded-run', 'excluded', 3, 'secret'),
      );
    } finally {
      runtime.close();
    }

    await exportSessionBundleState({
      stateRoot,
      configRoot,
      destinationRoot,
      sessionId: selected.id,
    });

    const bundledDatabasePath = join(destinationRoot, 'runtime.sqlite');
    const bundledRuntime = createSqliteRuntimeStore(bundledDatabasePath, { readOnly: true });
    try {
      const selectedEvents = await bundledRuntime.readRuntimeEvents(selected.id, 'selected-run');
      assert.equal(selectedEvents.length, 1);
      assert.equal(
        selectedEvents[0]?.content?.kind === 'text' ? selectedEvents[0].content.text : undefined,
        'ab',
      );
      assert.deepEqual(await bundledRuntime.readRuntimeEvents(excluded.id, 'excluded-run'), []);
    } finally {
      bundledRuntime.close();
    }
    const bundledDatabase = new DatabaseSync(bundledDatabasePath, { readOnly: true });
    try {
      assert.deepEqual(
        bundledDatabase
          .prepare('SELECT text_content FROM runtime_partial_segments ORDER BY segment_seq')
          .all()
          .map((row) => (row as { text_content: string }).text_content),
        ['ab'],
      );
    } finally {
      bundledDatabase.close();
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

function input(name: string): CreateSessionInput {
  return {
    cwd: '/tmp/cwd',
    llmConnectionSlug: 'fake',
    model: 'fake-model',
    permissionMode: 'ask' as const,
    name,
    labels: [],
  };
}

function message(id: string) {
  return { type: 'user' as const, id, turnId: 'turn-1', ts: 1, text: id };
}

function partialEvent(
  sessionId: string,
  runId: string,
  prefix: string,
  ts: number,
  text: string,
): RuntimeEvent {
  return {
    id: `${prefix}-partial-${ts}`,
    invocationId: `${prefix}-invocation`,
    runId,
    sessionId,
    turnId: `${prefix}-turn`,
    ts,
    partial: true,
    role: 'model',
    author: 'agent',
    content: { kind: 'text', text },
    refs: { providerEventId: `${prefix}-message` },
  };
}

test('imports reuse shared immutable objects and reject the same ID naming different bytes', async () => {
  const base = await mkdtemp(join(tmpdir(), 'maka-bundle-shared-'));
  const sourceRoot = join(base, 'source');
  const targetRoot = join(base, 'target');
  const source = createSessionStore(sourceRoot);
  const files = createSqliteArtifactStoreWriteAuthority(sourceRoot);
  let firstId: string;
  let secondId: string;
  try {
    const first = await source.create(input('First'));
    const second = await source.create(input('Second'));
    firstId = first.id;
    secondId = second.id;
    await files.store.create({
      id: 'shared-file',
      sessionId: first.id,
      turnId: 'turn-1',
      name: 'report.md',
      kind: 'file',
      source: 'user_delivery',
      content: 'original bytes',
    });
    await files.store.copyConversationArtifacts({
      sourceSessionId: first.id,
      targetSessionId: second.id,
      turnIds: ['turn-1'],
    });
  } finally {
    files.close();
    await source.close?.();
  }
  try {
    for (const sessionId of [firstId, secondId]) {
      const bundleStateRoot = join(base, sessionId);
      await exportSessionBundleState({
        stateRoot: sourceRoot,
        configRoot: join(base, 'config'),
        destinationRoot: bundleStateRoot,
        sessionId,
      });
      await importSessionBundleState({ stateRoot: targetRoot, bundleStateRoot });
    }
    const target = createSqliteArtifactStoreWriteAuthority(targetRoot);
    try {
      const first = (await target.store.getInSession(firstId, 'shared-file')).record;
      const second = (await target.store.getInSession(secondId, 'shared-file')).record;
      assert.ok(first && second);
      assert.equal(first.relativePath, second.relativePath);
      await target.store.purgeSessionArtifacts(firstId);
      await target.store.collectGarbage({ maxPaths: 100 });
      assert.deepEqual(await target.store.readTextInSession(secondId, 'shared-file'), {
        ok: true,
        text: 'original bytes',
      });
    } finally {
      target.close();
    }
    const conflictingRoot = join(base, 'conflicting');
    const conflictingSessions = createSessionStore(conflictingRoot);
    const conflictingFiles = createSqliteArtifactStoreWriteAuthority(conflictingRoot);
    let conflictId: string;
    try {
      conflictId = (await conflictingSessions.create(input('Conflict'))).id;
      await conflictingFiles.store.create({
        id: 'shared-file',
        sessionId: conflictId,
        turnId: 'turn-1',
        name: 'report.md',
        kind: 'file',
        source: 'user_delivery',
        content: 'different bytes',
      });
    } finally {
      conflictingFiles.close();
      await conflictingSessions.close?.();
    }
    const bundleStateRoot = join(base, 'conflicting-bundle');
    await exportSessionBundleState({
      stateRoot: conflictingRoot,
      configRoot: join(base, 'config'),
      destinationRoot: bundleStateRoot,
      sessionId: conflictId,
    });
    await assert.rejects(
      importSessionBundleState({ stateRoot: targetRoot, bundleStateRoot }),
      /identity names different content/,
    );
    const checked = createSqliteArtifactStoreWriteAuthority(targetRoot);
    const targetSessions = createSessionStore(targetRoot);
    try {
      await checked.store.collectGarbage({ maxPaths: 100 });
      assert.deepEqual(await checked.store.readTextInSession(secondId, 'shared-file'), {
        ok: true,
        text: 'original bytes',
      });
      assert.ok(!(await targetSessions.list()).some((session) => session.id === conflictId));
    } finally {
      checked.close();
      await targetSessions.close?.();
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
