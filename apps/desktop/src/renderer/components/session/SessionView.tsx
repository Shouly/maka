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

// The conversation surface.
//
// Three things meet here and each has exactly one owner:
//
//   WHAT is on screen — `useActiveTurns()`, the same `TurnViewModel[]` the
//   projection produces. Nothing here reads raw events.
//
//   HOW MUCH is on screen — the range store's byte-budgeted window. A long
//   conversation is never fully resident, so the feed has two edges and
//   `projectTranscriptRows` puts a gap row at each.
//
//   WHERE it is looking — `TranscriptScrollAuthority`, and only it. Three
//   writers used to move `scrollTop` and avoid each other through flags; the
//   authority is one boolean instead (pinned → growth writes, released →
//   nothing here writes, ever). Every command releases the pin first, which is
//   why a command can never race the policy.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { revealSessionFile } from '../../bridge/app.js';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { userFacingText, type StoredMessage } from '@maka/core/session';
import type { PlanProposal } from '@maka/core/plan';
import {
  SessionAttachmentProvider,
  TranscriptScrollAuthorityProvider,
  projectTranscriptRows,
  finalAssistantReplyText,
  useChatScroll,
  useTranscriptScrollAuthority,
  useUiLocale,
  type TurnViewModel,
  type TransientUserMessageProjection,
} from '@maka/ui';
import { openExternal } from '../../bridge/external-links.js';
import { readAttachmentBytes } from '../../bridge/attachments.js';
import {
  useActiveTurns,
  useLiveTurnSnapshot,
  useShellLiveTurn,
} from '../../hooks/use-workspace.js';
import {
  openWorkbarArtifact,
  openWorkbarFile,
  openWorkbarTerminal,
} from '../../hooks/use-workbar.js';
import { useTurnPresentation, pendingTurnActionKey } from '../../hooks/use-turn-presentation.js';
import {
  activeSessionStore,
  planStore,
  revisionDraftStore,
  revisionActions,
  sessionsStore,
  turnActionsStore,
  uiStore,
} from '../../store/index.js';
import { requestScheduledTaskFocus } from '../../store/scheduled-tasks-store.js';
import { reviewableProposal } from '../../store/plan-store.js';
import { revisionRefusalFor } from '../../store/revision-draft.js';
import { deriveMessageVersions, type MessageVersions } from '../../lib/ported/session-revisions.js';
import { pendingActionsOf } from '../../store/turn-actions-store.js';
import { getDesktopConversationCopy } from '../../locales/conversation-copy.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';
import type { TurnFooterActionId } from '../../lib/ported/turn-footer-actions.js';
import {
  isSessionWorkspaceUnavailableError,
  showSessionWorkspaceUnavailableToast,
} from '../../lib/ported/session-workspace-errors.js';
import { toastApi } from '../../store/toast-api.js';
import { ChatSkeleton } from '../ui/chat-skeleton.js';
import { placeTransientMessages } from '../../lib/transient-message-placement.js';
import { cn } from '../../lib/cn.js';
import { ChatInput } from '../composer/ChatInput.js';
import { InteractionPrompts } from '../composer/InteractionPrompts.js';
import { JumpToLatest, TranscriptGapRow } from './HistoryControls.js';
import { MessageQueue } from './MessageQueue.js';
import { SelectionQuote } from './SelectionQuote.js';
import { UserMessageRow } from './UserMessageRow.js';
import { TranscriptTurn, TurnStatusBeforeTurn } from './TranscriptTurn.js';
import type { TurnStatusBlocked, TurnStatusLive } from './tools/TurnStatus.js';
import { useQuestionPin } from './use-question-pin.js';
import { deriveWorkingMarkActivity } from '../../lib/turn-activity.js';
import { NoticeCard } from './notices/NoticeCard.js';
import { RevisionBanner } from './notices/RevisionBanner.js';
import { GoalBanner } from './notices/GoalBanner.js';
import { PlanExecutionBanner } from './notices/PlanExecutionBanner.js';
import { PlanProposalCard } from './PlanProposalCard.js';
import { SessionNotices } from './notices/SessionNotices.js';

/** The status-row wording for a pending interaction's type. */
function blockedOnOf(type: string | undefined): TurnStatusBlocked | undefined {
  if (type === undefined) return undefined;
  return type === 'user_question_request' ? 'question' : 'input';
}

export interface SessionViewProps {
  sessionId: string;
  /** Phase 3b swaps the composer in here without touching the transcript. */
  composerSlot?: ReactNode;
  onOpenSettings?: (section?: 'models' | 'projects') => void;
  onError?: (title: string, error: unknown) => void;
}

export function SessionView(props: SessionViewProps) {
  return (
    <TranscriptScrollAuthorityProvider>
      <SessionAttachmentProvider sessionId={props.sessionId} readBytes={readAttachmentBytes}>
        <SessionTranscript {...props} />
      </SessionAttachmentProvider>
    </TranscriptScrollAuthorityProvider>
  );
}

/**
 * Every edited message's versions in this Session's family, by turn id.
 *
 * Selected as a string: a catalog refresh replaces every row, and a selector
 * returning a fresh Map would re-render the transcript on every refresh of any
 * Session. The string only changes when some message's versions do.
 */
function useMessageVersions(sessionId: string): ReadonlyMap<string, MessageVersions> {
  const encoded = useStore(sessionsStore, (state) =>
    JSON.stringify([...deriveMessageVersions(state.sessions, sessionId)]),
  );
  return useMemo(
    () => new Map<string, MessageVersions>(JSON.parse(encoded) as [string, MessageVersions][]),
    [encoded],
  );
}

function SessionTranscript(props: SessionViewProps) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale);
  const actions = getDesktopConversationCopy(locale).actions;
  const sessionId = props.sessionId;
  const scrollRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const authority = useTranscriptScrollAuthority();
  const [switchingToolUseId, setSwitchingToolUseId] = useState<string | undefined>(undefined);

  const turns = useActiveTurns();
  const live = useLiveTurnSnapshot();
  const shellLive = useShellLiveTurn(sessionId);
  const draft = useStore(revisionDraftStore, (state) => state.draft);
  const pending = useStore(turnActionsStore, (state) => pendingActionsOf(state, sessionId));
  const feed = useStore(
    activeSessionStore,
    useShallow((state) => ({
      messages: state.messages,
      transientMessages: state.transientMessages,
      observationReady: state.observationReady,
      hasOlder: state.range?.hasOlder === true,
      hasNewer: state.range?.hasNewer === true,
      historyPending: state.historyPending,
      // The composer yields to a turn-scoped prompt: an answer typed beside
      // it would race the one the prompt is waiting for.
      interactionPending: (state.interactions[sessionId]?.length ?? 0) > 0,
      // What the live turn's status row says while it waits: a question, or
      // anything else the user has to decide.
      blockedOn: blockedOnOf(state.interactions[sessionId]?.[0]?.type),
      // The event stream has gone quiet for long enough that what is on screen
      // may be behind. The live status row says so (`TurnStatus`); the
      // health probe only runs while a turn is active, so the line is always up
      // to carry it.
      streamStale: state.health?.sessionId === sessionId && state.health.status === 'stale',
      // #1629: no boundary, no composer — but never silently. The notice
      // stands where the composer would be and hands the user another read.
      boundaryUnreadable: state.boundaryUnreadable,
      boundaryReading: state.boundaryReading,
    })),
  );

  // The Plan is read for a Session the Host has admitted — the gate GoalBanner
  // uses: a first prompt from the welcome surface runs against a row the Host
  // does not know yet, and asking for its plan is an error for nothing.
  const hostAdmitted = useStore(sessionsStore, (state) => {
    const row = state.sessions.find((session) => session.id === sessionId);
    return row !== undefined && row.localState !== 'pending';
  });
  useEffect(() => {
    if (!hostAdmitted) {
      planStore.disconnect();
      return;
    }
    return planStore.observe(sessionId);
  }, [sessionId, hostAdmitted]);
  const plan = useStore(planStore, (state) => state.data);
  const reviewable = reviewableProposal(plan);
  const proposalsByTurn = useMemo(() => {
    const byTurn = new Map<string, PlanProposal[]>();
    for (const proposal of plan?.proposals ?? []) {
      const list = byTurn.get(proposal.turnId) ?? [];
      list.push(proposal);
      byTurn.set(proposal.turnId, list);
    }
    return byTurn;
  }, [plan]);
  // A proposal stands after its turn. When that turn is outside the loaded
  // window the decision still has to be reachable, so the one still waiting
  // stands at the tail instead.
  const unanchoredReviewable =
    reviewable && !turns.some((turn) => turn.turnId === reviewable.turnId) ? reviewable : undefined;

  const reportError = useCallback(
    (title: string, error: unknown) => {
      // Every Host action on a Session whose directory is gone fails with
      // one typed code; say that, not the raw string.
      if (isSessionWorkspaceUnavailableError(error)) {
        showSessionWorkspaceUnavailableToast(toastApi, locale, { sessionId });
        return;
      }
      props.onError?.(title, error);
    },
    [locale, props, sessionId],
  );

  // After a send the question goes to the top and the answer fills the space
  // beneath it (relx's reading model); the disc offers the tail when there is
  // content below the viewport. See `use-question-pin.ts`.
  const { contentBelow, jumpToLatest } = useQuestionPin({
    scrollRef,
    feedRef,
    endRef,
    sessionId,
    authority,
    viewportNavigation: activeSessionStore.viewportNavigation,
  });

  // Bring the remembered turn back into the range before the scroller looks
  // for it. A cancelled restore is a task the reader already left.
  //
  // Re-run on every published range: the bookmark's turn may only become
  // resident several batches in. The store's restore lifecycle admits one
  // command per activation, so this is idempotent rather than a page per
  // batch.
  useEffect(() => {
    activeSessionStore.restoreReadingPosition();
  }, [sessionId, feed.observationReady, feed.messages]);

  const transientPlacement = useMemo(
    () => placeTransientMessages(turns, feed.transientMessages),
    [turns, feed.transientMessages],
  );
  const turnIds = useMemo(() => turns.map((turn) => turn.turnId), [turns]);
  const messageVersions = useMessageVersions(sessionId);
  const selectVersion = useCallback((id: string) => sessionsStore.select(id), []);
  const pendingTurnActions = usePendingTurnActions(sessionId, pending, turnIds);
  const presentation = useTurnPresentation(turns, {
    activeId: sessionId,
    pendingTurnActions,
    uiLocale: locale,
  });

  const rows = useMemo(
    () =>
      projectTranscriptRows<TurnViewModel>({
        turns,
        hasOlder: feed.hasOlder,
        hasNewer: feed.hasNewer,
      }),
    [turns, feed.hasOlder, feed.hasNewer],
  );

  const loadHistory = useCallback(
    (target: 'earlier' | 'later' | 'latest') => activeSessionStore.loadHistory({ target }),
    [],
  );

  const restoreTarget = activeSessionStore.restoreTarget(sessionId);
  const { highlightedTurnId } = useChatScroll({
    scrollRef,
    sessionId,
    messages: feed.messages,
    ...(restoreTarget ? { restoreTarget } : {}),
    // A send publishes one pin here; the hook consumes it once rather than
    // replaying it on the next growth.
    viewportNavigation: activeSessionStore.viewportNavigation,
    // A send releases the tail pin instead of writing to it: the question is
    // pinned to the top by `useQuestionPin`, and the stream is not followed.
    followLatest: 'release',
    // Parked on the latest Turn is not a bookmark: returning to this task
    // lands on the latest reply, as relx does, not on the question with the
    // reply below the fold. A reader in older history keeps their place.
    bookmarks: 'history',
    behavior: 'smooth',
    hasOlderHistory: feed.hasOlder,
    hasNewerHistory: feed.hasNewer,
    // The window is the renderer's (upstream #5170): the scroller fills an
    // edge as the reader nears it and trims what they can no longer reach.
    onPrefetchHistory: (edge) => activeSessionStore.prefetchHistory(edge),
    onRetainWindow: (window) => activeSessionStore.retainWindow(window),
    onReadingAnchorChange: (turnId) => activeSessionStore.setReadingAnchor(sessionId, turnId),
  });

  const toolContext = useMemo(
    () => ({
      onOpenSession: (childSessionId: string) => sessionsStore.select(childSessionId),
      onOpenExternal: (url: string) => {
        openExternal(url);
      },
      // The two handoffs into the right pane (Phase 4). They are bound to THIS
      // session rather than read from the pane, so a row in a child task's
      // transcript cannot open a file in its parent's pane.
      onOpenFile: (path: string | undefined) => openWorkbarFile(sessionId, path),
      onOpenArtifact: (artifactId: string) => openWorkbarArtifact(sessionId, artifactId),
      onOpenTerminal: (ref: string) => openWorkbarTerminal(sessionId, ref),
      // A delivered file goes to its destination AS ITSELF. The artifact
      // routes materialize a copy under a temp presentation root, which is
      // right for something the session produced and wrong here: this file is
      // already in the user's project, and revealing a shadow of it answers a
      // question nobody asked. Main resolves this session's root and re-checks
      // the path lands inside it, so a delivery from elsewhere is refused —
      // and says so, because a button that silently does nothing is worse.
      onShowDeliveredFile: (path: string | undefined) => {
        if (path === undefined) return;
        void revealSessionFile(sessionId, path).then((result) => {
          if (result.ok) return;
          const delivery = getTranscriptCopy(locale).delivery;
          toastApi.error(
            delivery.openFailed,
            result.reason === 'not-allowed' ? delivery.openOutsideWorkspace : undefined,
          );
        });
      },
      // Leaves the session for the page that owns the task. The id travels out
      // of band because the nav selection is persisted (see the store).
      onOpenScheduledTask: (taskId: string) => {
        requestScheduledTaskFocus(taskId);
        uiStore.navigate({ section: 'automations', module: 'scheduled-tasks' });
      },
    }),
    [sessionId],
  );

  const onFooterAction = useCallback(
    (turnId: string, id: TurnFooterActionId) => {
      const turn = turns.find((row) => row.turnId === turnId);
      if (!turn) return;
      if (id === 'copy') {
        return navigator.clipboard.writeText(finalAssistantReplyText(turn));
      }
      if (id === 'info') return;
      if (id === 'regenerate') {
        void turnActionsStore
          .regenerate(sessionId, turnId)
          .catch((error) => reportError(actions.operationFailedTitle, error));
        return;
      }
      void turnActionsStore
        .branch(sessionId, { sourceTurnId: turnId, copyId: crypto.randomUUID() })
        .catch((error) => reportError(actions.operationFailedTitle, error));
    },
    [actions, reportError, sessionId, turns],
  );

  const onOpenLineage = useCallback((turnId: string) => {
    const element = document.querySelector(`[data-turn-id="${CSS.escape(turnId)}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const beginEdit = useCallback(
    (turnId: string) => {
      const message = feed.messages.find(
        (row): row is Extract<StoredMessage, { type: 'user' }> =>
          row.type === 'user' && row.turnId === turnId,
      );
      if (!message) return;
      revisionDraftStore.begin({ sessionId, turnId, text: userFacingText(message) });
    },
    [feed.messages, sessionId],
  );

  const submitEdit = useCallback(() => {
    void revisionActions
      .submit()
      .catch((error) => reportError(actions.revisionUnavailableTitle, error));
  }, [actions, reportError]);
  const cancelEdit = useCallback(() => {
    void revisionActions
      .cancel()
      .catch((error) => reportError(actions.revisionUnavailableTitle, error));
  }, [actions, reportError]);

  const switchToFullAccessAndRetry = useCallback(
    (turnId: string) => (toolUseId: string) => {
      setSwitchingToolUseId(toolUseId);
      void turnActionsStore
        .setPermission(sessionId, 'bypass')
        .then(() => turnActionsStore.regenerate(sessionId, turnId))
        .catch((error) => reportError(copy.sandbox.failedTitle, error))
        .finally(() => setSwitchingToolUseId(undefined));
    },
    [copy, reportError, sessionId],
  );

  // #646: Stop must be available for the WHOLE turn — the moment the user
  // most wants to interrupt is a long wait with nothing on screen. The live
  // stream is folded in defensively for the rare replay where the projection
  // was over-cleared.
  const running = shellLive.turnActive || shellLive.activeStreamingLive;
  // No committed turn to own the status line yet — the send is still on its
  // way to the Host, or the turn it opened has not reached the transcript.
  // Mirrors upstream's bare running phrase (no clock, since there is no
  // `startedAt` to measure from).
  const orphanRunningStatus =
    shellLive.showRunningStatus && !turns.some((turn) => turn.turnId === live.turnId);
  const activeTurn = turns.find((turn) => turn.turnId === live.turnId);
  // No second rule here: the store already declines to call a turn quiet while
  // something on screen explains the silence (a tool in flight, an open
  // question). See `evaluateHealth`.
  const streamUnsteady = feed.streamStale;
  // The live turn's clock and working mark. They ride on the turn's own status
  // row (`TranscriptTurn`); before a committed turn exists, a pending row with
  // the same parts stands where the turn will appear.
  const liveStartedAt =
    (live.turnId ? transientPlacement.before.get(live.turnId)?.[0]?.ts : undefined) ??
    activeTurn?.startedAt ??
    feed.transientMessages[0]?.ts;
  const liveMark = deriveWorkingMarkActivity(activeTurn);
  // Held by value, so the memoized live turn does not re-render for every
  // render of this view — only when the clock's start, the mark or the stream
  // health actually change.
  const liveStatus = useMemo<TurnStatusLive>(
    () => ({
      ...(live.turnId ? { turnId: live.turnId } : {}),
      ...(liveStartedAt !== undefined ? { startedAt: liveStartedAt } : {}),
      unsteady: streamUnsteady,
      mark: liveMark,
    }),
    [live.turnId, liveStartedAt, streamUnsteady, liveMark],
  );
  const shellCopy = getShellCopy(locale).app;
  const historyPending =
    feed.historyPending?.sessionId === sessionId ? feed.historyPending : undefined;

  return (
    <div
      className="chat-area relative flex min-h-0 flex-1 flex-col"
      data-maka-contract="transcript"
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="absolute inset-0 overflow-y-auto"
          data-maka-transcript-boundary=""
          role="log"
          aria-live="polite"
          aria-label={copy.feed.ariaLabel}
          aria-busy={!feed.observationReady || undefined}
        >
          <div
            ref={feedRef}
            className="chat-feed mx-auto w-full max-w-[var(--chat-feed-max)] px-4 pb-8 pt-4"
          >
            {!feed.observationReady &&
              turns.length === 0 &&
              feed.transientMessages.length === 0 && <ChatSkeleton />}
            {feed.observationReady && turns.length === 0 && feed.transientMessages.length === 0 && (
              <p className="py-16 text-center text-sm text-text-muted" role="status">
                {copy.feed.empty}
              </p>
            )}
            {[
              ...rows.flatMap((row): ReactNode[] => {
                if (row.kind === 'gap') {
                  return [
                    <TranscriptGapRow
                      key={`gap-${row.direction}`}
                      direction={row.direction}
                      pending={
                        historyPending?.target === (row.direction === 'older' ? 'earlier' : 'later')
                      }
                      onLoad={() =>
                        void loadHistory(row.direction === 'older' ? 'earlier' : 'later')
                      }
                    />,
                  ];
                }
                const turn = row.turn;
                const editingThisTurn =
                  draft?.sourceSessionId === sessionId && draft.sourceTurnId === turn.turnId;
                const message = feed.messages.find(
                  (item): item is Extract<StoredMessage, { type: 'user' }> =>
                    item.type === 'user' && item.turnId === turn.turnId,
                );
                const refusal = revisionRefusalFor(message);
                return [
                  ...(transientPlacement.before.get(turn.turnId) ?? []).map((message) => (
                    <TransientMessageRow key={`pending:${message.id}`} message={message} />
                  )),
                  <TranscriptTurn
                    key={`turn:${turn.turnId}`}
                    turn={turn}
                    live={live.turnId === turn.turnId}
                    footerActions={presentation.footerActionsByTurn[turn.turnId] ?? []}
                    footerAlwaysVisible={
                      turn.status !== 'running' &&
                      !feed.hasNewer &&
                      turn.turnId === turns.at(-1)?.turnId
                    }
                    {...(presentation.lineageBadgesByTurn[turn.turnId]
                      ? { lineageBadges: presentation.lineageBadgesByTurn[turn.turnId] }
                      : {})}
                    {...(presentation.failedReasonLabels[turn.turnId]
                      ? { failedReasonLabel: presentation.failedReasonLabels[turn.turnId] }
                      : {})}
                    {...(presentation.failedSeverities[turn.turnId]
                      ? { failedSeverity: presentation.failedSeverities[turn.turnId] }
                      : {})}
                    {...(presentation.failedExecutionStateLabels[turn.turnId]
                      ? {
                          failedExecutionStateLabel:
                            presentation.failedExecutionStateLabels[turn.turnId],
                        }
                      : {})}
                    highlighted={highlightedTurnId === turn.turnId}
                    toolContext={toolContext}
                    onFooterAction={onFooterAction}
                    onOpenLineage={onOpenLineage}
                    {...(message && !refusal && !draft ? { onEditUserMessage: beginEdit } : {})}
                    {...(messageVersions.has(turn.turnId)
                      ? {
                          versions: messageVersions.get(turn.turnId),
                          onSelectVersion: selectVersion,
                        }
                      : {})}
                    {...(refusal
                      ? {
                          editDisabledReason:
                            refusal === 'attachments'
                              ? actions.revisionAttachmentsUnsupported
                              : actions.revisionTransformedTextUnsupported,
                        }
                      : {})}
                    {...(editingThisTurn
                      ? {
                          editing: true,
                          editText: draft.text,
                          onEditTextChange: (text: string) => revisionDraftStore.setText(text),
                          onEditSubmit: submitEdit,
                          onEditCancel: cancelEdit,
                          editPending:
                            draft.phase === 'preparing' ||
                            draft.phase === 'sending' ||
                            draft.cleanupRequested,
                          editCancelDisabled:
                            draft.phase === 'sending' || draft.phase === 'uncertain',
                        }
                      : {})}
                    onSwitchToFullAccessAndRetry={switchToFullAccessAndRetry(turn.turnId)}
                    {...(switchingToolUseId ? { switchingToolUseId } : {})}
                    onOpenExternal={toolContext.onOpenExternal}
                    {...(feed.blockedOn && live.turnId === turn.turnId
                      ? { blocked: feed.blockedOn }
                      : {})}
                    {...(shellLive.showRunningStatus && turn.turnId === live.turnId
                      ? { liveStatus }
                      : {})}
                  />,
                  ...(proposalsByTurn.get(turn.turnId) ?? []).map((proposal) => (
                    <PlanProposalCard
                      key={`plan:${proposal.proposalId}`}
                      sessionId={sessionId}
                      proposal={proposal}
                      reviewable={proposal.proposalId === reviewable?.proposalId}
                    />
                  )),
                ];
              }),
              ...transientPlacement.tail.map((message) => (
                <TransientMessageRow key={`pending:${message.id}`} message={message} />
              )),
              ...(unanchoredReviewable
                ? [
                    <PlanProposalCard
                      key={`plan:${unanchoredReviewable.proposalId}`}
                      sessionId={sessionId}
                      proposal={unanchoredReviewable}
                      reviewable
                    />,
                  ]
                : []),
              ...(orphanRunningStatus
                ? [<TurnStatusBeforeTurn key={`running:${sessionId}`} live={liveStatus} />]
                : []),
            ]}
            {/* The end of content, as opposed to the end of the scroll height
                the pinned question's floor extends. */}
            <div ref={endRef} data-maka-transcript-end="" />
          </div>
        </div>
        {(contentBelow || feed.hasNewer) && (
          <JumpToLatest
            streaming={running}
            activity={deriveWorkingMarkActivity(activeTurn)}
            onJump={() => {
              jumpToLatest();
              void loadHistory('latest');
            }}
          />
        )}
        <SelectionQuote sessionId={sessionId} scrollRef={scrollRef} enabled={!draft} />
      </div>

      {/* pb-2, not pb-4: the reference anchors the meta row 8px above the
          viewport and the composer's white face 38px above it. */}
      <div className={cn('shrink-0 px-4 pb-2')}>
        <div className="mx-auto flex w-full max-w-[var(--chat-feed-max)] flex-col gap-2">
          <GoalBanner sessionId={sessionId} onError={reportError} />
          <PlanExecutionBanner sessionId={sessionId} />
          <SessionNotices
            sessionId={sessionId}
            {...(presentation.resumeCandidateTurnId
              ? { resumeCandidateTurnId: presentation.resumeCandidateTurnId }
              : {})}
            onOpenModelPicker={() => props.onOpenSettings?.('models')}
            onOpenSettings={(section) => props.onOpenSettings?.(section)}
          />
          <RevisionBanner onCancel={cancelEdit} onSubmit={submitEdit} sessionId={sessionId} />
          <MessageQueue sessionId={sessionId} onError={reportError} />
          <InteractionPrompts sessionId={sessionId} onError={reportError} />
          {feed.boundaryUnreadable && !feed.interactionPending && (
            <NoticeCard
              tone="warning"
              role="status"
              title={shellCopy.boundaryUnreadableTitle}
              description={shellCopy.boundaryUnreadableDetail}
              actions={[
                {
                  label: feed.boundaryReading
                    ? shellCopy.boundaryUnreadableRetrying
                    : shellCopy.boundaryUnreadableRetry,
                  disabled: feed.boundaryReading,
                  onClick: () => activeSessionStore.reloadExecutionBoundary(),
                },
              ]}
            />
          )}
          {/* The composer stays under an open interaction (relx): Stop lives
              here, and while a question is open a plain send answers it. */}
          {!(
            draft &&
            (draft.sourceSessionId === sessionId || draft.revisionSessionId === sessionId)
          ) &&
            !feed.boundaryUnreadable &&
            (props.composerSlot ?? (
              <ChatInput sessionId={sessionId} running={running} onError={reportError} />
            ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The footer actions currently in flight, as the exact key set the
 * presentation derivation expects.
 *
 * The turn-actions store locks per Session and per KIND, not per turn — the
 * Host takes one regenerate at a time for a Session — so a running regenerate
 * marks every turn's regenerate busy. Spelling that out for each turn is what
 * makes the disabled state honest instead of leaving three other rows
 * clickable into a rejection.
 *
 * Memoized so the derivation's identity comparison keeps working: a fresh Set
 * per render would invalidate the whole per-turn cache on every token.
 */
function usePendingTurnActions(
  sessionId: string,
  pending: readonly string[],
  turnIds: readonly string[],
): ReadonlySet<string> {
  const regenerating = pending.includes('regenerate');
  const branching = pending.includes('copy');
  const key = turnIds.join(' ');
  return useMemo(() => {
    const keys = new Set<string>();
    if (!regenerating && !branching) return keys;
    for (const turnId of key === '' ? [] : key.split(' ')) {
      if (regenerating) keys.add(pendingTurnActionKey(sessionId, turnId, 'regenerate'));
      if (branching) keys.add(pendingTurnActionKey(sessionId, turnId, 'branch'));
    }
    return keys;
  }, [branching, key, regenerating, sessionId]);
}

function TransientMessageRow({ message }: { message: TransientUserMessageProjection }) {
  return (
    <div key={message.id} data-transient-message-id={message.id} data-message-status="pending">
      <UserMessageRow
        messageId={message.id}
        text={message.text}
        ts={message.ts}
        attachments={message.attachments}
        quotes={message.quotes}
        directoryReferences={message.directoryReferences}
        inlineReferences={message.inlineReferences}
      />
      {message.deliveryStatus && (
        <div
          className="mt-1 flex flex-wrap items-center justify-end gap-2 text-xs text-text-muted"
          role="status"
          data-message-delivery-status=""
        >
          <span>{message.deliveryStatus}</span>
          {message.deliveryDetail && <span>{message.deliveryDetail}</span>}
          {message.deliveryActions?.map((action) => (
            <button
              key={action.label}
              type="button"
              className="cursor-pointer rounded px-2 py-1 text-accent hover:bg-alpha-1"
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
