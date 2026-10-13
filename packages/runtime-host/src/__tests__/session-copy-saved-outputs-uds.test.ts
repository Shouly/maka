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
import { lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import type { RuntimeEvent, RuntimeEventFunctionResponseContent } from '@maka/core/runtime-event';
import { shellRunOutputFilePath, taskOutputRoot } from '@maka/runtime/shell-run-output-file';
import { toolResultRoot } from '@maka/runtime/tool-result-file';
import { seedInvocation } from '@maka/runtime/test-only/invocation-fixture';
import { buildHistoryCompactCheckpoint } from '@maka/runtime/history-compact-checkpoint';
import { loadLatestHistoryCompactCheckpointFromRunLedger } from '@maka/runtime/history-compact-ledger';
import { applyRuntimeEventHistoryCompact } from '@maka/runtime/context-budget';
import { openInteractiveArtifactStoreForWrite } from '@maka/storage/artifact-stores';
import { openInteractiveExecutionStoresForWrite } from '@maka/storage/execution-stores';
import { tryAcquireInteractiveRootOwner } from '@maka/storage/root-authority';
import { createSqliteShellRunStore } from '@maka/storage/shell-run-store';
import { parseAttachmentResourceRef } from '@maka/core/attachments';
import { FAKE_WAIT_FOR_STEERING_PROMPT } from '@maka/runtime/test-only/fake-backend';
import {
  connectClient,
  operationError,
  requireStartedTurn,
  waitForRunningTurn,
  waitForTerminalTurn,
  withExecutionRoot,
  type ExecutionFixture,
} from './fixtures/execution-host-suite.js';
import { readLedgerMessages } from './fixtures/ledger-transcript.js';

const BRANCH_ID = 'saved-output-branch';
const REVISION_ID = 'saved-output-revision';
const ROLLBACK_ID = 'saved-output-rollback';

test('branches and revisions retain compacted output, and a failed copy leaves none', {
  skip: process.platform === 'win32' ? 'Windows SQLite shutdown lifecycle' : false,
  timeout: 120_000,
}, async () => {
  await withExecutionRoot(async (fixture) => {
    const stateRoot = fixture.capability.canonicalPath;
    const roots = {
      toolResults: toolResultRoot(stateRoot),
      taskOutputs: taskOutputRoot(stateRoot),
    };
    const source = fixture.sessionId;
    const bash = { path: 'maka://runtime/attachments/bash-1' };
    const later = { path: 'maka://runtime/attachments/bash-2' };
    const summaryOnly = { path: 'maka://runtime/attachments/summary-only' };
    const task = 'maka://runtime/task-outputs/task-1';
    const taskPath = shellRunOutputFilePath(roots.taskOutputs, source, 'task-1');
    await mkdir(dirname(taskPath), { recursive: true });
    await writeFile(taskPath, 'done\n\n[exited with code 0]\n');
    const gone = 'maka://runtime/attachments/gone-1';
    await seedSource(fixture, {
      bash: bash.path,
      later: later.path,
      task,
      gone,
      summaryOnly: summaryOnly.path,
    });

    const host = await fixture.startHost();
    const client = await connectClient(fixture.root);
    try {
      const revision = await sourceRevision(client, source);
      const branch = await client.request('session.branch.create', {
        sourceSessionId: source,
        targetSessionId: BRANCH_ID,
        sourceTurnId: 'turn-1',
        expectedSourceRevision: revision,
      });
      assert.equal(branch.kind, 'committed');
      await writeFile(taskPath, 'new live output\n[running]\n');
      const again = await client.request('session.branch.create', {
        sourceSessionId: BRANCH_ID,
        targetSessionId: 'saved-output-again',
        sourceTurnId: 'turn-1',
        expectedSourceRevision: await sourceRevision(client, BRANCH_ID),
      });
      assert.equal(again.kind, 'committed');
      // Turn 2 names an Artifact that is not there, so its copy fails after
      // the saved outputs were put in place, and is rolled back.
      await assert.rejects(
        client.request('session.branch.create', {
          sourceSessionId: source,
          targetSessionId: ROLLBACK_ID,
          sourceTurnId: 'turn-2',
          expectedSourceRevision: revision,
        }),
        operationError('persistence_failed'),
      );
      const revised = await client.request('session.revision.create', {
        sourceSessionId: source,
        targetSessionId: REVISION_ID,
        sourceTurnId: 'turn-2',
        expectedSourceRevision: await sourceRevision(client, source),
      });
      assert.equal(revised.kind, 'committed');
    } finally {
      await client.close();
      await fixture.stopHost(host);
    }

    let newBash = '';
    let newTask = '';
    let newSummary = '';
    for (const root of [roots.toolResults, roots.taskOutputs]) {
      for (const sessionId of [BRANCH_ID, REVISION_ID, ROLLBACK_ID])
        await assert.rejects(lstat(join(root, sessionId)), /ENOENT/u);
    }
    // Updating the live task after branching must not change its snapshot.
    await writeFile(taskPath, 'later output\n[running]\n');
    const owner = await tryAcquireInteractiveRootOwner(fixture.capability);
    assert.ok(owner);
    if (!owner) return;
    try {
      const stores = await openInteractiveExecutionStoresForWrite(owner.lease);
      const artifacts = await openInteractiveArtifactStoreForWrite(owner.lease);
      const resolvedPath = async (ref: string, sessionId = BRANCH_ID) => {
        const id =
          parseAttachmentResourceRef(ref)?.artifactId ??
          (await artifacts.readTaskOutputSnapshots(sessionId)).get('task-1');
        assert.ok(id, ref);
        const resource = (await artifacts.getInSession(sessionId, id)).record;
        assert.ok(resource);
        return join(stateRoot, 'artifacts', resource.relativePath);
      };
      newBash = await resolvedPath(bash.path);
      newTask = await resolvedPath(task);
      newSummary = await resolvedPath(summaryOnly.path);
      assert.notEqual((await stat(newTask)).ino, (await stat(taskPath)).ino);
      assert.equal(await readFile(newTask, 'utf8'), 'done\n\n[exited with code 0]\n');
      assert.equal(
        await resolvedPath(task, 'saved-output-again'),
        newTask,
        'a second branch inherits the frozen view, not newer live output',
      );
      assert.equal((await artifacts.getInSession(BRANCH_ID, 'bash-2')).record, null);
      assert.equal((await artifacts.getInSession(BRANCH_ID, 'gone-1')).record, null);
      assert.equal((await artifacts.listPage(ROLLBACK_ID, { offset: 0, limit: 100 })).total, 0);
      const runs = await stores.runtimeEventStore.listSessionInvocations(BRANCH_ID);
      const events = (
        await Promise.all(
          runs.map((run) => stores.runtimeEventStore.readRuntimeEvents(BRANCH_ID, run.runId)),
        )
      ).flat();
      const responses = new Map(
        events.flatMap((event) =>
          event.content?.kind === 'function_response'
            ? [[event.content.id, event.content] as const]
            : [],
        ),
      );
      const responseTo = (id: string) => {
        const content = responses.get(id);
        assert.ok(content, id);
        return content;
      };
      const bashResponse = responseTo('bash-call');
      const savedPath = (bashResponse.result as { savedOutput: { ref: string } }).savedOutput.ref;
      assert.equal(savedPath, bash.path);
      assert.equal(await resolvedPath(savedPath), newBash);
      // The locator is resolved separately; the original receipt keeps its spelling.
      assert.deepEqual(bashResponse.modelProjection, {
        version: 1,
        kind: 'text',
        text: `The full output is saved to ${bash.path}; read it with Read.`,
      });
      assert.equal((responseTo('task-call').result as { outputRef: string }).outputRef, task);
      assert.deepEqual(responses.get('mcp-call')?.result, {
        kind: 'json',
        value: { content: [{ type: 'text', text: `saved to ${bash.path};` }] },
        fileRefs: [bash.path],
      });
      // A file already gone when the branch was made is still named where it was.
      assert.equal(
        (responseTo('gone-call').result as { savedOutput: { ref: string } }).savedOutput.ref,
        gone,
      );
      const messages = await readLedgerMessages(stores.runtimeEventStore, BRANCH_ID);
      const result = messages.find(
        (message) => message.type === 'tool_result' && message.toolUseId === 'bash-call',
      );
      assert.equal(
        result?.type === 'tool_result' && result.content.kind === 'terminal'
          ? result.content.savedOutput?.ref
          : undefined,
        bash.path,
      );
      // Branch and revision both carry a usable compacted continuation, including
      // the file named only by the summary. Revision excludes the edited turn.
      for (const sessionId of [BRANCH_ID, REVISION_ID]) {
        const copiedRuns = await stores.runtimeEventStore.listSessionInvocations(sessionId);
        const copiedEvents = (
          await Promise.all(
            copiedRuns.map((run) =>
              stores.runtimeEventStore.readRuntimeEvents(sessionId, run.runId),
            ),
          )
        ).flat();
        const checkpoint = await loadLatestHistoryCompactCheckpointFromRunLedger(
          stores.agentRunStore,
          sessionId,
          copiedRuns.map((run) => run.runId),
        );
        assert.ok(checkpoint);
        const replay = applyRuntimeEventHistoryCompact(copiedEvents, {
          historyCompact: { enabled: true, checkpoint },
        });
        assert.equal(replay.checkpoint, checkpoint, 'the rebuilt prefix is replayable');
        const modelText = replay.events
          .map((event) => (event.content?.kind === 'text' ? event.content.text : ''))
          .join('\n');
        for (const path of [bash.path, summaryOnly.path]) {
          const ownPath = join(roots.toolResults, sessionId, basename(path));
          assert.ok(modelText.includes(path));
          assert.equal(modelText.includes(ownPath), false);
          const snapshot = await resolvedPath(path, sessionId);
          assert.ok((await readFile(snapshot, 'utf8')).length > 0);
          assert.equal(snapshot, await resolvedPath(path), 'identical snapshots share content');
        }
        assert.ok(modelText.includes(gone), 'missing output keeps its old path');
        await assert.rejects(
          lstat(join(roots.toolResults, sessionId, basename(later.path))),
          /ENOENT/u,
        );
      }
      artifacts.close();
      await stores.sessionStore.close?.();
    } finally {
      await owner.close();
    }

    // Delete through the real Host lifecycle: an ordinary branch survives its
    // source's removal. Revisions belong to the source's lifecycle family.
    const workingSessionId = await fixture.seedSession();
    const restarted = await fixture.startHost();
    const remover = await connectClient(fixture.root);
    try {
      const turnId = 'running-during-session-switch';
      requireStartedTurn(
        await remover.request('turn.start', {
          sessionId: workingSessionId,
          turnId,
          content: { text: FAKE_WAIT_FOR_STEERING_PROMPT },
        }),
      );
      await waitForRunningTurn(remover, workingSessionId, turnId);
      const inherited = await shellUpdate(remover, 'saved-output-again');
      assert.deepEqual(inherited.ownership, {
        kind: 'source_owned',
        sourceSessionId: BRANCH_ID,
        ownerSessionId: source,
      });
      // C's immediate parent B, or the more distant A, can disappear. Reading
      // C's copied task status must not drain the Host or stop another Session.
      for (const deleted of [BRANCH_ID, source]) {
        const removed = await remover.request('session.remove', {
          sessionId: deleted,
          expectedRevision: await sourceRevision(remover, deleted),
        });
        assert.equal(removed.kind, 'removed');
        assert.deepEqual((await shellUpdate(remover, 'saved-output-again')).ownership, {
          kind: 'source_unavailable',
          sourceSessionId: BRANCH_ID,
        });
        assert.equal(
          (await remover.request('turn.query', { sessionId: workingSessionId, turnId })).status,
          'running',
        );
        assert.equal(restarted.child.exitCode, null);
      }
      const submitted = await remover.request('turn.message.submit', {
        originHostEpoch: restarted.hostEpoch,
        sessionId: workingSessionId,
        messageId: 'continue-after-switch',
        content: { text: 'Continue after the Session switch.' },
        placement: 'current_turn',
      });
      assert.equal(submitted.disposition, 'steering');
      assert.equal(
        (await waitForTerminalTurn(remover, workingSessionId, turnId)).status,
        'completed',
      );
      requireStartedTurn(
        await remover.request('turn.start', {
          sessionId: 'saved-output-again',
          turnId: 'after-source-deletion',
          content: { text: 'Continue in the surviving branch.' },
        }),
      );
      assert.equal(
        (await waitForTerminalTurn(remover, 'saved-output-again', 'after-source-deletion')).status,
        'completed',
      );
    } finally {
      await remover.close();
      await fixture.stopHost(restarted);
    }
    // The same history must also remain queryable in a fresh Host process.
    const cold = await fixture.startHost();
    const reader = await connectClient(fixture.root);
    try {
      assert.deepEqual((await shellUpdate(reader, 'saved-output-again')).ownership, {
        kind: 'source_unavailable',
        sourceSessionId: BRANCH_ID,
      });
      assert.equal(cold.child.exitCode, null);
    } finally {
      await reader.close();
      await fixture.stopHost(cold);
    }
    await assert.rejects(readFile(taskPath, 'utf8'), /ENOENT/u);
    assert.equal(await readFile(newBash, 'utf8'), 'all of the output');
    assert.equal(await readFile(newTask, 'utf8'), 'done\n\n[exited with code 0]\n');
    assert.equal(await readFile(newSummary, 'utf8'), 'only the summary names this output');
  });
});

for (const order of ['source-first', 'branch-first'] as const) {
  test(`unavailable inherited tasks permit ${order} removal and cold-restarted survivor removal`, {
    skip: process.platform === 'win32' ? 'Windows SQLite shutdown lifecycle' : false,
    timeout: 120_000,
  }, async () => {
    await withExecutionRoot(async (fixture) => {
      await seedRetirementSource(fixture);
      const source = fixture.sessionId;
      const survivor = 'saved-output-again';
      const turnId = 'completed-before-retirement';
      const host = await fixture.startHost();
      const client = await connectClient(fixture.root);
      try {
        await branchFromTurnOne(client, source, BRANCH_ID);
        await branchFromTurnOne(client, BRANCH_ID, survivor);
        for (const sessionId of [BRANCH_ID, survivor]) {
          const update = await shellUpdate(client, sessionId);
          assert.equal(update.ownership.kind, 'source_owned');
          assert.equal(update.result.status, 'completed', 'the source process has already exited');
        }
        const deletedIds = order === 'source-first' ? [source, BRANCH_ID] : [BRANCH_ID, source];
        for (const sessionId of deletedIds) {
          await removeSession(client, sessionId);
          if (order === 'source-first' && sessionId === source) {
            const branch = await shellUpdate(client, BRANCH_ID);
            assert.deepEqual(branch.ownership, {
              kind: 'source_unavailable',
              sourceSessionId: source,
            });
            assert.equal(branch.result.status, 'running');
          }
          const inherited = await shellUpdate(client, survivor);
          assert.deepEqual(inherited.ownership, {
            kind: 'source_unavailable',
            sourceSessionId: BRANCH_ID,
          });
          assert.equal(inherited.result.status, 'running', 'the copied observation is unchanged');
        }
        requireStartedTurn(
          await client.request('turn.start', {
            sessionId: survivor,
            turnId,
            content: { text: 'Continue in the surviving branch before removing it.' },
          }),
        );
        assert.equal((await waitForTerminalTurn(client, survivor, turnId)).status, 'completed');
        assert.equal((await shellUpdate(client, survivor)).result.status, 'running');
        assert.equal(host.child.exitCode, null);
      } finally {
        await client.close();
        await fixture.stopHost(host);
      }

      const cold = await fixture.startHost();
      const reader = await connectClient(fixture.root);
      try {
        assert.equal(
          (await reader.request('turn.query', { sessionId: survivor, turnId })).status,
          'completed',
        );
        const historical = await shellUpdate(reader, survivor);
        assert.deepEqual(historical.ownership, {
          kind: 'source_unavailable',
          sourceSessionId: BRANCH_ID,
        });
        assert.equal(historical.result.status, 'running');
        await removeSession(reader, survivor);
        assert.equal(cold.child.exitCode, null);
      } finally {
        await reader.close();
        await fixture.stopHost(cold);
      }
    });
  });
}

test('unavailable history permits archive, but a live local task still blocks archive and removal', {
  skip: process.platform === 'win32' ? 'POSIX shell and Windows SQLite shutdown lifecycle' : false,
  timeout: 120_000,
}, async () => {
  await withExecutionRoot(async (fixture) => {
    await seedRetirementSource(fixture);
    const host = await fixture.startHost();
    const client = await connectClient(fixture.root);
    try {
      await branchFromTurnOne(client, fixture.sessionId, BRANCH_ID);
      await removeSession(client, fixture.sessionId);
      const historical = await shellUpdate(client, BRANCH_ID);
      assert.equal(historical.ownership.kind, 'source_unavailable');
      assert.equal(historical.result.status, 'running');

      const started = await client.request('runtime.resource.start', {
        sessionId: BRANCH_ID,
        launchId: 'live-during-retirement',
        command: 'sleep 60',
      });
      assert.equal(started.resource.status, 'running');
      try {
        const live = await client.request('runtime.resource.query', {
          kind: 'get',
          sessionId: BRANCH_ID,
          ref: started.resource.ref,
        });
        assert.ok(live.kind === 'resource' && live.resource);
        assert.equal(live.resource.ownership.kind, 'local');
        const busy = {
          code: 'session_busy',
          message: `Session ${BRANCH_ID} has a live Runtime Resource`,
        };
        await assert.rejects(
          client.request('session.lifecycle.set', { sessionId: BRANCH_ID, state: 'archived' }),
          busy,
        );
        await assert.rejects(
          client.request('session.remove', {
            sessionId: BRANCH_ID,
            expectedRevision: await sourceRevision(client, BRANCH_ID),
          }),
          busy,
        );
      } finally {
        const stopped = await client.request('runtime.resource.stop', {
          sessionId: BRANCH_ID,
          ref: started.resource.ref,
        });
        assert.equal(stopped.resource.status, 'cancelled');
      }
      const archived = await client.request('session.lifecycle.set', {
        sessionId: BRANCH_ID,
        state: 'archived',
      });
      assert.ok(!('kind' in archived));
      assert.equal(archived.isArchived, true);
      const stillHistorical = await client.request('runtime.resource.query', {
        kind: 'get',
        sessionId: BRANCH_ID,
        ref: historical.result.ref,
      });
      assert.ok(stillHistorical.kind === 'resource');
      assert.deepEqual(stillHistorical.resource, historical, 'archiving does not complete history');
      await removeSession(client, BRANCH_ID);
      assert.equal(host.child.exitCode, null);
    } finally {
      await client.close();
      await fixture.stopHost(host);
    }
  });
});

async function seedRetirementSource(fixture: ExecutionFixture): Promise<void> {
  const taskPath = shellRunOutputFilePath(
    taskOutputRoot(fixture.capability.canonicalPath),
    fixture.sessionId,
    'task-1',
  );
  await mkdir(dirname(taskPath), { recursive: true });
  await writeFile(taskPath, 'done\n\n[exited with code 0]\n');
  await seedSource(fixture, {
    bash: 'maka://runtime/attachments/bash-1',
    later: 'maka://runtime/attachments/bash-2',
    task: 'maka://runtime/task-outputs/task-1',
    gone: 'maka://runtime/attachments/gone-1',
    summaryOnly: 'maka://runtime/attachments/summary-only',
  });
}

async function branchFromTurnOne(
  client: Awaited<ReturnType<typeof connectClient>>,
  sourceSessionId: string,
  targetSessionId: string,
): Promise<void> {
  const branched = await client.request('session.branch.create', {
    sourceSessionId,
    targetSessionId,
    sourceTurnId: 'turn-1',
    expectedSourceRevision: await sourceRevision(client, sourceSessionId),
  });
  assert.equal(branched.kind, 'committed');
}

async function removeSession(
  client: Awaited<ReturnType<typeof connectClient>>,
  sessionId: string,
): Promise<void> {
  assert.deepEqual(
    await client.request('session.remove', {
      sessionId,
      expectedRevision: await sourceRevision(client, sessionId),
    }),
    { kind: 'removed', sessionId },
  );
  assert.deepEqual(await client.request('session.catalog.query', { kind: 'get', sessionId }), {
    kind: 'session',
    session: null,
  });
}

async function shellUpdate(client: Awaited<ReturnType<typeof connectClient>>, sessionId: string) {
  const page = await client.request('runtime.resource.query', { kind: 'list_start', sessionId });
  assert.equal(page.kind, 'page');
  if (page.kind !== 'page') assert.fail('Expected shell resource page');
  assert.equal(page.resources.length, 1);
  const update = page.resources[0]!;
  const point = await client.request('runtime.resource.query', {
    kind: 'get',
    sessionId,
    ref: update.result.ref,
  });
  assert.equal(point.kind, 'resource');
  if (point.kind !== 'resource') assert.fail('Expected shell resource point read');
  assert.deepEqual(point.resource, update);
  return update;
}

async function sourceRevision(
  client: Awaited<ReturnType<typeof connectClient>>,
  sessionId: string,
): Promise<number> {
  const result = await client.request('session.catalog.query', { kind: 'get', sessionId });
  if (result.kind !== 'session' || !result.session || 'kind' in result.session) {
    assert.fail('Source Session must be in the catalog');
  }
  return result.session.revision;
}

async function seedSource(
  fixture: ExecutionFixture,
  paths: { bash: string; later: string; task: string; gone: string; summaryOnly: string },
): Promise<void> {
  const owner = await tryAcquireInteractiveRootOwner(fixture.capability);
  assert.ok(owner);
  if (!owner) throw new Error('Unable to acquire the root to seed the source');
  try {
    const stores = await openInteractiveExecutionStoresForWrite(owner.lease);
    const sessionId = fixture.sessionId;
    const artifacts = await openInteractiveArtifactStoreForWrite(owner.lease);
    try {
      for (const [id, turnId, content] of [
        ['bash-1', 'turn-1', 'all of the output'],
        ['bash-2', 'turn-2', 'the second output'],
        ['summary-only', 'turn-1', 'only the summary names this output'],
      ])
        await artifacts.create({
          id: id!,
          sessionId,
          turnId: turnId!,
          name: `${id}.txt`,
          kind: 'file',
          source: 'saved_tool_output',
          content: content!,
        });
    } finally {
      artifacts.close();
    }
    const shellRuns = createSqliteShellRunStore(fixture.capability.canonicalPath);
    try {
      await shellRuns.createShellRun({
        shellRunId: 'task-1',
        sessionId,
        sourceTurnId: 'turn-1',
        sourceToolCallId: 'task-call',
        cwd: fixture.root,
        command: 'sleep 1',
        status: 'completed',
        background: true,
        exitCode: 0,
        startedAt: 1,
        updatedAt: 2,
        completedAt: 2,
        notifiedAt: 3,
        revision: 1,
        outputFile: shellRunOutputFilePath(
          taskOutputRoot(fixture.capability.canonicalPath),
          sessionId,
          'task-1',
        ),
        output: {
          mode: 'pipes',
          stdout: 'done',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          redacted: false,
        },
      });
    } finally {
      shellRuns.close();
    }
    const pipes = {
      mode: 'pipes' as const,
      stdout: 'all of',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      redacted: false,
    };
    const terminal = (cmd: string, path: string) => ({
      kind: 'terminal',
      cwd: fixture.root,
      cmd,
      status: 'completed',
      exitCode: 0,
      output: pipes,
      savedOutput: { ref: path, chars: 17, truncated: false },
    });
    const turns: Array<{ turn: string; events: Array<Partial<RuntimeEvent>> }> = [
      {
        turn: 'turn-1',
        events: [
          text('user-1', 'user', 'run it'),
          ...tool('bash-call', 'Bash', terminal('make', paths.bash), {
            version: 1,
            kind: 'text',
            text: `The full output is saved to ${paths.bash}; read it with Read.`,
          }),
          ...tool(
            'mcp-call',
            'mcp__srv__fetch',
            {
              kind: 'json',
              value: { content: [{ type: 'text', text: `saved to ${paths.bash};` }] },
              fileRefs: [paths.bash],
            },
            { version: 1, kind: 'text', text: `saved to ${paths.bash};` },
          ),
          ...tool(
            'task-call',
            'Bash',
            {
              kind: 'shell_run',
              ref: 'maka://runtime/background-tasks/task-1',
              mode: 'pipes',
              status: 'running',
              cwd: fixture.root,
              cmd: 'sleep 1',
              startedAt: 1,
              updatedAt: 1,
              revision: 1,
              outputRef: paths.task,
            },
            { version: 1, kind: 'text', text: `Output is being written to: ${paths.task}.` },
          ),
          ...tool('gone-call', 'Bash', terminal('make again', paths.gone), {
            version: 1,
            kind: 'text',
            text: `saved to ${paths.gone}`,
          }),
          { id: 'terminal-1', status: 'completed' },
        ],
      },
      {
        turn: 'turn-2',
        events: [
          text('user-2', 'user', 'and again'),
          ...tool('later-call', 'Bash', terminal('make later', paths.later), {
            version: 1,
            kind: 'text',
            text: `saved to ${paths.later}`,
          }),
          ...tool('image-call', 'Read', {
            kind: 'image',
            mimeType: 'image/png',
            ref: { kind: 'session_file', sessionId, relativePath: 'missing-artifact' },
          }),
          { id: 'terminal-2', status: 'completed' },
        ],
      },
    ];
    let ts = 1;
    for (const { turn, events } of turns) {
      const run = {
        sessionId,
        runId: `run-${turn}`,
        invocationId: `invocation-${turn}`,
        turnId: turn,
        openedAt: ts,
        opening: {
          route: {
            provenance: 'runtime' as const,
            backendKind: 'fake' as const,
            llmConnectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            llmConnectionSlug: 'fake',
            modelId: 'fake-model',
          },
          configuration: {
            cwd: fixture.root,
            permissionMode: 'ask' as const,
            collaborationMode: 'agent' as const,
            orchestrationMode: 'default' as const,
            orchestrationSource: 'session' as const,
            toolMode: 'direct' as const,
          },
        },
      };
      await seedInvocation(stores.runtimeEventStore, run);
      for (const overrides of events) {
        ts += 1;
        await stores.runtimeEventStore.appendRuntimeEvent(sessionId, run.runId, {
          invocationId: run.invocationId,
          runId: run.runId,
          sessionId,
          turnId: turn,
          ts,
          partial: false,
          role: 'system',
          author: 'system',
          ...overrides,
          id: `event-${turn}-${overrides.id}`,
        } as RuntimeEvent);
      }
    }
    const checkpoint = buildHistoryCompactCheckpoint({
      sessionId,
      coveredRuntimeEvents: (
        await stores.runtimeEventStore.readRuntimeEvents(sessionId, 'run-turn-1')
      ).filter(
        (event) =>
          event.content?.kind === 'text' ||
          event.content?.kind === 'function_call' ||
          event.content?.kind === 'function_response',
      ),
      summary: `## Goal\nRead ${paths.bash} and ${paths.summaryOnly}.\n\n## Progress\n- done\n\n## Next Steps\n1. continue\n\n## Critical Context\n- Missing output: ${paths.gone}`,
      highWaterName: 'saved-output-copy',
      highWaterSeq: 1,
      now: ts + 1,
    });
    await stores.agentRunStore.appendEvent(sessionId, 'run-turn-1', {
      type: 'history_compact_checkpoint_recorded',
      id: 'saved-output-checkpoint',
      sessionId,
      runId: 'run-turn-1',
      turnId: 'turn-1',
      ts: ts + 1,
      data: { checkpoint },
    });
    await stores.sessionStore.close?.();
  } finally {
    await owner.close();
  }
}

function text(id: string, role: 'user', value: string): Partial<RuntimeEvent> {
  return { id, role, author: 'user', content: { kind: 'text', text: value } };
}

function tool(
  id: string,
  name: string,
  result: unknown,
  modelProjection?: RuntimeEventFunctionResponseContent['modelProjection'],
): Array<Partial<RuntimeEvent>> {
  return [
    {
      id: `${id}-call`,
      role: 'model',
      author: 'agent',
      content: { kind: 'function_call', id, name, args: {} },
    },
    {
      id: `${id}-response`,
      role: 'tool',
      author: 'tool',
      content: {
        kind: 'function_response',
        id,
        name,
        result,
        ...(modelProjection ? { modelProjection } : {}),
      },
    },
  ];
}
