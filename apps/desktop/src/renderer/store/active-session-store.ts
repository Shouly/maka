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
import type { ContextCompactionOutcome, ShellRunUpdate } from '@maka/core/events';
import type { StoredMessage } from '@maka/core/session';
import type { SessionEventStreamSnapshot } from '@maka/core/session-event-health';
import type { ExecutionBoundaryReadModel } from '@maka/core/sandbox-boundary';
import type { UiLocale } from '@maka/core/ui-locale';
import {
  reconcileInteractions,
  type InteractionQueues,
  type LiveTurnProjection,
  type TransientUserMessageProjection,
} from '@maka/ui';
import * as sessions from '../bridge/sessions.js';
import * as transcripts from '../bridge/transcripts.js';
import {
  ShellRunHydration,
  mergeShellRunUpdates,
  mergeShellRunNotification,
  type ShellRunUpdatesBySession,
} from '../lib/ported/shell-run-update-state.js';
import * as shellRuns from '../bridge/shell-runs.js';
import * as notifications from '../bridge/notifications.js';
import {
  createRecoveringDesktopTranscriptRangeController,
  DesktopTranscriptRangeStore,
  type RecoveringDesktopTranscriptRangeController,
  type DesktopTranscriptRangeState,
} from '../lib/ported/desktop-transcript-range-store.js';
import {
  createSessionEventStreamSubscription,
  recordSessionEventStreamEvent,
} from '../lib/ported/session-event-health.js';
import {
  projectQueuedTransientMessages,
  reconcileTransientMessages,
} from '../lib/ported/transient-message-projection.js';
import { createAppShellSessionEventHandlers } from './session-event-handlers.js';
import type { MessageQueueUiState } from './session-state.js';
import { errorMessage } from './resource-store.js';
import type { RefreshMessagesOptions } from '../lib/ported/session-message-settlement.js';
import type { ToastApi } from './toast-api.js';

export interface ActiveSessionState {
  sessionId: string | undefined;
  messages: readonly StoredMessage[];
  range: DesktopTranscriptRangeState | undefined;
  loading: boolean;
  observationReady: boolean;
  error: string | undefined;
  health: SessionEventStreamSnapshot | undefined;
  liveTurns: Record<string, LiveTurnProjection>;
  interactions: InteractionQueues;
  queues: Record<string, MessageQueueUiState>;
  transientMessages: readonly TransientUserMessageProjection[];
  shellUpdates: readonly ShellRunUpdate[];
  executionBoundary: ExecutionBoundaryReadModel | undefined;
  compactionOutcome: ContextCompactionOutcome | undefined;
}
const initialState = (): ActiveSessionState => ({
  sessionId: undefined,
  messages: [],
  range: undefined,
  loading: false,
  observationReady: false,
  error: undefined,
  health: undefined,
  liveTurns: {},
  interactions: {},
  queues: {},
  transientMessages: [],
  shellUpdates: [],
  executionBoundary: undefined,
  compactionOutcome: undefined,
});

export function createActiveSessionStore(
  options: {
    sessions?: typeof sessions;
    transcripts?: typeof transcripts;
    shellRuns?: typeof shellRuns;
    refreshSessions?: () => Promise<unknown>;
    toast?: Pick<ToastApi, 'error'>;
    scheduleFrame?: (callback: () => void) => void;
    notifications?: Pick<typeof notifications, 'notifyRunEnded'>;
    /** Session display name for the OS "run ended" notification title. */
    sessionTitle?: (sessionId: string) => string | undefined;
  } = {},
) {
  const api = options.sessions ?? sessions;
  const transcriptApi = options.transcripts ?? transcripts;
  const shellApi = options.shellRuns ?? shellRuns;
  const store = createStore<ActiveSessionState>(initialState);
  let dispose = () => {};
  let controller: RecoveringDesktopTranscriptRangeController | undefined;
  let currentRefresh: ((options?: RefreshMessagesOptions) => Promise<boolean>) | undefined;
  let selectionGeneration = 0;

  function observe(sessionId: string | undefined, locale: UiLocale): () => void {
    dispose();
    const generation = ++selectionGeneration;
    store.setState({ ...initialState(), sessionId, loading: !!sessionId });
    if (!sessionId) {
      dispose = () => {};
      return dispose;
    }
    let closed = false;
    const current = () => !closed && generation === selectionGeneration;
    const commit = (patch: Partial<ActiveSessionState>) => {
      if (current()) store.setState(patch);
    };
    const fail = (error: unknown) => commit({ error: errorMessage(error), loading: false });
    const transient = new Map<string, TransientUserMessageProjection>();
    const transcript = new DesktopTranscriptRangeStore(sessionId);
    let interactionsRequest = 0;
    let interactionEvents = 0;
    let boundaryRequest = 0;
    let attempt = 0;
    let failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    const liveRef = {
      get current() {
        return current() ? store.getState().liveTurns : {};
      },
    };
    let rangeController: RecoveringDesktopTranscriptRangeController;
    const publishTransient = () =>
      commit({
        transientMessages: reconcileTransientMessages(transient, store.getState().messages),
      });
    const refresh = async (input?: RefreshMessagesOptions) => {
      if (!current()) return false;
      try {
        await rangeController.ready();
        const settled = input?.requiredAssistantMessageId
          ? await rangeController.waitForDurableMessage(input.requiredAssistantMessageId, 480)
          : true;
        if (!current()) return false;
        applyTranscript();
        return settled;
      } catch (error) {
        fail(error);
        return false;
      }
    };
    const refreshInteractions = async () => {
      const request = ++interactionsRequest;
      const revision = interactionEvents;
      try {
        const requests = await api.listActiveInteractions(sessionId);
        if (current() && request === interactionsRequest && revision === interactionEvents)
          commit({
            interactions: reconcileInteractions(store.getState().interactions, sessionId, requests),
          });
      } catch (error) {
        fail(error);
      }
    };
    const refreshBoundary = async () => {
      const request = ++boundaryRequest;
      try {
        const executionBoundary = await api.readExecutionBoundary(sessionId);
        if (request === boundaryRequest) commit({ executionBoundary });
      } catch (error) {
        fail(error);
      }
    };
    const handlers = createAppShellSessionEventHandlers({
      uiLocale: locale,
      activeIdRef: {
        get current() {
          return current() ? sessionId : undefined;
        },
      },
      liveTurnBySessionRef: liveRef,
      refreshMessages: (_id, input) => refresh(input),
      refreshSessions: async () => {
        if (current()) await options.refreshSessions?.();
      },
      setLiveTurnBySession: (update) => {
        if (current()) commit({ liveTurns: update(store.getState().liveTurns) });
      },
      setInteractionBySession: (update) => {
        if (current()) commit({ interactions: update(store.getState().interactions) });
      },
      setMessageQueueBySession: (update) => {
        if (current()) commit({ queues: update(store.getState().queues) });
      },
      projectQueuedTransientMessages: (_id, messages) => {
        if (current()) {
          projectQueuedTransientMessages(transient, messages);
          publishTransient();
        }
      },
      removeTransientMessage: (_id, messageId) => {
        if (current()) {
          transient.delete(messageId);
          publishTransient();
        }
      },
      onInteractionChanged: () => {
        void refreshInteractions();
      },
      onExecutionBoundaryChanged: () => {
        void refreshBoundary();
      },
      onContextCompactionOutcome: (_id, _turnId, compactionOutcome) =>
        commit({ compactionOutcome }),
      showModelSetupToast: (description) => {
        if (current()) {
          commit({ error: description });
          options.toast?.error(description);
        }
      },
      toastApi: {
        error: (title, description, details, target) => {
          if (current()) {
            commit({ error: description ?? title });
            options.toast?.error(title, description, details, target);
          }
        },
      },
      // Main gates on the product toggle and window focus before raising
      // anything, so this is unconditional here (as the old shell did).
      notifyRunEnded: ({ kind, sessionId: endedId, body }) => {
        if (!current()) return;
        (options.notifications ?? notifications).notifyRunEnded({
          kind,
          title: options.sessionTitle?.(endedId),
          body,
        });
      },
      scheduleFrame: options.scheduleFrame,
    });
    function applyTranscript() {
      if (!current()) return;
      const snapshot = transcript.snapshot();
      commit({
        messages: snapshot.messages,
        range: snapshot,
        ...(snapshot.ready ? { loading: false, error: undefined } : {}),
      });
      handlers.reconcilePersistedMessages(sessionId!, snapshot.messages);
      publishTransient();
    }
    rangeController = createRecoveringDesktopTranscriptRangeController(
      transcript,
      async (signal) => {
        return transcriptApi.openTranscript(
          sessionId,
          (batch) => {
            if (!current() || signal.aborted) return;
            try {
              if (transcript.accept(batch)) applyTranscript();
            } catch (error) {
              fail(error);
            }
          },
          (cancel) => {
            if (signal.aborted) cancel();
            else signal.addEventListener('abort', cancel, { once: true });
          },
        );
      },
      { onError: fail },
    );
    controller = rangeController;
    currentRefresh = refresh;
    commit({ health: createSessionEventStreamSubscription({ sessionId, now: Date.now() }) });

    const beginSeed = () => {
      handlers.dropDisplayEvents(sessionId);
      handlers.markDisplayPending(sessionId);
      interactionEvents++;
      transient.clear();
      commit({
        observationReady: false,
        liveTurns: {},
        interactions: {},
        queues: {},
        transientMessages: [],
      });
    };
    const ready = () => {
      if (!current()) return;
      failures = 0;
      rangeController.observationChanged('ready');
      handlers.markDisplayReady(sessionId);
      commit({ observationReady: true });
      void refreshInteractions();
      void refreshBoundary();
    };
    const subscribe = () => {
      if (!current()) return;
      const owner = ++attempt;
      beginSeed();
      let releaseRequested = false;
      let release = () => {
        releaseRequested = true;
      };
      const seedFailed = (error: unknown) => {
        if (!current() || owner !== attempt) return;
        attempt++; // Reject callbacks from the failed observer during the retry delay.
        rangeController.observationChanged('pending');
        commit({ observationReady: false });
        fail(error);
        release();
        retry = setTimeout(subscribe, Math.min(100 * 2 ** failures++, 2000));
      };
      try {
        const off = api.subscribeSessionEvents(
          sessionId,
          (event) => {
            if (!current() || owner !== attempt) return;
            if (
              [
                'sandbox_boundary_request',
                'client_capability_request',
                'user_question_request',
                'form_request',
                'sandbox_boundary_decision_ack',
                'client_capability_decision_ack',
                'user_question_answer_ack',
                'form_answer_ack',
                'tool_result',
                'complete',
                'abort',
                'error',
              ].includes(event.type)
            )
              interactionEvents++;
            const health = store.getState().health;
            if (health) commit({ health: recordSessionEventStreamEvent(health, Date.now()) });
            handlers.handleEvent(sessionId, event);
          },
          () => {
            if (owner === attempt) ready();
          },
          (phase) => {
            if (!current() || owner !== attempt) return;
            rangeController.observationChanged(phase);
            if (phase === 'pending') beginSeed();
            else ready();
          },
          seedFailed,
        );
        release = off;
        unsubscribe = off;
        if (releaseRequested) off();
      } catch (error) {
        seedFailed(error);
      }
    };
    const offInteractions = api.subscribeActiveInteractions((event) => {
      if (!current() || event.sessionId !== sessionId) return;
      interactionEvents++;
      commit({
        interactions: reconcileInteractions(
          store.getState().interactions,
          sessionId,
          event.interactions,
        ),
      });
    });
    // Preserve bounded hydration and inherited shell ownership from the original renderer.
    const hydration = new ShellRunHydration();
    let shellState: ShellRunUpdatesBySession = {};
    let shellRetry: ReturnType<typeof setTimeout> | undefined;
    let shellFailures = 0;
    const publishShell = () => commit({ shellUpdates: Object.values(shellState[sessionId] ?? {}) });
    const hydrateShell = async (epoch: number) => {
      try {
        const updates = await shellApi.listShellRuns(sessionId);
        if (!current()) return;
        const buffered = hydration.commit(epoch);
        if (!buffered) return;
        shellState = mergeShellRunUpdates(
          shellState,
          updates.filter((update) => update.sessionId === sessionId),
        );
        for (const update of buffered.updates)
          shellState = mergeShellRunNotification(shellState, sessionId, update);
        publishShell();
        shellFailures = 0;
        if (buffered.overflowed) void hydrateShell(epoch);
      } catch (error) {
        if (!current() || !hydration.isCurrent(epoch)) return;
        fail(error);
        shellRetry = setTimeout(
          () => {
            void hydrateShell(epoch);
          },
          Math.min(250 * 2 ** shellFailures++, 5000),
        );
      }
    };
    const offShell = shellApi.subscribeShellRunUpdates((update) => {
      if (!current()) return;
      const live = hydration.accept(update);
      if (live) {
        shellState = mergeShellRunNotification(shellState, sessionId, live);
        publishShell();
      }
    });
    const offResync = shellApi.subscribeShellRunResync((event) => {
      if (current() && event.sessionId === sessionId) {
        clearTimeout(shellRetry);
        void hydrateShell(hydration.begin());
      }
    });
    subscribe();
    void hydrateShell(0);
    dispose = () => {
      if (closed) return;
      closed = true;
      attempt++;
      clearTimeout(retry);
      clearTimeout(shellRetry);
      handlers.dropDisplayEvents(sessionId);
      unsubscribe();
      offInteractions();
      offShell();
      offResync();
      void rangeController.close();
      if (controller === rangeController) {
        controller = undefined;
        currentRefresh = undefined;
      }
      if (generation === selectionGeneration)
        store.setState({ observationReady: false, loading: false });
    };
    return dispose;
  }
  return {
    ...store,
    observe,
    disconnect() {
      dispose();
      selectionGeneration++;
      store.setState(initialState());
    },
    refreshMessages: (input?: RefreshMessagesOptions) =>
      currentRefresh?.(input) ?? Promise.resolve(false),
    async loadBefore() {
      await controller?.loadBefore();
    },
    async loadAfter() {
      await controller?.loadAfter();
    },
    async loadLatest() {
      await controller?.loadLatest();
    },
    async loadAround(sequence: number) {
      await controller?.loadAround(sequence);
    },
  };
}
