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
import type { IpcMain } from 'electron';
import type { SessionCatalogProjection, SessionCreateInput } from '@maka/runtime-host/protocol';
import { RuntimeHostOperationError } from '@maka/runtime-host/client';
import { DesktopRuntimeHostClientError } from '../runtime-host-client.js';
import {
  registerRuntimeHostSessionCatalogIpc,
  toDesktopHostSessionSummary,
  type RuntimeHostSessionCatalogIpcDeps,
} from '../runtime-host-session-catalog-ipc-main.js';

test('maps Runtime Host live run state without collapsing unknown and known-empty', () => {
  const unknown = toDesktopHostSessionSummary(projection());
  const knownEmpty = toDesktopHostSessionSummary(
    projection({ liveRunState: { schemaVersion: 1, runningTurnIds: [] } }),
  );
  const running = toDesktopHostSessionSummary(
    projection({ liveRunState: { schemaVersion: 1, runningTurnIds: ['turn-live'] } }),
  );

  assert.equal(Object.hasOwn(unknown, 'runningTurnIds'), false);
  assert.deepEqual(knownEmpty.runningTurnIds, []);
  assert.deepEqual(running.runningTurnIds, ['turn-live']);
});

test('preserves the Session revision in Owner Desktop Host summaries', () => {
  assert.equal(toDesktopHostSessionSummary(projection({ revision: 7 })).revision, 7);
});

test('session creation forwards the caller name for a mode that carries none', async () => {
  const creates: SessionCreateInput[] = [];
  const ipc = ipcHarness();
  registerRuntimeHostSessionCatalogIpc(createDeps(creates), ipc as unknown as IpcMain);

  await ipc.invoke('sessions:create', { mode: 'bot', name: '飞书 任务' });
  await ipc.invoke('sessions:create', { mode: 'deep_research', name: '飞书 任务' });

  assert.deepEqual(
    creates.map((input) => [input.mode, input.name]),
    [
      ['bot', '飞书 任务'],
      ['deep_research', '飞书 任务'],
    ],
  );
});

test('archive, restore, and remove carry expected Host refusals across IPC without retirement effects', async () => {
  const sessionId = '2f34a351-f4e7-4295-983a-686e4f2daeea';
  for (const [channel, operation] of [
    ['sessions:archive', 'session.lifecycle.set'],
    ['sessions:unarchive', 'session.lifecycle.set'],
    ['sessions:remove', 'session.remove'],
  ] as const) {
    for (const code of ['session_busy', 'operation_conflict', 'operation_unavailable', 'not_found'] as const) {
      const failure = new RuntimeHostOperationError(operation, code, `Session ${sessionId} has a live Runtime Resource`);
      const { ipc, effects } = retirementHarness(failure, sessionId);
      assert.deepEqual(await ipc.invoke(channel, sessionId), { ok: false, code }, `${channel}: ${code}`);
      assert.deepEqual(effects, [], 'A refused action must not release resources or emit retirement');
    }
  }
});

test('retirement actions translate typed client conflicts and missing Sessions, not message text', async () => {
  for (const [failure, code] of [
    [new DesktopRuntimeHostClientError('revision_conflict', 'revision changed'), 'operation_conflict'],
    [new DesktopRuntimeHostClientError('session_not_found', 'Session removed'), 'not_found'],
  ] as const) {
    const { ipc, effects } = retirementHarness(failure);
    assert.deepEqual(await ipc.invoke('sessions:archive', 'session-1'), { ok: false, code });
    assert.deepEqual(effects, []);
  }
  for (const failure of [
    new Error('session_busy: Session 4295 has a live Runtime Resource'),
    new RuntimeHostOperationError('session.remove', 'persistence_failed', 'disk failure'),
  ]) {
    const { ipc, effects } = retirementHarness(failure);
    await assert.rejects(ipc.invoke('sessions:remove', 'session-1'), (error: unknown) => error === failure);
    assert.deepEqual(effects, []);
  }
});

test('successful lifecycle actions retain retirement effects and the restored removal outcome', async () => {
  for (const [channel, reason] of [
    ['sessions:archive', 'archived'],
    ['sessions:unarchive', 'updated'],
  ] as const) {
    const { ipc, effects } = retirementHarness();
    assert.deepEqual(await ipc.invoke(channel, 'session-1'), { ok: true, result: undefined });
    assert.deepEqual(effects, channel === 'sessions:archive' ? ['release', reason] : [reason]);
  }
  for (const disposition of ['removed', 'restored'] as const) {
    const outcome = { disposition, archivedSubtaskCount: disposition === 'removed' ? 2 : 0 };
    const { ipc, effects } = retirementHarness(undefined, 'session-1', outcome);
    assert.deepEqual(await ipc.invoke('sessions:remove', 'session-1', { requireArchived: true }), { ok: true, result: outcome });
    assert.deepEqual(effects, disposition === 'removed' ? ['release', 'deleted'] : []);
  }
});

test('resource-release failures after successful archive or delete still propagate', async () => {
  for (const channel of ['sessions:archive', 'sessions:remove']) {
    const failure = new RuntimeHostOperationError('session.remove', 'session_busy', 'release failed');
    const { ipc } = retirementHarness(undefined, 'session-1', undefined, failure);
    await assert.rejects(ipc.invoke(channel, 'session-1'), (error: unknown) => error === failure);
  }
});

function retirementHarness(
  failure?: Error,
  sessionId = 'session-1',
  removal = { disposition: 'removed' as 'removed' | 'restored', archivedSubtaskCount: 0 },
  releaseFailure?: Error,
) {
  const ipc = ipcHarness();
  const effects: string[] = [];
  const deps = createDeps([]);
  const refuse = async () => {
    if (failure) throw failure;
    return projection({ id: sessionId });
  };
  registerRuntimeHostSessionCatalogIpc({
    ...deps,
    client: {
      ...deps.client,
      listSessions: async () => [projection({ id: sessionId })],
      setSessionLifecycle: refuse,
      removeSession: async () => {
        await refuse();
        return removal;
      },
    },
    releaseSessionResources: () => {
      effects.push('release');
      if (releaseFailure) throw releaseFailure;
    },
    emitSessionsChanged: (reason) => { effects.push(reason); },
  }, ipc as unknown as IpcMain);
  return { ipc, effects };
}

type IpcHandler = Parameters<Pick<IpcMain, 'handle'>['handle']>[1];

test('rejects invalid creation before allocating a workspace', async () => {
  const creates: SessionCreateInput[] = [];
  const ipc = ipcHarness();
  let resolved = false;
  registerRuntimeHostSessionCatalogIpc({
    ...createDeps(creates),
    resolveCreateProject: async () => {
      resolved = true;
      throw new Error('Unexpected workspace allocation');
    },
  }, ipc as unknown as IpcMain);
  await assert.rejects(ipc.invoke('sessions:create', { projectId: null, model: 'incomplete' }), /Explicit model selection/);
  assert.equal(resolved, false);
  assert.deepEqual(creates, []);
});

function ipcHarness() {
  const handlers = new Map<string, IpcHandler>();
  return {
    handle(channel: string, handler: IpcHandler) {
      handlers.set(channel, handler);
    },
    async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const handler = handlers.get(channel);
      assert.ok(handler, `missing handler: ${channel}`);
      return handler({} as never, ...args);
    },
  };
}

function createDeps(creates: SessionCreateInput[]): RuntimeHostSessionCatalogIpcDeps {
  return {
    client: {
      createSession: async (input: SessionCreateInput) => {
        creates.push(input);
        return projection({ id: input.sessionId });
      },
    } as unknown as RuntimeHostSessionCatalogIpcDeps['client'],
    runningTurnIds: () => [],
    resolveCreateProject: async () => ({ kind: 'host_path', path: '/workspace' }),
    emitSessionsChanged: () => {},
    releaseSessionResources: () => {},
    sessionCopyCleanup: {
      ownCreation: async <T>(_creation: unknown, operation: () => Promise<T>) => operation(),
      recover: async () => ({ removed: [], failed: [] }),
    } as unknown as RuntimeHostSessionCatalogIpcDeps['sessionCopyCleanup'],
  };
}

function projection(overrides: Partial<SessionCatalogProjection> = {}): SessionCatalogProjection {
  return {
    id: 'session-1',
    revision: 1,
    workspace: {
      target: { kind: 'host_path', path: '/workspace' },
      hostCwd: '/workspace',
    },
    createdAt: 1,
    activityAt: 2,
    name: 'Session',
    isFlagged: false,
    isArchived: false,
    labels: [],
    labelsTruncated: false,
    hasUnread: false,
    status: 'active',
    backend: 'ai-sdk',
    llmConnectionId: 'connection-1',
    llmConnectionSlug: 'openai-main',
    connectionLocked: true,
    model: 'gpt-5',
    permissionMode: 'ask',
    collaborationMode: 'agent',
    orchestrationMode: 'default',
    ...overrides,
  };
}
