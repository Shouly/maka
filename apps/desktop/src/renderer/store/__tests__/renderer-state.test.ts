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
import { createSettingsStore } from '../settings-store.js';
import * as settingsBridge from '../../bridge/settings.js';
import { createDefaultSettings } from '@maka/core/settings';
import { reconcileRuntimeHostSessionCatalog } from '../../../preload/runtime-host-session-catalog.js';
import { createResourceStore } from '../resource-store.js';
import { createSessionsStore } from '../sessions-store.js';
import { createActiveSessionStore } from '../active-session-store.js';
import { createTurnActionsStore } from '../turn-actions-store.js';
import { createUiStore } from '../ui-store.js';
import * as sessions from '../../bridge/sessions.js';
import * as transcripts from '../../bridge/transcripts.js';
import * as shellRuns from '../../bridge/shell-runs.js';
import { toUnsubscribe } from '../../bridge/bridge.js';
import { createTranscriptProjection } from '@maka/ui';
import type {
  ActiveInteractionRequestEvent,
  SessionEvent,
  ShellRunUpdate,
} from '@maka/core/events';
import type { StoredMessage } from '@maka/core/session';
import type {
  DesktopTranscriptBatch,
  DesktopTranscriptHandle,
} from '../../../preload/transcript-contract.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const sid = (name: string) => JSON.stringify(['host', name]);
function row(id: string, host = 'host') {
  return {
    id,
    runtimeHostId: host,
    profileId: 'local',
    name: id,
    status: 'idle',
    revision: 1,
  } as unknown as sessions.DesktopSessionSummary;
}
function batch(id: string, messages: StoredMessage[] = [], reset = true): DesktopTranscriptBatch {
  return {
    sessionId: JSON.parse(id)[1],
    generation: 'g',
    hostEpoch: 'h',
    deliverySequence: 0,
    durableThrough: messages.length || null,
    reset,
    ready: true,
    hasOlder: false,
    hasNewer: false,
    evictedDurableSequences: [],
    completedOverlayMessageIds: [],
    fragments: messages.map((message, index) => {
      const data = new TextEncoder().encode(JSON.stringify(message));
      return {
        source: 'durable' as const,
        identity: index + 1,
        order: null,
        byteOffset: 0,
        totalBytes: data.length,
        data,
      };
    }),
  };
}
function fakeRuntime() {
  type Observer = {
    id: string;
    event: (event: SessionEvent) => void;
    ready?: () => void;
    phase?: (phase: 'pending' | 'ready') => void;
    fail?: (error: unknown) => void;
    closed: boolean;
  };
  const observers: Observer[] = [];
  const readers: {
    id: string;
    receive: (batch: DesktopTranscriptBatch) => void;
    closed: boolean;
    cancelled: boolean;
  }[] = [];
  const frames: (() => void)[] = [];
  let interactions: ActiveInteractionRequestEvent[] = [];
  let interactionRead: (() => Promise<ActiveInteractionRequestEvent[]>) | undefined;
  let onInteraction = (_event: {
    sessionId: string;
    interactions: ActiveInteractionRequestEvent[];
  }) => {};
  let onShell = (_update: ShellRunUpdate) => {};
  let onResync = (_event: { sessionId: string }) => {};
  let shellRead = async (_id: string): Promise<ShellRunUpdate[]> => [];
  const paging: string[] = [];
  const store = createActiveSessionStore({
    scheduleFrame: (callback) => frames.push(callback),
    sessions: {
      ...sessions,
      subscribeSessionEvents(id, event, ready, phase, fail) {
        const observer = { id, event, ready, phase, fail, closed: false };
        observers.push(observer);
        ready?.();
        return () => {
          observer.closed = true;
        };
      },
      async listActiveInteractions() {
        return interactionRead ? interactionRead() : interactions;
      },
      async readExecutionBoundary() {
        return {} as Awaited<ReturnType<typeof sessions.readExecutionBoundary>>;
      },
      subscribeActiveInteractions(handler) {
        onInteraction = handler;
        return () => {};
      },
    },
    transcripts: {
      ...transcripts,
      async openTranscript(id, receive, cancellation) {
        const reader = { id, receive, closed: false, cancelled: false };
        readers.push(reader);
        cancellation?.(() => {
          reader.cancelled = true;
        });
        receive(batch(id));
        return {
          sessionId: id,
          generation: 'g',
          hostEpoch: 'h',
          readThroughMessageId: null,
          async close() {
            reader.closed = true;
          },
          async loadBefore() {
            paging.push('before');
          },
          async loadAfter() {
            paging.push('after');
          },
          async loadAround() {
            paging.push('around');
          },
        } satisfies DesktopTranscriptHandle;
      },
    },
    shellRuns: {
      ...shellRuns,
      listShellRuns: (id) => shellRead(id),
      subscribeShellRunUpdates(handler) {
        onShell = handler;
        return () => {};
      },
      subscribeShellRunResync(handler) {
        onResync = handler;
        return () => {};
      },
    },
  });
  return {
    store,
    observers,
    readers,
    frames,
    paging,
    interaction: (event: Parameters<typeof onInteraction>[0]) => onInteraction(event),
    setInteractions: (value: ActiveInteractionRequestEvent[]) => {
      interactions = value;
    },
    setInteractionRead: (value: typeof interactionRead) => {
      interactionRead = value;
    },
    shell: (event: ShellRunUpdate) => onShell(event),
    resync: (id: string) => onResync({ sessionId: id }),
    setShellRead: (read: typeof shellRead) => {
      shellRead = read;
    },
  };
}
const delta = (text: string): SessionEvent => ({
  type: 'text_delta',
  id: text,
  turnId: 'turn',
  messageId: 'answer',
  ts: 1,
  text,
});
const question = (): ActiveInteractionRequestEvent =>
  ({
    type: 'user_question_request',
    requestId: 'request',
    id: 'q',
    turnId: 'turn',
    ts: 1,
    toolUseId: 'tool',
    questions: [],
  }) as unknown as ActiveInteractionRequestEvent;

// Reads are allowed to finish out of order. Only the latest committed scope may win.
test('resource ignores stale reads and rejects callbacks from a stopped scope', async () => {
  const store = createResourceStore<string>();
  const first = deferred<string>();
  const second = deferred<string>();
  let calls = 0;
  let notify = () => {};
  const stop = store.connect(
    () => (++calls === 1 ? first.promise : second.promise),
    (callback) => {
      notify = callback;
      return () => {};
    },
  );
  notify();
  second.resolve('new');
  await tick();
  first.resolve('old');
  await tick();
  assert.equal(store.getState().data, 'new');
  stop();
  notify();
  assert.equal(calls, 2);
  assert.equal(store.getState().data, undefined);
});
test('old host response and mutation do not populate the new host', async () => {
  const store = createResourceStore<string>();
  const old = deferred<string>();
  const write = deferred<void>();
  store.connect(
    () => old.promise,
    () => () => {},
  );
  const mutation = store.mutate(() => write.promise);
  store.connect(
    async () => 'host-B',
    () => () => {},
  );
  await tick();
  old.resolve('host-A');
  write.resolve();
  await mutation;
  assert.equal(store.getState().data, 'host-B');
});
test('resource exposes errors without discarding the last good snapshot', async () => {
  const store = createResourceStore<number>();
  let fails = false;
  store.connect(
    async () => {
      if (fails) throw new Error('offline');
      return 1;
    },
    () => () => {},
  );
  await tick();
  fails = true;
  await store.refresh();
  assert.equal(store.getState().data, 1);
  assert.equal(store.getState().error, 'offline');
  store.disconnect();
});
test('catalog uses the preload snapshot including its retained offline hosts', async () => {
  let result = { sessions: [row('a', 'A'), row('b', 'B')], completeHostIds: ['A', 'B'] };
  const store = createSessionsStore({
    ...sessions,
    async listSessionsWithCoverage() {
      return result;
    },
  });
  await store.refresh();
  store.select('b');
  result = { sessions: [row('b', 'B')], completeHostIds: ['A'] };
  await store.refresh();
  assert.deepEqual(
    store.getState().sessions.map((item) => item.id),
    ['b'],
  );
  assert.equal(store.getState().activeId, 'b');
  result = { sessions: [], completeHostIds: ['B'] };
  await store.refresh();
  assert.equal(store.getState().activeId, undefined);
});
test('catalog failure is not an empty successful observation', async () => {
  const store = createSessionsStore({
    ...sessions,
    async listSessionsWithCoverage() {
      throw new Error('offline');
    },
  });
  store.upsert(row('a'));
  store.select('a');
  await store.refresh();
  assert.equal(store.getState().sessions.length, 1);
  assert.equal(store.getState().revision, 0);
  assert.equal(store.getState().activeId, 'a');
});
test('selection fences old stream callbacks, transcript batches, frames, and cleanup', async () => {
  const f = fakeRuntime();
  const stopA = f.store.observe(sid('a'), 'en');
  await tick();
  f.observers[0]!.event(delta('old'));
  f.store.observe(sid('b'), 'en');
  await tick();
  stopA();
  f.observers[0]!.event(delta('stale'));
  f.readers[0]!.receive(
    batch(sid('a'), [
      { type: 'assistant', id: 'old', turnId: 'turn', ts: 1, text: 'old', modelId: 'm' },
    ]),
  );
  f.frames.forEach((frame) => frame());
  assert.equal(f.store.getState().sessionId, sid('b'));
  assert.equal(f.store.getState().messages.length, 0);
  assert.deepEqual(f.store.getState().liveTurns, {});
  assert.ok(f.readers[0]!.cancelled);
  assert.ok(f.readers[0]!.closed);
  assert.ok(f.observers[0]!.closed);
  f.store.disconnect();
});
test('display deltas batch, lifecycle events flush, and durable answer takes over once', async () => {
  const f = fakeRuntime();
  const id = sid('a');
  f.store.observe(id, 'en');
  await tick();
  const observer = f.observers[0]!;
  observer.event(delta('Hello '));
  observer.event(delta('world'));
  assert.equal(f.frames.length, 1);
  assert.deepEqual(f.store.getState().liveTurns, {});
  observer.event({
    type: 'text_complete',
    id: 'text-end',
    turnId: 'turn',
    messageId: 'answer',
    ts: 2,
    text: 'Hello world',
  });
  assert.equal(f.store.getState().liveTurns[id]?.steps[0]?.text?.text, 'Hello world');
  observer.event({ type: 'complete', id: 'done', turnId: 'turn', ts: 3, stopReason: 'end_turn' });
  const message: StoredMessage = {
    type: 'assistant',
    id: 'answer',
    turnId: 'turn',
    ts: 2,
    text: 'Hello world',
    modelId: 'm',
  };
  f.readers[0]!.receive(batch(id, [message], false));
  await tick();
  const state = f.store.getState();
  const turns = createTranscriptProjection().project({
    sessionId: id,
    locale: 'en',
    messages: state.messages,
    liveTurn: state.liveTurns[id],
  });
  assert.equal(turns.length, 1);
  assert.equal(state.messages.length, 1);
  assert.equal(state.liveTurns[id], undefined);
  f.frames.forEach((frame) => frame());
  assert.equal(f.store.getState().liveTurns[id], undefined);
  f.store.disconnect();
});
test('late terminal handoff cannot settle a newly observed session with the same id', async () => {
  const f = fakeRuntime();
  const id = sid('a');
  f.store.observe(id, 'en');
  await tick();
  f.observers[0]!.event(delta('old'));
  f.observers[0]!.event({
    type: 'complete',
    id: 'end',
    turnId: 'turn',
    ts: 2,
    stopReason: 'end_turn',
  });
  f.store.observe(id, 'en');
  await tick();
  f.observers[1]!.event(delta('new'));
  f.frames.forEach((frame) => frame());
  f.readers[0]!.receive(
    batch(
      id,
      [{ type: 'assistant', id: 'answer', turnId: 'turn', ts: 2, text: 'old', modelId: 'm' }],
      false,
    ),
  );
  await tick();
  assert.equal(f.store.getState().liveTurns[id]?.steps[0]?.text?.text, 'new');
  f.store.disconnect();
});
test('failed observer is retired immediately and retries with a clean seed', async () => {
  const f = fakeRuntime();
  const id = sid('a');
  f.store.observe(id, 'en');
  await tick();
  f.observers[0]!.fail?.(new Error('disconnected'));
  f.observers[0]!.event(delta('stale'));
  assert.equal(f.store.getState().observationReady, false);
  assert.ok(f.observers[0]!.closed);
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert.equal(f.observers.length, 2);
  assert.equal(f.store.getState().observationReady, true);
  assert.deepEqual(f.store.getState().liveTurns, {});
  f.store.disconnect();
});
test('reseed replaces live content instead of appending the same deltas twice', async () => {
  const f = fakeRuntime();
  const id = sid('a');
  f.store.observe(id, 'en');
  await tick();
  const observer = f.observers[0]!;
  observer.event(delta('same'));
  f.frames.shift()!();
  observer.phase?.('pending');
  observer.event(delta('same'));
  observer.phase?.('ready');
  assert.equal(f.store.getState().liveTurns[id]?.steps[0]?.text?.text, 'same');
  f.store.disconnect();
});
test('interaction acknowledgements beat an older in-flight query', async () => {
  const f = fakeRuntime();
  const id = sid('a');
  f.store.observe(id, 'en');
  await tick();
  const read = deferred<ActiveInteractionRequestEvent[]>();
  f.setInteractionRead(() => read.promise);
  f.observers[0]!.event(question());
  f.observers[0]!.event({
    type: 'user_question_answer_ack',
    id: 'ack',
    turnId: 'turn',
    ts: 2,
    requestId: 'request',
    toolUseId: 'tool',
  } as SessionEvent);
  f.interaction({ sessionId: id, interactions: [] });
  read.resolve([question()]);
  await tick();
  assert.deepEqual(f.store.getState().interactions[id], []);
  f.store.disconnect();
});
test('abort clears requests without waiting for a query', async () => {
  const f = fakeRuntime();
  const id = sid('a');
  f.store.observe(id, 'en');
  await tick();
  f.observers[0]!.event(question());
  f.observers[0]!.event({ type: 'abort', id: 'abort', turnId: 'turn', ts: 2, reason: 'user_stop' });
  assert.deepEqual(f.store.getState().interactions[id], []);
  f.store.disconnect();
});
test('shell hydration buffers updates and retains the highest revision', async () => {
  const f = fakeRuntime();
  const id = sid('a');
  const read = deferred<ShellRunUpdate[]>();
  f.setShellRead(() => read.promise);
  f.store.observe(id, 'en');
  const update = (revision: number) =>
    ({
      sessionId: id,
      sourceTurnId: 'turn',
      sourceToolCallId: 'tool',
      ownership: { kind: 'local' },
      result: {
        kind: 'shell_run',
        ref: 'shell',
        revision,
        status: 'running',
        mode: 'pipes',
        cmd: 'echo test',
        cwd: '/tmp',
        startedAt: 1,
        updatedAt: revision,
      },
    }) as ShellRunUpdate;
  f.shell(update(3));
  read.resolve([update(1)]);
  await tick();
  f.shell(update(2));
  assert.equal(f.store.getState().shellUpdates[0]?.result.revision, 3);
  f.store.disconnect();
});
test('history controls use the existing bounded paging handle', async () => {
  const f = fakeRuntime();
  const id = sid('a');
  f.store.observe(id, 'en');
  await tick();
  f.readers[0]!.receive({ ...batch(id), hasOlder: true, hasNewer: true, durableThrough: 9 });
  await f.store.loadBefore();
  await f.store.loadAfter();
  await f.store.loadLatest();
  assert.deepEqual(f.paging, ['before', 'after', 'around']);
  f.store.disconnect();
});
test('send retains outcome_unknown and never retries the admission automatically', async () => {
  let calls = 0;
  const store = createTurnActionsStore({
    api: {
      ...sessions,
      async sendMessage() {
        calls++;
        return {
          ok: false,
          reason: 'outcome_unknown',
          messageId: 'intent',
          skillInvocation: { loaded: [], failed: [], receipts: [] },
        };
      },
    },
  });
  const result = await store.send('a', { type: 'send', turnId: 'intent', text: 'hello' });
  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.deepEqual(store.getState().sendResults.a, result);
});
test('stop remains available while send is awaiting admission and commands retain their owner', async () => {
  const send = deferred<sessions.SessionSendResult>();
  const stopped: string[] = [];
  const store = createTurnActionsStore({
    api: {
      ...sessions,
      sendMessage: () => send.promise,
      async stopSession(id) {
        stopped.push(id);
      },
    },
  });
  const pending = store.send('a', { type: 'send', turnId: 'intent', text: 'hello' });
  await store.stop('a');
  assert.deepEqual(stopped, ['a']);
  await assert.rejects(
    store.send('a', { type: 'send', turnId: 'other', text: 'different' }),
    /pending/,
  );
  send.resolve({
    ok: false,
    reason: 'outcome_unknown',
    messageId: 'intent',
    skillInvocation: { loaded: [], failed: [], receipts: [] },
  });
  await pending;
  assert.deepEqual(store.getState().pending.a, []);
});
test('UI layout rejects non-finite sizes and keeps the expanded size on collapse', () => {
  const store = createUiStore();
  const width = store.getState().sidebarWidth;
  store.setSidebarWidth(0);
  store.setSidebarWidth(Number.NaN);
  assert.equal(store.getState().sidebarWidth, width);
  store.setSidebarWidth(900);
  assert.equal(store.getState().sidebarWidth, 480);
  store.setSidebarCollapsed(true);
  assert.equal(store.getState().sidebarWidth, 480);
  store.dispatchWorkbar({ type: 'resize', placement: 'right', size: Number.NaN });
  assert.ok(Number.isFinite(store.getState().workbar.rightWidth));
});
test('bridge unsubscribe is idempotent', () => {
  let calls = 0;
  const off = toUnsubscribe(() => calls++);
  off();
  off();
  assert.equal(calls, 1);
});

test('inherited shell notifications retain the viewing session identity', async () => {
  const f = fakeRuntime();
  const id = sid('child');
  const parent = sid('parent');
  const inherited: ShellRunUpdate = {
    sessionId: id,
    sourceTurnId: 'turn',
    sourceToolCallId: 'tool',
    ownership: { kind: 'source_owned', sourceSessionId: parent, ownerSessionId: parent },
    result: {
      kind: 'shell_run',
      ref: 'shared',
      revision: 1,
      status: 'running',
      mode: 'pipes',
      cmd: 'echo test',
      cwd: '/tmp',
      startedAt: 1,
      updatedAt: 1,
    },
  };
  f.setShellRead(async () => [inherited]);
  f.store.observe(id, 'en');
  await tick();
  f.shell({
    ...inherited,
    sessionId: parent,
    ownership: { kind: 'local' },
    result: { ...inherited.result, revision: 2, status: 'completed', updatedAt: 2, exitCode: 0 },
  });
  assert.equal(f.store.getState().shellUpdates[0]?.sessionId, id);
  assert.equal(f.store.getState().shellUpdates[0]?.result.status, 'completed');
  f.store.disconnect();
});

test('same-revision compact shell notification does not erase the hydrated output', async () => {
  const f = fakeRuntime();
  const id = sid('a');
  const compact: ShellRunUpdate = {
    sessionId: id,
    sourceTurnId: 'turn',
    sourceToolCallId: 'tool',
    ownership: { kind: 'local' },
    result: {
      kind: 'shell_run',
      ref: 'shell',
      revision: 1,
      status: 'running',
      mode: 'pipes',
      cmd: 'echo test',
      cwd: '/tmp',
      startedAt: 1,
      updatedAt: 1,
    },
  };
  const snapshot = {
    ...compact,
    result: {
      ...compact.result,
      mode: 'pipes' as const,
      output: {
        mode: 'pipes' as const,
        stdout: 'retained',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        redacted: false,
      },
    },
  };
  f.setShellRead(async () => [snapshot]);
  f.store.observe(id, 'en');
  await tick();
  f.shell(compact);
  assert.equal(f.store.getState().shellUpdates[0]?.result.output?.mode, 'pipes');
  f.store.disconnect();
});

test('fixture carries sidebar, settings, search, and workbar state into their stores', () => {
  const store = createUiStore();
  store.applyFixture({
    activeSessionId: sid('fixture'),
    sidebarCollapsed: false,
    sidebarSection: 'mcp',
    workbarTab: 'inspector',
    workbarCollapsed: false,
    openSettingsSection: 'appearance',
    searchModalOpen: true,
  });
  const state = store.getState();
  assert.equal(state.sidebarCollapsed, false);
  assert.deepEqual(state.navigation.selection, { section: 'extensions', module: 'mcp' });
  assert.equal(state.settingsSection, 'appearance');
  assert.equal(state.settingsOpen, true);
  assert.equal(state.searchOpen, true);
  assert.equal(state.workbar.panels.right.activeTabId, 'workbar:inspector');
  assert.equal(state.workbar.collapsedBySession[sid('fixture')], false);
});

test('removed profiles and revoked Guest access are not resurrected by the renderer', async () => {
  const removed = row('removed', 'removed-host');
  const guest = { ...row('guest', 'guest-host'), shared: true as const };
  let result = { sessions: [removed, guest], completeHostIds: [] as string[] };
  const store = createSessionsStore({
    ...sessions,
    async listSessionsWithCoverage() {
      return result;
    },
  });
  await store.refresh();
  store.select(removed.id);
  result = {
    sessions: reconcileRuntimeHostSessionCatalog(result.sessions, {
      sessions: [],
      completeHostIds: [],
      knownOwnerProfileIds: [],
      guestSessions: [],
    }),
    completeHostIds: [],
  };
  await store.refresh();
  assert.deepEqual(store.getState().sessions, []);
  assert.equal(store.getState().activeId, undefined);
});

test('queued Host writes keep their display owner and do not block another Host', async () => {
  const first = deferred<Awaited<ReturnType<typeof settingsBridge.updateHostSettings>>>();
  const second = deferred<Awaited<ReturnType<typeof settingsBridge.updateHostSettings>>>();
  const writes: string[] = [];
  const defaults = createDefaultSettings();
  const data = {
    ...defaults,
    network: {
      ...defaults.network,
      proxy: { ...defaults.network.proxy, passwordConfigured: false },
    },
  };
  const store = createSettingsStore({
    ...settingsBridge,
    async getHostSettings() {
      return data;
    },
    subscribeExternalSettingsChanged: () => () => {},
    updateHostSettings(_patch, host) {
      writes.push(host!.hostId);
      if (host!.hostId === 'A')
        return writes.filter((id) => id === 'A').length === 1 ? first.promise : second.promise;
      return Promise.resolve({ settings: data });
    },
  });
  const A = { hostId: 'A', profileId: 'A' };
  const B = { hostId: 'B', profileId: 'B' };
  store.observeHost(A);
  await tick();
  const write1 = store.updateHost({}, A);
  await tick();
  const write2 = store.updateHost({}, A);
  const rejection = assert.rejects(write2, /A failed/);
  store.observeHost(B);
  await tick();
  await store.updateHost({}, B);
  assert.deepEqual(writes, ['A', 'B']);
  first.resolve({ settings: data });
  await write1;
  await tick();
  second.reject(new Error('A failed'));
  await rejection;
  assert.deepEqual(writes, ['A', 'B', 'A']);
  assert.equal(store.host.getState().data, data);
  assert.equal(store.host.getState().error, undefined);
  store.host.disconnect();
});

test('a captured mutation cannot invalidate reads after disconnecting and reconnecting', async () => {
  const store = createResourceStore<string>();
  const load = async () => 'current';
  store.connect(load, () => () => {});
  await tick();
  const oldMutation = store.captureMutation();
  const pending = deferred<string>();
  store.disconnect();
  store.connect(
    () => pending.promise,
    () => () => {},
  );
  await oldMutation(async () => {});
  pending.resolve('new');
  await tick();
  assert.equal(store.getState().data, 'new');
  store.disconnect();
});
