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
import { writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { RuntimeEvent } from '@maka/core/runtime-event';
import type { DurableToolResultProjection } from '@maka/core/durable-tool-result-projection';
import { DURABLE_TOOL_RESULT_PROJECTION_FAILURE } from '@maka/core/durable-tool-result-projection';
import { decodeCanonicalToolResultContent } from '@maka/core/tool-result-record-schema';
import { buildSendUserFileTool, sendUserFileModelText } from '@maka/runtime/send-user-file-tool';
import { seedInvocation } from '@maka/runtime/test-only/invocation-fixture';
import {
  saveToolResultText,
  toolResultFilePath,
  toolResultRoot,
} from '@maka/runtime/tool-result-file';
import { buildHistoryCompactCheckpoint } from '@maka/runtime/history-compact-checkpoint';
import { openInteractiveArtifactStoreForWrite } from '@maka/storage/artifact-stores';
import { openInteractiveExecutionStoresForWrite } from '@maka/storage/execution-stores';
import { tryAcquireInteractiveRootOwner } from '@maka/storage/root-authority';
import {
  connectClient,
  withExecutionRoot,
  type ExecutionFixture,
} from './fixtures/execution-host-suite.js';
import { readLedgerMessages } from './fixtures/ledger-transcript.js';
import { createHostExecutionArtifactServices } from '../server/execution-artifacts.js';
import { SessionAdmissionGate } from '../server/session-admission-gate.js';

const COPY_KINDS = [
  ['session.revision.create', 'revision', undefined],
  ['session.branch.create', 'branch', undefined],
  ['session.branch.create', 'side', 'side_conversation'],
] as const;
const OPTIONS = {
  skip: process.platform === 'win32' ? 'Windows SQLite shutdown lifecycle' : false,
  timeout: 120_000,
};

test(
  'deleted deliveries do not block edit resend, branch or side conversation',
  OPTIONS,
  async () => {
    await withExecutionRoot(async (fixture) => {
      const source = await seedDelivery(fixture);
      const copies: Array<{ sessionId: string; available: number }> = [];
      const host = await fixture.startHost();
      const client = await connectClient(fixture.root);
      try {
        for (const [index, file] of source.files.entries()) {
          assert.equal(
            (
              await client.request('artifact.delete', {
                sessionId: fixture.sessionId,
                artifactId: file.artifactId,
              })
            ).kind,
            'deleted',
          );
          for (const [operation, suffix, intent] of COPY_KINDS) {
            const sessionId = `deleted-${index}-${suffix}`;
            assert.equal(
              (await copy(client, fixture.sessionId, sessionId, operation, intent)).kind,
              'committed',
            );
            copies.push({ sessionId, available: source.files.length - index - 1 });
            const page = await client.request('artifact.query', { kind: 'list_start', sessionId });
            assert.ok(page.kind === 'page');
            assert.equal(page.artifacts.length, source.files.length - index - 1);
            for (const artifact of page.artifacts) {
              const bytes = await client.request('artifact.query', {
                kind: 'read_chunk',
                sessionId,
                artifactId: artifact.id,
                offset: 0,
              });
              assert.ok(bytes.kind === 'chunk');
              assert.equal(Buffer.from(bytes.chunkBase64, 'base64').toString(), 'keep me');
            }
          }
        }
        assert.equal((await copy(client, 'deleted-1-branch', 'empty-again')).kind, 'committed');
        copies.push({ sessionId: 'empty-again', available: 0 });
      } finally {
        await client.close();
        await fixture.stopHost(host);
      }
      const owner = await tryAcquireInteractiveRootOwner(fixture.capability);
      assert.ok(owner);
      const stores = await openInteractiveExecutionStoresForWrite(owner.lease);
      try {
        for (const { sessionId, available } of copies) {
          const messages = await readLedgerMessages(stores.runtimeEventStore, sessionId);
          const receipt = messages.find(
            (message) => message.type === 'tool_result' && message.toolUseId === 'delivery-call',
          );
          assert.ok(receipt?.type === 'tool_result');
          assert.deepEqual(decodeCanonicalToolResultContent(receipt.content), receipt.content);
          if (available === 0) {
            assert.ok(receipt.content.kind === 'text');
            assert.match(receipt.content.text, /no longer available/);
          } else {
            assert.ok(receipt.content.kind === 'user_file_delivery');
            assert.equal(receipt.content.files.length, 1);
            assert.equal(receipt.content.files[0]!.name, 'keep.txt');
            assert.notEqual(receipt.content.files[0]!.artifactId, source.files[1]!.artifactId);
          }
          const response = (await eventsFor(stores, sessionId)).find(
            (event) =>
              event.content?.kind === 'function_response' && event.content.id === 'delivery-call',
          );
          assert.ok(response?.content?.kind === 'function_response');
          assert.deepEqual(response.content.modelProjection, {
            version: 1,
            kind: 'text',
            text:
              receipt.content.kind === 'text'
                ? receipt.content.text
                : sendUserFileModelText(receipt.content),
          });
          const checkpoints = await checkpointsFor(stores, sessionId);
          assert.equal(checkpoints.length, 1, 'only the summary before delivery survives');
          assert.ok(!JSON.stringify(checkpoints).includes(source.files[0]!.artifactId));
        }
        const original = (
          await readLedgerMessages(stores.runtimeEventStore, fixture.sessionId)
        ).find(
          (message) => message.type === 'tool_result' && message.toolUseId === 'delivery-call',
        );
        assert.ok(original?.type === 'tool_result');
        assert.deepEqual(
          original.content,
          source,
          'deletion and copying do not rewrite source history',
        );
        assert.equal((await checkpointsFor(stores, fixture.sessionId)).length, 2);
      } finally {
        await stores.sessionStore.close?.();
        await owner.close();
      }
    });
  },
);

test(
  'repeated copies keep delivery paths and model receipts consistent and drop stale summaries',
  OPTIONS,
  async () => {
    await withExecutionRoot(async (fixture) => {
      const source = await seedDelivery(fixture, true);
      const host = await fixture.startHost();
      const client = await connectClient(fixture.root);
      try {
        assert.equal((await copy(client, fixture.sessionId, 'delivery-first')).kind, 'committed');
        assert.equal((await copy(client, 'delivery-first', 'delivery-second')).kind, 'committed');
        for (const file of source.files) {
          assert.equal(
            (
              await client.request('artifact.delete', {
                sessionId: fixture.sessionId,
                artifactId: file.artifactId,
              })
            ).kind,
            'deleted',
          );
        }
      } finally {
        await client.close();
        await fixture.stopHost(host);
      }
      const owner = await tryAcquireInteractiveRootOwner(fixture.capability);
      assert.ok(owner);
      const stores = await openInteractiveExecutionStoresForWrite(owner.lease);
      const artifacts = await openInteractiveArtifactStoreForWrite(owner.lease);
      try {
        let previousIds = source.files.map((file) => file.artifactId);
        for (const sessionId of ['delivery-first', 'delivery-second']) {
          const events = await eventsFor(stores, sessionId);
          const responses = events.flatMap((event) =>
            event.content?.kind === 'function_response' ? [event.content] : [],
          );
          const response = responses.find((response) => response.id === 'delivery-call');
          assert.ok(response);
          const delivery = decodeCanonicalToolResultContent(response.result);
          assert.ok(delivery.kind === 'user_file_delivery');
          const ids = delivery.files.map((file) => file.artifactId);
          assert.ok(ids.every((id) => !previousIds.includes(id)));
          previousIds = ids;
          const copiedLog = toolResultFilePath(
            toolResultRoot(fixture.capability.canonicalPath),
            sessionId,
            'saved-log',
          );
          assert.equal(delivery.files[0]!.path, copiedLog);
          assert.equal(await readFile(copiedLog, 'utf8'), 'saved log');
          assert.equal(
            delivery.files[1]!.path,
            source.files[1]!.path,
            'ordinary file paths retain their original location',
          );
          assert.deepEqual(response.modelProjection, {
            version: 1,
            kind: 'text',
            text: sendUserFileModelText(delivery),
          });
          for (const file of delivery.files) {
            const read = await artifacts.readTextInSession(sessionId, file.artifactId);
            assert.ok(read.ok, 'a receipt names a readable file in its own session');
          }
          assert.deepEqual(
            responses.find((response) => response.id === 'failure-call')?.modelProjection,
            DURABLE_TOOL_RESULT_PROJECTION_FAILURE,
          );
          assert.deepEqual(
            responses.find((response) => response.id === 'error-call')?.modelProjection,
            { version: 1, kind: 'text', text: 'projection refused', isError: true },
          );
          assert.deepEqual(
            responses.find((response) => response.id === 'custom-call')?.modelProjection,
            { version: 1, kind: 'text', text: 'custom projection' },
          );
          const checkpoints = await checkpointsFor(stores, sessionId);
          assert.equal(checkpoints.length, 1);
          assert.ok(checkpoints[0]?.data?.checkpoint);
          assert.ok(
            !source.files.some((file) => JSON.stringify(checkpoints).includes(file.artifactId)),
          );
        }
      } finally {
        artifacts.close();
        await stores.sessionStore.close?.();
        await owner.close();
      }
    });
  },
);

test(
  'missing payload bytes still fail copying instead of being treated as user deletion',
  OPTIONS,
  async () => {
    await withExecutionRoot(async (fixture) => {
      const source = await seedDelivery(fixture);
      const owner = await tryAcquireInteractiveRootOwner(fixture.capability);
      assert.ok(owner);
      const artifacts = await openInteractiveArtifactStoreForWrite(owner.lease);
      try {
        const entry = await artifacts.getInSession(fixture.sessionId, source.files[0]!.artifactId);
        assert.ok(entry.record);
        await rm(join(fixture.capability.canonicalPath, 'artifacts', entry.record.relativePath));
      } finally {
        artifacts.close();
        await owner.close();
      }
      const host = await fixture.startHost();
      const client = await connectClient(fixture.root);
      try {
        await assert.rejects(
          copy(client, fixture.sessionId, 'missing-payload-copy'),
          /Artifact .* could not be copied: not_found/,
        );
      } finally {
        await client.close();
        await fixture.stopHost(host);
      }
    });
  },
);

async function copy(
  client: Awaited<ReturnType<typeof connectClient>>,
  sourceSessionId: string,
  targetSessionId: string,
  operation: 'session.branch.create' | 'session.revision.create' = 'session.branch.create',
  intent?: 'side_conversation',
) {
  const source = await client.request('session.catalog.query', {
    kind: 'get',
    sessionId: sourceSessionId,
  });
  assert.ok(source.kind === 'session' && source.session && !('kind' in source.session));
  return client.request(operation, {
    sourceSessionId,
    targetSessionId,
    sourceTurnId: 'later-turn',
    expectedSourceRevision: source.session.revision,
    ...(intent ? { intent } : {}),
  });
}

type Stores = Awaited<ReturnType<typeof openInteractiveExecutionStoresForWrite>>;
async function eventsFor(stores: Stores, sessionId: string) {
  return (
    await Promise.all(
      (
        await stores.runtimeEventStore.listSessionInvocations(sessionId)
      ).map((invocation) =>
        stores.runtimeEventStore.readRuntimeEvents(sessionId, invocation.invocationId),
      ),
    )
  ).flat();
}
async function checkpointsFor(stores: Stores, sessionId: string) {
  return (
    await Promise.all(
      (
        await stores.runtimeEventStore.listSessionInvocations(sessionId)
      ).map((invocation) => stores.agentRunStore.readEvents(sessionId, invocation.runId)),
    )
  )
    .flat()
    .filter((event) => event.type === 'history_compact_checkpoint_recorded');
}

async function seedDelivery(fixture: ExecutionFixture, legacyReceipt = false) {
  const owner = await tryAcquireInteractiveRootOwner(fixture.capability);
  assert.ok(owner);
  const stores = await openInteractiveExecutionStoresForWrite(owner.lease);
  const artifacts = await openInteractiveArtifactStoreForWrite(owner.lease);
  try {
    const saved = await saveToolResultText(
      toolResultFilePath(
        toolResultRoot(fixture.capability.canonicalPath),
        fixture.sessionId,
        'saved-log',
      ),
      'saved log',
    );
    const keep = join(fixture.capability.canonicalPath, 'keep.txt');
    await writeFile(keep, 'keep me');
    const files = [saved.path, keep];
    const services = createHostExecutionArtifactServices({
      artifacts,
      sessionAdmission: new SessionAdmissionGate(),
      sessions: { probeSessionRemoval: async () => ({ kind: 'present' }) },
      requestDrain: () => assert.fail('fixture must not drain'),
    });
    const delivery = await buildSendUserFileTool().impl(
      { files, status: 'normal' },
      {
        sessionId: fixture.sessionId,
        turnId: 'delivery-turn',
        cwd: fixture.capability.canonicalPath,
        toolCallId: 'delivery-call',
        abortSignal: new AbortController().signal,
        emitOutput() {},
        recordArtifacts: (candidates) =>
          services.recordToolArtifacts({
            sessionId: fixture.sessionId,
            turnId: 'delivery-turn',
            toolUseId: 'delivery-call',
            toolName: 'SendUserFile',
            cwd: fixture.capability.canonicalPath,
            args: { files, status: 'normal' },
            result: undefined,
            candidates: [...candidates],
          }),
      },
    );
    const append = async (runId: string, turnId: string, parts: Partial<RuntimeEvent>[]) => {
      await seedInvocation(stores.runtimeEventStore, {
        sessionId: fixture.sessionId,
        runId,
        turnId,
        openedAt: 1,
      });
      for (const [index, part] of parts.entries()) {
        await stores.runtimeEventStore.appendRuntimeEvent(fixture.sessionId, runId, {
          id: `${runId}-${index}`,
          sessionId: fixture.sessionId,
          runId,
          invocationId: runId,
          turnId,
          ts: index + 2,
          role: 'system',
          author: 'system',
          partial: false,
          ...part,
        });
      }
    };
    const receipts: Array<{ id: string; name: string; projection: DurableToolResultProjection }> = [
      {
        id: 'delivery-call',
        name: 'SendUserFile',
        projection: {
          version: 1,
          kind: 'text',
          text: legacyReceipt
            ? sendUserFileModelText(delivery).replace(saved.path, '/previous-copy/saved-log.txt')
            : sendUserFileModelText(delivery),
        },
      },
      {
        id: 'failure-call',
        name: 'SendUserFile',
        projection: DURABLE_TOOL_RESULT_PROJECTION_FAILURE,
      },
      {
        id: 'error-call',
        name: 'SendUserFile',
        projection: { version: 1, kind: 'text', text: 'projection refused', isError: true },
      },
      {
        id: 'custom-call',
        name: 'CustomDelivery',
        projection: { version: 1, kind: 'text', text: 'custom projection' },
      },
    ];
    const end: Partial<RuntimeEvent> = { status: 'completed', actions: { endInvocation: true } };
    await append('delivery-run', 'delivery-turn', [
      { role: 'user', author: 'user', content: { kind: 'text', text: 'Deliver two files' } },
      ...receipts.flatMap(({ id, name, projection }): Partial<RuntimeEvent>[] => [
        {
          role: 'model',
          author: 'agent',
          content: { kind: 'function_call', id, name, args: { files, status: 'normal' } },
        },
        {
          role: 'tool',
          author: 'tool',
          content: {
            kind: 'function_response',
            id,
            name,
            result: delivery,
            isError: false,
            modelProjection: projection,
          },
        },
      ]),
      end,
    ]);
    await append('later-run', 'later-turn', [
      { role: 'user', author: 'user', content: { kind: 'text', text: 'Edit this later message' } },
      end,
    ]);
    const events = (
      await stores.runtimeEventStore.readRuntimeEvents(fixture.sessionId, 'delivery-run')
    ).filter(
      (event) =>
        event.content?.kind === 'text' ||
        event.content?.kind === 'function_call' ||
        event.content?.kind === 'function_response',
    );
    let previousCheckpointId: string | undefined;
    for (const [index, coveredRuntimeEvents] of [events.slice(0, 1), events].entries()) {
      const checkpoint = buildHistoryCompactCheckpoint({
        sessionId: fixture.sessionId,
        coveredRuntimeEvents,
        summary: `## Goal\nFile delivery.\n\n## Progress\n- ${index === 0 ? 'Before delivery' : `Delivered ${delivery.files.map((file) => file.artifactId).join(', ')}`}\n\n## Next Steps\n1. Continue.\n\n## Critical Context\n- Test files.`,
        highWaterName: 'delivery',
        highWaterSeq: index + 1,
        now: 50 + index,
        ...(previousCheckpointId ? { previousCheckpointId } : {}),
      });
      previousCheckpointId = checkpoint.checkpointId;
      await stores.agentRunStore.appendEvent(fixture.sessionId, 'delivery-run', {
        type: 'history_compact_checkpoint_recorded',
        id: `checkpoint-${index}`,
        sessionId: fixture.sessionId,
        runId: 'delivery-run',
        turnId: 'delivery-turn',
        ts: 50 + index,
        data: { checkpoint },
      });
    }
    return delivery;
  } finally {
    artifacts.close();
    await stores.sessionStore.close?.();
    await owner.close();
  }
}
