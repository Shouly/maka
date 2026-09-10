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
// `foldTimeline` collapses a thinking+tools run between two answers into one
// "Processing" block. It runs HERE, at render time, rather than in the
// projection, so every pass that rewrites a timeline (the live overlay, tool
// projection, shell-run folding) stays flat and never has to maintain a
// nesting invariant.
//
// `data-turn-id` is load-bearing beyond styling: the scroll authority finds
// turns by it, and `resolveQuoteTarget` walks up to it to decide which turn a
// selection belongs to.

import { memo, useMemo } from 'react';
import {
  finalAssistantReplyText,
  foldTimeline,
  useUiLocale,
  type FoldedTimelineEntry,
  type TurnViewModel,
} from '@maka/ui';
import Markdown from '../ui/Markdown.js';
import StreamPopMarkdown from '../ui/StreamPopMarkdown.js';
import { Anthropicon } from '../icons/Anthropicon.js';
import { cn } from '../../lib/cn.js';
import type { FailedTurnSeverity } from '../../lib/ported/session-status-presentation.js';
import type { TurnFooterAction, TurnFooterActionId } from '../../lib/ported/turn-footer-actions.js';
import type { TurnLineageBadge } from '@maka/ui';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { TurnFooter } from './TurnFooter.js';
import { UserMessageRow } from './UserMessageRow.js';
import { ToolGroup } from './tools/ToolGroup.js';
import type { ToolContentContext } from './tools/registry.js';

/** A system note inside a turn — compaction, a resume, a step cap. */
function SystemNote(props: { text: string }) {
  return (
    <div className="my-4 flex items-center justify-center" role="status">
      <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-alpha-1 px-3.5 py-1.5 text-[13px] leading-[18px] text-text-muted">
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
  /** Model · duration · cost, printed beside the actions. */
  turnMeta?: string;
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
  const folded = useMemo<FoldedTimelineEntry[]>(() => foldTimeline(turn.timeline), [turn.timeline]);
  const hasAnswer = finalAssistantReplyText(turn).trim().length > 0;
  // A concrete tool label outranks the generic phrase while a tool is in flight.

  const renderToolGroup = (items: readonly (typeof turn.tools)[number][], key: string) => (
    <ToolGroup
      key={key}
      items={items}
      complete={turn.status !== 'running'}
      context={props.toolContext}
      {...(props.onSwitchToFullAccessAndRetry
        ? {
            onSwitchToFullAccessAndRetry: (item: (typeof turn.tools)[number]) =>
              props.onSwitchToFullAccessAndRetry?.(item.toolUseId),
          }
        : {})}
      {...(props.switchingToolUseId ? { switchingToolUseId: props.switchingToolUseId } : {})}
    />
  );

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
        {folded.map((entry, index) => {
          if (entry.kind === 'processing') {
            return (
              <div key={`processing-${entry.id}`} className="flex flex-col">
                {entry.children.map((child, childIndex) =>
                  child.kind === 'thinking' ? (
                    <ThinkingBlock
                      key={`${entry.id}-thinking-${child.messageId}-${childIndex}`}
                      text={child.text}
                      {...(child.live ? { live: true } : {})}
                      {...(child.truncated ? { truncated: true } : {})}
                      onOpenExternal={props.onOpenExternal}
                    />
                  ) : (
                    renderToolGroup(child.items, `${entry.id}-tools-${childIndex}`)
                  ),
                )}
              </div>
            );
          }
          if (entry.kind === 'thinking') {
            return (
              <ThinkingBlock
                key={`thinking-${entry.messageId}-${index}`}
                text={entry.text}
                {...(entry.live ? { live: true } : {})}
                {...(entry.truncated ? { truncated: true } : {})}
                onOpenExternal={props.onOpenExternal}
              />
            );
          }
          if (entry.kind === 'tools') {
            return renderToolGroup(entry.items, `tools-${index}`);
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
          {...(props.turnMeta ? { meta: props.turnMeta } : {})}
          {...(props.lineageBadges ? { lineageBadges: props.lineageBadges } : {})}
          onAction={(id) => props.onFooterAction(turn.turnId, id)}
          onOpenLineage={props.onOpenLineage}
        />
      )}
    </article>
  );
});
