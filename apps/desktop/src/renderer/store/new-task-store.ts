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

// Everything the welcome surface needs before a Session exists.
//
// A new task is not "a session with no messages": there is no session yet, so
// none of the per-session namespaces answer for it. `newTasks` is the preload
// namespace that does — it takes a `{profileId, hostId, projectId}` target and
// answers catalog, readiness, connections and skills for that target, then
// mints the Session. This store owns that target and keeps the four reads in
// step with it, so the picker, the readiness banner and the model chip can
// never disagree about which Host and project they are describing.

import { createStore } from 'zustand/vanilla';
import type { TaskSubmissionReadinessSnapshot } from '@maka/core/task-submission-readiness';
import type { ChatModelChoice } from '@maka/core/chat-model-choice';
import * as api from '../bridge/new-tasks.js';
import type { CreateSessionRequestInput } from '@maka/core/runtime-inputs';
import type {
  DesktopNewTaskCatalog,
  DesktopNewTaskTarget,
  DesktopNewTaskHostRef,
} from '../bridge/new-tasks.js';
import type { DesktopConnectionSnapshot } from '../bridge/connections.js';
import type { ProjectRecord } from '@maka/core/project';
import { errorMessage } from './resource-store.js';
import {
  pickNewChatModel,
  type NewChatModel,
  type NewChatModelCandidate,
} from '../lib/ported/shell-chat-model-selection.js';
import { loadComposerDefaults, saveComposerDefaults } from '../lib/ported/composer-defaults.js';

/** The model the last new task started on, as a candidate the catalog may still offer. */
function rememberedModel(): NewChatModelCandidate | null {
  const model = loadComposerDefaults()?.model;
  return model ? { llmConnectionSlug: model.llmConnectionSlug, model: model.model } : null;
}

/** One selectable workspace row: a project on a Host, or a Host with none. */
export interface WorkspaceOption {
  readonly profileId: string;
  readonly hostId: string | undefined;
  readonly profileName: string;
  readonly projectId: string | null;
  readonly projectName: string | undefined;
  readonly path: string | undefined;
  readonly available: boolean;
  readonly unavailableReason: string | undefined;
}

export interface NewTaskState {
  catalog: DesktopNewTaskCatalog | undefined;
  connections: DesktopConnectionSnapshot | undefined;
  readiness: TaskSubmissionReadinessSnapshot | undefined;
  target: DesktopNewTaskTarget | undefined;
  /** The model the next task starts on; sticky across target changes. */
  model: NewChatModel | undefined;
  loading: boolean;
  creating: boolean;
  error: string | undefined;
}

const initial = (): NewTaskState => ({
  catalog: undefined,
  connections: undefined,
  readiness: undefined,
  target: undefined,
  model: undefined,
  loading: false,
  creating: false,
  error: undefined,
});

/** A project location for display: the preferred path, else its first location. */
export function projectPath(project: ProjectRecord): string | undefined {
  return project.preferredPath ?? project.locations[0]?.path;
}

/** Flatten the Host tree into the rows the picker lists, Host order preserved. */
export function workspaceOptionsOf(catalog: DesktopNewTaskCatalog | undefined): WorkspaceOption[] {
  const options: WorkspaceOption[] = [];
  for (const host of catalog?.hosts ?? []) {
    if (host.readiness !== 'ready') {
      options.push({
        profileId: host.profile.id,
        hostId: undefined,
        profileName: host.profile.name,
        projectId: null,
        projectName: undefined,
        path: undefined,
        available: false,
        unavailableReason: host.message,
      });
      continue;
    }
    if (host.state === 'error') {
      options.push({
        profileId: host.profile.id,
        hostId: host.hostId,
        profileName: host.profile.name,
        projectId: null,
        projectName: undefined,
        path: undefined,
        available: false,
        unavailableReason: host.message,
      });
      continue;
    }
    for (const project of host.projects) {
      options.push({
        profileId: host.profile.id,
        hostId: host.hostId,
        profileName: host.profile.name,
        projectId: project.id,
        projectName: project.name,
        path: projectPath(project),
        available: true,
        unavailableReason: undefined,
      });
    }
  }
  return options;
}

/** The target the catalog says is current: the default Host's selected project. */
export function defaultTargetOf(
  catalog: DesktopNewTaskCatalog | undefined,
): DesktopNewTaskTarget | undefined {
  for (const host of catalog?.hosts ?? []) {
    if (host.readiness !== 'ready' || host.state !== 'available') continue;
    if (host.profile.id !== catalog?.defaultProfileId) continue;
    return {
      profileId: host.profile.id,
      hostId: host.hostId,
      projectId: host.selectedProjectId ?? host.defaultProjectId ?? null,
    };
  }
  for (const host of catalog?.hosts ?? []) {
    if (host.readiness !== 'ready' || host.state !== 'available') continue;
    return {
      profileId: host.profile.id,
      hostId: host.hostId,
      projectId: host.selectedProjectId ?? host.defaultProjectId ?? null,
    };
  }
  return undefined;
}

function sameTarget(
  left: DesktopNewTaskTarget | undefined,
  right: DesktopNewTaskTarget | undefined,
): boolean {
  return (
    left?.profileId === right?.profileId &&
    left?.hostId === right?.hostId &&
    left?.projectId === right?.projectId
  );
}

export function createNewTaskStore(bridge = api) {
  const store = createStore<NewTaskState>(initial);
  // Two generations: the catalog is Host-wide, the per-target reads are not.
  let catalogGeneration = 0;
  let targetGeneration = 0;
  let lifetime = 0;

  async function loadTargetScopedReads(target: DesktopNewTaskTarget): Promise<void> {
    const request = ++targetGeneration;
    const [connections, readiness] = await Promise.allSettled([
      bridge.getNewTaskConnections({ profileId: target.profileId, hostId: target.hostId }),
      bridge.getNewTaskReadiness(target),
    ]);
    if (request !== targetGeneration) return;
    store.setState((state) => {
      const snapshot = connections.status === 'fulfilled' ? connections.value : state.connections;
      return {
        connections: snapshot,
        readiness: readiness.status === 'fulfilled' ? readiness.value : undefined,
        // Keep the sticky choice when it is still offered; otherwise fall back
        // to this connection catalog's own default.
        model: pickNewChatModel({
          pending: state.model ?? rememberedModel(),
          catalogDefault: defaultModelCandidate(snapshot),
          choices: snapshot?.chatModelChoices ?? [],
        }),
      };
    });
  }

  async function refreshCatalog(): Promise<void> {
    const request = ++catalogGeneration;
    store.setState({ loading: true, error: undefined });
    try {
      const catalog = await bridge.getNewTaskCatalog();
      if (request !== catalogGeneration) return;
      const state = store.getState();
      // A target the user chose survives a catalog refresh as long as it still
      // exists; otherwise the catalog's own default takes over.
      const options = workspaceOptionsOf(catalog);
      const keep =
        state.target &&
        options.some(
          (option) =>
            option.profileId === state.target?.profileId &&
            option.projectId === state.target.projectId,
        );
      const target = keep ? state.target : defaultTargetOf(catalog);
      store.setState({ catalog, target, loading: false });
      if (target) await loadTargetScopedReads(target);
    } catch (error) {
      if (request === catalogGeneration)
        store.setState({ error: errorMessage(error), loading: false });
    }
  }

  return {
    ...store,
    start(): () => void {
      const owner = ++lifetime;
      const off = bridge.subscribeNewTaskChanges(() => {
        if (owner === lifetime) void refreshCatalog();
      });
      void refreshCatalog();
      return () => {
        off();
        if (owner === lifetime) {
          lifetime++;
          catalogGeneration++;
          targetGeneration++;
        }
      };
    },
    refresh: refreshCatalog,
    selectTarget(target: DesktopNewTaskTarget) {
      if (sameTarget(store.getState().target, target)) return;
      store.setState({ target, readiness: undefined });
      void loadTargetScopedReads(target);
    },
    selectModel(model: NewChatModel) {
      store.setState({ model });
      // The next task starts on this model, restart or not.
      saveComposerDefaults({ model });
    },
    async addProject(host: DesktopNewTaskHostRef) {
      const result = await bridge.addNewTaskProject(host);
      if (result.ok) {
        await refreshCatalog();
        store.setState({
          target: { profileId: host.profileId, hostId: host.hostId, projectId: result.project.id },
        });
        void loadTargetScopedReads({
          profileId: host.profileId,
          hostId: host.hostId,
          projectId: result.project.id,
        });
      }
      return result;
    },
    async relinkProject(host: DesktopNewTaskHostRef, projectId: string) {
      const result = await bridge.relinkNewTaskProject(host, projectId);
      if (result.ok) await refreshCatalog();
      return result;
    },
    listInvocableSkills(context?: api.NewTaskSkillContext) {
      const target = store.getState().target;
      if (!target) return Promise.resolve([] as api.NewTaskInvocableSkills);
      return bridge.listNewTaskInvocableSkills(target, context);
    },
    /**
     * Mint the Session with everything the draft chose, in one call. Callers
     * own the first message; this only creates.
     *
     * A permission mode is sent only when the user picked one: otherwise the
     * Host's configured default applies, and writing the draft's placeholder
     * would override it as an explicit per-Session choice on every new task.
     */
    async create(
      input: Partial<
        Pick<
          CreateSessionRequestInput,
          'permissionMode' | 'thinkingLevel' | 'collaborationMode' | 'orchestrationMode'
        >
      > = {},
    ) {
      const state = store.getState();
      if (!state.target) throw new Error('No workspace is selected for the new task');
      store.setState({ creating: true, error: undefined });
      try {
        return await bridge.createNewTask(state.target, {
          ...(state.model
            ? {
                llmConnectionId: state.model.llmConnectionId,
                llmConnectionSlug: state.model.llmConnectionSlug,
                model: state.model.model,
              }
            : {}),
          ...input,
        });
      } catch (error) {
        store.setState({ error: errorMessage(error) });
        throw error;
      } finally {
        store.setState({ creating: false });
      }
    },
  };
}

function defaultModelCandidate(
  snapshot: DesktopConnectionSnapshot | undefined,
): NewChatModelCandidate | undefined {
  const choices: readonly ChatModelChoice[] = snapshot?.chatModelChoices ?? [];
  const preferred =
    choices.find(
      (choice) => choice.isDefault && choice.connectionSlug === snapshot?.defaultConnection,
    ) ??
    choices.find((choice) => choice.connectionSlug === snapshot?.defaultConnection) ??
    choices.find((choice) => choice.isDefault);
  return preferred
    ? {
        llmConnectionId: preferred.connectionId,
        llmConnectionSlug: preferred.connectionSlug,
        model: preferred.model,
      }
    : undefined;
}

export const newTaskStore = createNewTaskStore();
