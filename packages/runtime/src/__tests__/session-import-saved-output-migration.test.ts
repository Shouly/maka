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
import { createSqliteAgentRunStore } from '@maka/storage/agent-run-store';
import { OPERATIONAL_STATE_DATABASE_NAME } from '@maka/storage/operational-state-store';
import { createWorkspaceRuntimeStore } from '@maka/storage/runtime-event-persistence';
import { importSessionBundleState } from '@maka/storage/session-bundle-policy';
import { createSessionStore } from '@maka/storage/session-store';
import type { AgentRun } from '../agent-run.js';
import {
  buildHistoryCompactCheckpoint,
  type HistoryCompactCheckpoint,
} from '../history-compact-checkpoint.js';
import { HistoryCompactCheckpointCoordinator } from '../history-compact-checkpoint-coordinator.js';
import { loadLatestHistoryCompactCheckpointFromRunLedger } from '../history-compact-ledger.js';
import { exportSessionBundle } from '../session-export.js';
import { importSessionBundle } from '../session-import.js';
import { sectionedSummary } from './history-compact-test-fixtures.js';
import { seedInvocation } from './invocation-fixture.js';

interface Fixture {
  base: string;
  bundleRoot: string;
  targetRoot: string;
}

interface SeededSession {
  sessionId: string;
  runId: string;
  turnId: string;
  path: string;
  events: RuntimeEvent[];
  checkpoint: HistoryCompactCheckpoint;
}

async function withFixture(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'maka-import-output-migration-')));
  const bundleRoot = join(base, 'bundle-state');
  const targetRoot = join(base, 'target-state');
  await Promise.all([mkdir(bundleRoot), mkdir(targetRoot)]);
  try {
    await run({ base, bundleRoot, targetRoot });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

function database(root: string): DatabaseSync {
  return new DatabaseSync(join(root, OPERATIONAL_STATE_DATABASE_NAME));
}

function inspect<T>(root: string, read: (db: DatabaseSync) => T): T {
  const db = database(root);
  try {
    return read(db);
  } finally {
    db.close();
  }
}

async function seedSession(
  root: string,
  label: string,
  pathFor: (sessionId: string) => string,
  options: {
    summaryOnly?: boolean;
    untouched?: boolean;
    opaque?: boolean;
    shellOnly?: boolean;
  } = {},
): Promise<SeededSession> {
  const sessions = createSessionStore(root);
  let sessionId: string;
  try {
    sessionId = (
      await sessions.create({
        cwd: root,
        llmConnectionSlug: 'test-connection',
        model: 'test-model',
        permissionMode: 'ask',
        name: label,
      })
    ).id;
  } finally {
    await sessions.close?.();
  }
  const path = pathFor(sessionId);
  const runId = `run-${label}`;
  const turnId = `turn-${label}`;
  const runtime = createWorkspaceRuntimeStore(root);
  const runs = createSqliteAgentRunStore(root);
  try {
    const identity = await seedInvocation(runtime, {
      sessionId,
      runId,
      turnId,
      openedAt: 1,
      opening: { configuration: { cwd: root } },
    });
    const event = (id: string, ts: number, fields: Partial<RuntimeEvent>): RuntimeEvent => ({
      ...identity,
      id: `${label}-${id}`,
      ts,
      partial: false,
      role: 'model',
      author: 'agent',
      ...fields,
    });
    const events = [
      event('user', 2, {
        role: 'user',
        author: 'user',
        content: { kind: 'text', text: 'inspect output' },
      }),
      event('answer', 3, {
        content: {
          kind: 'text',
          text:
            options.summaryOnly || options.untouched || options.shellOnly
              ? 'Output inspected.'
              : `The full output is saved to ${path}; read it with Read.`,
        },
      }),
    ];
    for (const item of events) await runtime.appendRuntimeEvent(sessionId, runId, item);
    await runtime.appendRuntimeEvent(
      sessionId,
      runId,
      event('done', 4, {
        role: 'system',
        author: 'system',
        status: 'completed',
      }),
    );
    const first = buildHistoryCompactCheckpoint({
      sessionId,
      coveredRuntimeEvents: events,
      summary: sectionedSummary(
        options.untouched || options.shellOnly || options.opaque
          ? 'Output inspected.'
          : `Saved output: ${path}`,
      ),
      highWaterSeq: 1,
      now: 5,
    });
    await appendCheckpoint(runs, { sessionId, runId, turnId }, first, 'first');
    const checkpoint = options.opaque
      ? buildHistoryCompactCheckpoint({
          sessionId,
          coveredRuntimeEvents: events,
          providerState: {
            kind: 'openai_codex_remote_v2',
            connectionId: 'connection',
            modelId: 'model',
            itemId: 'item',
            encryptedContent: 'opaque',
          },
          previousCheckpointId: first.checkpointId,
          highWaterSeq: 2,
          now: 6,
        })
      : buildHistoryCompactCheckpoint({
          sessionId,
          coveredRuntimeEvents: events,
          summary: first.version === 2 ? first.summary : sectionedSummary('Output inspected.'),
          previousCheckpointId: first.checkpointId,
          highWaterSeq: 2,
          now: 6,
        });
    await appendCheckpoint(runs, { sessionId, runId, turnId }, checkpoint, 'second');
    if (!options.untouched) {
      const file = join(
        root,
        options.shellOnly ? 'tasks' : 'tool-results',
        sessionId,
        options.shellOnly ? 'task.output' : 'output.txt',
      );
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, `saved bytes for ${label}`);
    }
    if (options.shellOnly) {
      inspect(root, (db) =>
        db
          .prepare(
            'INSERT INTO core_shell_runs(session_id, shell_run_id, started_at, record_json) VALUES (?, ?, 1, ?)',
          )
          .run(sessionId, 'task', JSON.stringify({ shellRunId: 'task', outputFile: path })),
      );
    }
    return { sessionId, runId, turnId, path, events, checkpoint };
  } finally {
    runtime.close();
    await runs.close?.();
  }
}

async function appendCheckpoint(
  runs: ReturnType<typeof createSqliteAgentRunStore>,
  session: Pick<SeededSession, 'sessionId' | 'runId' | 'turnId'>,
  checkpoint: HistoryCompactCheckpoint,
  suffix: string,
): Promise<void> {
  await runs.appendEvent(session.sessionId, session.runId, {
    sessionId: session.sessionId,
    runId: session.runId,
    turnId: session.turnId,
    id: `${session.runId}-checkpoint-${suffix}`,
    type: 'history_compact_checkpoint_recorded',
    ts: checkpoint.createdAt,
    data: {
      checkpointId: checkpoint.checkpointId,
      checkpoint,
      highWaterName: checkpoint.highWaterName,
      highWaterSeq: checkpoint.highWaterSeq,
      boundaryKind: 'historyCompact',
    },
  });
}

function runtimeRows(root: string, sessionId: string) {
  return inspect(
    root,
    (db) =>
      db
        .prepare(
          'SELECT event_id, event_seq, payload_json FROM runtime_events WHERE session_id = ? ORDER BY event_seq',
        )
        .all(sessionId) as Array<{ event_id: string; event_seq: number; payload_json: string }>,
  );
}

function checkpointRows(root: string, sessionId: string) {
  return inspect(root, (db) => ({
    events: db
      .prepare(
        "SELECT record_json FROM core_agent_run_events WHERE session_id = ? AND event_type = 'history_compact_checkpoint_recorded' ORDER BY sequence",
      )
      .all(sessionId),
    projection: db
      .prepare(
        "SELECT event_json FROM core_agent_run_projections WHERE session_id = ? AND event_type = 'history_compact_checkpoint_recorded'",
      )
      .get(sessionId),
  }));
}

for (const { name, sourceRoot, sourcePath } of [
  { name: 'Windows drive', sourceRoot: 'C:\\Users\\Alice\\Maka', sourcePath: win32.join },
  { name: 'Windows UNC', sourceRoot: '\\\\server\\share\\Maka', sourcePath: win32.join },
  {
    name: 'POSIX root containing a backslash',
    sourceRoot: '/old/Maka\\state',
    sourcePath: posix.join,
  },
]) {
  test(`imports ${name} saved paths using the destination separator`, async () => {
    await withFixture(async ({ bundleRoot, targetRoot }) => {
      const source = await seedSession(bundleRoot, 'portable', (id) =>
        sourcePath(sourceRoot, 'tool-results', id, 'output.txt'),
      );
      await importSessionBundleState({
        stateRoot: targetRoot,
        bundleStateRoot: bundleRoot,
        sourceStateRoot: sourceRoot,
      });
      const destination = join(targetRoot, 'tool-results', source.sessionId, 'output.txt');
      const answer = runtimeRows(targetRoot, source.sessionId).find(
        (row) => row.event_id === 'portable-answer',
      );
      assert.ok(answer);
      assert.equal((JSON.parse(answer.payload_json) as RuntimeEvent).content?.kind, 'text');
      assert.equal(
        JSON.parse(answer.payload_json).content.text,
        `The full output is saved to ${destination}; read it with Read.`,
      );
      assert.equal(await readFile(destination, 'utf8'), 'saved bytes for portable');
      assert.deepEqual(checkpointRows(targetRoot, source.sessionId).events, []);
    });
  });
}

test('an actual archive moves same-platform saved paths and invalidates its checkpoint chain', async () => {
  await withFixture(async ({ base, bundleRoot, targetRoot }) => {
    const source = await seedSession(bundleRoot, 'archive', (id) =>
      join(bundleRoot, 'tool-results', id, 'output.txt'),
    );
    const archive = join(base, 'session.maka-session');
    const exported = await exportSessionBundle({
      workspaceRoot: bundleRoot,
      sessionId: source.sessionId,
      destination: archive,
    });
    assert.equal(exported.ok, true);
    const imported = await importSessionBundle({ workspaceRoot: targetRoot, source: archive });
    assert.equal(imported.ok, true);
    const answer = runtimeRows(targetRoot, source.sessionId).find(
      (row) => row.event_id === 'archive-answer',
    );
    assert.ok(answer);
    assert.equal(
      JSON.parse(answer.payload_json).content.text,
      `The full output is saved to ${join(targetRoot, 'tool-results', source.sessionId, 'output.txt')}; read it with Read.`,
    );
    assert.deepEqual(checkpointRows(targetRoot, source.sessionId).events, []);
  });
});

test('a legacy import without a source root preserves paths and checkpoints', async () => {
  await withFixture(async ({ bundleRoot, targetRoot }) => {
    const source = await seedSession(bundleRoot, 'legacy', (id) =>
      join(bundleRoot, 'tool-results', id, 'output.txt'),
    );
    const rows = runtimeRows(bundleRoot, source.sessionId);
    const checkpoints = checkpointRows(bundleRoot, source.sessionId);
    await importSessionBundleState({ stateRoot: targetRoot, bundleStateRoot: bundleRoot });
    assert.deepEqual(runtimeRows(targetRoot, source.sessionId), rows);
    assert.deepEqual(checkpointRows(targetRoot, source.sessionId), checkpoints);
    assert.equal(
      await readFile(join(targetRoot, 'tool-results', source.sessionId, 'output.txt'), 'utf8'),
      'saved bytes for legacy',
    );
  });
});

test('only relocated Sessions lose checkpoints, including summary-only, shell-only and opaque state', async () => {
  await withFixture(async ({ bundleRoot, targetRoot }) => {
    const filePath = (id: string) => join(bundleRoot, 'tool-results', id, 'output.txt');
    const changed = await seedSession(bundleRoot, 'changed', filePath);
    const summary = await seedSession(bundleRoot, 'summary', filePath, { summaryOnly: true });
    // No file lands for this Session: only its checkpoint summary can mark
    // the old root as affected. Copying files must not mask that admission.
    await rm(join(bundleRoot, 'tool-results', summary.sessionId, 'output.txt'));
    const shell = await seedSession(
      bundleRoot,
      'shell',
      (id) => join(bundleRoot, 'tasks', id, 'task.output'),
      { shellOnly: true },
    );
    const opaque = await seedSession(bundleRoot, 'opaque', filePath, {
      untouched: false,
      summaryOnly: true,
      opaque: true,
    });
    const untouched = await seedSession(bundleRoot, 'untouched', filePath, { untouched: true });
    const sources = [changed, summary, shell, opaque, untouched];
    const before = new Map(
      sources.map((source) => [source.sessionId, runtimeRows(bundleRoot, source.sessionId)]),
    );
    const kept = checkpointRows(bundleRoot, untouched.sessionId);
    await importSessionBundleState({
      stateRoot: targetRoot,
      bundleStateRoot: bundleRoot,
      sourceStateRoot: bundleRoot,
    });
    for (const source of sources) {
      const after = runtimeRows(targetRoot, source.sessionId);
      assert.deepEqual(
        after.map(({ event_id, event_seq }) => ({ event_id, event_seq })),
        before.get(source.sessionId)!.map(({ event_id, event_seq }) => ({ event_id, event_seq })),
      );
      if (source !== changed) assert.deepEqual(after, before.get(source.sessionId));
    }
    for (const source of [changed, summary, shell, opaque]) {
      const state = checkpointRows(targetRoot, source.sessionId);
      assert.deepEqual(state.events, [], source.sessionId);
      assert.equal(
        state.projection?.event_json,
        null,
        'an explicit empty projection prevents stale recovery',
      );
    }
    assert.deepEqual(checkpointRows(targetRoot, untouched.sessionId), kept);
    assert.deepEqual(
      inspect(targetRoot, (db) => db.prepare('PRAGMA foreign_key_check').all()),
      [],
    );

    // Cold store + production loader must not resurrect any removed checkpoint.
    let runs = createSqliteAgentRunStore(targetRoot);
    try {
      assert.equal(
        await loadLatestHistoryCompactCheckpointFromRunLedger(runs, changed.sessionId, [
          changed.runId,
        ]),
        undefined,
      );
      assert.equal(
        (
          await loadLatestHistoryCompactCheckpointFromRunLedger(runs, untouched.sessionId, [
            untouched.runId,
          ])
        )?.checkpointId,
        untouched.checkpoint.checkpointId,
      );
    } finally {
      await runs.close?.();
    }

    runs = createSqliteAgentRunStore(targetRoot);
    const runtime = createWorkspaceRuntimeStore(targetRoot);
    try {
      const coordinator = new HistoryCompactCheckpointCoordinator({
        runStore: runs,
        runtimeEventStore: runtime,
      });
      assert.equal(await coordinator.load(changed.sessionId), undefined);
      const events = (await runtime.readRuntimeEvents(changed.sessionId, changed.runId)).filter(
        (event) => changed.events.some((old) => old.id === event.id),
      );
      const replacement = buildHistoryCompactCheckpoint({
        sessionId: changed.sessionId,
        coveredRuntimeEvents: events,
        summary: sectionedSummary('Rebuilt on the importing workspace.'),
        now: 20,
      });
      assert.equal(replacement.coverage.eventCount, changed.checkpoint.coverage.eventCount);
      assert.notEqual(replacement.coverage.sourceDigest, changed.checkpoint.coverage.sourceDigest);
      await coordinator.record(changed.sessionId, replacement, {
        recordHistoryCompactCheckpoint: (checkpoint: HistoryCompactCheckpoint) =>
          appendCheckpoint(runs, changed, checkpoint, 'replacement'),
      } as AgentRun);
      assert.equal(
        (await coordinator.load(changed.sessionId))?.checkpointId,
        replacement.checkpointId,
      );
    } finally {
      runtime.close();
      await runs.close?.();
    }
  });
});

test('a failed path migration rolls back imported history, checkpoints and copied output files', async () => {
  await withFixture(async ({ bundleRoot, targetRoot }) => {
    const source = await seedSession(bundleRoot, 'rollback', (id) =>
      join(bundleRoot, 'tool-results', id, 'output.txt'),
    );
    const kept = await seedSession(targetRoot, 'existing', () => '/unchanged', { untouched: true });
    const before = runtimeRows(targetRoot, kept.sessionId);
    // Hold the ordinary operational owner before adding the fault injector.
    // Import then reuses this already-validated connection rather than
    // rejecting the test-only trigger during a fresh schema inspection.
    const runtime = createWorkspaceRuntimeStore(targetRoot);
    try {
      inspect(targetRoot, (db) =>
        db.exec(`
      CREATE TRIGGER reject_import_path_migration AFTER UPDATE OF payload_json ON runtime_events
      WHEN OLD.event_id = 'rollback-answer'
      BEGIN SELECT RAISE(ABORT, 'deliberate import migration failure'); END;
    `),
      );
      await assert.rejects(
        importSessionBundleState({
          stateRoot: targetRoot,
          bundleStateRoot: bundleRoot,
          sourceStateRoot: bundleRoot,
        }),
        /deliberate import migration failure/u,
      );
      assert.deepEqual(runtimeRows(targetRoot, source.sessionId), []);
      assert.deepEqual(checkpointRows(targetRoot, source.sessionId).events, []);
      assert.equal(checkpointRows(targetRoot, source.sessionId).projection, undefined);
      assert.equal(
        inspect(targetRoot, (db) =>
          db.prepare('SELECT 1 FROM session_metadata WHERE session_id = ?').get(source.sessionId),
        ),
        undefined,
      );
      assert.deepEqual(runtimeRows(targetRoot, kept.sessionId), before);
      await assert.rejects(
        stat(join(targetRoot, 'tool-results', source.sessionId, 'output.txt')),
        /ENOENT/u,
      );
      assert.equal(checkpointRows(bundleRoot, source.sessionId).events.length, 2);
      assert.deepEqual(
        inspect(targetRoot, (db) => db.prepare('PRAGMA foreign_key_check').all()),
        [],
      );
    } finally {
      try {
        inspect(targetRoot, (db) => db.exec('DROP TRIGGER IF EXISTS reject_import_path_migration'));
      } finally {
        runtime.close();
      }
    }
  });
});
