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

// The shape a turn's timeline is drawn in: prose and inserted user messages as
// they are, and every run of reasoning and tool calls between them as ONE work
// group.
//
// `@maka/ui`'s `foldTimeline` leaves a run with no tool call standing as bare
// thinking entries. Drawn that way, the commonest live path changes shape in
// front of the reader: the turn thinks (a block of its own), then the first
// call lands and the same text becomes a step inside a group. Grouping every
// run, tool calls or not, keeps one element with one identity from the first
// token to the last step. The reference design system does the same.
//
// A group's id is the messageId of the prose or user message before it (or
// `'start'`), which is what `foldTimeline` would have given the block once a
// call arrived — so nothing about the key changes as the run grows.

import type { FoldedTimelineChild, ToolActivityItem, TurnTimelineItem } from '@maka/ui';
import { isAskUserQuestionTool } from './ask-user-question.js';
import {
  durableResultOf,
  isNoteItem,
  isScheduledTaskWriteItem,
  readNoteMessage,
  userMessageFitsOneRow,
} from './tool-delivery-results.js';

/**
 * An answered AskUserQuestion, standing on its own between runs. While the
 * question is open it is drawn in the composer's place and nowhere here; once
 * answered it is the user's own words, and a run that folds must not take
 * them with it.
 */
export interface TurnAskRecord {
  readonly kind: 'ask';
  readonly id: string;
  readonly item: ToolActivityItem;
}

/**
 * A file delivery, or a note too big for a row, standing on its own after the
 * run that produced it.
 *
 * SendUserFile and SendUserMessage do not report on work; they ARE the thing
 * handed over, and a collapsed step list is where a handover goes to be lost.
 * So the result is drawn as a block of the turn, beside the prose, exactly as
 * a text entry is — and at that size it is indistinguishable from the turn's
 * own answer, which is the point: the person reads it as words addressed to
 * them, not as a tool's output.
 */
export interface TurnDeliveryEntry {
  readonly kind: 'delivery';
  readonly id: string;
  readonly item: ToolActivityItem;
}

export interface TurnWorkGroup {
  readonly kind: 'work';
  /** Stable identity: `'start'` or the preceding prose/user boundary's messageId. */
  readonly id: string;
  readonly children: readonly FoldedTimelineChild[];
  /**
   * How many notes this run carries, counted separately from the tool calls
   * because a note is not work — the header reads "Ran a command · 1 note".
   *
   * A note that was promoted to full width is counted here too, even though it
   * is drawn outside the group: it came out of THIS run, and the count is the
   * only mark left on it once it is rendered as plain prose.
   */
  readonly notes: number;
}

export type TurnTimelineGroup =
  | Exclude<TurnTimelineItem, { kind: 'thinking' | 'tools' }>
  | TurnWorkGroup
  | TurnAskRecord
  | TurnDeliveryEntry;

/**
 * Whether a settled call is a delivery, and whether its step survives.
 *
 * `'block'` — the result is the whole of it, and the step would only repeat
 * the cards below it (SendUserFile).
 * `'step+block'` — the step is worth keeping as one line of the work, and the
 * message stands below the group as well (SendUserMessage).
 */
/**
 * A settled SendUserFile. Asked twice — once to place the call, once to hold
 * it back — so it is named once.
 */
function isFileDeliveryItem(item: ToolActivityItem): boolean {
  return durableResultOf(item)?.kind === 'user_file_delivery';
}

export function deliveryPlacement(item: ToolActivityItem): 'block' | 'inline' | undefined {
  if (isFileDeliveryItem(item)) return 'block';
  // A scheduled task the turn created is something the person now owns, like a
  // delivered file — it stands in the turn rather than folding into the run
  // that made it, and the card is how they open it.
  if (isScheduledTaskWriteItem(item)) return 'block';
  if (!isNoteItem(item)) return undefined;
  // A note stays in the timeline when a row can hold it, and breaks out when
  // it cannot. Nothing is drawn twice either way: the inline note IS its row,
  // and the promoted note IS its block. Answered from the live message while
  // the call is still arriving, which the predicate's monotonicity makes safe.
  return userMessageFitsOneRow(readNoteMessage(item) ?? '') ? 'inline' : 'block';
}

export function groupTurnTimeline(
  items: readonly TurnTimelineItem[],
  isAsk: (tool: ToolActivityItem) => boolean = (tool) => isAskUserQuestionTool(tool),
): TurnTimelineGroup[] {
  const out: TurnTimelineGroup[] = [];
  // Delivered FILES are held back and laid out at the foot of the turn, in the
  // order they were sent.
  //
  // The tool tells the model to send each file as it is produced rather than
  // batching them, so the calls land mid-work — but the reader meets the turn
  // as a finished thing, and a stack of cards wedged between two paragraphs
  // reads as an interruption of the answer rather than as what the answer
  // hands over. The reference does the same: its card stack is the next
  // sibling AFTER the whole prose block, however early the call was made.
  //
  // Only files. A note (SendUserMessage) is addressed to the reader at the
  // moment it is said, and a scheduled-task card belongs where the task was
  // made; moving either would change what it means.
  const files: TurnDeliveryEntry[] = [];
  let anchor = 'start';
  let run: FoldedTimelineChild[] | null = null;
  // Notes belonging to the run being built — the inline ones drawn in it, plus
  // any promoted one that closes it. A promoted note is counted before `flush`
  // so the header it lands under is the run it came out of.
  let notes = 0;
  const flush = (): void => {
    if (run && run.length > 0) out.push({ kind: 'work', id: anchor, children: run, notes });
    run = null;
    notes = 0;
  };
  for (const item of items) {
    if (item.kind === 'thinking') {
      (run ??= []).push(item);
      continue;
    }
    if (item.kind === 'tools') {
      // The common case, untouched: an entry with no question and no delivery
      // in it (an empty one included) joins the run as it is.
      if (!item.items.some((tool) => isAsk(tool) || deliveryPlacement(tool) !== undefined)) {
        (run ??= []).push(item);
        continue;
      }
      let rest: ToolActivityItem[] = [];
      const flushRest = (): void => {
        if (rest.length > 0) (run ??= []).push({ ...item, items: rest });
        rest = [];
      };
      for (const tool of item.items) {
        if (!isAsk(tool)) {
          const placement = deliveryPlacement(tool);
          if (placement === undefined) {
            rest.push(tool);
            continue;
          }
          // A note a row can hold stays in the run, as its own step. It does
          // not close the group: it is one more line of the same activity.
          if (placement === 'inline') {
            notes += 1;
            rest.push(tool);
            continue;
          }
          // A file leaves the timeline here and comes back at the foot of the
          // turn. It does NOT close the run: the work it came out of carries
          // on, and breaking the group around a card that is no longer there
          // would split one run into two for no visible reason.
          if (isFileDeliveryItem(tool)) {
            files.push({ kind: 'delivery', id: tool.toolUseId, item: tool });
            continue;
          }
          // Everything else closes the run it came out of, so its block lands
          // AFTER that group rather than inside or before it. A promoted note
          // still counts toward that group's header on the way out.
          if (isNoteItem(tool)) notes += 1;
          flushRest();
          flush();
          out.push({ kind: 'delivery', id: tool.toolUseId, item: tool });
          anchor = `delivery:${tool.toolUseId}`;
          continue;
        }
        // Open: drawn in the composer's place. Answered: its own entry, and
        // the run after it keys off it, so neither side changes identity when
        // the answer lands.
        if (tool.status === 'running') continue;
        flushRest();
        flush();
        out.push({ kind: 'ask', id: tool.toolUseId, item: tool });
        anchor = `ask:${tool.toolUseId}`;
      }
      flushRest();
      continue;
    }
    flush();
    out.push(item);
    anchor = item.messageId;
  }
  flush();
  out.push(...files);
  return out;
}
