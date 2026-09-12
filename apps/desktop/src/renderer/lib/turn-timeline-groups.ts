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

export interface TurnWorkGroup {
  readonly kind: 'work';
  /** Stable identity: `'start'` or the preceding prose/user boundary's messageId. */
  readonly id: string;
  readonly children: readonly FoldedTimelineChild[];
}

export type TurnTimelineGroup =
  | Exclude<TurnTimelineItem, { kind: 'thinking' | 'tools' }>
  | TurnWorkGroup
  | TurnAskRecord;

export function groupTurnTimeline(
  items: readonly TurnTimelineItem[],
  isAsk: (tool: ToolActivityItem) => boolean = (tool) => isAskUserQuestionTool(tool),
): TurnTimelineGroup[] {
  const out: TurnTimelineGroup[] = [];
  let anchor = 'start';
  let run: FoldedTimelineChild[] | null = null;
  const flush = (): void => {
    if (run && run.length > 0) out.push({ kind: 'work', id: anchor, children: run });
    run = null;
  };
  for (const item of items) {
    if (item.kind === 'thinking') {
      (run ??= []).push(item);
      continue;
    }
    if (item.kind === 'tools') {
      // The common case, untouched: an entry with no question in it (an
      // empty one included) joins the run as it is.
      if (!item.items.some(isAsk)) {
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
          rest.push(tool);
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
  return out;
}
