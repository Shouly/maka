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

// One contiguous run of the turn's work, collapsed to a summary line.
//
// A run is TOOL CALLS AND REASONING together — `groupTurnTimeline` hands over
// the interleaved children of a work group, and both kinds become steps on one
// timeline. Reference behaviour, and the reason is that they are one piece of
// work: a turn thinks, calls something, thinks again, calls again. Rendered as
// siblings, that reads as four separate things with four headings, none of
// which can be put away; rendered as one group it is a single line the reader
// opens when they want the detail.
//
// The summary is the SAME sentence while the run is live and after it ends —
// "Ran 2 commands, read a file" — growing as calls land and settling when the
// turn does, so the moment a run finishes changes nothing on screen. It never
// says what is happening right now: the status line under the transcript does
// that, and a header that repeated it flickered through "working on it" on
// every gap between steps.
//
// Reasoning does not count towards the summary. It does count as a STEP, so
// the running window slides over it like anything else. A run with no call at
// all is still a group: while it runs it has no summary line at all (the step
// is the whole story, and the status line says "Thinking…"); once done its
// summary is "Thought process" — the one way back into that text.
//
// Ported from the reference design system's `TaskToolGroup`, including the
// rule that decides what "collapsed" means. It is not one state but two:
//
//   still running + collapsed = a sliding window onto the last few steps
//   finished     + collapsed = the summary line alone
//
// Both are the default, which is what makes the transition free: when the run
// ends the window's rows fall from three to zero on their own, and nothing has
// to reach in and re-collapse a group the reader opened.

import { memo, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useUiLocale, type FoldedTimelineChild, type ToolActivityItem } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { cn } from '../../../lib/cn.js';
import { getTranscriptCopy } from '../../../locales/transcript-copy.js';
import { ThinkingStep } from '../ThinkingStep.js';
import { ToolRow } from './ToolRow.js';
import type { ToolContentContext } from './registry.js';
import { summarizeToolGroup } from './tool-presentation.js';

/** How many steps a running group keeps visible while collapsed. */
export const COLLAPSED_VISIBLE_COUNT = 3;

export interface ToolGroupProps {
  /**
   * The run's children in the order they happened, as `groupTurnTimeline`
   * grouped them. Held as entries rather than a flat step list so the array's
   * identity is the grouping's, and a turn that has not changed does not
   * re-render its groups.
   */
  entries: readonly FoldedTimelineChild[];
  /** False while the group can still gain steps. */
  complete: boolean;
  context: ToolContentContext;
  onSwitchToFullAccessAndRetry?: (item: ToolActivityItem) => void;
  switchingToolUseId?: string;
}

/** One line on the group's timeline: a tool call, or a run of reasoning. */
type ToolGroupStep =
  | { kind: 'tool'; key: string; item: ToolActivityItem }
  | { kind: 'thinking'; key: string; text: string; live: boolean; truncated: boolean };

function toSteps(entries: readonly FoldedTimelineChild[]): ToolGroupStep[] {
  const steps: ToolGroupStep[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === 'thinking') {
      steps.push({
        kind: 'thinking',
        // The entry's own index joins the messageId: one reasoning message can
        // be split across the run by the tools between its parts.
        key: `thinking-${entry.messageId}-${index}`,
        text: entry.text,
        live: entry.live === true,
        truncated: entry.truncated === true,
      });
    } else {
      for (const item of entry.items) steps.push({ kind: 'tool', key: item.toolUseId, item });
    }
  });
  return steps;
}

/**
 * The summary sentence. While the run is live each new sentence fades in
 * (keyed remount) — no shimmer, the in-progress signal is the step below —
 * and the settled render is the same element, so finishing changes nothing.
 */
function SummaryText(props: { live: boolean; children: string }) {
  if (!props.live) return <span className="min-w-0 truncate">{props.children}</span>;
  return (
    <motion.span
      key={props.children}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="min-w-0 truncate"
    >
      {props.children}
    </motion.span>
  );
}

export const ToolGroup = memo(function ToolGroup(props: ToolGroupProps) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).tools;
  const [collapsed, setCollapsed] = useState(true);

  const steps = useMemo(() => toSteps(props.entries), [props.entries]);
  // The summary counts tool calls; reasoning is not something that was "run".
  const tools = useMemo(
    () => steps.flatMap((step) => (step.kind === 'tool' ? [step.item] : [])),
    [steps],
  );

  const thinkingOnly = tools.length === 0;
  const summary = useMemo(
    () => (thinkingOnly ? copy.thinkingOnly : summarizeToolGroup(tools, locale)),
    [thinkingOnly, tools, locale, copy],
  );
  // A live run of pure reasoning shows its step and nothing above it.
  const showHeader = !(thinkingOnly && !props.complete);

  if (steps.length === 0) return null;

  const windowed = !props.complete && collapsed;
  const visible = windowed
    ? steps.slice(Math.max(0, steps.length - COLLAPSED_VISIBLE_COUNT))
    : steps;
  const showSteps = !props.complete || !collapsed;
  // Something is folded above the first visible row, so the timeline has to
  // keep its top segment or it appears to start out of nowhere.
  const hasHiddenSteps = visible.length < steps.length;
  // While running with no more steps than the window holds, opening changes
  // nothing — do not offer a control that does nothing.
  const canToggle = props.complete || steps.length > COLLAPSED_VISIBLE_COUNT;

  return (
    // `pl-2` is the transcript's text column, not decoration: the answer above
    // it is `.standard-markdown`, which pads its paragraphs by the same 0.5rem
    // (globals.css). Without it the summary line starts 8px left of every
    // sentence around it, and the turn reads as two ragged columns. The
    // reference design system passes the same inset in at the call site.
    <div
      className="my-2 pl-2"
      data-maka-tool-group=""
      data-maka-tool-group-kind={thinkingOnly ? 'thinking' : 'tools'}
    >
      {showHeader && (
        <div
          className="group/summary flex min-w-0 items-center gap-2 py-1"
          data-maka-tool-group-summary=""
        >
          {canToggle ? (
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={collapsed ? copy.expand(summary) : copy.collapse(summary)}
              onClick={() => setCollapsed((open) => !open)}
              className="flex min-w-0 cursor-pointer select-none items-center gap-2 rounded-md text-sm leading-5 text-text-muted outline-none transition-colors hover:text-text-secondary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
            >
              <SummaryText live={!props.complete}>{summary}</SummaryText>
              <Anthropicon
                name="caretDown"
                size={12}
                className={cn(
                  'shrink-0 opacity-0 transition-all duration-200',
                  'group-hover/summary:opacity-100 group-focus-within/summary:opacity-100',
                  collapsed && '-rotate-90',
                )}
              />
            </button>
          ) : (
            <span className="flex min-w-0 items-center text-sm leading-5 text-text-muted">
              <SummaryText live={!props.complete}>{summary}</SummaryText>
            </span>
          )}
        </div>
      )}

      <div className="mt-1" aria-label={copy.stepsLabel}>
        <AnimatePresence initial={false}>
          {showSteps &&
            visible.map((step, index) => {
              const isFirst = !hasHiddenSteps && index === 0;
              const isLast = index === visible.length - 1;
              return (
                <motion.div
                  key={step.key}
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  {step.kind === 'thinking' ? (
                    <ThinkingStep
                      text={step.text}
                      live={step.live}
                      truncated={step.truncated}
                      isFirst={isFirst}
                      isLast={isLast}
                      onOpenExternal={props.context.onOpenExternal}
                    />
                  ) : (
                    <ToolRow
                      item={step.item}
                      isFirst={isFirst}
                      isLast={isLast}
                      context={props.context}
                      {...(props.onSwitchToFullAccessAndRetry
                        ? {
                            onSwitchToFullAccessAndRetry: () =>
                              props.onSwitchToFullAccessAndRetry?.(step.item),
                          }
                        : {})}
                      switching={props.switchingToolUseId === step.item.toolUseId}
                    />
                  )}
                </motion.div>
              );
            })}
        </AnimatePresence>
      </div>
    </div>
  );
});
