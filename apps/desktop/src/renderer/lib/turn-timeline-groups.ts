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

// The shape a turn is drawn in: the reference's TurnStatus layout.
//
// A turn is prose the reader reads, and between the prose, ONE status row per
// run of work — a line of muted text ("Ran 2 commands, read a file") that opens
// onto a flat card of steps. Reasoning, tool calls and the model's narration
// between them all live in that card; only words addressed to the reader stand
// outside it.
//
// Which words those are is decided per text block, the reference's way
// (`narration-fold.ts`): a text with more work after it is scored by the
// reference's classifier and folds into the run as NARRATION when it reads
// like the model talking to itself — short, "let me…", deep into a run of
// calls. A first reply, a long explanation, a question stays shown. A text
// right before a call that waits on the user is always shown (it is the
// context for the question), and so is the tail: the final answer, or the line
// being written right now.
//
// A text is decided the moment the next call or text lands, live or settled —
// the reference's way. Holding every decision until the turn settled drew a
// live turn as runs cut apart by its own narration, all merging into one at
// the end. Deciding early instead does not work either: the classifier judges
// a finished text, and an answer's first few hundred characters score like
// narration, so the answer would stream hidden. So the line being written
// stands under its run while the run stays live (`TranscriptTurn`), and at
// most that one line is tucked into the run when the next call arrives.
//
// SendUserMessage is not a step at all. The reference rewrites the call into a
// text block the moment it reads the message, drops the call and its result,
// and never folds that text — so here a delivered (or still-arriving) message
// is prose, and only a call that settled WITHOUT delivering stays a step, where
// its failure can be read.
//
// A run's id is the boundary before it (`'start'`, a prose block's messageId,
// an answered question, a card) so it keeps its identity while it grows and
// while the text after it folds into it.

import type { ToolActivityItem, TurnTimelineItem } from '@maka/ui';
import { isAskUserQuestionTool } from './ask-user-question.js';
import { NARRATION_SHOW_THRESHOLD, scoreNarration, type NarrationEvent } from './narration-fold.js';
import {
  durableResultOf,
  isScheduledTaskWriteItem,
  isSendUserMessageItem,
  readSendUserMessageText,
} from './tool-delivery-results.js';

/** One line in a run's card. */
export type TurnStatusStep =
  | { readonly kind: 'tool'; readonly key: string; readonly item: ToolActivityItem }
  | {
      readonly kind: 'thinking';
      readonly key: string;
      readonly text: string;
      readonly live: boolean;
      readonly truncated: boolean;
    }
  | {
      /** Text the model wrote between two steps, folded out of the answer. */
      readonly kind: 'narration';
      readonly key: string;
      readonly text: string;
      readonly live: boolean;
    };

/** A run of work, drawn as one status row. */
export interface TurnStatusGroup {
  readonly kind: 'status';
  /** Stable identity: `'start'` or the boundary before the run. */
  readonly id: string;
  readonly steps: readonly TurnStatusStep[];
}

/** Words addressed to the reader: the answer, or a SendUserMessage. */
export type TurnProseEntry = Extract<TurnTimelineItem, { kind: 'text' }> & {
  readonly fromSendUserMessage?: true;
};

/**
 * An answered AskUserQuestion, standing on its own between runs. While the
 * question is open it is a step of its run (the run shows "Asking a question")
 * and the question itself is drawn in the composer's place; once answered it is
 * the user's own words, and a run that folds must not take them with it.
 */
export interface TurnAskRecord {
  readonly kind: 'ask';
  readonly id: string;
  readonly item: ToolActivityItem;
}

/**
 * Something the turn handed over, drawn as a card of the turn: a delivered
 * file (at the foot of the turn, after all prose) or a scheduled task the turn
 * created (where it was made).
 */
export interface TurnDeliveryEntry {
  readonly kind: 'delivery';
  readonly id: string;
  readonly item: ToolActivityItem;
  /**
   * Laid out at the foot of the turn rather than where it was made. Such an
   * entry follows the turn's work without ending it: a run is still the turn's
   * newest block while the files it sent wait below.
   */
  readonly atFoot?: true;
}

export type TurnTimelineGroup =
  | Extract<TurnTimelineItem, { kind: 'user' }>
  | TurnProseEntry
  | TurnStatusGroup
  | TurnAskRecord
  | TurnDeliveryEntry;

/** A settled SendUserFile. */
function isFileDeliveryItem(item: ToolActivityItem): boolean {
  return durableResultOf(item)?.kind === 'user_file_delivery';
}

/**
 * The words a SendUserMessage call puts in front of the reader, or undefined
 * when the call is a step instead: one whose message has not started arriving
 * (nothing to show yet, and no step either — it would be an empty line), or
 * one that settled without delivering.
 */
function sendUserMessageProse(item: ToolActivityItem): string | undefined {
  return isSendUserMessageItem(item) ? readSendUserMessageText(item) : undefined;
}

type Block =
  | { readonly kind: 'user'; readonly entry: Extract<TurnTimelineItem, { kind: 'user' }> }
  | { readonly kind: 'thinking'; readonly entry: Extract<TurnTimelineItem, { kind: 'thinking' }> }
  | { readonly kind: 'text'; readonly entry: TurnProseEntry }
  | { readonly kind: 'tool'; readonly item: ToolActivityItem };

function flatten(items: readonly TurnTimelineItem[]): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    if (item.kind === 'user') blocks.push({ kind: 'user', entry: item });
    else if (item.kind === 'thinking') {
      if (item.text.trim()) blocks.push({ kind: 'thinking', entry: item });
    } else if (item.kind === 'text') {
      if (item.text.trim()) blocks.push({ kind: 'text', entry: item });
    } else {
      for (const tool of item.items) {
        if (!isSendUserMessageItem(tool)) {
          blocks.push({ kind: 'tool', item: tool });
          continue;
        }
        const text = sendUserMessageProse(tool);
        if (text !== undefined) {
          const live = tool.status === 'running';
          blocks.push({
            kind: 'text',
            entry: {
              kind: 'text',
              text,
              messageId: `send-user-message:${tool.toolUseId}`,
              ...(live ? { live: true } : { complete: true }),
              fromSendUserMessage: true,
            },
          });
        } else if (tool.status !== 'running') {
          // Settled without delivering: a step, so its failure is readable.
          blocks.push({ kind: 'tool', item: tool });
        }
      }
    }
  }
  return blocks;
}

/**
 * The text blocks that fold into their run, by block index.
 *
 * Scored per reply: a steering message from the user starts a new one, as a
 * user message does in the reference. A text whose next call waits on the user
 * (a question, a scheduled-task card) is never narration — it is the context
 * for what the user is about to be asked. The reasoning between the two is
 * looked past: the reference stops at it and can fold the explanation of an
 * open question into the run, which leaves the question without its reason.
 */
function narrationIndexes(
  blocks: readonly Block[],
  isAsk: (tool: ToolActivityItem) => boolean,
): Set<number> {
  const folded = new Set<number>();
  // For each block, the next block that is neither text nor reasoning — one
  // backward pass, so no text scans ahead on its own.
  const nextWork: (Block | undefined)[] = new Array(blocks.length);
  let ahead: Block | undefined;
  for (let index = blocks.length - 1; index >= 0; index--) {
    nextWork[index] = ahead;
    const block = blocks[index]!;
    if (block.kind !== 'text' && block.kind !== 'thinking') ahead = block;
  }
  let start = 0;
  const scoreReply = (end: number): void => {
    const events: NarrationEvent[] = [];
    const blockOf: number[] = [];
    for (let index = start; index < end; index++) {
      const block = blocks[index]!;
      if (block.kind === 'user') continue;
      blockOf.push(index);
      events.push(
        block.kind === 'text'
          ? { kind: 'text', text: block.entry.text }
          : block.kind === 'thinking'
            ? { kind: 'thinking' }
            : { kind: 'tool_use' },
      );
    }
    for (const [event, score] of scoreNarration(events).decided) {
      const index = blockOf[event]!;
      const block = blocks[index]!;
      if (block.kind !== 'text' || block.entry.fromSendUserMessage) continue;
      if (score >= NARRATION_SHOW_THRESHOLD) continue;
      const next = nextWork[index];
      if (next?.kind === 'tool' && (isAsk(next.item) || isScheduledTaskWriteItem(next.item))) {
        continue;
      }
      folded.add(index);
    }
  };
  blocks.forEach((block, index) => {
    if (block.kind !== 'user') return;
    scoreReply(index);
    start = index + 1;
  });
  scoreReply(blocks.length);
  return folded;
}

export function groupTurnTimeline(
  items: readonly TurnTimelineItem[],
  isAsk: (tool: ToolActivityItem) => boolean = (tool) => isAskUserQuestionTool(tool),
): TurnTimelineGroup[] {
  const blocks = flatten(items);
  const narration = narrationIndexes(blocks, isAsk);
  const out: TurnTimelineGroup[] = [];
  // Delivered files are laid out at the foot of the turn, after all prose, in
  // the order they were sent — the reference's card stack is the sibling after
  // the whole answer, however early the call was made. The call itself stays a
  // step of its run ("Shared a file").
  const files: TurnDeliveryEntry[] = [];
  let anchor = 'start';
  let run: TurnStatusStep[] | null = null;
  const flush = (): void => {
    if (run && run.length > 0) out.push({ kind: 'status', id: anchor, steps: run });
    run = null;
  };
  blocks.forEach((block, index) => {
    switch (block.kind) {
      case 'thinking':
        (run ??= []).push({
          kind: 'thinking',
          key: `thinking:${block.entry.messageId}:${index}`,
          text: block.entry.text,
          live: block.entry.live === true,
          truncated: block.entry.truncated === true,
        });
        return;
      case 'text':
        if (narration.has(index)) {
          (run ??= []).push({
            kind: 'narration',
            key: `narration:${block.entry.messageId}:${index}`,
            text: block.entry.text,
            live: block.entry.live === true,
          });
          return;
        }
        flush();
        out.push(block.entry);
        anchor = block.entry.messageId;
        return;
      case 'user':
        flush();
        out.push(block.entry);
        anchor = block.entry.messageId;
        return;
      case 'tool': {
        const tool = block.item;
        if (isAsk(tool) && tool.status !== 'running') {
          flush();
          out.push({ kind: 'ask', id: tool.toolUseId, item: tool });
          anchor = `ask:${tool.toolUseId}`;
          return;
        }
        if (isScheduledTaskWriteItem(tool)) {
          flush();
          out.push({ kind: 'delivery', id: tool.toolUseId, item: tool });
          anchor = `delivery:${tool.toolUseId}`;
          return;
        }
        if (isFileDeliveryItem(tool)) {
          files.push({ kind: 'delivery', id: tool.toolUseId, item: tool, atFoot: true });
        }
        (run ??= []).push({ kind: 'tool', key: tool.toolUseId, item: tool });
        return;
      }
    }
  });
  flush();
  out.push(...files);
  return out;
}

/** The tool calls of a run, in order. */
export function statusGroupTools(group: TurnStatusGroup): ToolActivityItem[] {
  return group.steps.flatMap((step) => (step.kind === 'tool' ? [step.item] : []));
}
