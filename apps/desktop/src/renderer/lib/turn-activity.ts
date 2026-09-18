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

// What the running turn is doing RIGHT NOW, read off the tail of its timeline
// — the sentence the status line under the transcript shows beside the mark.
//
// Ported from the reference design system's `useStreamingActivity` +
// `ChatStatusIndicator`: the newest block decides. Reasoning that is still
// streaming is "Thinking…", a call still in flight is that tool's own phrase,
// prose still streaming is "Writing…". Between blocks — the newest one has
// finished and the next has not started, which happens for a few hundred
// milliseconds after EVERY tool result — the activity is a `gap`, and the
// status line keeps showing whatever it showed last rather than flashing a
// generic phrase on every step. No timeline at all (the send is still on its
// way) is `none`, and reads as "Working on it…".

import { computerRunningLabel, type TurnViewModel } from '@maka/ui';
import type { UiLocale } from '@maka/core/ui-locale';
import { getTranscriptCopy } from '../locales/transcript-copy.js';
import {
  activeToolLabel,
  toolSummaryKeyOf,
} from '../components/session/tools/tool-presentation.js';
import type { WorkingMarkActivity } from './working-mark-sheets.js';

export type TurnActivity =
  | { readonly kind: 'none' }
  | { readonly kind: 'gap' }
  | { readonly kind: 'thinking' | 'tool' | 'text'; readonly label: string };

export function deriveTurnActivity(
  turn: TurnViewModel | undefined,
  locale: UiLocale,
): TurnActivity {
  if (!turn) return { kind: 'none' };
  const copy = getTranscriptCopy(locale);
  // A computer-use action in flight names its target ("Clicking Save…");
  // that outranks the generic phrase for the same call.
  const computer = computerRunningLabel(turn.tools, locale);
  if (computer) return { kind: 'tool', label: computer };
  const last = turn.timeline[turn.timeline.length - 1];
  if (!last) return { kind: 'none' };
  switch (last.kind) {
    case 'thinking':
      return last.live ? { kind: 'thinking', label: copy.thinking.active } : { kind: 'gap' };
    case 'tools':
      return last.items.some((item) => item.status === 'running')
        ? { kind: 'tool', label: activeToolLabel(last.items, locale) }
        : { kind: 'gap' };
    case 'text':
      return last.live && !last.complete
        ? { kind: 'text', label: copy.tools.writing }
        : { kind: 'gap' };
    default:
      return { kind: 'gap' };
  }
}

/** Retain the newest activity through inter-block gaps, including when the jump button mounts late. */
export function deriveWorkingMarkActivity(turn: TurnViewModel | undefined): WorkingMarkActivity {
  if (!turn) return 'default';
  if (turn.tools.some((tool) => tool.status === 'running' && tool.activityKind === 'computer')) {
    return 'default';
  }
  for (let index = turn.timeline.length - 1; index >= 0; index--) {
    const block = turn.timeline[index];
    if (block?.kind === 'thinking') return 'think';
    if (block?.kind === 'text') return 'write';
    if (block?.kind !== 'tools') continue;
    const tool =
      [...block.items].reverse().find((item) => item.status === 'running') ?? block.items.at(-1);
    if (!tool) continue;
    switch (toolSummaryKeyOf(tool)) {
      case 'read':
      case 'webfetch':
      case 'taskRead':
        return 'read';
      case 'search':
      case 'websearch':
      case 'explore':
      case 'toolSearch':
        return 'search';
      case 'edit':
      case 'command':
        return 'code';
      default:
        return 'default';
    }
  }
  return 'default';
}
