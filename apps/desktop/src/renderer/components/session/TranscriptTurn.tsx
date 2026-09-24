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

// One turn, in the order it happened.
//
// The turn's `timeline` is the rendering authority, not the aggregate
// `assistant` / `assistantThinking` fields: a turn is thinking, then a tool,
// then more thinking, then an answer, and flattening that into "reasoning,
// tools, answer" reorders work the reader watched happen.
//
// `groupTurnTimeline` turns the timeline into the reference's TurnStatus
// layout: prose addressed to the reader, and between it one status row per run
// of work, whose card holds the calls, the reasoning and the narration folded
// out of the answer. It runs HERE, at render time, rather than in the
// projection, so every pass that rewrites a timeline (the live overlay, tool
// projection, shell-run folding) stays flat and never has to maintain a
// nesting invariant.
//
// `data-turn-id` is load-bearing beyond styling: the scroll authority finds
// turns by it, and `resolveQuoteTarget` walks up to it to decide which turn a
// selection belongs to.

import { memo, useMemo } from 'react';
import { DeliveryAutoOpen } from './tools/renderers/DeliveryResults.js';
import { durableResultOf } from '../../lib/tool-delivery-results.js';
import { finalAssistantReplyText, useUiLocale, type TurnViewModel } from '@maka/ui';
import type { AttachmentRef } from '@maka/core/events';
import Markdown from '../ui/Markdown.js';
import StreamPopMarkdown from '../ui/StreamPopMarkdown.js';
import { Anthropicon } from '../icons/Anthropicon.js';
import { cn } from '../../lib/cn.js';
import { groupTurnTimeline } from '../../lib/turn-timeline-groups.js';
import type { FailedTurnSeverity } from '../../lib/ported/session-status-presentation.js';
import type { TurnFooterAction, TurnFooterActionId } from '../../lib/ported/turn-footer-actions.js';
import type { TurnLineageBadge } from '@maka/ui';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';
import { TurnFooter } from './TurnFooter.js';
import { UserMessageRow } from './UserMessageRow.js';
import { SystemNoticeRow } from './SystemNoticeRow.js';
import {
  TurnStatus,
  TurnStatusPending,
  type TurnStatusBlocked,
  type TurnStatusLive,
} from './tools/TurnStatus.js';
import { renderToolContent } from './tools/registry.js';
import { useStore } from 'zustand';
import { AskUserQuestionRecord } from './AskUserQuestionRecord.js';
import { isAskUserQuestionTool, knownUserQuestionCalls } from '../../lib/ask-user-question.js';
import type { ToolContentContext } from './tools/registry.js';

/** A system note inside a turn — compaction, a resume, a step cap. */
function SystemNote(props: { text: string }) {
  return (
    <div className="my-4 flex items-center justify-center" role="status">
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-alpha-1 px-3.5 py-1.5 text-[0.8125rem] leading-[1.125rem] text-text-muted">
        <Anthropicon name="archive" size={16} className="shrink-0" />
        <span className="min-w-0 truncate">{props.text}</span>
      </span>
    </div>
  );
}

export interface TranscriptTurnProps {
  turn: TurnViewModel;
  /** True while this turn is the one the live projection is writing into. */
  live: boolean;
  footerActions: readonly TurnFooterAction[];
  /** Keep the true tail's actions visible after generation finishes. */
  footerAlwaysVisible?: boolean;
  lineageBadges?: readonly TurnLineageBadge[];
  failedReasonLabel?: string;
  failedSeverity?: FailedTurnSeverity;
  failedExecutionStateLabel?: string;
  highlighted?: boolean;
  toolContext: ToolContentContext;
  onFooterAction: (turnId: string, id: TurnFooterActionId) => void | Promise<void>;
  onOpenLineage: (turnId: string) => void;
  onEditUserMessage?: (turnId: string) => void;
  editDisabledReason?: string;
  editing?: boolean;
  editText?: string;
  onEditTextChange?: (text: string) => void;
  onEditSubmit?: () => void;
  onEditCancel?: () => void;
  editPending?: boolean;
  editCancelDisabled?: boolean;
  onSwitchToFullAccessAndRetry?: (toolUseId: string) => void;
  switchingToolUseId?: string;
  onOpenExternal: (url: string) => void;
  /** What the live turn is parked on, drawn on its last run's status row. */
  blocked?: TurnStatusBlocked;
  /**
   * Present while this turn is running: its clock and working mark. They ride
   * on the turn's newest run, or on a pending row when there is no run to
   * carry them — the turn has no second status line under it.
   */
  liveStatus?: TurnStatusLive;
}

export const TranscriptTurn = memo(function TranscriptTurn(props: TranscriptTurnProps) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale);
  const turn = props.turn;
  // The ask-user calls are told apart by id (their live copy has no name),
  // so the grouping follows the known set as well as the timeline.
  const knownAsks = useStore(knownUserQuestionCalls, (state) => state.byToolUseId);
  const grouped = useMemo(
    () => groupTurnTimeline(turn.timeline, (tool) => isAskUserQuestionTool(tool, knownAsks)),
    [turn.timeline, knownAsks],
  );
  // A sent file opens in the right pane's Files face, the way a tool's output
  // does; the pane resolves the session file against its catalog.
  const onOpenFile = props.toolContext.onOpenFile;
  const openAttachment = onOpenFile
    ? (attachment: AttachmentRef) =>
        onOpenFile(attachment.ref.kind === 'session_file' ? attachment.ref.relativePath : undefined)
    : undefined;
  const hasAnswer = finalAssistantReplyText(turn).trim().length > 0;
  const lastStatusIndex = grouped.findLastIndex((entry) => entry.kind === 'status');
  // The turn's newest block. Files laid out at the foot come after it without
  // ending it: a run is still being worked in while the files it sent wait below.
  const tailIndex = grouped.findLastIndex((entry) => !(entry.kind === 'delivery' && entry.atFoot));
  const tail = grouped[tailIndex];
  const running = turn.status === 'running';
  // A text in a live turn carries `live: true` for its whole life; only
  // `complete` says whether it is still being written.
  const tailWriting = tail?.kind === 'text' && tail.live === true && tail.complete !== true;
  // The run the turn is working in. The line being written right after a run
  // stands under it WITHOUT ending it — the reference's `contentAfter` — so the
  // run keeps its mark and clock while the text streams, and the next call
  // joins the same run instead of opening a second one below the text. A
  // SendUserMessage is words for the reader, decided the moment it arrives, so
  // it does end the run.
  const narratingAfterRun =
    running &&
    props.live &&
    tail?.kind === 'text' &&
    tail.fromSendUserMessage !== true &&
    grouped[tailIndex - 1]?.kind === 'status';
  const liveRunIndex = !running
    ? -1
    : tail?.kind === 'status'
      ? tailIndex
      : narratingAfterRun
        ? tailIndex - 1
        : -1;
  // The turn always shows that it is working. When no run is live — the turn
  // has said nothing yet, a SendUserMessage just went out, the first line is
  // being written with no run before it, the user or a card spoke last — a
  // pending row stands at the end with the same mark and clock. The reference
  // covers the same gaps with the spark at the foot of the transcript.
  const pendingStatus =
    props.liveStatus && liveRunIndex < 0 ? (
      <TurnStatusPending
        key="pending-status"
        live={props.liveStatus}
        {...(tailWriting ? { writing: true } : {})}
      />
    ) : null;

  const drawEntry = (entry: (typeof grouped)[number], index: number) => {
    if (entry.kind === 'status') {
      return (
        <TurnStatus
          key={`status-${entry.id}`}
          group={entry}
          // A run is over once anything follows it — the answer's prose,
          // a steering message, the next run — not only when the turn
          // ends. Files at the foot do not count: they follow everything,
          // and neither does the line being written right under it.
          complete={!running || (index < tailIndex && index !== liveRunIndex)}
          {...(index === liveRunIndex && narratingAfterRun && tailWriting
            ? { narrating: true }
            : {})}
          {...(props.live && props.blocked && index === lastStatusIndex
            ? { blocked: props.blocked }
            : {})}
          {...(props.liveStatus && index === liveRunIndex ? { live: props.liveStatus } : {})}
          context={props.toolContext}
          {...(props.onSwitchToFullAccessAndRetry
            ? { onSwitchToFullAccessAndRetry: props.onSwitchToFullAccessAndRetry }
            : {})}
          {...(props.switchingToolUseId ? { switchingToolUseId: props.switchingToolUseId } : {})}
        />
      );
    }
    if (entry.kind === 'ask') {
      return <AskUserQuestionRecord key={`ask-${entry.id}`} item={entry.item} />;
    }
    if (entry.kind === 'delivery') {
      // A handover — delivered files at the foot of the turn, or a
      // scheduled task where it was made — stands in the turn as a card
      // at the answer's width. The renderer is the registry's, so the
      // shape of a `user_file_delivery` is decided in exactly one place.
      return (
        <div key={`delivery-${entry.id}`} data-maka-delivery={entry.id}>
          {/* Draws nothing: it is `display: 'render'` moving the pane
              onto the file, which only happens while the turn is live. */}
          <DeliveryAutoOpen
            result={durableResultOf(entry.item)}
            live={props.live}
            onOpenArtifact={props.toolContext.onOpenArtifact}
          />
          {renderToolContent(entry.item, props.toolContext)}
        </div>
      );
    }
    if (entry.kind === 'user') {
      if (entry.message.hostOrigin?.kind === 'background_task') {
        return (
          <div key={`inserted-${entry.messageId}`} className="-my-3">
            <SystemNoticeRow messageId={entry.message.id} text={entry.message.text} />
          </div>
        );
      }
      return (
        <div key={`inserted-${entry.messageId}`} className="-mt-5">
          <UserMessageRow
            messageId={entry.message.id}
            text={entry.message.text}
            {...(entry.message.ts !== undefined ? { ts: entry.message.ts } : {})}
            {...(entry.message.quotes ? { quotes: entry.message.quotes } : {})}
            attachments={entry.message.attachments}
            directoryReferences={entry.message.directoryReferences}
            inlineReferences={entry.message.inlineReferences}
            {...(openAttachment ? { onOpenAttachment: openAttachment } : {})}
          />
        </div>
      );
    }
    const Renderer = entry.live && !entry.complete ? StreamPopMarkdown : Markdown;
    return (
      <div
        key={`text-${entry.messageId}-${index}`}
        className="chat-assistant-response standard-markdown"
        data-maka-contract="markdown"
      >
        <Renderer
          noPadding
          onOpenExternal={props.onOpenExternal}
          {...(onOpenFile ? { onOpenFile: (path: string) => onOpenFile(path) } : {})}
        >
          {entry.text}
        </Renderer>
        {entry.truncated && (
          <p className="mt-1 text-xs leading-4 text-text-muted">{copy.thinking.truncated}</p>
        )}
      </div>
    );
  };

  return (
    <article
      data-turn-id={turn.turnId}
      data-maka-transcript-turn={turn.turnId}
      data-turn-status={turn.status}
      className={cn('group/turn flex flex-col', props.highlighted && 'highlight-message')}
    >
      {turn.user && turn.user.hostOrigin?.kind === 'background_task' && (
        <SystemNoticeRow messageId={turn.user.id} text={turn.user.text} />
      )}
      {turn.user && turn.user.hostOrigin?.kind !== 'background_task' && (
        <UserMessageRow
          messageId={turn.user.id}
          text={turn.user.text}
          {...(turn.user.ts !== undefined ? { ts: turn.user.ts } : {})}
          {...(turn.user.attachments ? { attachments: turn.user.attachments } : {})}
          {...(turn.user.quotes ? { quotes: turn.user.quotes } : {})}
          {...(turn.user.directoryReferences
            ? { directoryReferences: turn.user.directoryReferences }
            : {})}
          {...(turn.user.inlineReferences ? { inlineReferences: turn.user.inlineReferences } : {})}
          {...(openAttachment ? { onOpenAttachment: openAttachment } : {})}
          {...(props.onEditUserMessage
            ? { onEdit: () => props.onEditUserMessage?.(turn.turnId) }
            : {})}
          {...(props.editDisabledReason ? { editDisabledReason: props.editDisabledReason } : {})}
          {...(props.editing ? { editing: true } : {})}
          {...(props.editText !== undefined ? { editText: props.editText } : {})}
          {...(props.onEditTextChange ? { onEditTextChange: props.onEditTextChange } : {})}
          {...(props.onEditSubmit ? { onEditSubmit: props.onEditSubmit } : {})}
          {...(props.onEditCancel ? { onEditCancel: props.onEditCancel } : {})}
          editCancelDisabled={props.editCancelDisabled}
          {...(props.editPending ? { editPending: true } : {})}
        />
      )}

      {/* The reference's block column: every block 20px from the next, and a
          status row pulls itself 6px into that on each side. Nothing here
          carries its own vertical margin. The 10px on top puts the first
          block's words 44px under the user's bubble, as the reference does. */}
      <div className="flex flex-col gap-5 pt-2.5">
        {tailIndex < 0 && pendingStatus}
        {grouped.flatMap((entry, index) => {
          const drawn = drawEntry(entry, index);
          return index === tailIndex && pendingStatus ? [drawn, pendingStatus] : [drawn];
        })}
      </div>

      {turn.notes.map((note) => (
        <SystemNote key={note.id} text={note.text} />
      ))}

      {props.failedReasonLabel && (
        <div
          role="status"
          className={cn(
            'mt-3 flex flex-col gap-1 rounded-lg border-[0.5px] px-3 py-2',
            props.failedSeverity === 'warning'
              ? 'border-warning-line bg-warning-subtle'
              : 'border-danger-line bg-danger-subtle',
          )}
        >
          <span
            className={cn(
              'text-sm leading-5',
              props.failedSeverity === 'warning' ? 'text-warning' : 'text-danger',
            )}
          >
            {props.failedReasonLabel}
          </span>
          {props.failedExecutionStateLabel && (
            <span className="text-xs leading-4 text-text-muted">
              {props.failedExecutionStateLabel}
            </span>
          )}
        </div>
      )}

      {!props.live && (
        <TurnFooter
          actions={props.footerActions}
          alwaysVisible={props.footerAlwaysVisible}
          {...(props.lineageBadges ? { lineageBadges: props.lineageBadges } : {})}
          onAction={(id) => props.onFooterAction(turn.turnId, id)}
          onOpenLineage={props.onOpenLineage}
        />
      )}
    </article>
  );
});
