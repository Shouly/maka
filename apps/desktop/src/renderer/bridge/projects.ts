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

// The `projects` namespace of the preload bridge, wrapped.

import type { ProjectRecord } from '@maka/core/project';
import type {
  DesktopAppInfo,
  DesktopProjectDirectoryEntry,
  DesktopProjectDirectoryRoot,
  DesktopProjectSnapshot,
  DesktopRuntimeHostRef,
  MakaBridge,
} from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type Projects = MakaBridge['projects'];

export type {
  DesktopProjectSnapshot,
  DesktopProjectDirectoryEntry,
  DesktopProjectDirectoryRoot,
  DesktopRuntimeHostRef,
};
export type ProjectAddResult = Awaited<ReturnType<Projects['add']>>;
export type ProjectRelinkResult = Awaited<ReturnType<Projects['relink']>>;
export type ProjectSelectResult = Awaited<ReturnType<Projects['select']>>;

const projects = (): Projects => requireNamespace('projects');

export function getDefaultProjectContext(
  host?: DesktopRuntimeHostRef,
): Promise<{ snapshot: DesktopProjectSnapshot; info: DesktopAppInfo }> {
  return projects().getDefaultContext(host);
}

export function getProjectSnapshot(
  sessionId?: string,
  host?: DesktopRuntimeHostRef,
): Promise<DesktopProjectSnapshot> {
  return projects().getSnapshot(sessionId, host);
}

export function getLocalProjectSnapshot(): Promise<DesktopProjectSnapshot> {
  return projects().getLocalSnapshot();
}

export function subscribeProjectChanges(
  handler: () => void,
  sessionId?: string,
  host?: DesktopRuntimeHostRef,
): () => void {
  return toUnsubscribe(tryNamespace('projects')?.subscribeChanges(handler, sessionId, host));
}

export function subscribeLocalProjectChanges(handler: () => void): () => void {
  return toUnsubscribe(tryNamespace('projects')?.subscribeLocalChanges(handler));
}

export function addProject(host?: DesktopRuntimeHostRef): Promise<ProjectAddResult> {
  return projects().add(host);
}

export function getProjectDirectoryRoots(
  host: DesktopRuntimeHostRef,
): Promise<readonly DesktopProjectDirectoryRoot[]> {
  return projects().getDirectoryRoots(host);
}

export function listProjectDirectory(
  input: { readonly rootId: string; readonly segments: readonly string[] },
  host: DesktopRuntimeHostRef,
): Promise<readonly DesktopProjectDirectoryEntry[]> {
  return projects().listDirectory(input, host);
}

export function registerProjectDirectory(
  input: { readonly rootId: string; readonly segments: readonly string[] },
  host: DesktopRuntimeHostRef,
): Promise<ProjectRecord> {
  return projects().registerDirectory(input, host);
}

export function selectProject(
  projectId: string | null,
  host?: DesktopRuntimeHostRef,
): Promise<ProjectSelectResult> {
  return projects().select(projectId, host);
}

export function relinkProject(
  projectId: string,
  host?: DesktopRuntimeHostRef,
): Promise<ProjectRelinkResult> {
  return projects().relink(projectId, host);
}

export function revealProject(
  projectId: string,
  host?: DesktopRuntimeHostRef,
): ReturnType<Projects['reveal']> {
  return projects().reveal(projectId, host);
}

export function renameProject(
  projectId: string,
  name: string,
  host?: DesktopRuntimeHostRef,
): Promise<ProjectRecord> {
  return projects().rename(projectId, name, host);
}

export function archiveProject(
  projectId: string,
  host?: DesktopRuntimeHostRef,
): Promise<ProjectRecord> {
  return projects().archive(projectId, host);
}

export function restoreProject(
  projectId: string,
  host?: DesktopRuntimeHostRef,
): Promise<ProjectRecord> {
  return projects().restore(projectId, host);
}
