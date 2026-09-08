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

import { createStore } from 'zustand/vanilla';
import {
  getDefaultRuntimeHost,
  subscribeRuntimeHostProfileChanges,
  type DesktopRuntimeHostRef,
} from '../bridge/runtime-host-profiles.js';
import { createActiveSessionStore } from './active-session-store.js';
import { createTurnActionsStore } from './turn-actions-store.js';
import { sessionsStore } from './sessions-store.js';
import { settingsStore } from './settings-store.js';
import { connectionsStore } from './connections-store.js';
import { mcpStore } from './mcp-store.js';
import { projectsStore } from './projects-store.js';
import { toastApi } from './toast-api.js';
import { newTaskStore } from './new-task-store.js';
import { onboardingStore } from './onboarding-store.js';
import { scheduledTasksStore } from './scheduled-tasks-store.js';
import { updateStore } from './update-store.js';
import { errorMessage } from './resource-store.js';

export { sessionsStore, settingsStore, connectionsStore, projectsStore };
// Connected by the MCP module page for as long as it is mounted: nothing
// outside it reads MCP, so it is not part of `startRendererStores`.
export { mcpStore };
export { newTaskStore, onboardingStore, scheduledTasksStore, updateStore };
export { uiStore } from './ui-store.js';
export { composerDraftStore } from './composer-draft-store.js';
export { contextUsageStore } from './context-usage-store.js';
import { revisionDraftStore } from './revision-draft.js';
import { createRevisionActions } from './revision-actions.js';
import { abandonSessionCopy } from '../bridge/sessions.js';
import { readSettledMessages } from '../lib/ported/session-message-settlement.js';
import { composerInputStore } from './composer-input-store.js';
export { revisionDraftStore };
export const activeSessionStore = createActiveSessionStore({
  refreshSessions: sessionsStore.refresh,
  toast: toastApi,
  sessionTitle: (sessionId) =>
    sessionsStore.getState().sessions.find((row) => row.id === sessionId)?.name,
  sessionStatus: (sessionId) =>
    sessionsStore.getState().sessions.find((row) => row.id === sessionId)?.status,
});
// The catalog is the authority on whether a turn is over; the active store
// holds the live projection that says it is running. Each read reconciles the
// two, and each change event about the observed Session reaches it first.
sessionsStore.onChange((event) => activeSessionStore.recordSessionChange(event));
sessionsStore.onCatalogRead({
  before: () => activeSessionStore.observeLiveTurns(),
  after: (sessions, observed) => activeSessionStore.reconcileSettledLiveTurns(sessions, observed),
});
export const turnActionsStore = createTurnActionsStore({
  refresh: sessionsStore.refresh,
  // A send is a viewport command as well as an admission: it abandons the
  // reader's bookmark and pins the transcript back to the tail. `prepareSend`
  // resolves once the tail command is issued, not once the tail has loaded.
  onFollowLatest: (sessionId) => activeSessionStore.prepareSend(sessionId),
  // The messages a stop retracted from the queue will never be sent; their
  // rows come down with the turn they were waiting on.
  onStopped(sessionId, result) {
    if (result?.kind !== 'interrupted') return;
    for (const messageId of result.retractedMessageIds) {
      activeSessionStore.removeTransientMessage(sessionId, messageId);
    }
  },
  onCopy(sourceId, row) {
    sessionsStore.upsert(row);
    if (sessionsStore.getState().activeId === sourceId) sessionsStore.select(row.id);
  },
});
export const revisionActions = createRevisionActions({
  draft: revisionDraftStore,
  selected: () => sessionsStore.getState().activeId,
  subscribeSelection: (listener) => sessionsStore.subscribe(listener),
  select: sessionsStore.select,
  upsert: sessionsStore.upsert,
  revise: turnActionsStore.revise,
  settle: (id, signal) => readSettledMessages(id, { signal }),
  submit: (id, text, messageId) =>
    turnActionsStore.submit(
      id,
      'current_turn',
      { text, messageId },
      { waitForHostAdmission: true },
    ),
  abandon: abandonSessionCopy,
  setText: composerInputStore.setText,
  show: (id, text, messageId) =>
    activeSessionStore.showTransientUserMessage(id, {
      id: messageId,
      text,
      ts: Date.now(),
      inlineReferences: [],
      transientPlacement: 'current_turn',
    }),
  remove: activeSessionStore.removeTransientMessage,
  refresh: sessionsStore.refresh,
});
const reconcileRevisionAdmission = () => {
  if (revisionDraftStore.getState().draft?.phase !== 'uncertain') return;
  const state = activeSessionStore.getState();
  revisionActions.reconcile(
    state.sessionId,
    state.messages.map((message) => message.id),
  );
};
activeSessionStore.subscribe(reconcileRevisionAdmission);
revisionDraftStore.subscribe(reconcileRevisionAdmission);

export const hostScopeStore = createStore<{
  host: DesktopRuntimeHostRef | undefined;
  revision: number;
  error: string | undefined;
}>(() => ({ host: undefined, revision: 0, error: undefined }));

/** One app lifetime. Host changes invalidate scoped reads before asking for the new default. */
export function startRendererStores(): () => void {
  let closed = false;
  let generation = 0;
  const refreshHost = async () => {
    const request = ++generation;
    hostScopeStore.setState((s) => ({
      host: undefined,
      revision: s.revision + 1,
      error: undefined,
    }));
    try {
      const host = await getDefaultRuntimeHost();
      if (!closed && request === generation) hostScopeStore.setState({ host });
    } catch (error) {
      if (!closed && request === generation)
        hostScopeStore.setState({ error: errorMessage(error) });
    }
  };
  const offHosts = subscribeRuntimeHostProfileChanges(() => {
    void refreshHost();
    void sessionsStore.refresh();
  });
  const offSessions = sessionsStore.start();
  const offSettings = settingsStore.startClient();
  const offLocal = projectsStore.connectLocal();
  const offNewTasks = newTaskStore.start();
  const offSchedules = scheduledTasksStore.start();
  const offUpdates = updateStore.start();
  // Deferred, not raced against the reveal handshake: the onboarding snapshot
  // is a composite read and nothing on the first frame depends on it.
  const cancelOnboarding = onboardingStore.prefetch();
  void refreshHost();
  return () => {
    closed = true;
    generation++;
    offHosts();
    offSessions();
    offSettings();
    offLocal();
    offNewTasks();
    offSchedules();
    offUpdates();
    cancelOnboarding();
  };
}
