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
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RuntimeEvent } from '@maka/core/runtime-event';
import { decodeCanonicalToolResultContent } from '@maka/core/tool-result-record-schema';
import { renderChildAgentNotification } from '@maka/runtime/injection';
import { buildSubagentSpawnTool, startedChildAgentText } from '@maka/runtime/subagent-tools';
import { buildSendUserFileTool, sendUserFileModelText } from '@maka/runtime/send-user-file-tool';
import { seedInvocation } from '@maka/runtime/test-only/invocation-fixture';
import { openInteractiveExecutionStoresForWrite } from '@maka/storage/execution-stores';
import { openInteractiveArtifactStoreForWrite } from '@maka/storage/artifact-stores';
import { buildHistoryCompactCheckpoint } from '@maka/runtime/history-compact-checkpoint';
import { tryAcquireInteractiveRootOwner } from '@maka/storage/root-authority';
import {
  connectClient,
  withExecutionRoot,
  type ExecutionFixture,
} from './fixtures/execution-host-suite.js';
import { readLedgerMessages } from './fixtures/ledger-transcript.js';
import { createHostExecutionArtifactServices } from '../server/execution-artifacts.js';
import { SessionAdmissionGate } from '../server/session-admission-gate.js';

const BRANCH = 'async-agent-branch';
const REVISION = 'async-agent-revision';
const SIDE = 'async-agent-side';
const REPORT = 'async-agent-report';
const REPORT_BYTES = 'The delivered report file.';
const DELIVERED_FILES = [
  { path: 'outside/report.md', bytes: Buffer.from('OUTER') },
  { path: 'inside/report.md', bytes: Buffer.from('INNER') },
  { path: '中文 附件.json', bytes: Buffer.from('{"测试":true}') },
  { path: 'payload.bin', bytes: Buffer.from([0, 255, 128, 13, 10]) },
  { path: 'empty.txt', bytes: Buffer.alloc(0) },
];

test('Agent and delivered file cards survive branch, edit resend and side conversation through the Host', {
  skip: process.platform === 'win32' ? 'Windows SQLite shutdown lifecycle' : false,
  timeout: 120_000,
}, async () => {
  await withExecutionRoot(async (fixture) => {
    const deliveryCards = new Map<string, readonly string[]>();
    const childId = await seedAsyncAgent(fixture);
    const host = await fixture.startHost();
    const client = await connectClient(fixture.root);
    try {
      for (const [operation, targetSessionId, intent] of [
        ['session.branch.create', BRANCH, undefined],
        ['session.revision.create', REVISION, undefined],
        ['session.branch.create', SIDE, 'side_conversation'],
      ] as const) {
        const input = {
          sourceSessionId: fixture.sessionId,
          targetSessionId,
          sourceTurnId: 'after-agent',
          expectedSourceRevision: await revisionOf(client, fixture.sessionId),
          ...(intent ? { intent } : {}),
        };
        assert.equal((await client.request(operation, input)).kind, 'committed');
        assert.equal((await client.request(operation, input)).kind, 'committed', 'retry is exact');
      }
    } finally {
      await client.close();
      await fixture.stopHost(host);
    }

    const owner = await tryAcquireInteractiveRootOwner(fixture.capability);
    assert.ok(owner);
    try {
      const stores = await openInteractiveExecutionStoresForWrite(owner.lease);
      const artifacts = await openInteractiveArtifactStoreForWrite(owner.lease);
      for (const sessionId of [fixture.sessionId, BRANCH, REVISION, SIDE]) {
        const messages = await readLedgerMessages(stores.runtimeEventStore, sessionId);
        const message = messages.find(
          (entry) => entry.type === 'tool_result' && entry.toolUseId === 'agent-call',
        );
        assert.ok(message?.type === 'tool_result' && message.content.kind === 'subagent');
        assert.equal(message.content.status, 'running', 'the historical launch receipt is intact');
        const snapshot = sessionId === BRANCH || sessionId === SIDE;
        assert.equal(message.content.childSessionId, snapshot ? undefined : childId);
        assert.equal(message.content.runId, snapshot ? undefined : 'child-run');
        assert.ok(
          messages.some((entry) => entry.type === 'assistant' && entry.text === 'Agent finished.'),
        );
        assert.ok(
          messages.some(
            (entry) =>
              entry.type === 'user' && entry.text.includes('The delegated report is complete.'),
          ),
        );
        const delivery = messages.find(
          (entry) => entry.type === 'tool_result' && entry.toolUseId === 'delivery-call',
        );
        assert.ok(
          delivery?.type === 'tool_result' && delivery.content.kind === 'user_file_delivery',
        );
        assert.equal(delivery.content.files.length, DELIVERED_FILES.length);
        deliveryCards.set(
          sessionId,
          delivery.content.files.map((file) => file.artifactId),
        );
        for (const [index, file] of delivery.content.files.entries()) {
          const read = await artifacts.readChunkInSession(sessionId, file.artifactId, {
            offset: 0,
            maxBytes: 100,
          });
          assert.ok(read.ok, `delivery card ${file.name} must resolve in ${sessionId}`);
          assert.deepEqual(Buffer.from(read.bytes), DELIVERED_FILES[index]!.bytes);
        }
        let receipts = 0;
        for (const invocation of await stores.runtimeEventStore.listSessionInvocations(sessionId)) {
          for (const event of await stores.runtimeEventStore.readRuntimeEvents(
            sessionId,
            invocation.invocationId,
          )) {
            if (event.content?.kind !== 'function_response' || event.content.id !== 'delivery-call')
              continue;
            receipts += 1;
            assert.deepEqual(event.content.modelProjection, {
              version: 1,
              kind: 'text',
              text: sendUserFileModelText(delivery.content),
            });
          }
        }
        assert.equal(receipts, 1, 'the model receipt is checked as well as the delivery card');
        assert.equal(
          messages.some((entry) => entry.turnId === 'after-agent'),
          sessionId !== REVISION,
          'edit resend excludes the edited turn',
        );
        const notification = messages.find(
          (entry) => entry.type === 'user' && entry.text.includes('<artifacts>'),
        );
        assert.ok(notification?.type === 'user');
        if (snapshot) {
          const page = await artifacts.listPage(sessionId, { offset: 0, limit: 10 });
          assert.equal(
            page.total,
            6,
            'the five deliveries and only the notified child file are copied',
          );
          const copiedId = page.records.find((record) => record.name === `${REPORT}.txt`)!.id;
          assert.notEqual(copiedId, REPORT);
          assert.ok(notification.text.includes(`<artifacts>${copiedId}</artifacts>`));
          assert.deepEqual(await artifacts.readTextInSession(sessionId, copiedId), {
            ok: true,
            text: REPORT_BYTES,
          });
          const checkpoint = await stores.agentRunStore.readEventProjection?.(
            sessionId,
            'history_compact_checkpoint_recorded',
          );
          assert.equal(
            checkpoint,
            undefined,
            'a summary naming the old Artifact is rebuilt from raw history',
          );
        } else {
          assert.ok(notification.text.includes(`<artifacts>${REPORT}</artifacts>`));
          assert.equal(
            Boolean(
              await stores.agentRunStore.readEventProjection?.(
                sessionId,
                'history_compact_checkpoint_recorded',
              ),
            ),
            sessionId === fixture.sessionId,
            'source keeps its summary; the revision rebuilds it after delivery ids change',
          );
        }
      }
      const headers = await stores.sessionStore.listHeaders();
      assert.deepEqual(
        headers.filter((header) => header.subagentParent).map((header) => header.id),
        [childId],
        'copying history does not create or transfer child ownership',
      );
      assert.equal(
        (await stores.sessionStore.readHeaderSnapshot(childId)).subagentParent?.parentSessionId,
        fixture.sessionId,
      );
      await stores.sessionStore.close?.();
    } finally {
      await owner.close();
    }

    // Independent copies still work after source-family and child retirement.
    const restarted = await fixture.startHost();
    const remover = await connectClient(fixture.root);
    try {
      assert.equal(
        (
          await remover.request('session.remove', {
            sessionId: fixture.sessionId,
            expectedRevision: await revisionOf(remover, fixture.sessionId),
          })
        ).kind,
        'removed',
      );
      const child = await remover.request('session.catalog.query', {
        kind: 'get',
        sessionId: childId,
      });
      // Removing a parent archives ordinary children. Retire the archived
      // child too, so the copies cannot accidentally rely on its records.
      assert.ok(child.kind === 'session' && child.session && !('kind' in child.session));
      assert.equal(child.session.isArchived, true);
      assert.equal(
        (
          await remover.request('session.remove', {
            sessionId: childId,
            expectedRevision: child.session.revision,
          })
        ).kind,
        'removed',
      );
      for (const sourceSessionId of [BRANCH, SIDE]) {
        for (const [index, artifactId] of deliveryCards.get(sourceSessionId)!.entries()) {
          const read = await remover.request('artifact.query', {
            kind: 'read_chunk',
            sessionId: sourceSessionId,
            artifactId,
            offset: 0,
          });
          assert.ok(read.kind === 'chunk');
          assert.deepEqual(Buffer.from(read.chunkBase64, 'base64'), DELIVERED_FILES[index]!.bytes);
        }
        assert.equal(
          (
            await remover.request('session.branch.create', {
              sourceSessionId,
              targetSessionId: `${sourceSessionId}-again`,
              sourceTurnId: 'after-agent',
              expectedSourceRevision: await revisionOf(remover, sourceSessionId),
            })
          ).kind,
          'committed',
        );
        for (const sessionId of [sourceSessionId, `${sourceSessionId}-again`]) {
          const page = await remover.request('artifact.query', { kind: 'list_start', sessionId });
          assert.ok(page.kind === 'page');
          assert.equal(page.artifacts.length, 6);
          const read = await remover.request('artifact.query', {
            kind: 'read_chunk',
            sessionId,
            artifactId: page.artifacts.find((record) => record.name === `${REPORT}.txt`)!.id,
            offset: 0,
          });
          assert.ok(read.kind === 'chunk');
          assert.equal(Buffer.from(read.chunkBase64, 'base64').toString(), REPORT_BYTES);
        }
      }
    } finally {
      await remover.close();
      await fixture.stopHost(restarted);
    }
  });
});

async function revisionOf(client: Awaited<ReturnType<typeof connectClient>>, sessionId: string) {
  const result = await client.request('session.catalog.query', { kind: 'get', sessionId });
  assert.ok(result.kind === 'session' && result.session && !('kind' in result.session));
  return result.session.revision;
}

async function seedAsyncAgent(fixture: ExecutionFixture): Promise<string> {
  const owner = await tryAcquireInteractiveRootOwner(fixture.capability);
  assert.ok(owner);
  try {
    const stores = await openInteractiveExecutionStoresForWrite(owner.lease);
    const source = await stores.sessionStore.readHeaderSnapshot(fixture.sessionId);
    const child = await stores.sessionStore.createSubagent({
      cwd: fixture.root,
      llmConnectionId: source.llmConnectionId,
      llmConnectionSlug: source.llmConnectionSlug,
      model: source.model,
      permissionMode: 'ask',
      subagentParent: {
        kind: 'subagent',
        parentSessionId: fixture.sessionId,
        spawnedBy: {
          parentRunId: 'agent-run',
          parentTurnId: 'agent-turn',
          toolCallId: 'agent-call',
        },
        lifecycle: 'foreground',
      },
      subagentRuntime: {
        schemaVersion: 2,
        definitionVersion: 1,
        agentId: 'worker',
        agentName: 'Worker',
        profile: 'default',
        systemPrompt: 'Finish the delegated task.',
      },
      subagentSpawn: {
        schemaVersion: 1,
        requestFingerprint: 'a'.repeat(64),
        initialTurnId: 'child-turn',
        initialRunId: 'child-run',
      },
    });
    const childId = child.header.id;
    const artifacts = await openInteractiveArtifactStoreForWrite(owner.lease);
    const files = await Promise.all(
      DELIVERED_FILES.map(async ({ path, bytes }) => {
        const target = join(fixture.root, 'delivery', path);
        await mkdir(join(target, '..'), { recursive: true });
        await writeFile(target, bytes);
        return target;
      }),
    );
    const deliveryServices = createHostExecutionArtifactServices({
      artifacts,
      sessionAdmission: new SessionAdmissionGate(),
      sessions: { probeSessionRemoval: async () => ({ kind: 'present' }) },
      requestDrain: () => assert.fail('delivery setup must not drain the Host'),
    });
    const delivery = await buildSendUserFileTool().impl(
      { files, status: 'normal' },
      {
        sessionId: fixture.sessionId,
        turnId: 'agent-turn',
        cwd: fixture.root,
        toolCallId: 'delivery-call',
        abortSignal: new AbortController().signal,
        emitOutput() {},
        recordArtifacts: (candidates) =>
          deliveryServices.recordToolArtifacts({
            sessionId: fixture.sessionId,
            turnId: 'agent-turn',
            toolUseId: 'delivery-call',
            toolName: 'SendUserFile',
            cwd: fixture.root,
            args: { files, status: 'normal' },
            result: undefined,
            candidates: [...candidates],
          }),
      },
    );
    for (const id of [REPORT, 'unnotified-report']) {
      await artifacts.create({
        id,
        sessionId: childId,
        turnId: 'child-turn',
        name: `${id}.txt`,
        kind: 'file',
        content: REPORT_BYTES,
        mimeType: 'text/plain',
        source: 'tool_result',
        now: 1,
      });
    }
    // Exercise the producer that intentionally persists running, not the old
    // hand-authored completed result that missed the asynchronous lifecycle.
    const result = decodeCanonicalToolResultContent(
      await buildSubagentSpawnTool().impl(
        {
          description: 'Finish delegated task',
          prompt: 'Finish the delegated task.',
        },
        {
          sessionId: fixture.sessionId,
          turnId: 'agent-turn',
          cwd: fixture.root,
          toolCallId: 'agent-call',
          abortSignal: new AbortController().signal,
          emitOutput() {},
          spawnChildSession: async () => ({
            childSessionId: childId,
            agentId: 'worker',
            agentName: 'Worker',
            turnId: 'child-turn',
            runId: 'child-run',
            permissionMode: 'ask',
          }),
        },
      ),
    );
    assert.ok(result.kind === 'subagent' && result.status === 'running');
    const appendRun = async (
      sessionId: string,
      runId: string,
      turnId: string,
      events: Array<Partial<RuntimeEvent>>,
    ) => {
      await seedInvocation(stores.runtimeEventStore, { sessionId, runId, turnId, openedAt: 1 });
      for (const [index, event] of events.entries()) {
        await stores.runtimeEventStore.appendRuntimeEvent(sessionId, runId, {
          id: `${runId}-${index}`,
          sessionId,
          runId,
          invocationId: runId,
          turnId,
          ts: index + 2,
          role: 'system',
          author: 'system',
          partial: false,
          ...event,
        });
      }
    };
    const user = (text: string): Partial<RuntimeEvent> => ({
      role: 'user',
      author: 'user',
      content: { kind: 'text', text },
    });
    const end: Partial<RuntimeEvent> = { status: 'completed', actions: { endInvocation: true } };
    await appendRun(childId, 'child-run', 'child-turn', [user('Do the work'), end]);
    await appendRun(fixture.sessionId, 'agent-run', 'agent-turn', [
      user('Delegate this'),
      {
        role: 'model',
        author: 'agent',
        content: {
          kind: 'function_call',
          id: 'delivery-call',
          name: 'SendUserFile',
          args: { files, status: 'normal' },
        },
      },
      {
        role: 'tool',
        author: 'tool',
        content: {
          kind: 'function_response',
          id: 'delivery-call',
          name: 'SendUserFile',
          result: delivery,
          isError: false,
          modelProjection: { version: 1, kind: 'text', text: sendUserFileModelText(delivery) },
        },
      },
      {
        role: 'model',
        author: 'agent',
        content: {
          kind: 'function_call',
          id: 'agent-call',
          name: 'Agent',
          args: { description: 'Finish delegated task', prompt: 'Finish the delegated task.' },
        },
      },
      {
        role: 'tool',
        author: 'tool',
        content: {
          kind: 'function_response',
          id: 'agent-call',
          name: 'Agent',
          result,
          isError: false,
          modelProjection: { version: 1, kind: 'text', text: startedChildAgentText(childId) },
        },
      },
      {
        role: 'user',
        author: 'system',
        content: {
          kind: 'text',
          steering: true,
          origin: { kind: 'background_task', ref: childId, toolUseId: 'agent-call' },
          text: renderChildAgentNotification({
            id: childId,
            toolUseId: 'agent-call',
            status: 'completed',
            name: 'Finish delegated task',
            result: 'The delegated report is complete.',
            artifactIds: [REPORT],
          }),
        },
      },
      { role: 'model', author: 'agent', content: { kind: 'text', text: 'Agent finished.' } },
      end,
    ]);
    await appendRun(fixture.sessionId, 'after-run', 'after-agent', [
      user('Edit this later message'),
      end,
    ]);
    const events = await stores.runtimeEventStore.readRuntimeEvents(fixture.sessionId, 'agent-run');
    const checkpoint = buildHistoryCompactCheckpoint({
      sessionId: fixture.sessionId,
      coveredRuntimeEvents: events.filter(
        (event) =>
          event.content?.kind === 'text' ||
          event.content?.kind === 'function_call' ||
          event.content?.kind === 'function_response',
      ),
      summary: `## Goal\nRead ${REPORT}.\n\n## Progress\n- Agent finished\n\n## Next Steps\n1. read the report\n\n## Critical Context\n- Artifact ${REPORT}`,
      highWaterName: 'agent-report',
      highWaterSeq: 1,
      now: 10,
    });
    await stores.agentRunStore.appendEvent(fixture.sessionId, 'agent-run', {
      type: 'history_compact_checkpoint_recorded',
      id: 'agent-report-checkpoint',
      sessionId: fixture.sessionId,
      runId: 'agent-run',
      turnId: 'agent-turn',
      ts: 10,
      data: { checkpoint },
    });
    await stores.sessionStore.close?.();
    return childId;
  } finally {
    await owner.close();
  }
}
