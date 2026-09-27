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
import { setImmediate } from 'node:timers/promises';
import { WORKHUB_COORDINATION_SESSION_ID } from '@maka/core/session';
import { deferred, waitFor } from '@maka/core/test-only/async-primitives';
import type { RuntimeHostConnection } from '@maka/runtime-host/client';
import type { SessionCatalogChangedFrame } from '@maka/runtime-host/protocol';
import { DesktopRuntimeHostClient } from '../runtime-host-client.js';
import { deduplicateRunNotifications, type RunNotificationEvent } from '../notifications-policy.js';
import { observeRuntimeHostNotifications } from '../runtime-host-notifications.js';

test('notifies for any Session from the catalog feed alone, named after it', async (t) => {
  const f = fixture();
  t.after(f.close);
  f.changed({ kind: 'session.catalog.changed', revision: 1, sessionId: 'plain' });
  f.changed({
    kind: 'session.catalog.changed',
    revision: 2,
    sessionId: WORKHUB_COORDINATION_SESSION_ID,
    attention: { kind: 'completed', eventId: 'workhub-terminal' },
  });
  for (const [sessionId, kind, body] of [
    ['background-question', 'waiting', 'Which branch?'],
    ['background-complete', 'completed', undefined],
    ['background-failed', 'errored', 'provider failed'],
  ] as const) {
    f.changed({
      kind: 'session.catalog.changed',
      revision: 3,
      sessionId,
      attention: { kind, eventId: sessionId, ...(body ? { body } : {}) },
    });
  }
  await waitFor(() => f.notifications.length === 3, { timeoutMs: 1000 });
  assert.deepEqual(f.notifications, [
    { kind: 'waiting', title: 'background-question', body: 'Which branch?' },
    { kind: 'completed', title: 'background-complete', body: 'reply-background-complete' },
    { kind: 'errored', title: 'background-failed', body: 'provider failed' },
  ]);
  // Only the three attentions read a name; a plain change and WorkHub do not.
  assert.equal(f.operations.length, 3);
  assert.deepEqual(f.errors, []);
});

test('drops a notification whose name read outlives the observer', async () => {
  const f = fixture();
  const content = deferred<null>();
  f.client.getSession = () => content.promise;
  f.changed({
    kind: 'session.catalog.changed',
    revision: 1,
    sessionId: 'a',
    attention: { kind: 'completed', eventId: 'done' },
  });
  f.close();
  content.resolve(null);
  await setImmediate();
  assert.deepEqual(f.notifications, []);
  assert.equal(f.listenersRemaining(), 0);
});

test('a Guest reads its shared Session, and a failed read still notifies with fallback copy', async (t) => {
  const f = fixture(true);
  t.after(f.close);
  f.client.getSession = async () => {
    throw new Error('Owner-only query must not be used');
  };
  f.client.getSharedSession = async () => {
    throw new Error('Host disconnected');
  };
  f.changed({
    kind: 'session.catalog.changed',
    revision: 1,
    sessionId: 'shared',
    attention: { kind: 'waiting', eventId: 'question', body: 'Answer?' },
  });
  await waitFor(() => f.notifications.length === 1, { timeoutMs: 1000 });
  assert.deepEqual(f.notifications, [{ kind: 'waiting', title: undefined, body: 'Answer?' }]);
  assert.deepEqual(f.errors, []);
});

test('owner and Guest feeds of one Host notify once; other events, Sessions and Hosts still do', async (t) => {
  const notifications: RunNotificationEvent[] = [];
  const pending = deferred<void>();
  const notify = deduplicateRunNotifications(async (input) => {
    notifications.push(input);
    await pending.promise;
  });
  const owner = fixture(false, notify);
  const guest = fixture(true, notify);
  const otherHost = fixture(false, notify, 'host-2');
  t.after(() => {
    pending.resolve();
    owner.close();
    guest.close();
    otherHost.close();
  });
  const frame: SessionCatalogChangedFrame = {
    kind: 'session.catalog.changed',
    revision: 1,
    sessionId: 'shared',
    attention: { kind: 'waiting', eventId: 'question' },
  };
  owner.changed(frame);
  guest.changed(frame);
  otherHost.changed(frame);
  owner.changed({ ...frame, sessionId: 'other-session' });
  owner.changed({ ...frame, attention: { kind: 'completed', eventId: 'terminal' } });
  await waitFor(() => notifications.length === 4, { timeoutMs: 1000 });
  await setImmediate();
  assert.deepEqual(
    notifications.map(({ hostEpoch, sessionId, eventId }) => [hostEpoch, sessionId, eventId]),
    [
      ['host-1', 'shared', 'question'],
      ['host-2', 'shared', 'question'],
      ['host-1', 'other-session', 'question'],
      ['host-1', 'shared', 'terminal'],
    ],
  );
});

function fixture(
  shared = false,
  notify?: (input: RunNotificationEvent) => Promise<void>,
  hostEpoch = 'host-1',
) {
  let listener: ((frame: SessionCatalogChangedFrame) => void) | undefined;
  const notifications: Pick<RunNotificationEvent, 'kind' | 'title' | 'body'>[] = [];
  const errors: unknown[] = [];
  const operations: string[] = [];
  const connection = {
    hostEpoch,
    request: async (operation: string, input: { sessionId?: string }) => {
      operations.push(operation);
      return {
        kind: 'session',
        session: {
          id: input.sessionId,
          name: input.sessionId,
          lastMessagePreview: `reply-${input.sessionId}`,
        },
      };
    },
    subscribeSessionCatalogChanges(next: typeof listener) {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
  } as unknown as RuntimeHostConnection;
  const client = new DesktopRuntimeHostClient(connection);
  const close = observeRuntimeHostNotifications(
    client,
    notify ??
      (async ({ kind, title, body }) => {
        notifications.push({ kind, title, body });
      }),
    (error) => errors.push(error),
    shared,
  );
  return {
    client,
    close,
    operations,
    notifications,
    errors,
    changed(frame: SessionCatalogChangedFrame) {
      listener?.(frame);
    },
    listenersRemaining: () => Number(!!listener),
  };
}
