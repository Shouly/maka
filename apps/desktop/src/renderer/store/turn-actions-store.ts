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
import * as api from '../bridge/sessions.js';
import { errorMessage } from './resource-store.js';

export interface TurnActionsState {
  pending: Readonly<Record<string, readonly string[]>>;
  errors: Readonly<Record<string, string | undefined>>;
  sendResults: Readonly<Record<string, api.SessionSendResult | undefined>>;
}
/**
 * The operations in flight for one Session, or an empty list.
 *
 * The empty case is a shared frozen constant, not a fresh `[]`. This is read
 * through `useStore`, whose snapshot must be stable between renders: a new
 * array per call reads as "the store changed" on every render and loops until
 * React gives up (#185). A Session with no operation yet has no key at all,
 * which is exactly the state a freshly forked revision is in.
 */
const NO_PENDING_ACTIONS: readonly string[] = Object.freeze([]);

export function pendingActionsOf(
  state: TurnActionsState,
  sessionId: string | undefined,
): readonly string[] {
  return (sessionId ? state.pending[sessionId] : undefined) ?? NO_PENDING_ACTIONS;
}

/** Operations capture their Session at invocation; selection changes never retarget a command. */
export function createTurnActionsStore(
  options: {
    api?: typeof api;
    refresh?: () => Promise<unknown>;
    onCopy?: (sourceId: string, result: api.DesktopSessionSummary) => void;
    /**
     * Take the transcript back to the tail before a user message is admitted.
     *
     * Fire-and-forget on purpose: the pin and the cancellation are
     * synchronous, the catch-up page is not, and an unopened or offline
     * transcript must never delay saving what the user typed.
     */
    onFollowLatest?: (sessionId: string) => void;
  } = {},
) {
  const bridge = options.api ?? api;
  const store = createStore<TurnActionsState>(() => ({ pending: {}, errors: {}, sendResults: {} }));
  const locks = new Map<string, Promise<unknown>>();
  function run<T>(id: string, action: string, operation: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([id, action]);
    if (locks.has(key))
      return Promise.reject(
        new Error('An operation of this kind is already pending for this Session'),
      );
    store.setState((s) => ({
      pending: { ...s.pending, [id]: [...(s.pending[id] ?? []), action] },
      errors: { ...s.errors, [id]: undefined },
    }));
    const result = Promise.resolve()
      .then(operation)
      .catch((error) => {
        store.setState((s) => ({ errors: { ...s.errors, [id]: errorMessage(error) } }));
        throw error;
      })
      .finally(() => {
        locks.delete(key);
        store.setState((s) => ({
          pending: { ...s.pending, [id]: (s.pending[id] ?? []).filter((name) => name !== action) },
        }));
        void options.refresh?.().catch(() => undefined);
      });
    locks.set(key, result);
    return result;
  }
  return {
    ...store,
    send(id: string, command: api.SessionSendCommand) {
      options.onFollowLatest?.(id);
      return run(id, 'send', async () => {
        const result = await bridge.sendMessage(id, command);
        store.setState((s) => ({ sendResults: { ...s.sendResults, [id]: result } }));
        return result;
      });
    },
    submit: (
      id: string,
      placement: api.SessionSubmitPlacement,
      command: api.SessionSubmitCommand,
    ) => {
      options.onFollowLatest?.(id);
      return run(id, 'send', () => bridge.submitMessage(id, placement, command));
    },
    stop: (id: string, input?: api.SessionStopInput) =>
      run(id, 'stop', () => bridge.stopSession(id, input)),
    regenerate: (id: string, turnId: string) =>
      run(id, 'regenerate', () => bridge.regenerateTurn(id, turnId)),
    compact: (id: string) => run(id, 'compact', () => bridge.compactSession(id)),
    resume: (id: string) => run(id, 'resume', () => bridge.resumeLatestTurn(id)),
    branch: (id: string, input: api.DesktopBranchFromTurnInput) =>
      run(id, 'copy', async () => {
        const row = await bridge.branchFromTurn(id, input);
        options.onCopy?.(id, row);
        return row;
      }),
    revise: (id: string, input: api.DesktopReviseBeforeTurnInput) =>
      run(id, 'copy', async () => {
        const row = await bridge.reviseBeforeTurn(id, input);
        options.onCopy?.(id, row);
        return row;
      }),
    retract: (id: string, entryId: string) =>
      run(id, 'queue', () => bridge.retractQueueEntry(id, entryId)),
    promote: (id: string, entryId: string) =>
      run(id, 'queue', () => bridge.promoteQueueEntry(id, entryId)),
    editQueued: (id: string, entryId: string, revision: number, text: string) =>
      run(id, 'queue', () => bridge.updateQueueEntry(id, entryId, revision, text)),
    reorderQueued: (id: string, entryIds: readonly string[]) =>
      run(id, 'queue', () => bridge.reorderQueueEntries(id, entryIds)),
    respondSandbox: (id: string, response: Parameters<typeof api.respondToSandboxBoundary>[1]) =>
      run(id, 'interaction', () => bridge.respondToSandboxBoundary(id, response)),
    respondCapability: (
      id: string,
      response: Parameters<typeof api.respondToClientCapability>[1],
    ) => run(id, 'interaction', () => bridge.respondToClientCapability(id, response)),
    respondQuestion: (id: string, response: Parameters<typeof api.respondToUserQuestion>[1]) =>
      run(id, 'interaction', () => bridge.respondToUserQuestion(id, response)),
    respondForm: (id: string, response: Parameters<typeof api.respondToUserForm>[1]) =>
      run(id, 'interaction', () => bridge.respondToUserForm(id, response)),
    setModel: (id: string, input: api.SessionModelConfiguration) =>
      run(id, 'model', () => bridge.setModelConfiguration(id, input)),
    setThinking: (id: string, level: Parameters<typeof api.setThinkingLevel>[1]) =>
      run(id, 'thinking', () => bridge.setThinkingLevel(id, level)),
    setPermission: (id: string, mode: Parameters<typeof api.setPermissionMode>[1]) =>
      run(id, 'permission', () => bridge.setPermissionMode(id, mode)),
    setCollaboration: (id: string, mode: Parameters<typeof api.setCollaborationMode>[1]) =>
      run(id, 'collaboration', () => bridge.setCollaborationMode(id, mode)),
  };
}
