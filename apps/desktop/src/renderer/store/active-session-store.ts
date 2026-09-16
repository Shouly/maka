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

import { observeLocalMessages } from './local-messages.js';
import type { DesktopLocalMessage } from '../bridge/session-local.js';
import { createStore } from 'zustand/vanilla';
import type { ContextCompactionOutcome, SessionEvent, ShellRunUpdate } from '@maka/core/events';
import type { StoredMessage } from '@maka/core/session';
import type { SessionEventStreamSnapshot } from '@maka/core/session-event-health';
import type { ExecutionBoundaryReadModel } from '@maka/core/sandbox-boundary';
import type { UiLocale } from '@maka/core/ui-locale';
import {
  createTranscriptViewportNavigation,
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
  captureTranscriptReadingAnchor,
  createTranscriptRestoreLifecycle,
  currentTranscriptRange,
  prepareTranscriptForSend,
  restoreSessionTranscriptRange,
  TranscriptReadSupersededError,
  transcriptRestoreTarget,
  type TranscriptReadingAnchor,
  type TranscriptRestoreLifecycle,
} from '../lib/ported/transcript-reading-position.js';
import {
  createSessionEventStreamSubscription,
  evaluateSessionEventStreamSnapshot,
  recordSessionEventStreamChange,
  recordSessionEventStreamEvent,
} from '../lib/ported/session-event-health.js';
import { sessionExpectsEventStream } from '@maka/core/session-event-health';
import type { SessionChangedEvent, SessionStatus } from '@maka/core/session';
import { deriveLiveTurnSnapshot } from '../lib/ported/live-turn-snapshot.js';
import { reconcileSettledSessionTransients } from '../lib/ported/settled-session-transients.js';
import { readExecutionBoundaryWithRetry } from '../lib/ported/execution-boundary-read.js';
import { mergeTransientMessageProjection } from '../lib/ported/transient-message-projection.js';
import type { DesktopSessionSummary } from '../bridge/sessions.js';
import { MESSAGE_QUEUE_MAX_ENTRIES } from '@maka/runtime-host/protocol';

export interface TranscriptHistoryRequest {
  readonly target: 'earlier' | 'later' | 'latest';
}

export interface TranscriptHistoryPending {
  readonly sessionId: string;
  readonly target: TranscriptHistoryRequest['target'];
}

/**
 * A live projection minus what a reseed replays: the text and thinking still
 * streaming. Steps that finished (a completed message, a tool call) stay; a
 * step left with nothing goes.
 */
function dropIncompleteStreams(projection: LiveTurnProjection): LiveTurnProjection | undefined {
  let changed = false;
  const steps = projection.steps.flatMap((step) => {
    const dropText = step.text !== undefined && !step.text.complete;
    const dropThinking = step.thinking !== undefined && !step.thinking.complete;
    if (!dropText && !dropThinking) return [step];
    changed = true;
    const { text, thinking, ...rest } = step;
    const next = {
      ...rest,
      ...(dropText || text === undefined ? {} : { text }),
      ...(dropThinking || thinking === undefined ? {} : { thinking }),
    };
    const empty =
      next.text === undefined &&
      next.thinking === undefined &&
      next.tools.length === 0 &&
      (next.leadingSteering?.length ?? 0) === 0;
    return empty ? [] : [next];
  });
  if (!changed) return projection;
  if (steps.length === 0 && (projection.pendingSteering?.length ?? 0) === 0) return undefined;
  return { ...projection, steps };
}

const SETTLE_FALLBACK_GRACE_MS = 1_000;
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
  localHandoffPending: boolean;
  error: string | undefined;
  /**
   * The transcript itself could not be opened or read (upstream
   * `messageLoadError`). Separate from `error` so the notice that offers a
   * retry only fires for the thing the retry reloads.
   */
  transcriptError: string | undefined;
  health: SessionEventStreamSnapshot | undefined;
  liveTurns: Record<string, LiveTurnProjection>;
  interactions: InteractionQueues;
  queues: Record<string, MessageQueueUiState>;
  transientMessages: readonly TransientUserMessageProjection[];
  localMessages: readonly DesktopLocalMessage[];
  shellUpdates: readonly ShellRunUpdate[];
  executionBoundary: ExecutionBoundaryReadModel | undefined;
  /** Main was asked for the boundary and every attempt failed (#1629). */
  boundaryUnreadable: boolean;
  /** A boundary read is in flight. */
  boundaryReading: boolean;
  compactionOutcome: ContextCompactionOutcome | undefined;
  /** Which direction a history page is loading in, when one is. */
  historyPending: TranscriptHistoryPending | undefined;
  /**
   * Where the reader was parked, per Session. Survives a selection change —
   * that is the whole point — so it is restored rather than reset below.
   */
  readingAnchors: Readonly<Record<string, TranscriptReadingAnchor | undefined>>;
  /** A remembered anchor whose turn the range could not produce. */
  unavailableAnchorTurnId: string | undefined;
}
const initialState = (): ActiveSessionState => ({
  sessionId: undefined,
  messages: [],
  range: undefined,
  loading: false,
  observationReady: false,
  localHandoffPending: false,
  error: undefined,
  transcriptError: undefined,
  health: undefined,
  liveTurns: {},
  interactions: {},
  queues: {},
  transientMessages: [],
  localMessages: [],
  shellUpdates: [],
  executionBoundary: undefined,
  boundaryUnreadable: false,
  boundaryReading: false,
  compactionOutcome: undefined,
  historyPending: undefined,
  readingAnchors: {},
  unavailableAnchorTurnId: undefined,
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
    /** The catalog's status for a Session — the health probe's expectation input. */
    sessionStatus?: (sessionId: string) => SessionStatus | undefined;
    /** Injectable for tests: the boundary read's retry schedule. */
    boundaryRetryDelaysMs?: readonly number[];
    /** Injectable for tests: the event-stream health probe interval. */
    healthProbeIntervalMs?: number;
  } = {},
) {
  const api = options.sessions ?? sessions;
  const transcriptApi = options.transcripts ?? transcripts;
  const shellApi = options.shellRuns ?? shellRuns;
  const store = createStore<ActiveSessionState>(initialState);
  // Read-only observers of the ACTIVE session's event stream: the workbar's
  // Review and Inspector faces re-read their own Host projections when a turn
  // appends to a ledger. They fan out from the one subscription this store
  // already owns rather than opening a second observer per face — the preload
  // mints an observer id per `subscribeEvents`, and three of them on one
  // session would triple the seed traffic to say the same thing.
  const eventListeners = new Set<(sessionId: string, event: SessionEvent) => void>();
  // One explicit viewport channel for the app's lifetime: a send publishes a
  // pin here and `useChatScroll` consumes it once. It is deliberately not
  // store state — a command is an event, and replaying it on the next render
  // would take the viewport back from a reader who has since scrolled away.
  const viewportNavigation = createTranscriptViewportNavigation();
  let dispose = () => {};
  let controller: RecoveringDesktopTranscriptRangeController | undefined;
  let currentRefresh: ((options?: RefreshMessagesOptions) => Promise<boolean>) | undefined;
  let currentPublishTransient: (() => void) | undefined;
  let currentEvaluateHealth: (() => void) | undefined;
  let currentRefreshBoundary: (() => void) | undefined;
  let currentFailTranscript: ((error: unknown) => void) | undefined;
  let currentRemoveTransient: ((messageId: string) => void) | undefined;
  // The user's own sends, shown the instant they leave the composer and
  // retired when the Host's durable copy carries the same id (upstream
  // `showTransientUserMessage`). Kept per Session and outside the selection
  // because a send from the welcome surface lands before its Session has
  // been observed, and switching tasks must not forget an unacknowledged one.
  const optimisticBySession = new Map<string, Map<string, TransientUserMessageProjection>>();
  const optimisticFor = (sessionId: string) => {
    let map = optimisticBySession.get(sessionId);
    if (!map) {
      map = new Map();
      optimisticBySession.set(sessionId, map);
    }
    return map;
  };
  // A bookmark survives navigation; the command to restore it does not. One
  // lifecycle per selection is what makes the restore happen once per
  // activation rather than on every batch that changes the messages.
  let restoreLifecycle: TranscriptRestoreLifecycle = createTranscriptRestoreLifecycle();
  let selectionGeneration = 0;
  let observingLocalOnly = false;

  const setAnchor = (sessionId: string, anchor: TranscriptReadingAnchor | undefined) => {
    store.setState((state) => ({
      readingAnchors: { ...state.readingAnchors, [sessionId]: anchor },
    }));
  };
  const isCurrentController = (sessionId: string, candidate: object) =>
    candidate === controller && store.getState().sessionId === sessionId;
  /**
   * Drop the pending indicator for a Session.
   *
   * The Renderer owns the transcript window (upstream #5170): the range
   * controller refuses a read against an edge it has already read and a
   * navigation replaces the window outright, so there is no paging gate left
   * to drop — only the indicator the gap rows show.
   */
  const cancelHistory = (sessionId: string) => {
    const active = controller;
    if (currentTranscriptRange(active, sessionId) === undefined) return;
    store.setState((state) => ({
      historyPending:
        state.historyPending?.sessionId === sessionId ? undefined : state.historyPending,
    }));
  };
  /** Cancel a restore in flight; `clearAnchor` also forgets the bookmark. */
  const cancelRestore = (sessionId: string, clearAnchor: boolean) => {
    restoreLifecycle.cancel(sessionId);
    if (!clearAnchor) return;
    setAnchor(sessionId, undefined);
    store.setState({ unavailableAnchorTurnId: undefined });
  };

  function observe(sessionId: string | undefined, locale: UiLocale, localOnly = false): () => void {
    const previous = store.getState();
    const localHandoff = previous.sessionId === sessionId && observingLocalOnly && !localOnly;
    observingLocalOnly = localOnly;
    dispose();
    const generation = ++selectionGeneration;
    // Entering a Session is what captures a bookmark to restore. Clearing one
    // inside the activation must not restart the old restore.
    const lifecycle = createTranscriptRestoreLifecycle();
    restoreLifecycle = lifecycle;
    store.setState({
      ...initialState(),
      // What a live Turn had produced by the time the reader left survives the
      // switch, as the bookmarks do. The Host re-seeds only what is still
      // incomplete (the streaming text, pending interactions), and its
      // transcript overlay is bootstrapped once per replica, so the steps that
      // finished while this Session was on screen exist nowhere else. A Turn
      // that ended meanwhile is retired by the transcript it left behind
      // (`reconcilePersistedMessages`), a new Turn's events replace the old
      // projection, and the pending display gate holds the seed until ready.
      // A Session never revisited keeps its projection until disconnect: the
      // set is bounded by Sessions that had a live Turn on screen, and
      // nothing reads it before the next visit reconciles it.
      liveTurns: previous.liveTurns,
      // The same local task is becoming observable on the Host. Its saved
      // intents remain in flight while the replacement observer hydrates.
      ...(localHandoff
        ? { localMessages: previous.localMessages, transientMessages: previous.transientMessages }
        : {}),
      readingAnchors: store.getState().readingAnchors,
      sessionId,
      localHandoffPending: localHandoff,
      loading: !!sessionId,
    });
    if (!sessionId) {
      dispose = () => {};
      return dispose;
    }
    let closed = false;
    const current = () => !closed && generation === selectionGeneration;
    const commit = (patch: Partial<ActiveSessionState>) => {
      if (current()) store.setState(patch);
    };
    if (localOnly) {
      const optimistic = optimisticFor(sessionId);
      const publish = () =>
        commit({
          transientMessages: [...optimistic.values()],
          loading: false,
          observationReady: true,
        });
      const retire = (id: string) => {
        optimistic.delete(id);
        publish();
      };
      currentPublishTransient = publish;
      currentRemoveTransient = retire;
      publish();
      const offLocal = observeLocalMessages({
        sessionId,
        locale,
        publish(message) {
          const previous = optimistic.get(message.id);
          optimistic.set(
            message.id,
            previous ? mergeTransientMessageProjection(previous, message) : message,
          );
        },
        retire,
        snapshot(localMessages) {
          commit({ localMessages });
          publish();
        },
        reportError: (message) => options.toast?.error(message),
      });
      dispose = () => {
        closed = true;
        offLocal();
        if (currentPublishTransient === publish) currentPublishTransient = undefined;
        if (currentRemoveTransient === retire) currentRemoveTransient = undefined;
      };
      return dispose;
    }
    const fail = (error: unknown) => commit({ error: errorMessage(error), loading: false });
    // The transcript could not be opened or read. Kept apart from `fail` so
    // the retry the notice offers reloads exactly what failed.
    const failTranscript = (error: unknown) =>
      commit({ transcriptError: errorMessage(error), error: errorMessage(error), loading: false });
    const transient = new Map<string, TransientUserMessageProjection>();
    const optimistic = optimisticFor(sessionId);
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
    const publishTransient = () => {
      const messages = store.getState().messages;
      // A reader scrolled back into history is looking at a page that has
      // newer rows after it; an in-flight send belongs to the tail, not to
      // the bottom of that page. The rows are kept, only their presentation
      // waits for the tail to come back.
      let includeTransient = true;
      try {
        includeTransient = !transcript.range().hasNewer;
      } catch {
        // An unopened transcript has no historical range to hide the tail from.
      }
      // The user's sends first: they precede anything the Host has queued.
      const merged = new Map(
        reconcileTransientMessages(optimistic, messages, { includeTransient }).map((message) => [
          message.id,
          message,
        ]),
      );
      for (const message of reconcileTransientMessages(transient, messages, { includeTransient })) {
        const previous = merged.get(message.id);
        merged.set(
          message.id,
          previous ? mergeTransientMessageProjection(previous, message) : message,
        );
      }
      commit({ transientMessages: [...merged.values()] });
    };
    const removeAnyTransient = (messageId: string) => {
      transient.delete(messageId);
      optimistic.delete(messageId);
      publishTransient();
    };
    const offLocal = observeLocalMessages({
      sessionId,
      locale,
      publish(message) {
        const previous = optimistic.get(message.id);
        optimistic.set(
          message.id,
          previous ? mergeTransientMessageProjection(previous, message) : message,
        );
      },
      retire: removeAnyTransient,
      snapshot(localMessages) {
        commit({ localMessages });
        publishTransient();
      },
      reportError: (message) => options.toast?.error(message),
    });
    // Which local rows the Host has cancelled since the stream was last
    // heard: a stop mid-flight, an `outcome_unknown` that was in fact
    // refused. Asked at every (re)seed, in the protocol's per-query chunks;
    // a failed proof query retires nothing.
    const retireCancelledTransients = async () => {
      const messageIds = [...optimistic.keys(), ...transient.keys()];
      if (messageIds.length === 0) return;
      try {
        const cancelled: string[] = [];
        for (let from = 0; from < messageIds.length; from += MESSAGE_QUEUE_MAX_ENTRIES) {
          const result = await api.queryCancelledMessages(
            sessionId,
            messageIds.slice(from, from + MESSAGE_QUEUE_MAX_ENTRIES),
          );
          cancelled.push(...result.cancelledMessageIds);
        }
        if (!current() || cancelled.length === 0) return;
        for (const messageId of cancelled) {
          transient.delete(messageId);
          optimistic.delete(messageId);
        }
        publishTransient();
      } catch {
        // Presentation stays until canonical proof arrives.
      }
    };
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
        failTranscript(error);
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
    // #1629: a boundary that cannot be read is a state the user is told about,
    // not a silent gap. The bounded retry rides out a main process still
    // settling the Session; after that the composer yields to a notice with
    // another attempt, because sending into permissions the client cannot
    // describe is the one thing this read exists to prevent.
    const refreshBoundary = async () => {
      const request = ++boundaryRequest;
      commit({ boundaryReading: true });
      const result = await readExecutionBoundaryWithRetry({
        read: () => api.readExecutionBoundary(sessionId),
        wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
        cancelled: () => !current() || request !== boundaryRequest,
        ...(options.boundaryRetryDelaysMs ? { retryDelaysMs: options.boundaryRetryDelaysMs } : {}),
      });
      if (result.outcome === 'cancelled') return;
      commit(
        result.outcome === 'read'
          ? {
              executionBoundary: result.boundary,
              boundaryUnreadable: false,
              boundaryReading: false,
            }
          : { executionBoundary: undefined, boundaryUnreadable: true, boundaryReading: false },
      );
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
          optimistic.delete(messageId);
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
        ...(snapshot.ready ? { loading: false, error: undefined, transcriptError: undefined } : {}),
      });
      handlers.reconcilePersistedMessages(sessionId!, snapshot.messages);
      publishTransient();
      scheduleSettleFallback(snapshot.messages);
      reanchorAfterGenerationChange(snapshot);
    }
    const reportNavigationError = (error: unknown) => {
      // A read the Host refused because its epoch moved is superseded, not
      // failed: the reset that follows carries the new epoch.
      if (error instanceof TranscriptReadSupersededError) return;
      if (current()) store.setState({ error: errorMessage(error) });
    };
    // The bookmark outlives a replica generation change, the rows it named do
    // not. Within one Host epoch the sequence still names the row, so the
    // page around it is asked for again; across epochs sequences are renamed
    // and the Turn has to be found again by id through the landmark index.
    let lastLiveGeneration: { generation: string; hostEpoch: string } | undefined;
    function reanchorAfterGenerationChange(snapshot: DesktopTranscriptRangeState) {
      if (!snapshot.ready || snapshot.generation.startsWith('cached:')) return;
      const previous = lastLiveGeneration;
      lastLiveGeneration = { generation: snapshot.generation, hostEpoch: snapshot.hostEpoch };
      if (!previous || previous.generation === snapshot.generation) return;
      const id = sessionId!;
      const anchor = store.getState().readingAnchors[id];
      const active = rangeController;
      if (!anchor || active.store.sequenceForTurn(anchor.turnId) !== null) return;
      const navigate = (sequence: number) => {
        void active.loadAround(sequence).catch(reportNavigationError);
      };
      if (previous.hostEpoch === snapshot.hostEpoch) {
        if (anchor.sequence !== undefined) navigate(anchor.sequence);
        return;
      }
      const { turnId } = anchor;
      void api.listTurnLandmarks(id).then(
        (landmarks) => {
          if (!current() || !isCurrentController(id, active)) return;
          // A reader who has gone somewhere else since owns the position now.
          if (store.getState().readingAnchors[id]?.turnId !== turnId) return;
          const landmark = landmarks.landmarks.find((turn) => turn.turnId === turnId);
          // A Turn the new epoch does not name leaves the reader where the reset put them.
          if (!landmark) return;
          setAnchor(id, { turnId, sequence: landmark.sequence });
          navigate(landmark.sequence);
        },
        () => undefined,
      );
    }
    const unsubscribeTranscript = transcript.subscribe(applyTranscript);
    // Streaming-settle handoff, fallback path (upstream's
    // `SETTLE_FALLBACK_GRACE_MS`). The terminal event is the primary handoff;
    // a stuck live slot would otherwise hide the committed answer forever,
    // because `streamingMessageId` suppresses it while live.
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let settleScheduledFor: string | undefined;
    function scheduleSettleFallback(messages: readonly StoredMessage[]) {
      const id = sessionId!;
      const live = deriveLiveTurnSnapshot(store.getState().liveTurns[id]);
      const messageId = live.streamingMessageId;
      if (messageId === undefined || settleScheduledFor === messageId) return;
      if (!messages.some((message) => message.type === 'assistant' && message.id === messageId))
        return;
      clearTimeout(settleTimer);
      settleScheduledFor = messageId;
      settleTimer = setTimeout(() => {
        settleScheduledFor = undefined;
        if (current()) void handlers.settleAssistantStreaming(id, messageId);
      }, SETTLE_FALLBACK_GRACE_MS);
    }
    rangeController = createRecoveringDesktopTranscriptRangeController(
      transcript,
      async (signal) => {
        return transcriptApi.openTranscript(
          sessionId,
          (batch) => {
            if (!current() || signal.aborted) return;
            try {
              transcript.accept(batch);
            } catch (error) {
              failTranscript(error);
            }
          },
          (cancel) => {
            if (signal.aborted) cancel();
            else signal.addEventListener('abort', cancel, { once: true });
          },
        );
      },
      { onError: failTranscript },
    );
    controller = rangeController;
    currentRefresh = refresh;
    currentPublishTransient = publishTransient;
    currentRefreshBoundary = () => void refreshBoundary();
    currentFailTranscript = failTranscript;
    currentRemoveTransient = removeAnyTransient;
    publishTransient();
    commit({ health: createSessionEventStreamSubscription({ sessionId, now: Date.now() }) });
    // The event-stream health probe (upstream `useSessionEventHealthPolling`).
    // A stream nobody expects has nothing to observe, so an idle Session gets
    // no probe; a running one is checked every few seconds and on return to
    // the foreground, and a stalled one asks the Host for the catalog and the
    // transcript again — the only way a wedged stream ever self-heals.
    const evaluateHealth = () => {
      if (!current()) return;
      const state = store.getState();
      const live = deriveLiveTurnSnapshot(state.liveTurns[sessionId]);
      // Quiet the screen already explains is not a symptom, and this is where
      // that is decided — the only verdict anyone renders is the one made
      // here. A tool call in flight sends nothing until its result, and an
      // open question sends nothing until the user answers; both routinely
      // outlast the staleness threshold (a build, a test run, a question left
      // on screen). Judging them would report a stalled stream on the most
      // ordinary minute of work there is.
      if (live.hasInFlightTools || (state.interactions[sessionId]?.length ?? 0) > 0) return;
      const hasLiveActivity = live.hasStreamingText && live.streamingMessageId === undefined;
      const sessionStatus = options.sessionStatus?.(sessionId);
      if (!sessionExpectsEventStream(sessionStatus, hasLiveActivity)) return;
      const result = evaluateSessionEventStreamSnapshot({
        previous: state.health,
        now: Date.now(),
        sessionStatus,
        hasLiveActivity,
      });
      if (!result.snapshot) return;
      commit({ health: result.snapshot });
      if (result.shouldRefresh) {
        void options.refreshSessions?.();
        void refresh();
      }
    };
    const healthTimer = setInterval(evaluateHealth, options.healthProbeIntervalMs ?? 5_000);
    // A probe must never be what keeps a process alive (node test runners).
    (healthTimer as { unref?: () => void }).unref?.();
    const onVisible = () => {
      if (document.visibilityState === 'visible') evaluateHealth();
    };
    const hasDocument = typeof document !== 'undefined';
    if (hasDocument) document.addEventListener('visibilitychange', onVisible);
    currentEvaluateHealth = evaluateHealth;

    const beginSeed = () => {
      handlers.dropDisplayEvents(sessionId);
      handlers.markDisplayPending(sessionId);
      interactionEvents++;
      transient.clear();
      // The finished steps stay: they have no other source. The incomplete
      // text and thinking go, because the seed replays them whole from offset
      // zero while their live deltas carried no offsets — kept, the replay
      // would land after the text it repeats.
      const liveTurns = { ...store.getState().liveTurns };
      const kept = liveTurns[sessionId];
      if (kept) {
        const trimmed = dropIncompleteStreams(kept);
        if (trimmed) liveTurns[sessionId] = trimmed;
        else delete liveTurns[sessionId];
      }
      commit({
        observationReady: false,
        liveTurns,
        interactions: {},
        queues: {},
        // A reseed forgets what the Host had queued, not what the user sent.
        transientMessages: [...optimistic.values()],
      });
    };
    const ready = () => {
      if (!current()) return;
      failures = 0;
      rangeController.observationChanged('ready');
      // Deltas buffered across the seed boundary land before the display is
      // declared ready, or they are dropped with the seed.
      handlers.flushDisplayEvents(sessionId);
      handlers.markDisplayReady(sessionId);
      commit({ observationReady: true, localHandoffPending: false });
      void refreshInteractions();
      void refreshBoundary();
      void retireCancelledTransients();
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
            // After the shell's own handling: an observer that re-reads a Host
            // projection must see the state this event produced, not the one
            // before it.
            for (const listener of eventListeners) listener(sessionId, event);
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
      lifecycle.deactivate();
      attempt++;
      clearTimeout(retry);
      clearTimeout(shellRetry);
      clearInterval(healthTimer);
      clearTimeout(settleTimer);
      if (hasDocument) document.removeEventListener('visibilitychange', onVisible);
      if (currentEvaluateHealth === evaluateHealth) currentEvaluateHealth = undefined;
      handlers.dropDisplayEvents(sessionId);
      unsubscribe();
      offInteractions();
      offLocal();
      offShell();
      offResync();
      unsubscribeTranscript();
      void rangeController.close();
      if (controller === rangeController) {
        controller = undefined;
        currentRefresh = undefined;
        currentPublishTransient = undefined;
        currentRefreshBoundary = undefined;
        currentFailTranscript = undefined;
        currentRemoveTransient = undefined;
      }
      if (generation === selectionGeneration)
        store.setState({ observationReady: false, loading: false });
    };
    return dispose;
  }
  return {
    ...store,
    observe,
    /**
     * Watch the active session's event stream without opening one.
     *
     * The handler is called after the shell has applied the event, and only
     * for the session that is in front — a face is only ever looking at that
     * one. Returns the release; calling it twice is safe.
     */
    subscribeSessionEvents(listener: (sessionId: string, event: SessionEvent) => void): () => void {
      eventListeners.add(listener);
      return () => {
        eventListeners.delete(listener);
      };
    },
    disconnect() {
      dispose();
      selectionGeneration++;
      store.setState({ ...initialState(), readingAnchors: store.getState().readingAnchors });
    },
    refreshMessages: (input?: RefreshMessagesOptions) =>
      currentRefresh?.(input) ?? Promise.resolve(false),
    /**
     * Show the user's message the moment it leaves the composer.
     *
     * The durable copy the Host writes carries the same id, and the next
     * transcript batch that contains it retires this one; a send that never
     * reaches the Host is withdrawn by its caller (`removeTransientMessage`).
     */
    showTransientUserMessage(sessionId: string, message: TransientUserMessageProjection) {
      optimisticFor(sessionId).set(message.id, message);
      if (store.getState().sessionId === sessionId) {
        // A send is the user's answer to a failed load: the transcript is
        // about to be asked for again, so the stale verdict comes down.
        if (store.getState().transcriptError !== undefined)
          store.setState({ transcriptError: undefined });
        currentPublishTransient?.();
      }
    },
    /**
     * What the Host made of a submitted message: the Turn it landed in, the
     * attachments it resolved, the inline references it kept. A Host-named
     * Turn outranks a later local update that has none.
     */
    updateTransientMessage(sessionId: string, message: TransientUserMessageProjection) {
      const map = optimisticFor(sessionId);
      const existing = map.get(message.id);
      // The durable copy already retired it; a late update must not resurrect it.
      if (!existing) return;
      map.set(message.id, mergeTransientMessageProjection(existing, message));
      if (store.getState().sessionId === sessionId) currentPublishTransient?.();
    },
    /** Ask for the transcript again after a failed open or read. */
    retryTranscript() {
      const active = controller;
      if (!active) return;
      store.setState({ transcriptError: undefined, loading: true });
      void active.reload().catch((error) => {
        if (controller === active) currentFailTranscript?.(error);
      });
    },
    /** Another attempt at the boundary read (#1629). */
    reloadExecutionBoundary() {
      currentRefreshBoundary?.();
    },
    /**
     * A catalog change about the observed Session. A named turn's start,
     * refusal or end confirms the local claim; an appended message is read
     * back at once; either counts as the stream speaking for health.
     */
    recordSessionChange(event: SessionChangedEvent) {
      const sessionId = store.getState().sessionId;
      if (!sessionId || event.sessionId !== sessionId) return;
      const health = store.getState().health;
      if (health) store.setState({ health: recordSessionEventStreamChange(health, event.ts) });
      if (event.reason === 'message-appended') void currentRefresh?.();
    },
    /** The catalog was read; the live projections as they stood before that read. */
    observeLiveTurns(): Readonly<Record<string, LiveTurnProjection>> {
      return store.getState().liveTurns;
    },
    /**
     * Retire the live turn of any Session the authority says has settled.
     *
     * Compared against the projections observed before the catalog read
     * began: a turn that advanced while the read was in flight is not retired
     * by that older snapshot. Without this a dropped terminal event leaves
     * the composer locked in "running" until the task is re-selected.
     */
    reconcileSettledLiveTurns(
      sessions: readonly DesktopSessionSummary[],
      observed: Readonly<Record<string, LiveTurnProjection>>,
    ) {
      reconcileSettledSessionTransients({
        activeId: store.getState().sessionId,
        sessions,
        observedLiveTurnBySession: observed,
        clearTurnTransientStateIfCurrent: (sessionId, expected) => {
          const live = store.getState().liveTurns;
          if (expected === undefined || live[sessionId] !== expected) return;
          const next = { ...live };
          delete next[sessionId];
          store.setState({ liveTurns: next });
        },
      });
    },
    /** Test seam: run the health probe now. */
    probeHealth() {
      currentEvaluateHealth?.();
    },
    /**
     * Withdraw a local row: a refused send, a retracted queue entry, a
     * message a stop interrupted. Covers the Host-queued rows of the
     * observed Session as well as the user's own sends.
     */
    removeTransientMessage(sessionId: string, messageId: string) {
      optimisticBySession.get(sessionId)?.delete(messageId);
      if (store.getState().sessionId === sessionId) {
        if (currentRemoveTransient) currentRemoveTransient(messageId);
        else currentPublishTransient?.();
      }
    },
    async loadBefore(maxBytes?: number) {
      await controller?.loadBefore(maxBytes);
    },
    async loadAfter(maxBytes?: number) {
      await controller?.loadAfter(maxBytes);
    },
    async loadLatest() {
      await controller?.loadLatest();
    },
    async loadAround(sequence: number) {
      await controller?.loadAround(sequence);
    },
    /**
     * One explicit paging command from the reader: a gap row's button or the
     * return to the tail.
     *
     * The range controller keeps at most one read per edge in flight and
     * refuses one against an edge it has already read, so nothing here has to
     * queue. What is kept is the indicator: the gap row that asked shows it
     * is loading until its page lands.
     *
     * A `latest` command is the reader saying "take me back to the tail", so
     * it abandons the bookmark and replaces the window outright.
     */
    async loadHistory(request: TranscriptHistoryRequest): Promise<void> {
      const sessionId = store.getState().sessionId;
      const active = controller;
      if (!sessionId || !active || !isCurrentController(sessionId, active)) return;
      cancelRestore(sessionId, request.target === 'latest');
      if (request.target === 'latest') cancelHistory(sessionId);
      const pending: TranscriptHistoryPending = { sessionId, target: request.target };
      store.setState({ historyPending: pending });
      try {
        if (request.target === 'latest') await active.loadLatest();
        else if (request.target === 'earlier') await active.loadBefore();
        else await active.loadAfter();
      } catch (error) {
        if (error instanceof TranscriptReadSupersededError) return;
        if (isCurrentController(sessionId, active)) store.setState({ error: errorMessage(error) });
      } finally {
        store.setState((state) => ({
          historyPending: state.historyPending === pending ? undefined : state.historyPending,
        }));
      }
    },
    /**
     * The scroller filling an edge as the reader nears it. Deliberately not
     * `loadHistory`: that one cancels restoration because a reader who asks to
     * go somewhere has decided where to be. Filling decides nothing, so it
     * must leave an outstanding jump alone — the page it is waiting for can
     * still be in flight.
     *
     * Safe to ask on every frame the geometry wants it: the range controller
     * refuses a read against an edge it has already read, and answers whether
     * it issued one.
     */
    async prefetchHistory(edge: 'older' | 'newer'): Promise<boolean> {
      const sessionId = store.getState().sessionId;
      const active = controller;
      if (!sessionId || !active || !isCurrentController(sessionId, active)) return false;
      try {
        return edge === 'older' ? await active.loadBefore() : await active.loadAfter();
      } catch (error) {
        if (
          !(error instanceof TranscriptReadSupersededError) &&
          isCurrentController(sessionId, active)
        )
          store.setState({ error: errorMessage(error) });
        return false;
      }
    },
    /** The Turns the reader can still reach within the retained band; the rest may go. */
    retainWindow(window: { firstTurnId: string; lastTurnId: string }): void {
      const sessionId = store.getState().sessionId;
      const active = controller;
      if (!sessionId || !active || !isCurrentController(sessionId, active)) return;
      if (currentTranscriptRange(active, sessionId) === undefined) return;
      try {
        active.store.retain(
          active.store.sequenceForTurn(window.firstTurnId, 'first'),
          active.store.sequenceForTurn(window.lastTurnId, 'last'),
        );
      } catch {
        // A stale range has no window to trim.
      }
    },
    /**
     * A send takes the viewport back to the tail and abandons the bookmark.
     *
     * Local admission never waits for it: the pin is published synchronously
     * and the catch-up page runs in the background, so an unopened, slow or
     * offline transcript cannot delay saving the user's message.
     */
    prepareSend(sessionId: string): Promise<boolean> {
      cancelHistory(sessionId);
      return prepareTranscriptForSend({
        sessionId,
        currentSessionId: { current: store.getState().sessionId },
        controller: { current: controller },
        cancel: cancelRestore,
        followLatest: viewportNavigation.followLatest,
      });
    },
    /** The one explicit viewport channel, for `useChatScroll`. */
    viewportNavigation,
    /** Where a turn sits in the durable range, or `null` when it is not resident. */
    sequenceForTurn(turnId: string): number | null {
      try {
        const range = controller?.store;
        if (!range || range.range().sessionId !== store.getState().sessionId) return null;
        return range.sequenceForTurn(turnId);
      } catch {
        return null;
      }
    },
    /**
     * Remember where the reader was parked, so returning to this task lands
     * there rather than at the tail.
     *
     * Kept outside `initialState()` on purpose: the whole point is to survive
     * the selection change that resets everything else.
     */
    setReadingAnchor(sessionId: string, turnId: string | undefined) {
      const active = controller;
      if (store.getState().sessionId !== sessionId) return;
      store.setState({ unavailableAnchorTurnId: undefined });
      // Only the bookmark moves. The window is the Renderer's own, so a reader
      // parking on a Turn needs no page from the Host, and walking back to the
      // tail reveals it from the window already held. Which positions count as
      // bookmarks is the scroller's call (`useChatScroll` `bookmarks`).
      captureTranscriptReadingAnchor({
        sessionId,
        currentSessionId: store.getState().sessionId,
        ...(turnId ? { turnId } : {}),
        ...(active ? { controller: active } : {}),
        setAnchor,
      });
    },
    /** The turn `useChatScroll` should restore to, and whether it is gone. */
    restoreTarget(sessionId: string): { turnId: string; unavailable: boolean } | undefined {
      return transcriptRestoreTarget(
        store.getState().readingAnchors[sessionId],
        store.getState().unavailableAnchorTurnId,
      );
    },
    /**
     * Bring the remembered turn back into the range, if it is not already
     * resident.
     *
     * Safe to call on every batch: the lifecycle admits one restore per
     * activation, so a re-run while the first one is still in flight is a
     * no-op rather than a second navigation command. The range publishes
     * through its own batch handler, so nothing here has to set messages.
     *
     * A remembered anchor whose turn the Host can no longer produce is
     * reported as unavailable rather than silently dropped: the scroller has
     * to know it should stop waiting and take the tail instead. An
     * overlay-only live turn is not that case — it is already on screen
     * without a durable sequence.
     */
    restoreReadingPosition(): void {
      const sessionId = store.getState().sessionId;
      restoreSessionTranscriptRange({
        lifecycle: restoreLifecycle,
        sessionId,
        readingAnchor: sessionId ? store.getState().readingAnchors[sessionId] : undefined,
        controller,
        isCurrent: isCurrentController,
        setReadingAnchor: setAnchor,
        onRestoreUnavailable: (_id, turnId) => store.setState({ unavailableAnchorTurnId: turnId }),
        onError: (error) => store.setState({ error: errorMessage(error) }),
      });
    },
  };
}
