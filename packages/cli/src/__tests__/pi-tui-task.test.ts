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
import { stripAnsi } from '../tui-ansi.js';
import type { SessionTaskDocument, SessionTaskStatus } from '@maka/core/session-task';
import { CurrentTaskStore, TaskOverlay, renderTaskIndicator } from '../pi-tui-task.js';

/** One document from shorthand: ids are positional, everything else defaults. */
const snapshot = (
  items: Array<{ content: string; status: SessionTaskStatus }>,
): SessionTaskDocument => ({
  nextId: items.length + 1,
  items: items.map((item, index) => ({
    id: String(index + 1),
    subject: item.content,
    description: item.content,
    status: item.status,
    blocks: [],
    blockedBy: [],
    createdAt: 0,
    updatedAt: 0,
  })),
});

test('CurrentTaskStore distinguishes loading, empty, ready, and failure', async () => {
  const pending = deferred<ReturnType<typeof snapshot>>();
  let fail = false;
  const state = new CurrentTaskStore({
    read: async () => {
      if (fail) throw new Error('unavailable');
      return pending.promise;
    },
  });
  state.setSession('session-1');
  const load = state.refresh();
  assert.equal(state.getState().status, 'loading');
  pending.resolve(snapshot([]));
  assert.equal(await load, true);
  assert.equal(state.getState().status, 'empty');
  fail = true;
  await state.refresh();
  // Refreshes requested during a query are coalesced into one trailing query.
  await state.refresh();
  assert.equal(state.getState().status, 'error');
});

test('CurrentTaskStore exposes one current session and invalidates on dispose', async () => {
  const pending = deferred<ReturnType<typeof snapshot>>();
  const store = new CurrentTaskStore({ read: async () => pending.promise });
  store.setSession('session-1');
  assert.equal(store.getState().status, 'loading');
  store.dispose();
  pending.resolve(snapshot([{ content: 'late', status: 'in_progress' }]));
  await Promise.resolve();
  assert.equal(store.getState().status, 'idle');
  assert.equal(await store.refresh(), false);
});

test('CurrentTaskStore starts the new session while an old refresh is pending', async () => {
  const old = deferred<ReturnType<typeof snapshot>>();
  const next = deferred<ReturnType<typeof snapshot>>();
  const store = new CurrentTaskStore({
    read: async (sessionId) => (sessionId === 'old' ? old.promise : next.promise),
  });
  store.setSession('old');
  const oldLoad = store.refresh();
  store.setSession('new');
  assert.equal(store.getState().sessionId, 'new');
  assert.equal(store.getState().status, 'loading');
  next.resolve(snapshot([{ content: 'new', status: 'in_progress' }]));
  assert.equal(await store.refresh(), true);
  assert.equal(store.getState().items[0]?.subject, 'new');
  old.resolve(snapshot([{ content: 'old', status: 'completed' }]));
  assert.equal(await oldLoad, false);
  assert.equal(store.getState().items[0]?.subject, 'new');
});

test('refresh bursts coalesce without clearing the visible current list', async () => {
  const queued = deferred<ReturnType<typeof snapshot>>();
  let reads = 0;
  const store = new CurrentTaskStore({
    read: async () => {
      reads++;
      return reads === 1 ? snapshot([{ content: 'visible', status: 'pending' }]) : queued.promise;
    },
  });
  store.setSession('s');
  await store.refresh();
  assert.equal(reads, 2);
  const pending = store.refresh();
  assert.equal(store.refresh(), pending);
  store.setSession('s');
  assert.equal(reads, 2);
  assert.equal(store.getState().status, 'ready');
  assert.equal(store.getState().items[0]?.subject, 'visible');
  queued.resolve(snapshot([]));
  await pending;
  assert.equal(reads, 3);
  assert.equal(store.getState().status, 'empty');
  store.dispose();
});

test('renders a bounded indicator and hides empty state', async () => {
  const state = new CurrentTaskStore({
    read: async () =>
      snapshot([
        { content: 'Implement the current task list preview', status: 'in_progress' },
        { content: 'Done', status: 'completed' },
        { content: 'Next', status: 'pending' },
      ]),
  });
  state.setSession('s');
  await state.refresh();
  const indicator = renderTaskIndicator(state.getState(), { locale: 'en', width: 40 });
  const plainIndicator = stripAnsi(indicator ?? '');
  assert.ok(plainIndicator.length <= 40);
  assert.match(plainIndicator, /Tasks 1\/3 · \/tasks to view$/);

  state.setSession(undefined);
  assert.equal(renderTaskIndicator(state.getState(), { locale: 'zh-CN', width: 80 }), undefined);
});

test('CurrentTaskStore does not coalesce across A -> undefined -> A', async () => {
  const first = deferred<ReturnType<typeof snapshot>>();
  const second = deferred<ReturnType<typeof snapshot>>();
  let reads = 0;
  const store = new CurrentTaskStore({
    read: async () => (reads++ === 0 ? first.promise : second.promise),
  });
  store.setSession('A');
  store.setSession(undefined);
  store.setSession('A');
  assert.equal(reads, 2);
  second.resolve(snapshot([{ content: 'fresh', status: 'in_progress' }]));
  assert.equal(await store.refresh(), true);
  assert.equal(store.getState().items[0]?.subject, 'fresh');
  first.resolve(snapshot([{ content: 'stale', status: 'completed' }]));
  await Promise.resolve();
  assert.equal(store.getState().items[0]?.subject, 'fresh');
});

test('TaskOverlay renders status symbols, failure, and scrolls safely', async () => {
  const state = new CurrentTaskStore({
    read: async () =>
      snapshot([
        { content: 'pending item', status: 'pending' },
        { content: 'active item', status: 'in_progress' },
        { content: 'done item', status: 'completed' },
      ]),
  });
  state.setSession('s');
  await state.refresh();
  let closed = false;
  const overlay = new TaskOverlay({
    locale: 'zh-CN',
    getState: () => state.getState(),
    viewportRows: () => 4,
    onClose: () => {
      closed = true;
    },
  });
  assert.match(stripAnsi(overlay.render(24).join('\n')), /任务/);
  assert.match(overlay.render(24).join('\n'), /○|●|✓/);
  overlay.handleInput('\x1b[B');
  assert.match(stripAnsi(overlay.render(24).join('\n')), /active item/);
  overlay.handleInput('\x1b');
  assert.equal(closed, true);
});

test('TaskOverlay permits Kitty scrolling repeats but ignores closing repeats and releases', () => {
  let closes = 0;
  const overlay = new TaskOverlay({
    locale: 'en',
    getState: () => ({
      status: 'ready',
      items: Array.from({ length: 12 }, (_, i) => ({
        id: String(i + 1),
        subject: `item-${i}`,
        description: `item-${i}`,
        status: 'pending' as const,
        blocks: [],
        blockedBy: [],
        createdAt: 0,
        updatedAt: 0,
      })),
    }),
    viewportRows: () => 4,
    onClose: () => closes++,
  });
  const firstRow = () => stripAnsi(overlay.render(80)[1] ?? '').trim();
  assert.equal(firstRow(), '○ item-0');
  overlay.handleInput('\x1b[1;1:2B');
  assert.equal(firstRow(), '○ item-1');
  overlay.handleInput('\x1b[6;1:2~');
  assert.equal(firstRow(), '○ item-3');
  overlay.handleInput('\x1b[1;1:3B');
  assert.equal(firstRow(), '○ item-3');
  overlay.handleInput('\x1b[B');
  assert.equal(firstRow(), '○ item-4');
  for (const key of ['\x1b[27;1:2u', '\x1b[99;5:2u', '\x1b[27;1:3u']) {
    overlay.handleInput(key);
  }
  assert.equal(closes, 0);
  overlay.handleInput('\x1b');
  overlay.handleInput('\x03');
  assert.equal(closes, 2);
});

test('TaskOverlay wraps grapheme-safe content and supports Home/End', async () => {
  const state = new CurrentTaskStore({
    read: async () => snapshot([{ content: '👩‍💻 中文内容很长', status: 'pending' }]),
  });
  state.setSession('s');
  await state.refresh();
  let changes = 0;
  const overlay = new TaskOverlay({
    locale: 'en',
    getState: () => state.getState(),
    viewportRows: () => 4,
    onClose: () => undefined,
    onChange: () => changes++,
  });
  // The existing display projection removes zero-width format characters.
  assert.match(stripAnsi(overlay.render(8).join('\n')), /👩💻/);
  overlay.handleInput('\x1b[H');
  overlay.handleInput('\x1b[F');
  assert.equal(changes, 2);
});

test('error state renders unavailable instead of exposing query errors', async () => {
  const state = new CurrentTaskStore({
    read: async () => {
      throw new Error('secret-token');
    },
  });
  state.setSession('s');
  await state.refresh();
  const indicator = stripAnsi(
    renderTaskIndicator(state.getState(), { locale: 'en', width: 80 }) ?? '',
  );
  assert.equal(indicator, 'Tasks unavailable · /tasks to view');
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
