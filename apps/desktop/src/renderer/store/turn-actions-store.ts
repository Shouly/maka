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
     * Awaited, but it resolves as soon as the tail command has been issued:
     * the pin and the cancellation are synchronous, the catch-up page is not,
     * and an unopened or offline transcript must never delay saving what the
     * user typed. The wait exists for ordering — see `orderBeforeSend`.
     */
    onFollowLatest?: (sessionId: string) => Promise<unknown> | void;
    /** A stop that interrupted a turn also retracted its queued messages. */
    onStopped?: (sessionId: string, result: api.DesktopSessionStopResult) => void;
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
  /**
   * The tail command must reach the main process before the send does.
   *
   * Main answers a `followTail` navigation by re-reading the tail and then
   * settling every overlay message up to the sequence it captured when the
   * command arrived; while that runs, it withholds every transcript batch
   * from this consumer. Captured before the send, that sequence is the
   * previous turn's and the settlement is instant. Captured after the send
   * has started the turn, it covers the streaming reply, and the settlement
   * — and the blackout — last until the reply finishes: the user message
   * and the whole stream appear only when the turn is over.
   *
   * The command's IPC leaves after a few microtasks (the range controller
   * awaits its open handle first); the send's would leave on the very next
   * one. A macrotask yield lets the command's invoke go first, and both
   * calls then arrive in that order.
   */
  async function orderBeforeSend(id: string): Promise<void> {
    await options.onFollowLatest?.(id);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return {
    ...store,
    send(id: string, command: api.SessionSendCommand) {
      return run(id, 'send', async () => {
        await orderBeforeSend(id);
        const result = await bridge.sendMessage(id, command);
        store.setState((s) => ({ sendResults: { ...s.sendResults, [id]: result } }));
        return result;
      });
    },
    submit: (
      id: string,
      placement: api.SessionSubmitPlacement,
      command: api.SessionSubmitCommand,
      submitOptions?: api.SessionSubmitOptions,
    ) =>
      run(id, 'send', async () => {
        await orderBeforeSend(id);
        return bridge.submitMessage(id, placement, command, submitOptions);
      }),
    /**
     * The authority spoke about this Session's turn or messages: whatever
     * command was still claimed here has been answered by events, and a
     * claim that outlives its answer only keeps controls disabled.
     */
    clearPending(id: string) {
      for (const key of [...locks.keys()]) {
        if (key.startsWith(JSON.stringify([id]).slice(0, -1))) locks.delete(key);
      }
      store.setState((s) => (s.pending[id]?.length ? { pending: { ...s.pending, [id]: [] } } : s));
    },
    stop: (id: string, input?: api.SessionStopInput) =>
      run(id, 'stop', async () => {
        const result = await bridge.stopSession(id, input);
        options.onStopped?.(id, result);
        return result;
      }),
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
