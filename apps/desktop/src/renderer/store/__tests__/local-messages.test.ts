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

import test from 'node:test';
import assert from 'node:assert/strict';
import { observeLocalMessages } from '../local-messages.js';
import * as api from '../../bridge/session-local.js';
import type { TransientUserMessageProjection } from '@maka/ui';
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function fixture() {
  let changed = (_id: string) => {};
  let rows: readonly api.DesktopLocalMessage[] = [];
  let read = async () => rows;
  let reads = 0;
  const published = new Map<string, TransientUserMessageProjection>();
  const actions: string[][] = [];
  const errors: string[] = [];
  const stop = observeLocalMessages({
    sessionId: 'session',
    locale: 'en',
    api: {
      ...api,
      listLocalMessages: async () => {
        reads++;
        return read();
      },
      subscribeLocalMessageChanges: (handler) => {
        changed = handler;
        return () => {};
      },
      cancelLocalMessage: async (id, messageId) => {
        actions.push(['cancel', id, messageId]);
        rows = [];
      },
      reconcileLocalMessage: async (id, messageId) => {
        actions.push(['reconcile', id, messageId]);
      },
    },
    publish: (message) => {
      published.set(message.id, message);
    },
    retire: (id) => {
      published.delete(id);
    },
    snapshot: () => {},
    reportError: (message) => {
      errors.push(message);
    },
  });
  return {
    stop,
    published,
    actions,
    errors,
    changed: (id = 'session') => changed(id),
    reads: () => reads,
    setRows: (next: readonly api.DesktopLocalMessage[]) => {
      rows = next;
    },
    setRead: (next: typeof read) => {
      read = next;
    },
  };
}
const message = (
  state: api.DesktopLocalMessageState,
  canCancel = false,
): api.DesktopLocalMessage => ({
  sessionId: 'session',
  messageId: 'message',
  createdAt: 1,
  state,
  canCancel,
  text: 'saved text',
  placement: 'current_turn',
  attachments: [],
  inlineReferences: [],
});
test('saved messages rehydrate their status and only cancel through Main', async () => {
  const f = fixture();
  f.setRows([message('saved', true)]);
  f.changed();
  await tick();
  const row = f.published.get('message')!;
  assert.equal(row.deliveryStatus, 'Saved locally · waiting to send');
  await row.deliveryActions![0]!.onClick();
  assert.deepEqual(f.actions, [['cancel', 'session', 'message']]);
  assert.equal(f.published.size, 0);
  f.stop();
});
test('unknown delivery checks the existing id instead of creating a new send', async () => {
  const f = fixture();
  f.setRows([message('unknown')]);
  f.changed();
  await tick();
  const row = f.published.get('message')!;
  assert.equal(row.deliveryActions![0]!.label, 'Check status');
  await row.deliveryActions![0]!.onClick();
  assert.deepEqual(f.actions, [['reconcile', 'session', 'message']]);
  f.stop();
});
test('a failed read does not retract a pending message, but authoritative removal does', async () => {
  const f = fixture();
  f.setRows([message('sending')]);
  f.changed();
  await tick();
  f.setRead(async () => {
    throw Error('offline');
  });
  f.changed();
  await tick();
  assert.equal(f.published.size, 1);
  f.setRead(async () => []);
  f.changed();
  await tick();
  assert.equal(f.published.size, 0);
  f.stop();
});
test('an older or disconnected read cannot resurrect a removed message', async () => {
  const f = fixture();
  await tick();
  let resolve!: (rows: readonly api.DesktopLocalMessage[]) => void;
  f.setRead(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  f.changed();
  f.setRead(async () => []);
  f.changed();
  await tick();
  resolve([message('saved')]);
  await tick();
  assert.equal(f.published.size, 0);
  f.setRead(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  f.changed();
  f.stop();
  resolve([message('saved')]);
  await tick();
  assert.equal(f.published.size, 0);
});
test('local messages from other sessions do not refresh the active surface', async () => {
  const f = fixture();
  await tick();
  const count = f.reads();
  f.changed('other');
  await tick();
  assert.equal(f.reads(), count);
  f.stop();
});
