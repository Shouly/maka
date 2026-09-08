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
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { userFacingText, type StoredMessage } from '@maka/core/session';
import {
  SessionAttachmentProvider,
  TranscriptScrollAuthorityProvider,
  getConversationCopy,
  projectTranscriptRows,
  useChatScroll,
  useTranscriptScrollAuthority,
  useUiLocale,
  type TurnViewModel,
} from '@maka/ui';
import { openExternal } from '../../bridge/external-links.js';
import { readAttachmentBytes } from '../../bridge/attachments.js';
import {
  useActiveTurns,
  useLiveTurnSnapshot,
  useShellLiveTurn,
} from '../../hooks/use-workspace.js';
import { openWorkbarFile, openWorkbarTerminal } from '../../hooks/use-workbar.js';
import { useTurnPresentation, pendingTurnActionKey } from '../../hooks/use-turn-presentation.js';
import {
  activeSessionStore,
  revisionDraftStore,
  sessionsStore,
  turnActionsStore,
} from '../../store/index.js';
import { revisionRefusalFor } from '../../store/revision-draft.js';
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
import { cn } from '../../lib/cn.js';
import { composerInputStore } from '../../store/composer-input-store.js';
import { ChatInput } from '../composer/ChatInput.js';
import { InteractionPrompts } from '../composer/InteractionPrompts.js';
import { JumpToLatest, TranscriptGapRow } from './HistoryControls.js';
import { MessageQueue } from './MessageQueue.js';
import { SelectionQuote } from './SelectionQuote.js';
import { TranscriptTurn } from './TranscriptTurn.js';
import { NoticeCard } from './notices/NoticeCard.js';
import { RevisionBanner } from './notices/RevisionBanner.js';
import { SessionNotices } from './notices/SessionNotices.js';

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

function SessionTranscript(props: SessionViewProps) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale);
  const actions = getDesktopConversationCopy(locale).actions;
  const sessionId = props.sessionId;
  const scrollRef = useRef<HTMLDivElement>(null);
  const authority = useTranscriptScrollAuthority();
  const [awayFromTail, setAwayFromTail] = useState(false);
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
      observationReady: state.observationReady,
      hasOlder: state.range?.hasOlder === true,
      hasNewer: state.range?.hasNewer === true,
      historyPending: state.historyPending,
      // The composer yields to a turn-scoped prompt: an answer typed beside
      // it would race the one the prompt is waiting for.
      interactionPending: (state.interactions[sessionId]?.length ?? 0) > 0,
      // #1629: no boundary, no composer — but never silently. The notice
      // stands where the composer would be and hands the user another read.
      boundaryUnreadable: state.boundaryUnreadable,
      boundaryReading: state.boundaryReading,
    })),
  );

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

  // The pin state drives one affordance and nothing else, so it subscribes
  // rather than being lifted into a provider that would re-render the whole
  // transcript on every threshold crossing.
  useEffect(() => {
    const read = () => setAwayFromTail(authority.getSnapshot().awayFromTail);
    read();
    return authority.subscribe(read);
  }, [authority]);

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

  const turnIds = useMemo(() => turns.map((turn) => turn.turnId), [turns]);
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
    (target: 'earlier' | 'later' | 'latest', anchorTurnId?: string) =>
      activeSessionStore.loadHistory({
        target,
        ...(anchorTurnId ? { anchorTurnId } : {}),
      }),
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
    behavior: 'smooth',
    hasOlderHistory: feed.hasOlder,
    onLoadEarlierHistory: (anchorTurnId) => loadHistory('earlier', anchorTurnId),
    hasNewerHistory: feed.hasNewer,
    onLoadLaterHistory: (anchorTurnId) => loadHistory('later', anchorTurnId),
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
      onOpenTerminal: (ref: string) => openWorkbarTerminal(sessionId, ref),
    }),
    [sessionId],
  );

  const onFooterAction = useCallback(
    (turnId: string, id: TurnFooterActionId) => {
      const turn = turns.find((row) => row.turnId === turnId);
      if (!turn) return;
      if (id === 'copy') {
        const text = turn.assistant?.text ?? '';
        void navigator.clipboard.writeText(text).catch(() => undefined);
        return;
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
    const current = revisionDraftStore.getState().draft;
    if (!current || current.phase !== 'editing') return;
    const text = current.text.trim();
    if (!text) return;
    revisionDraftStore.markPreparing();
    void turnActionsStore
      .revise(current.sourceSessionId, {
        sourceTurnId: current.sourceTurnId,
        copyId: current.copyId,
      })
      .then(async (row) => {
        revisionDraftStore.markForked(row.id);
        composerInputStore.setText(row.id, text);
        const result = await turnActionsStore.send(row.id, {
          type: 'send',
          turnId: current.copyId,
          text,
        });
        if (!result.ok) throw new Error(result.reason);
        composerInputStore.setText(row.id, '');
        revisionDraftStore.complete();
      })
      .catch((error) => {
        revisionDraftStore.fail(
          error instanceof Error ? error.message : actions.operationFailedFallback,
        );
        reportError(actions.revisionUnavailableTitle, error);
      });
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
  const composerCopy = getConversationCopy(locale).composer;
  const waitCue = shellLive.showProcessingIndicator
    ? composerCopy.processing
    : shellLive.showContinuingIndicator
      ? composerCopy.continuing
      : undefined;
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
          <div className="chat-feed mx-auto w-full max-w-[var(--chat-feed-max)] px-4 pb-8 pt-4">
            {!feed.observationReady && turns.length === 0 && <ChatSkeleton />}
            {feed.observationReady && turns.length === 0 && (
              <p className="py-16 text-center text-sm text-text-muted" role="status">
                {copy.feed.empty}
              </p>
            )}
            {rows.map((row) => {
              if (row.kind === 'gap') {
                return (
                  <TranscriptGapRow
                    key={`gap-${row.direction}`}
                    direction={row.direction}
                    pending={
                      historyPending?.target === (row.direction === 'older' ? 'earlier' : 'later')
                    }
                    onLoad={() => void loadHistory(row.direction === 'older' ? 'earlier' : 'later')}
                  />
                );
              }
              const turn = row.turn;
              const editingThisTurn =
                draft?.sourceSessionId === sessionId && draft.sourceTurnId === turn.turnId;
              const message = feed.messages.find(
                (item): item is Extract<StoredMessage, { type: 'user' }> =>
                  item.type === 'user' && item.turnId === turn.turnId,
              );
              const refusal = revisionRefusalFor(message);
              return (
                <TranscriptTurn
                  key={turn.turnId}
                  turn={turn}
                  live={live.turnId === turn.turnId}
                  footerActions={presentation.footerActionsByTurn[turn.turnId] ?? []}
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
                        onEditCancel: () => revisionDraftStore.cancel(),
                        editPending: draft.phase !== 'editing',
                      }
                    : {})}
                  onSwitchToFullAccessAndRetry={switchToFullAccessAndRetry(turn.turnId)}
                  {...(switchingToolUseId ? { switchingToolUseId } : {})}
                  onOpenExternal={toolContext.onOpenExternal}
                />
              );
            })}
          </div>
        </div>
        {(awayFromTail || feed.hasNewer) && (
          <JumpToLatest
            streaming={running}
            onJump={() => {
              authority.pinToTail();
              void loadHistory('latest');
            }}
          />
        )}
        <SelectionQuote sessionId={sessionId} scrollRef={scrollRef} enabled={!draft} />
      </div>

      <div className={cn('shrink-0 px-4 pb-4')}>
        <div className="mx-auto flex w-full max-w-[var(--chat-feed-max)] flex-col gap-2">
          <SessionNotices
            sessionId={sessionId}
            {...(presentation.resumeCandidateTurnId
              ? { resumeCandidateTurnId: presentation.resumeCandidateTurnId }
              : {})}
            onOpenModelPicker={() => props.onOpenSettings?.('models')}
            onOpenSettings={(section) => props.onOpenSettings?.(section)}
          />
          <RevisionBanner
            sessionId={sessionId}
            onSelectSession={(id) => sessionsStore.select(id)}
          />
          <MessageQueue sessionId={sessionId} onError={reportError} />
          <InteractionPrompts sessionId={sessionId} />
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
          {!feed.interactionPending &&
            !feed.boundaryUnreadable &&
            (props.composerSlot ?? (
              <ChatInput
                sessionId={sessionId}
                running={running}
                {...(waitCue ? { waitCue } : {})}
                onError={reportError}
              />
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
