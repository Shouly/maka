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
import { createRevisionActions } from '../revision-actions.js';
import { createRevisionDraftStore } from '../revision-draft.js';
import type { DesktopSessionSummary, SessionSubmitResult } from '../../bridge/sessions.js';

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
const success = {
  ok: true,
  disposition: 'started',
  attachments: [],
  inlineReferences: [],
} as unknown as SessionSubmitResult;
function revisionFixture() {
  const draft = createRevisionDraftStore();
  draft.begin({ sessionId: 'source', turnId: 'turn', text: 'edited' });
  let selected = 'source';
  const listeners = new Set<() => void>();
  const copy = deferred<DesktopSessionSummary>();
  const settled = deferred<{ settled: boolean }>();
  const admitted = deferred<SessionSubmitResult>();
  const sends: { id: string; text: string; messageId: string }[] = [];
  const abandons: string[] = [];
  const texts: [string, string][] = [];
  let copies = 0;
  let response: SessionSubmitResult | undefined;
  let cleanupError = false;
  const select = (id: string) => {
    selected = id;
    for (const listener of listeners) listener();
  };
  const actions = createRevisionActions({
    draft,
    selected: () => selected,
    select,
    subscribeSelection: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    upsert: () => {},
    revise: () => {
      copies++;
      return copy.promise;
    },
    settle: () => settled.promise,
    submit: async (id, text, messageId) => {
      sends.push({ id, text, messageId });
      return response ?? admitted.promise;
    },
    abandon: async (_id, copyId) => {
      abandons.push(copyId);
      if (cleanupError) throw new Error('cleanup offline');
    },
    setText: (id, text) => {
      texts.push([id, text]);
    },
    show: () => {},
    remove: () => {},
    refresh: async () => {},
  });
  const row = { id: 'fork' } as DesktopSessionSummary;
  return {
    draft,
    actions,
    copy,
    settled,
    admitted,
    sends,
    abandons,
    texts,
    select,
    row,
    copies: () => copies,
    respond: (value: SessionSubmitResult) => {
      response = value;
    },
    failCleanup: (value: boolean) => {
      cleanupError = value;
    },
  };
}
for (const phase of ['copy', 'settlement'] as const)
  test(`cancel during ${phase} never submits or clears a later draft`, async () => {
    const f = revisionFixture();
    const sending = f.actions.submit();
    if (phase === 'settlement') {
      f.copy.resolve(f.row);
      await tick();
    }
    await f.actions.cancel();
    assert.equal(f.abandons.length, 1);
    f.draft.begin({ sessionId: 'other', turnId: 'new', text: 'keep me' });
    f.copy.resolve(f.row);
    f.settled.resolve({ settled: true });
    await sending;
    assert.equal(f.sends.length, 0);
    assert.equal(f.draft.getState().draft?.text, 'keep me');
  });
test('leaving a preparing revision cancels it, including returning to its source', async () => {
  const f = revisionFixture();
  const sending = f.actions.submit();
  f.copy.resolve(f.row);
  await tick();
  f.select('source');
  await tick();
  f.settled.resolve({ settled: true });
  await sending;
  assert.equal(f.sends.length, 0);
  assert.equal(f.draft.getState().draft, undefined);
});
test('unknown admission retains the fork and retries exactly the same message', async () => {
  const f = revisionFixture();
  const sending = f.actions.submit();
  f.copy.resolve(f.row);
  f.settled.resolve({ settled: true });
  await tick();
  f.admitted.resolve({ ok: false, reason: 'outcome_unknown' } as SessionSubmitResult);
  await sending;
  assert.equal(f.draft.getState().draft?.phase, 'uncertain');
  await f.actions.cancel();
  assert.ok(f.draft.getState().draft);
  f.draft.setText('different');
  assert.equal(f.draft.getState().draft?.text, 'edited');
  f.respond(success);
  await f.actions.submit();
  assert.equal(f.draft.getState().draft, undefined);
  assert.equal(f.copies(), 1);
  assert.deepEqual(f.sends[0], f.sends[1]);
  assert.deepEqual(f.abandons, []);
});
test('transport error after submit does not abandon possibly admitted work', async () => {
  const f = revisionFixture();
  const sending = f.actions.submit();
  f.copy.resolve(f.row);
  f.settled.resolve({ settled: true });
  await tick();
  f.admitted.reject(new Error('connection lost'));
  await assert.rejects(sending);
  assert.equal(f.draft.getState().draft?.phase, 'uncertain');
  assert.deepEqual(f.abandons, []);
});
test('successful revision clears only its draft and cannot be cancelled during admission', async () => {
  const f = revisionFixture();
  const sending = f.actions.submit();
  f.copy.resolve(f.row);
  f.settled.resolve({ settled: true });
  await tick();
  await f.actions.cancel();
  assert.ok(f.draft.getState().draft);
  f.admitted.resolve(success);
  await sending;
  assert.equal(f.draft.getState().draft, undefined);
  assert.deepEqual(f.texts.at(-1), ['fork', '']);
  assert.deepEqual(f.abandons, []);
});
test('cleanup failure retains the cancellation for retry without reusing its copy', async () => {
  const f = revisionFixture();
  const sending = f.actions.submit();
  f.failCleanup(true);
  await assert.rejects(f.actions.cancel());
  assert.equal(f.draft.getState().draft?.cleanupRequested, true);
  await f.actions.submit();
  assert.equal(f.copies(), 1);
  f.failCleanup(false);
  await f.actions.cancel();
  assert.equal(f.draft.getState().draft, undefined);
  f.copy.resolve(f.row);
  f.settled.resolve({ settled: true });
  await sending;
  assert.equal(f.sends.length, 0);
});

test('canonical message proof resolves an unknown revision without resubmission', async () => {
  const f = revisionFixture();
  const sending = f.actions.submit();
  f.copy.resolve(f.row);
  f.settled.resolve({ settled: true });
  await tick();
  f.admitted.resolve({ ok: false, reason: 'outcome_unknown' } as SessionSubmitResult);
  await sending;
  const messageId = f.sends[0]!.messageId;
  f.actions.reconcile('another-task', [messageId]);
  assert.ok(f.draft.getState().draft);
  f.actions.reconcile('fork', ['another-message']);
  assert.ok(f.draft.getState().draft);
  f.actions.reconcile('fork', [messageId]);
  assert.equal(f.draft.getState().draft, undefined);
  assert.equal(f.sends.length, 1);
  assert.deepEqual(f.abandons, []);
});

test('pending first prompt precedes its live reply while follow-ups stay after it', async () => {
  const { placeTransientMessages } = await import('../../lib/transient-message-placement.js');
  const turn = {
    turnId: 'live',
    timeline: [],
    tools: [],
    notes: [],
    status: 'running',
  } as unknown as import('@maka/ui').TurnViewModel;
  const first = {
    id: 'first',
    ts: 1,
    text: 'question',
    transientPlacement: 'current_turn' as const,
  };
  const next = {
    id: 'next',
    ts: 2,
    text: 'next question',
    transientPlacement: 'next_turn' as const,
  };
  const placement = placeTransientMessages([turn], [first, next]);
  assert.deepEqual(placement.before.get('live'), [first]);
  assert.deepEqual(placement.tail, [next]);
  const settled = { ...turn, user: { id: 'first', role: 'user' as const, text: 'question' } };
  assert.deepEqual(placeTransientMessages([settled], [first, next]).tail, [next]);
  assert.equal(placeTransientMessages([settled], [first, next]).before.size, 0);
});
