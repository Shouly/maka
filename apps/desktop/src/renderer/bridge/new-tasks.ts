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

// The `newTasks` namespace of the preload bridge, wrapped.
//
// The new-task surface reads a multi-Host catalog rather than the active
// session's Host: creating a task is the one action whose Host is chosen, not
// inherited.

import type { CreateSessionRequestInput } from '@maka/core/runtime-inputs';
import type { DesktopConnectionSnapshot } from '../../shared/desktop-connection-snapshot.js';
import type {
  DesktopNewTaskCatalog,
  DesktopNewTaskHostRef,
  DesktopNewTaskTarget,
  DesktopSessionSummary,
  DesktopTaskSubmissionReadinessRequest,
  MakaBridge,
} from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type NewTasks = MakaBridge['newTasks'];

export type { DesktopNewTaskCatalog, DesktopNewTaskHostRef, DesktopNewTaskTarget };
export type NewTaskSkillContext = NonNullable<Parameters<NewTasks['listInvocableSkills']>[1]>;
export type NewTaskInvocableSkills = Awaited<ReturnType<NewTasks['listInvocableSkills']>>;
export type NewTaskReadiness = Awaited<ReturnType<NewTasks['getReadiness']>>;
export type NewTaskFileSearchResult = Awaited<ReturnType<NewTasks['searchFiles']>>;

const newTasks = (): NewTasks => requireNamespace('newTasks');

export function getNewTaskCatalog(): Promise<DesktopNewTaskCatalog> {
  return newTasks().getCatalog();
}

export function subscribeNewTaskChanges(handler: () => void): () => void {
  return toUnsubscribe(tryNamespace('newTasks')?.subscribeChanges(handler));
}

export function addNewTaskProject(host: DesktopNewTaskHostRef): ReturnType<NewTasks['addProject']> {
  return newTasks().addProject(host);
}

export function relinkNewTaskProject(
  host: DesktopNewTaskHostRef,
  projectId: string,
): ReturnType<NewTasks['relinkProject']> {
  return newTasks().relinkProject(host, projectId);
}

export function getNewTaskConnections(
  host: DesktopNewTaskHostRef,
): Promise<DesktopConnectionSnapshot> {
  return newTasks().getConnections(host);
}

export function listNewTaskInvocableSkills(
  target: DesktopNewTaskTarget,
  context?: NewTaskSkillContext,
): Promise<NewTaskInvocableSkills> {
  return newTasks().listInvocableSkills(target, context);
}

export function getNewTaskReadiness(
  target: DesktopNewTaskTarget,
  input?: DesktopTaskSubmissionReadinessRequest,
): Promise<NewTaskReadiness> {
  return newTasks().getReadiness(target, input);
}

export function searchNewTaskFiles(
  target: DesktopNewTaskTarget,
  query: string,
  options?: { limit?: number },
): Promise<NewTaskFileSearchResult> {
  return newTasks().searchFiles(target, query, options);
}

export function createNewTask(
  target: DesktopNewTaskTarget,
  input?: CreateSessionRequestInput,
): Promise<DesktopSessionSummary> {
  return newTasks().create(target, input);
}
