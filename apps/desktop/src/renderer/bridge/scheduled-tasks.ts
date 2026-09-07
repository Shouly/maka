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

// The `scheduledTasks` namespace of the preload bridge, wrapped.

import type {
  CreateScheduledTaskInput,
  ScheduledTask,
  UpdateScheduledTaskInput,
} from '@maka/core/scheduled-task';
import type { DesktopRuntimeHostRef, MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type ScheduledTasks = MakaBridge['scheduledTasks'];

export type { ScheduledTask };

const scheduledTasks = (): ScheduledTasks => requireNamespace('scheduledTasks');

export function listScheduledTasks(host?: DesktopRuntimeHostRef): Promise<ScheduledTask[]> {
  return scheduledTasks().list(host);
}

export function createScheduledTask(
  input: Omit<CreateScheduledTaskInput, 'createdBy'>,
  host?: DesktopRuntimeHostRef,
): Promise<ScheduledTask> {
  return scheduledTasks().create(input, host);
}

export function updateScheduledTask(
  id: string,
  patch: UpdateScheduledTaskInput,
  host?: DesktopRuntimeHostRef,
): Promise<ScheduledTask> {
  return scheduledTasks().update(id, patch, host);
}

export function setScheduledTaskEnabled(
  id: string,
  enabled: boolean,
  host?: DesktopRuntimeHostRef,
): Promise<ScheduledTask> {
  return scheduledTasks().setEnabled(id, enabled, host);
}

export function triggerScheduledTaskNow(
  id: string,
  host?: DesktopRuntimeHostRef,
): Promise<ScheduledTask> {
  return scheduledTasks().triggerNow(id, host);
}

export function deleteScheduledTask(id: string, host?: DesktopRuntimeHostRef): Promise<void> {
  return scheduledTasks().delete(id, host);
}

export function subscribeScheduledTaskChanges(
  handler: (event: {
    type: 'scheduled_tasks_changed';
    reason: string;
    taskId?: string;
    ts: number;
  }) => void,
): () => void {
  return toUnsubscribe(tryNamespace('scheduledTasks')?.subscribeChanges(handler));
}

export function subscribeScheduledTasksDue(
  handler: (task: Pick<ScheduledTask, 'id' | 'title'>) => void,
): () => void {
  return toUnsubscribe(tryNamespace('scheduledTasks')?.subscribeDue(handler));
}
