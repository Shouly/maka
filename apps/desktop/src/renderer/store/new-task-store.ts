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

import { getHostSettings, type RuntimeHostAppSettings } from '../bridge/settings.js';
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
import { safeLocalStorageGet, safeLocalStorageSet } from '../lib/ported/browser-storage.js';
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

export const NEW_TASK_TARGET_KEY = 'maka-new-task-target-v1';

export function parseNewTaskTarget(raw: string | null): DesktopNewTaskTarget | undefined {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (
      value &&
      typeof value.profileId === 'string' &&
      value.profileId &&
      typeof value.hostId === 'string' &&
      value.hostId &&
      (value.projectId === null || (typeof value.projectId === 'string' && value.projectId))
    )
      return { profileId: value.profileId, hostId: value.hostId, projectId: value.projectId };
  } catch {}
  return undefined;
}

export function newTaskTargetAvailable(
  catalog: DesktopNewTaskCatalog | undefined,
  target: DesktopNewTaskTarget | undefined,
): boolean {
  if (!target) return false;
  const host = catalog?.hosts.find((entry) => entry.profile.id === target.profileId);
  if (host?.readiness !== 'ready' || host.state !== 'available' || host.hostId !== target.hostId)
    return false;
  return target.projectId === null
    ? host.capabilities.selectNoProject !== false
    : host.projects.some(
        (project) =>
          project.id === target.projectId && project.available && project.archivedAt === undefined,
      );
}

export function addProjectHostOf(
  catalog: DesktopNewTaskCatalog | undefined,
  target: DesktopNewTaskTarget | undefined,
): DesktopNewTaskHostRef | undefined {
  const host = target
    ? catalog?.hosts.find((entry) => entry.profile.id === target.profileId)
    : catalog?.hosts.find((entry) => entry.profile.id === catalog.defaultProfileId);
  if (
    host?.readiness !== 'ready' ||
    host.state !== 'available' ||
    (target && host.hostId !== target.hostId) ||
    !host.capabilities.chooseClientDirectory
  )
    return undefined;
  return { profileId: host.profile.id, hostId: host.hostId };
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
  /** Archived projects are listed only where the caller asked for them. */
  readonly archived: boolean;
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
  defaults: RuntimeHostAppSettings['chatDefaults'] | undefined;
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
  defaults: undefined,
  error: undefined,
});

/** A project location for display: the preferred path, else its first location. */
export function projectPath(project: ProjectRecord): string | undefined {
  return project.preferredPath ?? project.locations[0]?.path;
}

/** Flatten the Host tree into the rows the picker lists, Host order preserved. */
export function workspaceOptionsOf(
  catalog: DesktopNewTaskCatalog | undefined,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): WorkspaceOption[] {
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
        archived: false,
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
        archived: false,
      });
      continue;
    }
    for (const project of host.projects) {
      if (!includeArchived && project.archivedAt !== undefined) continue;
      options.push({
        profileId: host.profile.id,
        hostId: host.hostId,
        profileName: host.profile.name,
        projectId: project.id,
        projectName: project.name,
        path: projectPath(project),
        available: project.available,
        unavailableReason: undefined,
        archived: project.archivedAt !== undefined,
      });
    }
  }
  return options;
}

/** The target the catalog says is current: the default Host's selected project. */
export function defaultTargetOf(
  catalog: DesktopNewTaskCatalog | undefined,
): DesktopNewTaskTarget | undefined {
  const hosts = catalog?.hosts ?? [];
  const host =
    hosts.find(
      (entry) =>
        entry.profile.id === catalog?.defaultProfileId &&
        entry.readiness === 'ready' &&
        entry.state === 'available',
    ) ?? hosts.find((entry) => entry.readiness === 'ready' && entry.state === 'available');
  if (host?.readiness !== 'ready' || host.state !== 'available') return undefined;
  const projectId =
    host.selectedProjectId === null
      ? null
      : ([host.selectedProjectId, host.defaultProjectId].find(
          (id) =>
            typeof id === 'string' &&
            host.projects.some(
              (project) =>
                project.id === id && project.available && project.archivedAt === undefined,
            ),
        ) ?? null);
  return { profileId: host.profile.id, hostId: host.hostId, projectId };
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

export function createNewTaskStore(
  bridge = api,
  readSettings = getHostSettings,
  selectionStorage = { read: safeLocalStorageGet, write: safeLocalStorageSet },
) {
  const store = createStore<NewTaskState>(() => ({
    ...initial(),
    target: parseNewTaskTarget(selectionStorage.read(NEW_TASK_TARGET_KEY)),
  }));

  function selectTarget(target: DesktopNewTaskTarget) {
    selectionStorage.write(NEW_TASK_TARGET_KEY, JSON.stringify(target));
    if (sameTarget(store.getState().target, target)) return;
    store.setState({
      target,
      readiness: undefined,
      connections: undefined,
      defaults: undefined,
      error: undefined,
    });
    void loadTargetScopedReads(target);
  }
  // Two generations: the catalog is Host-wide, the per-target reads are not.
  let catalogGeneration = 0;
  let targetGeneration = 0;
  let lifetime = 0;

  async function loadTargetScopedReads(target: DesktopNewTaskTarget): Promise<void> {
    const request = ++targetGeneration;
    const [connections, readiness, settings] = await Promise.allSettled([
      bridge.getNewTaskConnections({ profileId: target.profileId, hostId: target.hostId }),
      bridge.getNewTaskReadiness(target),
      Promise.resolve().then(() =>
        readSettings({ profileId: target.profileId, hostId: target.hostId }),
      ),
    ]);
    if (request !== targetGeneration) return;
    store.setState((state) => {
      const snapshot = connections.status === 'fulfilled' ? connections.value : undefined;
      return {
        connections: snapshot,
        defaults: settings.status === 'fulfilled' ? settings.value.chatDefaults : undefined,
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
      // Preserve explicit intent during outages; an unavailable target is blocked,
      // never silently replaced by a different project or machine.
      const target = state.target ?? defaultTargetOf(catalog);
      targetGeneration++;
      store.setState({
        catalog,
        target,
        loading: false,
        readiness: undefined,
        connections: undefined,
        defaults: undefined,
      });
      if (newTaskTargetAvailable(catalog, target)) await loadTargetScopedReads(target!);
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
    selectTarget,
    selectModel(model: NewChatModel) {
      store.setState({ model });
      // The next task starts on this model, restart or not.
      saveComposerDefaults({ model });
    },
    async addProject(host: DesktopNewTaskHostRef) {
      if (!addProjectHostOf(store.getState().catalog, { ...host, projectId: null }))
        throw new Error('This Runtime Host cannot add a project from a local folder');
      const previousTarget = store.getState().target;
      const result = await bridge.addNewTaskProject(host);
      if (result.ok) {
        await refreshCatalog();
        if (sameTarget(store.getState().target, previousTarget))
          selectTarget({
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
      captured?: Pick<NewTaskState, 'target' | 'model'>,
    ) {
      const state = captured ?? store.getState();
      if (!state.target) throw new Error('No workspace is selected for the new task');
      if (!newTaskTargetAvailable(store.getState().catalog, state.target))
        throw new Error('The selected project or Runtime Host is unavailable');
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
        if (sameTarget(store.getState().target, state.target))
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

/** Resolve the clicked project explicitly; never reuse a previous composer target. */
export function projectTaskTarget(
  project: { id: string; profileId: string; hostId: string | undefined },
  catalog: DesktopNewTaskCatalog | undefined,
  defaultHost: DesktopNewTaskHostRef | undefined,
): DesktopNewTaskTarget | undefined {
  const profileId = project.profileId || defaultHost?.profileId;
  const hostId = project.hostId ?? defaultHost?.hostId;
  if (!profileId || !hostId) return undefined;
  const host = catalog?.hosts.find((entry) => entry.profile.id === profileId);
  if (host?.readiness !== 'ready' || host.state !== 'available' || host.hostId !== hostId)
    return undefined;
  const record = host.projects.find((entry) => entry.id === project.id);
  if (!record?.available || record.archivedAt !== undefined) return undefined;
  return { profileId, hostId, projectId: record.id };
}
