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

// The sidebar list, selected from the stores.
//
// `buildSessionListModel` is pure and does the thinking; this hook is only
// about which stores feed it and how often it recomputes. The filter text is
// component state in the Sidebar and is passed in rather than stored globally:
// it is a view of the list, not a property of the workspace, and persisting it
// would mean a user who typed a filter and quit comes back to an empty rail.

import { useMemo } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useUiLocale } from '@maka/ui';
import {
  newTaskStore,
  onboardingStore,
  sessionsStore,
  projectsStore,
  uiStore,
} from '../store/index.js';
import { sendOutcomesOf } from '../store/onboarding-store.js';
import { projectPath, workspaceOptionsOf } from '../store/new-task-store.js';
import {
  buildSessionListModel,
  type SessionListGroupMode,
  type SessionListModel,
} from '../store/session-list-model.js';
import { getSidebarCopy } from '../locales/sidebar-copy.js';

export interface ProjectRowModel {
  readonly id: string;
  readonly name: string;
  readonly profileId: string;
  readonly hostId: string | undefined;
  readonly path: string | undefined;
}

/**
 * Every project the shell can name, across Hosts.
 *
 * The new-task catalog is the only read that spans Hosts, so it is the source;
 * the default Host's own snapshot is merged in because it carries projects the
 * catalog omits while that Host is reconnecting.
 */
export function useProjectRows(): ProjectRowModel[] {
  const catalog = useStore(newTaskStore, (state) => state.catalog);
  const defaults = useStore(projectsStore.defaults, (state) => state.data);
  return useMemo(() => {
    const rows = new Map<string, ProjectRowModel>();
    for (const option of workspaceOptionsOf(catalog)) {
      if (!option.projectId || !option.projectName) continue;
      rows.set(option.projectId, {
        id: option.projectId,
        name: option.projectName,
        profileId: option.profileId,
        hostId: option.hostId,
        path: option.path,
      });
    }
    for (const project of defaults?.snapshot.projects ?? []) {
      if (rows.has(project.id)) continue;
      rows.set(project.id, {
        id: project.id,
        name: project.name,
        profileId: '',
        hostId: undefined,
        path: projectPath(project),
      });
    }
    return [...rows.values()];
  }, [catalog, defaults]);
}

export interface SessionListSelection {
  readonly model: SessionListModel;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly activeId: string | undefined;
  readonly mode: SessionListGroupMode;
}

export function useSessionList(filter: string): SessionListSelection {
  const locale = useUiLocale();
  const catalog = useStore(
    sessionsStore,
    useShallow((state) => ({
      sessions: state.sessions,
      activeId: state.activeId,
      loading: state.loading,
      error: state.error,
      revision: state.revision,
    })),
  );
  const viewMode = useStore(uiStore, (state) => state.viewMode);
  const sendOutcomes = useStore(onboardingStore, sendOutcomesOf);
  const projects = useProjectRows();
  // `conversation` and `project` are the persisted view-mode values the layout
  // key already carries; the list model names the same two choices by what
  // they group by.
  const mode: SessionListGroupMode = viewMode === 'project' ? 'project' : 'time';
  const model = useMemo(
    () =>
      buildSessionListModel({
        sessions: catalog.sessions,
        activeId: catalog.activeId,
        filter,
        mode,
        projects,
        sendOutcomes,
        copy: getSidebarCopy(locale),
        now: Date.now(),
      }),
    [
      catalog.sessions,
      catalog.activeId,
      catalog.revision,
      filter,
      mode,
      projects,
      sendOutcomes,
      locale,
    ],
  );
  return {
    model,
    loading: catalog.loading,
    error: catalog.error,
    activeId: catalog.activeId,
    mode,
  };
}
