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
// `groupTurnTimeline` collapses each run of reasoning and tool calls between
// two answers into one work group. It runs HERE, at render time, rather than
// in the projection, so every pass that rewrites a timeline (the live overlay,
// tool projection, shell-run folding) stays flat and never has to maintain a
// nesting invariant.
//
// A run goes to ONE `ToolGroup`, children and all — the reasoning between
// two calls is a step on that group's timeline, not a heading of its own
// beside it, and a run that is only reasoning is a group too, so the turn does
// not change shape when its first call lands (`groupTurnTimeline`).
//
// `data-turn-id` is load-bearing beyond styling: the scroll authority finds
// turns by it, and `resolveQuoteTarget` walks up to it to decide which turn a
// selection belongs to.

import { memo, useMemo } from 'react';
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
import { ToolGroup } from './tools/ToolGroup.js';
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
}

export const TranscriptTurn = memo(function TranscriptTurn(props: TranscriptTurnProps) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale);
  const turn = props.turn;
  const grouped = useMemo(() => groupTurnTimeline(turn.timeline), [turn.timeline]);
  // A sent file opens in the right pane's Files face, the way a tool's output
  // does; the pane resolves the session file against its catalog.
  const onOpenFile = props.toolContext.onOpenFile;
  const openAttachment = onOpenFile
    ? (attachment: AttachmentRef) =>
        onOpenFile(attachment.ref.kind === 'session_file' ? attachment.ref.relativePath : undefined)
    : undefined;
  const hasAnswer = finalAssistantReplyText(turn).trim().length > 0;

  return (
    <article
      data-turn-id={turn.turnId}
      data-maka-transcript-turn={turn.turnId}
      data-turn-status={turn.status}
      className={cn('group/turn flex flex-col', props.highlighted && 'highlight-message')}
    >
      {turn.user && (
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
          {...(turn.user.hostOrigin ? { hostOrigin: true } : {})}
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

      <div className="flex flex-col">
        {grouped.map((entry, index) => {
          if (entry.kind === 'work') {
            return (
              <ToolGroup
                key={`work-${entry.id}`}
                entries={entry.children}
                // A run is over once anything follows it — the answer's prose,
                // a steering message, the next run — not only when the turn
                // ends. An earlier run in a live turn folds to its summary the
                // moment the next block starts; only the newest keeps its
                // window of steps (reference behaviour).
                complete={turn.status !== 'running' || index < grouped.length - 1}
                context={props.toolContext}
                {...(props.onSwitchToFullAccessAndRetry
                  ? {
                      onSwitchToFullAccessAndRetry: (item: (typeof turn.tools)[number]) =>
                        props.onSwitchToFullAccessAndRetry?.(item.toolUseId),
                    }
                  : {})}
                {...(props.switchingToolUseId
                  ? { switchingToolUseId: props.switchingToolUseId }
                  : {})}
              />
            );
          }
          if (entry.kind === 'user') {
            return (
              <UserMessageRow
                key={`inserted-${entry.messageId}`}
                messageId={entry.message.id}
                text={entry.message.text}
                {...(entry.message.ts !== undefined ? { ts: entry.message.ts } : {})}
                {...(entry.message.quotes ? { quotes: entry.message.quotes } : {})}
                attachments={entry.message.attachments}
                directoryReferences={entry.message.directoryReferences}
                inlineReferences={entry.message.inlineReferences}
                {...(openAttachment ? { onOpenAttachment: openAttachment } : {})}
              />
            );
          }
          const Renderer = entry.live && !entry.complete ? StreamPopMarkdown : Markdown;
          return (
            <div
              key={`text-${entry.messageId}-${index}`}
              className="chat-assistant-response standard-markdown"
              data-maka-contract="markdown"
            >
              <Renderer noPadding onOpenExternal={props.onOpenExternal}>
                {entry.text}
              </Renderer>
              {entry.truncated && (
                <p className="mt-1 text-xs leading-4 text-text-muted">{copy.thinking.truncated}</p>
              )}
            </div>
          );
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
          {...(props.lineageBadges ? { lineageBadges: props.lineageBadges } : {})}
          onAction={(id) => props.onFooterAction(turn.turnId, id)}
          onOpenLineage={props.onOpenLineage}
        />
      )}
    </article>
  );
});
