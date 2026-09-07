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

import { getSessionProjectInfo } from '../bridge/app.js';
import * as api from '../bridge/projects.js';
import { createResourceStore } from './resource-store.js';
import type { DesktopRuntimeHostRef } from '../bridge/projects.js';

export function createProjectsStore() {
  const active = createResourceStore<Awaited<ReturnType<typeof api.getProjectSnapshot>>>();
  const activeInfo = createResourceStore<Awaited<ReturnType<typeof getSessionProjectInfo>>>();
  const defaults = createResourceStore<Awaited<ReturnType<typeof api.getDefaultProjectContext>>>();
  const local = createResourceStore<Awaited<ReturnType<typeof api.getLocalProjectSnapshot>>>();
  return {
    active,
    activeInfo,
    defaults,
    local,
    connectActive(sessionId: string, host: DesktopRuntimeHostRef) {
      const offSnapshot = active.connect(
        () => api.getProjectSnapshot(sessionId, host),
        (refresh) => api.subscribeProjectChanges(refresh, sessionId, host),
      );
      const offInfo = activeInfo.connect(
        () => getSessionProjectInfo(sessionId),
        (refresh) => api.subscribeProjectChanges(refresh, sessionId, host),
      );
      return () => {
        offSnapshot();
        offInfo();
      };
    },
    connectDefault(host: DesktopRuntimeHostRef) {
      return defaults.connect(
        () => api.getDefaultProjectContext(host),
        (refresh) => api.subscribeProjectChanges(refresh, undefined, host),
      );
    },
    connectLocal() {
      return local.connect(() => api.getLocalProjectSnapshot(), api.subscribeLocalProjectChanges);
    },
    async select(projectId: string | null, host: DesktopRuntimeHostRef) {
      return defaults.mutate(() => api.selectProject(projectId, host));
    },
    async add(host: DesktopRuntimeHostRef) {
      return defaults.mutate(() => api.addProject(host));
    },
    async rename(id: string, name: string, host: DesktopRuntimeHostRef) {
      return defaults.mutate(() => api.renameProject(id, name, host));
    },
    async archive(id: string, host: DesktopRuntimeHostRef) {
      return defaults.mutate(() => api.archiveProject(id, host));
    },
    async restore(id: string, host: DesktopRuntimeHostRef) {
      return defaults.mutate(() => api.restoreProject(id, host));
    },
    async relink(id: string, host: DesktopRuntimeHostRef) {
      return defaults.mutate(() => api.relinkProject(id, host));
    },
  };
}
export const projectsStore = createProjectsStore();
