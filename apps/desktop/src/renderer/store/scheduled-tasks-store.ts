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

// Scheduled tasks: the sidebar's Scheduled band and the module page.
//
// One store for both, started once for the app's lifetime, because the badge
// has to be right whether or not the page has ever been opened — an automation
// nobody remembers arming is the one that surprises them. The page therefore
// does not connect anything; it reads this store and writes through the
// mutations below.
//
// The mutations go through `store.mutate` rather than calling the bridge from
// a component so that the list is re-read after every write on the same
// latest-read-wins rule as the subscription refresh. The Host also pushes a
// `scheduled_tasks_changed` event for each of them, so the re-read is belt and
// braces — but the event is not ordered against the promise, and a row that
// snaps back for one frame after "Run now" is exactly the flicker that costs
// more to explain than to prevent.

import * as api from '../bridge/scheduled-tasks.js';
import type { ScheduledTask } from '../bridge/scheduled-tasks.js';
import type { DesktopRuntimeHostRef } from '../bridge/projects.js';
import { parseDesktopSessionKey } from '../bridge/session-keys.js';
import { createStore } from 'zustand/vanilla';
import { createResourceStore } from './resource-store.js';

/**
 * The task whose page is open, if any.
 *
 * Component state would be enough for the page itself, but the breadcrumb for
 * that page is drawn by the WINDOW TITLEBAR — the reference puts it in the
 * window's top row, left of the content column, and Maka's titlebar owns that
 * row. The shell and the page therefore have to agree on which task is open,
 * and neither one contains the other.
 */
export const scheduledTaskDetailStore = createStore<{ taskId: string | null }>(() => ({
  taskId: null,
}));

export function openScheduledTaskDetail(taskId: string | null): void {
  scheduledTaskDetailStore.setState({ taskId });
}

/**
 * Which task the Scheduled tasks page should open.
 *
 * A handoff, not navigation state: the transcript's card and the sidebar both
 * send the reader to one task, and the nav selection they travel through is
 * persisted to localStorage — a task id has no business surviving a restart
 * there.
 *
 * SUBSCRIBABLE, because the page is often already on screen when the request
 * arrives. Reading it once as a mount-time initializer meant a second click
 * from the sidebar did nothing at all: the component was mounted, the
 * initializer never ran again, and the request sat there unclaimed.
 */
const focusListeners = new Set<(taskId: string) => void>();
let requestedFocusId: string | null = null;

export function requestScheduledTaskFocus(taskId: string): void {
  requestedFocusId = taskId;
  for (const listener of focusListeners) listener(taskId);
}

/** Claims a request made before the page was listening, and clears it. */
export function takeScheduledTaskFocus(): string | null {
  const id = requestedFocusId;
  requestedFocusId = null;
  return id;
}

export function subscribeScheduledTaskFocus(listener: (taskId: string) => void): () => void {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

/**
 * The renderer key for a session a scheduled run produced.
 *
 * A run records the Runtime Host's own session id. The renderer keys sessions
 * by `desktopSessionKey({hostId, sessionId})` — the Host id is part of the
 * identity, because two Hosts can hold sessions with the same id — so the raw
 * id cannot be handed to `sessionsStore.select`. Passing it anyway got as far
 * as the transcript store's constructor, which parsed it as a key and threw,
 * taking the renderer down with it.
 *
 * Resolved by scanning the catalog rather than by assuming the default Host:
 * the answer is then a key that certainly exists, and a run whose session has
 * since been deleted resolves to nothing instead of to a key for a session
 * that is gone.
 */
export function desktopSessionKeyForRun(
  rows: readonly { readonly id: string }[],
  hostSessionId: string,
): string | undefined {
  return rows.find((row) => {
    try {
      return parseDesktopSessionKey(row.id).sessionId === hostSessionId;
    } catch {
      return false;
    }
  })?.id;
}

export function createScheduledTasksStore(bridge = api) {
  const store = createResourceStore<ScheduledTask[]>();
  return {
    ...store,
    start(): () => void {
      return store.connect(
        () => bridge.listScheduledTasks(),
        (refresh) => bridge.subscribeScheduledTaskChanges(refresh),
      );
    },
    create: (input: Parameters<typeof api.createScheduledTask>[0], host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.createScheduledTask(input, host)),
    update: (
      id: string,
      patch: Parameters<typeof api.updateScheduledTask>[1],
      host?: DesktopRuntimeHostRef,
    ) => store.mutate(() => bridge.updateScheduledTask(id, patch, host)),
    setEnabled: (id: string, enabled: boolean, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.setScheduledTaskEnabled(id, enabled, host)),
    triggerNow: (id: string, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.triggerScheduledTaskNow(id, host)),
    snooze: (id: string, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.snoozeScheduledTask(id, host)),
    clearRunHistory: (id: string, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.clearScheduledTaskRunHistory(id, host)),
    remove: (id: string, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.deleteScheduledTask(id, host)),
  };
}

export const scheduledTasksStore = createScheduledTasksStore();
