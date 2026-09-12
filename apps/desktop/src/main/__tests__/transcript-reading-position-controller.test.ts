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
// rather than in a React controller, so the shell-shaped cases from upstream
// (return to latest, edge filling, epoch re-anchor, window retention) live with
// that store's tests. What is kept here is the part that is pure module
// behaviour: navigation admission, bookmark lifecycle and send pinning.
import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred } from '@maka/core/test-only/async-primitives';
import type { StoredMessage } from '@maka/core/session';
import type { DesktopTranscriptHandle } from '../../preload/transcript-contract.js';
import { encodeDesktopTranscriptSnapshot } from '../desktop-transcript-ipc.js';
import {
  createDesktopTranscriptRangeController,
  DesktopTranscriptRangeStore,
} from '../../renderer/lib/ported/desktop-transcript-range-store.js';
import {
  createTranscriptRestoreLifecycle,
  prepareTranscriptForSend,
  restoreSessionTranscriptRange,
  TranscriptReadSupersededError,
} from '../../renderer/lib/ported/transcript-reading-position.js';

test('sending before transcript open completes supersedes the queued bookmark without delaying admission', { timeout: 5_000 }, async () => {
  const sessionId = JSON.stringify(['host-1', 'session-1']);
  const store = new DesktopTranscriptRangeStore(sessionId);
  const opening = deferred<DesktopTranscriptHandle>();
  const controller = createDesktopTranscriptRangeController(store, () => opening.promise);
  const lifecycle = createTranscriptRestoreLifecycle();
  const requests: Array<{ sequence: number | null; navigation: number }> = [];
  const publish = (sequence: number | null, navigation: number) => {
    requests.push({ sequence, navigation });
    const turnId = sequence === null ? 'b' : 'a';
    for (const batch of encodeDesktopTranscriptSnapshot({
      sessionId: 'session-1', generation: 'generation-1', hostEpoch: 'host-1',
      durableThrough: 20,
      durable: [{ sequence: sequence ?? 20, message: {
        type: 'assistant', id: `answer-${turnId}`, turnId, text: turnId, ts: 1, modelId: 'fixture',
      } }], overlay: [], hasOlder: true, hasNewer: sequence !== null,
    }, navigation)) store.accept(batch);
  };
  const handle: DesktopTranscriptHandle = {
    sessionId, generation: 'generation-1', hostEpoch: 'host-1', readThroughMessageId: null,
    acknowledgeTail: async () => {},
    loadBefore: async () => {}, loadAfter: async () => {}, close: async () => {},
    async loadAround(sequence, _maxBytes, navigation) { publish(sequence, navigation); },
    async loadLatest(navigation) { publish(null, navigation); },
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
      [sequence, navigation]), [[null, 2]]);
    assert.deepEqual(store.snapshot().messages.map(({ id }) => id), ['answer-b']);
    const latest = store.snapshot();
    for (const batch of encodeDesktopTranscriptSnapshot({
      sessionId: 'session-1', generation: 'generation-1', hostEpoch: 'host-1',
      durableThrough: 20,
      durable: [{ sequence: 10, message: {
        type: 'assistant', id: 'answer-a', turnId: 'a', text: 'a', ts: 1, modelId: 'fixture',
      } }], overlay: [], hasOlder: false, hasNewer: true,
    }, 1)) assert.equal(store.accept(batch), false);
    assert.strictEqual(store.snapshot(), latest, 'a late history response must not replace the latest range');
  } finally {
    opening.resolve(handle);
    await controller.close();
  }
});

test('an overlay-only bookmark stays available without loading another range', async () => {
  const sessionId = JSON.stringify(['host-1', 'session-1']);
  const store = new DesktopTranscriptRangeStore(sessionId);
  const overlay: StoredMessage = {
    type: 'assistant', id: 'answer-b', turnId: 'b', text: 'partial B', ts: 1, modelId: 'fixture',
  };
  for (const batch of encodeDesktopTranscriptSnapshot({
    sessionId: 'session-1', generation: 'generation-1', hostEpoch: 'host-1',
    durableThrough: null, durable: [], overlay: [overlay], hasOlder: false, hasNewer: false,
  })) store.accept(batch);
  const controller = createDesktopTranscriptRangeController(store, async () => ({
    sessionId, generation: 'generation-1', hostEpoch: 'host-1', readThroughMessageId: null,
    acknowledgeTail: async () => {},
    loadBefore: async () => {}, loadAfter: async () => {}, close: async () => {},
    loadAround: async () => assert.fail('an overlay-only bookmark has no page to load'),
    loadLatest: async () => assert.fail('an overlay-only bookmark has no page to load'),
  }));
  const lifecycle = createTranscriptRestoreLifecycle();
  let unavailable = 0;
  let cleared = 0;
  const restore = () => restoreSessionTranscriptRange({
    lifecycle, sessionId, controller, readingAnchor: { turnId: 'b' },
    isCurrent: () => true,
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
  } finally {
    await controller.close();
  }
});

test('a read superseded by a Host epoch change leaves the bookmark alone', async () => {
  const sessionId = 'session-1';
  const lifecycle = createTranscriptRestoreLifecycle();
  const controller = {
    store: {
      sessionId,
      range: () => ({ sessionId }),
      sequenceForTurn: () => null,
      newestDurableUserSequence: () => null,
      snapshot: () => ({ messages: [] }),
    },
    loadAround: async () => {
      throw new TranscriptReadSupersededError('Desktop transcript host epoch changed; reopen the transcript');
    },
  };
  restoreSessionTranscriptRange({
    lifecycle, sessionId, controller, readingAnchor: { turnId: 'turn-t', sequence: 10 },
    isCurrent: () => true,
    setReadingAnchor: () => assert.fail('a superseded read must not clear the bookmark'),
    onRestoreUnavailable: () => assert.fail('a superseded read decides nothing about the bookmark'),
    onError: (error) => assert.fail(String(error)),
  });
  await new Promise((resolve) => setImmediate(resolve));
});
