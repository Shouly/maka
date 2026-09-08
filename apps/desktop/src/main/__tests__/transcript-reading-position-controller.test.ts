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

// The enterprise renderer owns restore lifetime in `store/active-session-store.ts`
// rather than in a React controller, so the shell-shaped paging-gate cases from
// upstream live with that store. What is kept here is the part that is pure
// module behaviour: navigation admission, bookmark lifecycle and send pinning.
import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred } from '@maka/core/test-only/async-primitives';
import type { StoredMessage } from '@maka/core/session';
import type { DesktopTranscriptHandle, DesktopTranscriptNavigation } from '../../preload/transcript-contract.js';
import { encodeDesktopTranscriptSnapshot } from '../desktop-transcript-ipc.js';
import { createDesktopTranscriptRangeController, DesktopTranscriptRangeStore } from '../../renderer/lib/ported/desktop-transcript-range-store.js';
import {
  createTranscriptRestoreLifecycle,
  prepareTranscriptForSend,
  restoreSessionTranscriptRange,
} from '../../renderer/lib/ported/transcript-reading-position.js';

test('sending before transcript open completes supersedes the queued bookmark without delaying admission', { timeout: 5_000 }, async () => {
  const sessionId = JSON.stringify(['host-1', 'session-1']);
  const store = new DesktopTranscriptRangeStore(sessionId);
  const opening = deferred<DesktopTranscriptHandle>();
  const controller = createDesktopTranscriptRangeController(store, () => opening.promise);
  const lifecycle = createTranscriptRestoreLifecycle();
  const requests: Array<{ sequence: number | null; navigation?: DesktopTranscriptNavigation }> = [];
  const handle: DesktopTranscriptHandle = {
    sessionId, generation: 'generation-1', hostEpoch: 'host-1', readThroughMessageId: null,
    loadBefore: async () => {}, loadAfter: async () => {}, close: async () => {},
    async loadAround(sequence, _maxBytes, navigation) {
      requests.push({ sequence, navigation });
      const turnId = sequence === null ? 'b' : 'a';
      for (const batch of encodeDesktopTranscriptSnapshot({
        sessionId: 'session-1', generation: 'generation-1', hostEpoch: 'host-1',
        navigationVersion: navigation!.navigationVersion, durableThrough: 20,
        durable: [{ sequence: sequence ?? 20, message: {
          type: 'assistant', id: `answer-${turnId}`, turnId, text: turnId, ts: 1, modelId: 'fixture',
        } }], overlay: [], hasOlder: true, hasNewer: sequence !== null,
      })) store.accept(batch);
    },
  };
  const restore = () => restoreSessionTranscriptRange({
    lifecycle, sessionId, controller, readingAnchor: { turnId: 'a', sequence: 10 },
    isCurrent: () => true,
    setReadingAnchor: () => assert.fail('the cancelled bookmark must not be restored'),
    onError: (error) => assert.fail(String(error)),
  });
  try {
    restore();
    assert.throws(() => store.range(), /not initialized/);
    let pins = 0;
    assert.equal(await prepareTranscriptForSend({
      sessionId, currentSessionId: { current: sessionId }, controller: { current: controller },
      cancel: (target) => lifecycle.cancel(target), followLatest: () => { pins += 1; },
    }), true, 'local admission must finish while transcript open is still pending');
    assert.equal(pins, 1);
    assert.equal(requests.length, 0);
    opening.resolve(handle);
    await new Promise((resolve) => setImmediate(resolve));
    restore();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(requests.map(({ sequence, navigation }) =>
      [sequence, navigation?.intent, navigation?.navigationVersion]), [[null, 'followTail', 2]]);
    assert.deepEqual(store.snapshot().messages.map(({ id }) => id), ['answer-b']);
    const latest = store.snapshot();
    for (const batch of encodeDesktopTranscriptSnapshot({
      sessionId: 'session-1', generation: 'generation-1', hostEpoch: 'host-1',
      navigationVersion: 1, durableThrough: 20,
      durable: [{ sequence: 10, message: {
        type: 'assistant', id: 'answer-a', turnId: 'a', text: 'a', ts: 1, modelId: 'fixture',
      } }], overlay: [], hasOlder: false, hasNewer: true,
    })) assert.equal(store.accept(batch), false);
    assert.strictEqual(store.snapshot(), latest, 'a late history response must not replace the latest range');
  } finally {
    opening.resolve(handle);
    await controller.close();
  }
});

test('a resident search supersedes send catch-up before its older latest response can evict the target', async () => {
  const sessionId = JSON.stringify(['host-1', 'session-1']);
  const store = new DesktopTranscriptRangeStore(sessionId);
  const latestStarted = deferred<void>();
  const latestFinished = deferred<void>();
  const releaseLatest = deferred<void>();
  const readingAdmitted = deferred<void>();
  const admissions: Array<{ sequence: number | null; version: number; preserveRange?: boolean }> = [];
  const publish = (turnId: string, sequence: number, navigationVersion: number) => {
    const message: StoredMessage = {
      type: 'assistant', id: `answer-${turnId}`, turnId, text: turnId, ts: 1, modelId: 'fixture',
    };
    for (const batch of encodeDesktopTranscriptSnapshot({
      sessionId: 'session-1', generation: 'generation-1', hostEpoch: 'host-1', navigationVersion,
      durableThrough: 20, durable: [{ sequence, message }], overlay: [], hasOlder: false, hasNewer: turnId === 'a',
    })) store.accept(batch);
  };
  publish('a', 10, 0);
  const controller = createDesktopTranscriptRangeController(store, async () => ({
    sessionId, generation: 'generation-1', hostEpoch: 'host-1', readThroughMessageId: null,
    loadBefore: async () => {}, loadAfter: async () => {},
    async loadAround(sequence, _maxBytes, navigation) {
      const version = navigation!.navigationVersion;
      admissions.push({ sequence, version, preserveRange: navigation!.preserveRange });
      if (sequence === null) {
        latestStarted.resolve();
        await releaseLatest.promise;
        publish('b', 20, version);
        latestFinished.resolve();
      } else {
        publish('a', 10, version);
        readingAdmitted.resolve();
      }
    },
    close: async () => {},
  }));
  try {
    const lifecycle = createTranscriptRestoreLifecycle();
    assert.equal(await prepareTranscriptForSend({
      sessionId, currentSessionId: { current: sessionId }, controller: { current: controller },
      cancel: (sessionId) => lifecycle.cancel(sessionId),
      followLatest: () => {},
    }), true, 'local admission must not wait for the latest range');
    await latestStarted.promise;
    const restore = () => restoreSessionTranscriptRange({
      lifecycle, sessionId, controller,
      searchTarget: { sessionId, turnId: 'a', sequence: 10, nonce: 1 },
      isCurrent: () => true, setReadingAnchor: () => {},
      onError: (error) => assert.fail(String(error)),
    });
    restore();
    await readingAdmitted.promise;
    releaseLatest.resolve();
    await latestFinished.promise;
    await new Promise((resolve) => setImmediate(resolve));
    restore();
    assert.deepEqual(admissions, [
      { sequence: null, version: 1, preserveRange: undefined },
      { sequence: 10, version: 2, preserveRange: true },
    ]);
    assert.equal(store.sequenceForTurn('a'), 10);
    assert.equal(store.sequenceForTurn('b'), null);
    assert.deepEqual(store.snapshot().messages.map((message) => message.turnId), ['a']);
  } finally {
    releaseLatest.resolve();
    await controller.close();
  }
});

for (const source of ['bootstrap overlay', 'live projection'] as const) {
test(`a ${source} bookmark admits its Turn once and retains it across range reload`, async () => {
  const sessionId = JSON.stringify(['host-1', 'session-1']);
  const store = new DesktopTranscriptRangeStore(sessionId);
  const overlay: StoredMessage = {
    type: 'assistant', id: 'answer-b', turnId: 'b', text: 'partial B', ts: 1, modelId: 'fixture',
  };
  const publish = (navigationVersion: number) => {
    for (const batch of encodeDesktopTranscriptSnapshot({
      sessionId: 'session-1', generation: 'generation-1', hostEpoch: 'host-1', navigationVersion,
      durableThrough: null, durable: [], overlay: source === 'bootstrap overlay' ? [overlay] : [],
      hasOlder: false, hasNewer: false,
    })) store.accept(batch);
  };
  publish(0);
  const admissions: Array<{ sequence: number | null; turnId?: string; version: number; preserveRange?: boolean }> = [];
  const controller = createDesktopTranscriptRangeController(store, async () => ({
    sessionId, generation: 'generation-1', hostEpoch: 'host-1', readThroughMessageId: null,
    loadBefore: async () => {}, loadAfter: async () => {}, close: async () => {},
    async loadAround(sequence, _maxBytes, navigation) {
      admissions.push({ sequence, turnId: navigation!.readingTurnId,
        version: navigation!.navigationVersion, preserveRange: navigation!.preserveRange });
      publish(navigation!.navigationVersion);
    },
  }));
  const lifecycle = createTranscriptRestoreLifecycle();
  let unavailable = 0;
  let cleared = 0;
  const restore = () => restoreSessionTranscriptRange({
    lifecycle, sessionId, controller, readingAnchor: { turnId: 'b' },
    isCurrent: () => true,
    isLiveTurn: (candidateSessionId, turnId) => source === 'live projection' &&
      candidateSessionId === sessionId && turnId === 'b',
    setReadingAnchor: (_sessionId, anchor) => { if (!anchor) cleared += 1; },
    onRestoreUnavailable: () => { unavailable += 1; }, onError: (error) => assert.fail(String(error)),
  });
  try {
    restore();
    await new Promise((resolve) => setImmediate(resolve));
    restore();
    assert.equal(store.sequenceForTurn('b'), null);
    assert.equal(unavailable, 0);
    assert.equal(cleared, 0);
    assert.deepEqual(admissions, [{ sequence: null, turnId: 'b', version: 1, preserveRange: true }]);
    await controller.reload();
    assert.deepEqual(admissions[1], { sequence: null, turnId: 'b', version: 1, preserveRange: false });
  } finally {
    await controller.close();
  }
});
}

test('both paging directions retain an overlay-only Turn identity and admit a fresh intent', async () => {
  const sessionId = JSON.stringify(['host-1', 'session-1']);
  const store = new DesktopTranscriptRangeStore(sessionId);
  const message = (turnId: string): StoredMessage => ({
    type: 'assistant', id: `answer-${turnId}`, turnId, text: turnId, ts: 1, modelId: 'fixture',
  });
  for (const batch of encodeDesktopTranscriptSnapshot({
    sessionId: 'session-1', generation: 'generation-1', hostEpoch: 'host-1', navigationVersion: 0,
    durableThrough: 40, durable: [{ sequence: 10, message: message('a') }],
    overlay: [message('b')], hasOlder: true, hasNewer: true,
  })) store.accept(batch);
  const calls: Array<{ operation: string; sequence: number | null; turnId?: string; version?: number }> = [];
  const record = (operation: string) => async (sequence: number | null, _maxBytes?: number,
    navigation?: import('../../preload/transcript-contract.js').DesktopTranscriptNavigation) => {
    calls.push({ operation, sequence, turnId: navigation?.readingTurnId, version: navigation?.navigationVersion });
  };
  const controller = createDesktopTranscriptRangeController(store, async () => ({
    sessionId, generation: 'generation-1', hostEpoch: 'host-1', readThroughMessageId: null,
    loadBefore: record('before'), loadAfter: record('after'), loadAround: record('around'), close: async () => {},
  }));
  try {
    await controller.setReadingAnchor(null, 'b');
    await controller.loadBefore(undefined, 'b');
    await controller.loadAfter(undefined, 'b');
    await controller.loadBefore(undefined, 'a');
    await controller.loadAfter(undefined, 'a');
    assert.deepEqual(calls, [
      { operation: 'around', sequence: null, turnId: 'b', version: 1 },
      { operation: 'around', sequence: null, turnId: 'b', version: 2 },
      { operation: 'around', sequence: null, turnId: 'b', version: 3 },
      { operation: 'before', sequence: 10, turnId: 'a', version: 4 },
      { operation: 'after', sequence: 10, turnId: 'a', version: 5 },
    ]);
  } finally {
    await controller.close();
  }
});
