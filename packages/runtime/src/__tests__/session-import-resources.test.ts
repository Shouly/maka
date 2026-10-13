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
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { RuntimeEvent } from '@maka/core/runtime-event';
import { formatAttachmentResourceRef } from '@maka/core/attachments';
import { taskOutputResourceRef } from '@maka/core/file-resources';
import { createSqliteAgentRunStore } from '@maka/storage/agent-run-store';
import { openInteractiveArtifactStoreForWrite } from '@maka/storage/artifact-stores';
import { resolveStorageRoot, tryAcquireInteractiveRootOwner } from '@maka/storage/root-authority';
import { createWorkspaceRuntimeStore } from '@maka/storage/runtime-event-persistence';
import { importSessionBundleState } from '@maka/storage/session-bundle-policy';
import { createSessionStore } from '@maka/storage/session-store';
import { buildHistoryCompactCheckpoint } from '../history-compact-checkpoint.js';
import { HistoryCompactCheckpointCoordinator } from '../history-compact-checkpoint-coordinator.js';
import { exportSessionBundle } from '../session-export.js';
import { importSessionBundle } from '../session-import.js';
import { sectionedSummary } from './history-compact-test-fixtures.js';
import { seedInvocation } from './invocation-fixture.js';

async function withFixture(
  run: (fixture: { base: string; source: string; target: string }) => Promise<void>,
) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'maka-portable-resource-import-')));
  const source = join(base, 'source');
  const target = join(base, 'target');
  await Promise.all([mkdir(source), mkdir(target)]);
  try {
    await run({ base, source, target });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}
function inspect<T>(root: string, read: (database: DatabaseSync) => T): T {
  const db = new DatabaseSync(join(root, 'runtime.sqlite'));
  try {
    return read(db);
  } finally {
    db.close();
  }
}
async function artifacts<T>(
  root: string,
  run: (store: Awaited<ReturnType<typeof openInteractiveArtifactStoreForWrite>>) => Promise<T>,
): Promise<T> {
  const owner = await tryAcquireInteractiveRootOwner(
    await resolveStorageRoot({ path: root, kind: 'interactive' }),
  );
  assert.ok(owner);
  const store = await openInteractiveArtifactStoreForWrite(owner.lease);
  try {
    return await run(store);
  } finally {
    store.close();
    await owner.close();
  }
}
function history(root: string, sessionId: string) {
  return inspect(root, (db) => ({
    runtime: db
      .prepare('SELECT * FROM runtime_events WHERE session_id = ? ORDER BY event_seq')
      .all(sessionId),
    checkpoints: db
      .prepare('SELECT * FROM core_agent_run_events WHERE session_id = ? ORDER BY sequence')
      .all(sessionId),
    projections: db
      .prepare('SELECT * FROM core_agent_run_projections WHERE session_id = ? ORDER BY event_type')
      .all(sessionId),
  }));
}
async function seed(
  root: string,
  label: string,
  options: {
    sourceRoot?: string;
    sourceJoin?: typeof join;
    opaque?: boolean;
    summaryOnly?: boolean;
  } = {},
) {
  const sessions = createSessionStore(root);
  let sessionId: string;
  try {
    sessionId = (
      await sessions.create({
        cwd: root,
        llmConnectionSlug: 'test',
        model: 'test',
        permissionMode: 'ask',
        name: label,
      })
    ).id;
  } finally {
    await sessions.close?.();
  }
  const file = await artifacts(root, (store) =>
    store.create({
      id: `output-${label}`,
      sessionId,
      turnId: `turn-${label}`,
      name: 'output.txt',
      kind: 'file',
      source: 'saved_tool_output',
      content: `saved bytes for ${label}`,
    }),
  );
  const ref = formatAttachmentResourceRef({
    kind: 'session_file',
    sessionId,
    relativePath: file.id,
  })!;
  const taskRef = taskOutputResourceRef('task');
  const privatePath = (options.sourceJoin ?? join)(
    options.sourceRoot ?? root,
    'tasks',
    sessionId,
    'task.output',
  );
  const localPath = join(root, 'tasks', sessionId, 'task.output');
  await mkdir(dirname(localPath), { recursive: true });
  await writeFile(localPath, 'task output\n');
  inspect(root, (db) =>
    db
      .prepare(
        'INSERT INTO core_shell_runs(session_id, shell_run_id, started_at, record_json) VALUES (?, ?, 1, ?)',
      )
      .run(sessionId, 'task', JSON.stringify({ shellRunId: 'task', outputFile: privatePath })),
  );
  const runtime = createWorkspaceRuntimeStore(root);
  const runs = createSqliteAgentRunStore(root);
  try {
    const identity = await seedInvocation(runtime, {
      sessionId,
      runId: `run-${label}`,
      turnId: `turn-${label}`,
      openedAt: 1,
      opening: { configuration: { cwd: root } },
    });
    const events: RuntimeEvent[] = [
      {
        ...identity,
        id: `${label}-user`,
        ts: 2,
        partial: false,
        role: 'user',
        author: 'user',
        content: { kind: 'text', text: 'inspect output' },
      },
      {
        ...identity,
        id: `${label}-answer`,
        ts: 3,
        partial: false,
        role: 'model',
        author: 'agent',
        content: {
          kind: 'text',
          text: options.summaryOnly ? 'Output inspected.' : `Files: ${ref}; ${taskRef}`,
        },
      },
    ];
    for (const event of events) await runtime.appendRuntimeEvent(sessionId, identity.runId, event);
    await runtime.appendRuntimeEvent(sessionId, identity.runId, {
      ...identity,
      id: `${label}-done`,
      ts: 4,
      partial: false,
      role: 'system',
      author: 'system',
      status: 'completed',
    });
    const first = buildHistoryCompactCheckpoint({
      sessionId,
      coveredRuntimeEvents: events,
      summary: sectionedSummary(`Saved output: ${ref}; ${taskRef}`),
      highWaterSeq: 1,
      now: 5,
    });
    const checkpoint = buildHistoryCompactCheckpoint({
      sessionId,
      coveredRuntimeEvents: events,
      previousCheckpointId: first.checkpointId,
      highWaterSeq: 2,
      now: 6,
      ...(options.opaque
        ? {
            providerState: {
              kind: 'openai_codex_remote_v2' as const,
              connectionId: 'connection',
              modelId: 'model',
              itemId: 'item',
              encryptedContent: 'opaque',
            },
          }
        : { summary: sectionedSummary(`Continue reading ${ref}`) }),
    });
    for (const [index, value] of [first, checkpoint].entries())
      await runs.appendEvent(sessionId, identity.runId, {
        sessionId,
        runId: identity.runId,
        turnId: identity.turnId,
        id: `${label}-checkpoint-${index}`,
        type: 'history_compact_checkpoint_recorded',
        ts: value.createdAt,
        data: {
          checkpointId: value.checkpointId,
          checkpoint: value,
          highWaterSeq: value.highWaterSeq,
          boundaryKind: 'historyCompact',
        },
      });
    return { sessionId, file, ref, taskRef, checkpoint };
  } finally {
    runtime.close();
    await runs.close?.();
  }
}

for (const location of [
  { name: 'Windows drive', sourceRoot: 'C:\\Users\\Alice\\Maka', sourceJoin: win32.join },
  { name: 'Windows UNC', sourceRoot: '\\\\server\\share\\Maka', sourceJoin: win32.join },
  {
    name: 'POSIX root containing a backslash',
    sourceRoot: '/old/Maka\\state',
    sourceJoin: posix.join,
  },
])
  test(`imports resources from a ${location.name} root without rewriting history`, async () => {
    await withFixture(async ({ source, target }) => {
      const seeded = await seed(source, 'portable', location);
      const before = history(source, seeded.sessionId);
      await importSessionBundleState({
        stateRoot: target,
        bundleStateRoot: source,
        sourceStateRoot: location.sourceRoot,
      });
      assert.deepEqual(history(target, seeded.sessionId), before);
      const relocated = join(target, 'tasks', seeded.sessionId, 'task.output');
      assert.equal(await readFile(relocated, 'utf8'), 'task output\n');
      assert.equal(
        inspect(
          target,
          (db) =>
            JSON.parse(
              String(
                db
                  .prepare('SELECT record_json FROM core_shell_runs WHERE session_id = ?')
                  .get(seeded.sessionId)!.record_json,
              ),
            ).outputFile,
        ),
        relocated,
      );
      await rm(source, { recursive: true, force: true });
      await artifacts(target, async (store) => {
        assert.deepEqual(await store.readTextInSession(seeded.sessionId, seeded.file.id), {
          ok: true,
          text: 'saved bytes for portable',
        });
        assert.deepEqual(await store.readTextInSession('unrelated', seeded.file.id), {
          ok: false,
          reason: 'not_found',
        });
      });
    });
  });

test('actual archive preserves stable resource IDs, summary-only refs, and opaque checkpoint chains', async () => {
  for (const opaque of [false, true])
    await withFixture(async ({ base, source, target }) => {
      const seeded = await seed(source, 'archive', { opaque, summaryOnly: true });
      const before = history(source, seeded.sessionId);
      const bundle = join(base, 'session.maka-session');
      assert.equal(
        (
          await exportSessionBundle({
            workspaceRoot: source,
            sessionId: seeded.sessionId,
            destination: bundle,
          })
        ).ok,
        true,
      );
      const imported = await importSessionBundle({ workspaceRoot: target, source: bundle });
      assert.equal(imported.ok, true, JSON.stringify(imported));
      assert.deepEqual(history(target, seeded.sessionId), before);
      await rm(source, { recursive: true, force: true });
      const runtime = createWorkspaceRuntimeStore(target);
      const runs = createSqliteAgentRunStore(target);
      try {
        const coordinator = new HistoryCompactCheckpointCoordinator({
          runStore: runs,
          runtimeEventStore: runtime,
        });
        assert.equal(
          (await coordinator.load(seeded.sessionId))?.checkpointId,
          seeded.checkpoint.checkpointId,
        );
      } finally {
        runtime.close();
        await runs.close?.();
      }
      await artifacts(target, async (store) => {
        assert.deepEqual(await store.readTextInSession(seeded.sessionId, seeded.file.id), {
          ok: true,
          text: 'saved bytes for archive',
        });
      });
    });
});

test('an invalid private task locator rolls back imported history, resources, and copied bytes', async () => {
  await withFixture(async ({ source, target }) => {
    const invalid = await seed(source, 'invalid');
    const kept = await seed(target, 'kept');
    const before = history(target, kept.sessionId);
    inspect(source, (db) =>
      db
        .prepare('UPDATE core_shell_runs SET record_json = ?')
        .run(JSON.stringify({ shellRunId: 'task', outputFile: join(source, 'outside.output') })),
    );
    await assert.rejects(
      importSessionBundleState({
        stateRoot: target,
        bundleStateRoot: source,
        sourceStateRoot: source,
      }),
      /Task output locator does not belong to its Session/,
    );
    assert.deepEqual(history(target, invalid.sessionId), {
      runtime: [],
      checkpoints: [],
      projections: [],
    });
    assert.deepEqual(history(target, kept.sessionId), before);
    await assert.rejects(stat(join(target, 'artifacts', invalid.file.relativePath)), /ENOENT/);
    await assert.rejects(stat(join(target, 'tasks', invalid.sessionId, 'task.output')), /ENOENT/);
    assert.deepEqual(
      inspect(target, (db) => db.prepare('PRAGMA foreign_key_check').all()),
      [],
    );
  });
});
