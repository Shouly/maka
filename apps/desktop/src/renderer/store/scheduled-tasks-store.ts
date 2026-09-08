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

// Scheduled tasks: the sidebar's Automations badge and the module page.
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
import { createResourceStore } from './resource-store.js';

export function pendingScheduledTaskCount(tasks: readonly ScheduledTask[] | undefined): number {
  return (tasks ?? []).filter((task) => task.status === 'active' && task.nextFireAt !== null)
    .length;
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
    remove: (id: string, host?: DesktopRuntimeHostRef) =>
      store.mutate(() => bridge.deleteScheduledTask(id, host)),
  };
}

export const scheduledTasksStore = createScheduledTasksStore();
