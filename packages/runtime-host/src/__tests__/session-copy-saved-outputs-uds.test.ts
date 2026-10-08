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
import {
  saveToolResultText,
  toolResultFilePath,
  toolResultRoot,
} from '@maka/runtime/tool-result-file';
import { seedInvocation } from '@maka/runtime/test-only/invocation-fixture';
import { buildHistoryCompactCheckpoint } from '@maka/runtime/history-compact-checkpoint';
import { loadLatestHistoryCompactCheckpointFromRunLedger } from '@maka/runtime/history-compact-ledger';
import { applyRuntimeEventHistoryCompact } from '@maka/runtime/context-budget';
import { openInteractiveExecutionStoresForWrite } from '@maka/storage/execution-stores';
import { tryAcquireInteractiveRootOwner } from '@maka/storage/root-authority';
import {
  connectClient,
  operationError,
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
    const bash = await saveToolResultText(
      toolResultFilePath(roots.toolResults, source, 'bash-1'),
      'all of the output',
    );
    const later = await saveToolResultText(
      toolResultFilePath(roots.toolResults, source, 'bash-2'),
      'the second output',
    );
    const summaryOnly = await saveToolResultText(
      toolResultFilePath(roots.toolResults, source, 'summary-only'),
      'only the summary names this output',
    );
    const task = shellRunOutputFilePath(roots.taskOutputs, source, 'task-1');
    await mkdir(dirname(task), { recursive: true });
    await writeFile(task, 'done\n\n[exited with code 0]\n');
    const gone = toolResultFilePath(roots.toolResults, source, 'gone-1');
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

    const copied = (path: string, root: string) => join(root, BRANCH_ID, basename(path));
    const newBash = copied(bash.path, roots.toolResults);
    const newTask = copied(task, roots.taskOutputs);
    // One file under two names, private to the user.
    assert.equal((await stat(newBash)).ino, (await stat(bash.path)).ino);
    assert.equal((await stat(newTask)).ino, (await stat(task)).ino);
    assert.equal((await stat(dirname(newBash))).mode & 0o777, 0o700);
    // The failed copy's folders went with it; the source and the branch kept theirs.
    for (const root of [roots.toolResults, roots.taskOutputs]) {
      await assert.rejects(lstat(join(root, ROLLBACK_ID)), /ENOENT/u);
    }
    assert.equal(await readFile(later.path, 'utf8'), 'the second output');

    const owner = await tryAcquireInteractiveRootOwner(fixture.capability);
    assert.ok(owner);
    if (!owner) return;
    try {
      const stores = await openInteractiveExecutionStoresForWrite(owner.lease);
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
      const savedPath = (bashResponse.result as { savedOutput: { path: string } }).savedOutput.path;
      assert.equal(savedPath, newBash);
      // The reveal is offered for a file in the asking Session's own folder.
      assert.equal(basename(dirname(savedPath)), BRANCH_ID);
      assert.deepEqual(bashResponse.modelProjection, {
        version: 1,
        kind: 'text',
        text: `The full output is saved to ${newBash}; read it with Read.`,
      });
      assert.equal((responseTo('task-call').result as { outputFile: string }).outputFile, newTask);
      assert.deepEqual(responses.get('mcp-call')?.result, {
        kind: 'json',
        value: { content: [{ type: 'text', text: `saved to ${newBash};` }] },
      });
      // A file already gone when the branch was made is still named where it was.
      assert.equal(
        (responseTo('gone-call').result as { savedOutput: { path: string } }).savedOutput.path,
        gone,
      );
      const messages = await readLedgerMessages(stores.runtimeEventStore, BRANCH_ID);
      const result = messages.find(
        (message) => message.type === 'tool_result' && message.toolUseId === 'bash-call',
      );
      assert.equal(
        result?.type === 'tool_result' && result.content.kind === 'terminal'
          ? result.content.savedOutput?.path
          : undefined,
        newBash,
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
          assert.ok(modelText.includes(ownPath));
          assert.equal(modelText.includes(path), false);
          assert.ok((await readFile(ownPath, 'utf8')).length > 0);
        }
        assert.ok(modelText.includes(gone), 'missing output keeps its old path');
        await assert.rejects(
          lstat(join(roots.toolResults, sessionId, basename(later.path))),
          /ENOENT/u,
        );
      }
      await stores.sessionStore.close?.();
    } finally {
      await owner.close();
    }

    // Delete through the real Host lifecycle: an ordinary branch survives its
    // source's removal. Revisions belong to the source's lifecycle family.
    const restarted = await fixture.startHost();
    const remover = await connectClient(fixture.root);
    try {
      const removed = await remover.request('session.remove', {
        sessionId: source,
        expectedRevision: await sourceRevision(remover, source),
      });
      assert.equal(removed.kind, 'removed');
      assert.ok(await sourceRevision(remover, BRANCH_ID));
    } finally {
      await remover.close();
      await fixture.stopHost(restarted);
    }
    await assert.rejects(readFile(bash.path, 'utf8'), /ENOENT/u);
    assert.equal(await readFile(newBash, 'utf8'), 'all of the output');
    assert.equal(await readFile(newTask, 'utf8'), 'done\n\n[exited with code 0]\n');
    assert.equal(
      await readFile(copied(summaryOnly.path, roots.toolResults), 'utf8'),
      'only the summary names this output',
    );
  });
});

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
      savedOutput: { path, chars: 17, truncated: false },
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
              outputFile: paths.task,
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
