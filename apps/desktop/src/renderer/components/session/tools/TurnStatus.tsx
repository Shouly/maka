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

// One run of a turn's work, as the reference's TurnStatus: a single line of
// muted text that opens onto a card of steps.
//
// The line says three different things over the run's life:
//
//   waiting on the user   an amber ring and a pill — "Asking a question",
//                         "Needs your input"; the prompt itself is drawn in the
//                         composer's place
//   running               what is happening now — the running step's own words
//                         ("Run the unit tests", "Reading app.tsx"), or
//                         "Thinking…" while the model reasons; the working mark
//                         leads it and the turn's clock follows it
//   finished              what the run did — "Used 4 tools, ran 3 commands"
//
// The live row is the turn's ONE status: there is no second line under the
// transcript. Before the turn has a run at all — the send is on its way, or the
// model has not said anything yet — `TurnStatusPending` stands in its place
// with the same mark and clock.
//
// Closed by default, live or settled. The card is flat: every step is one row,
// separated by hairlines, no icons and no rail; reasoning and the narration
// folded out of the answer are rows of the same card, in the order they
// happened.

import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { formatTurnDuration, isTimeDrivenMotionEnabled, useUiLocale } from '@maka/ui';
import { WorkingMark } from '../../icons/WorkingMark.js';
import type { WorkingMarkActivity } from '../../../lib/working-mark-sheets.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { ShimmerTitle } from '../../ui/shimmer-title.js';
import { cn } from '../../../lib/cn.js';
import { getTranscriptCopy } from '../../../locales/transcript-copy.js';
import { getChildAgentsCopy } from '../../../locales/child-agents-copy.js';
import { statusGroupTools, type TurnStatusGroup } from '../../../lib/turn-timeline-groups.js';
import type { ToolContentContext } from './registry.js';
import { summarizeToolGroup, toolRowStatus, toolStepLabel } from './tool-presentation.js';
import { ThinkingText } from '../ThinkingStep.js';
import {
  TurnStatusNarrationStep,
  TurnStatusThinkingStep,
  TurnStatusToolStep,
} from './TurnStatusStep.js';

/** What a live run is waiting on the user for, when it is. */
export type TurnStatusBlocked = 'question' | 'input';

/** What the live row carries besides its words: the turn's clock and mark. */
export interface TurnStatusLive {
  /** The turn's own first-message timestamp: the clock measures the user's wait. */
  readonly startedAt?: number;
  readonly turnId?: string;
  /** The stream has gone quiet for longer than usual. */
  readonly unsteady?: boolean;
  readonly mark?: WorkingMarkActivity;
}

export interface TurnStatusProps {
  group: TurnStatusGroup;
  /** False while the run can still gain steps. */
  complete: boolean;
  /** Present on the run the turn is working in right now. */
  live?: TurnStatusLive;
  /** Set while the turn is parked on this run's call. */
  blocked?: TurnStatusBlocked;
  context: ToolContentContext;
  onSwitchToFullAccessAndRetry?: (toolUseId: string) => void;
  switchingToolUseId?: string;
}

/** What a row's mark shows: the working mark, or the waiting ring. */
type RowMarkKind = 'busy' | 'blocked';

/** How a leaving mark folds away: the reference's 400ms on its curve. */
const MARK_LEAVE_MS = 400;
const MARK_LEAVE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * The slot a row's mark sits in, as the reference's `data-cds-row-mark`: first
 * in the row, on the prose column, 20px wide with the words 12px after it.
 * (The reference can hang the mark in the gutter instead, `hangMark`, and
 * nothing asks it to.) A mark that leaves — its run finished — folds away in
 * place over `MARK_LEAVE_MS` and the words glide back onto the column with it,
 * then `onLeft` drops it.
 */
function RowMark(props: { children: ReactNode; leaving?: boolean; onLeft?: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { leaving, onLeft } = props;
  useLayoutEffect(() => {
    if (!leaving) return;
    const element = ref.current;
    if (
      !element ||
      typeof element.animate !== 'function' ||
      !isTimeDrivenMotionEnabled(element) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      onLeft?.();
      return;
    }
    const animation = element.animate(
      [
        { offset: 0, width: '20px', marginInlineEnd: '12px', opacity: 1, transform: 'scale(1)' },
        { offset: 0.6, opacity: 1 },
        { offset: 1, width: '0px', marginInlineEnd: '0px', opacity: 0, transform: 'scale(0)' },
      ],
      { duration: MARK_LEAVE_MS, easing: MARK_LEAVE_EASING, fill: 'forwards' },
    );
    animation.finished.then(
      () => onLeft?.(),
      () => undefined,
    );
    return () => animation.cancel();
  }, [leaving, onLeft]);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-maka-row-mark=""
      className="me-3 flex size-5 shrink-0 items-center justify-center"
    >
      {props.children}
    </span>
  );
}

/**
 * The amber ring of a run that waits on the user, measured off the reference:
 * a 14px ring with a 1px stroke around a 9px dot, in the pill's amber
 * (`--waiting-mark`), centred in the mark's 20px slot.
 */
function BlockedRing() {
  return (
    <span className="flex size-[14px] items-center justify-center rounded-full border-[1px] border-waiting-mark">
      <span className="size-[9px] rounded-full bg-waiting-mark" />
    </span>
  );
}

const ELAPSED_TICK_MS = 1_000;
/** Below this the clock stays hidden: a quick reply is not a wait. */
const ELAPSED_SHOW_AFTER_MS = 5_000;

/**
 * The turn's clock, after the live row's words: " · 12s". It appears after 5s,
 * so a turn that answers in two never shows a counter that would only have
 * said "2s". Local state, so ticking it never repaints the transcript.
 */
/**
 * The earliest start seen per turn. The clock moves between components as the
 * turn goes on — the pending row, one run, the next — and each is a new
 * instance; latched per instance, every move restarted it from 0s.
 */
const EARLIEST_START_BY_TURN = new Map<string, number>();

/** Exported for its test: the rows that take over from each other share one clock. */
export function latchedStart(
  turnId: string | undefined,
  startedAt: number | undefined,
): number | undefined {
  if (turnId === undefined) return startedAt;
  const seen = EARLIEST_START_BY_TURN.get(turnId);
  if (startedAt !== undefined && (seen === undefined || startedAt < seen)) {
    // Only the newest turns are ever live; the map need not outgrow a few.
    if (EARLIEST_START_BY_TURN.size > 32) EARLIEST_START_BY_TURN.clear();
    EARLIEST_START_BY_TURN.set(turnId, startedAt);
    return startedAt;
  }
  return seen ?? startedAt;
}

export function TurnElapsedTime(props: {
  startedAt?: number;
  turnId?: string;
  /** Without the " · " that joins it to words before it: a clock in a column of its own. */
  bare?: boolean;
}) {
  // Latched to the earliest start seen for the turn. A live Turn whose durable
  // rows have not landed yet is synthesised by the projection with
  // `startedAt: Date.now()` on every delta; taking each value as it comes
  // would reset the clock to 0s on every token.
  const startedAt = latchedStart(props.turnId, props.startedAt);
  const rootRef = useRef<HTMLSpanElement>(null);
  // Undefined until an effect measures it, so the first paint carries the
  // words alone and a static render stays deterministic.
  const [elapsedMs, setElapsedMs] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    // Frozen (fixture / reduced motion) the clock is dropped rather than
    // pinned: any value it could show is a real wall-clock difference.
    if (startedAt === undefined || !isTimeDrivenMotionEnabled(rootRef.current)) return;
    setElapsedMs(Math.max(0, Date.now() - startedAt));
    const tick = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    }, ELAPSED_TICK_MS);
    return () => window.clearInterval(tick);
  }, [startedAt]);
  return (
    <span
      ref={rootRef}
      aria-hidden="true"
      className="shrink-0 tabular-nums"
      data-maka-contract="turn-elapsed"
    >
      {elapsedMs !== undefined && elapsedMs >= ELAPSED_SHOW_AFTER_MS && (
        <>
          {!props.bare && <span className="mx-1 select-none">·</span>}
          {formatTurnDuration(elapsedMs)}
        </>
      )}
    </span>
  );
}

/** The working mark, in the slot the waiting ring takes. */
function BusyMark(props: { activity?: WorkingMarkActivity }) {
  return (
    <RowMark>
      <WorkingMark size={20} {...(props.activity ? { activity: props.activity } : {})} />
    </RowMark>
  );
}

/**
 * The live row's words while they change, then the clock after them. The words
 * may fade in after the mark (`wordsStyle`); they hold their place meanwhile,
 * so nothing moves when they show.
 */
function BusyText(props: { label: string; live?: TurnStatusLive; wordsStyle?: CSSProperties }) {
  return (
    <span className="flex min-w-0 items-center">
      {props.live && <BusyMark {...(props.live.mark ? { activity: props.live.mark } : {})} />}
      <span className="flex min-w-0 items-center" style={props.wordsStyle} data-maka-turn-words="">
        <ShimmerTitle
          title={props.label}
          isLoading
          className="min-w-0 truncate text-sm leading-5 [--base-color:var(--text-muted)]"
        />
        {props.live && (
          <TurnElapsedTime
            {...(props.live.startedAt !== undefined ? { startedAt: props.live.startedAt } : {})}
            {...(props.live.turnId !== undefined ? { turnId: props.live.turnId } : {})}
          />
        )}
      </span>
    </span>
  );
}

/** How long after the send the waiting row shows its mark alone. */
const WAITING_WORDS_DELAY_MS = 200;
const WAITING_WORDS_FADE_MS = 150;

/**
 * The waiting row's words fade in `WAITING_WORDS_DELAY_MS` after the send, so a
 * reply that starts at once never flashes them. Counted from the send, not from
 * this row: the row is drawn again when its turn reaches the transcript, and
 * words already showing must not fade out and back.
 */
function waitingWordsStyle(startedAt: number | undefined): CSSProperties | undefined {
  const remaining =
    startedAt === undefined
      ? WAITING_WORDS_DELAY_MS
      : WAITING_WORDS_DELAY_MS - (Date.now() - startedAt);
  if (remaining <= 0) return undefined;
  return { animation: `fadeIn ${WAITING_WORDS_FADE_MS}ms ease-out ${remaining}ms both` };
}

/**
 * The live turn's status when no run carries it: the send is on its way, the
 * model has not said anything yet, a message just went out, a first line is
 * being written, or a question was just answered. The same mark, words and
 * clock the live row has; the mark shows at once and the words follow it.
 *
 * Deviation: the reference shows the mark alone until the model starts
 * streaming (measured 2026-09-26). We keep the words, shown
 * `WAITING_WORDS_DELAY_MS` after the send (owner's choice).
 */
export function TurnStatusPending(props: { live: TurnStatusLive; writing?: boolean }) {
  const copy = getTranscriptCopy(useUiLocale()).tools;
  // Fixed when the row is drawn: a style that changed on a later render would
  // restart the fade.
  const [wordsStyle] = useState(() => waitingWordsStyle(props.live.startedAt));
  const label = props.live.unsteady
    ? copy.streamUnsteady
    : props.writing
      ? copy.writing
      : copy.working;
  return (
    <div
      className="-my-1.5 flex min-w-0"
      role="status"
      aria-label={label}
      data-maka-turn-pending=""
      {...(props.live.unsteady ? { 'data-maka-stream': 'unsteady' } : {})}
    >
      <span className="flex min-w-0 items-center px-2 py-1.5 text-sm leading-5 text-text-muted">
        <BusyText label={label} live={props.live} {...(wordsStyle ? { wordsStyle } : {})} />
      </span>
    </div>
  );
}

export const TurnStatus = memo(function TurnStatus(props: TurnStatusProps) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).tools;
  const [open, setOpen] = useState(false);
  const steps = props.group.steps;
  const tools = useMemo(() => statusGroupTools(props.group), [props.group]);
  const textOnly = tools.length === 0;

  // The live row reads the run's LAST call, in whatever tense it is in now —
  // "Checking the current time" while it runs, "Checked the current time" once
  // it has, and still that while the model reasons or writes under the run
  // (the reference keeps the step's words up until the next step). Live
  // reasoning with no call after it is the one moment that says "Thinking…".
  // The row waits on the user once the Host's request reaches the composer,
  // with the prompt on screen. While a question's arguments still arrive it
  // is an ordinary live row, "Asking a question" under the working mark.
  // Deviation (owner's call, 2026-09-27): the reference wears the waiting
  // pill from the call's first frame, and here that pill stood over a
  // composer with nothing to answer until the arguments were complete.
  const blocked = props.blocked;
  // A run can be over and its agents not: an Agent or SendMessage call returns
  // once its child is running, and the child works on after the turn has
  // answered. The run's words shimmer until the last of them is done, named by
  // the one still working. No working mark: that is the model's, and it has
  // moved on — the row only changes its ink, so nothing shifts when it ends.
  const workingAgents =
    props.complete && !blocked
      ? tools.filter(
          (tool) => tool.result?.kind === 'subagent' && toolRowStatus(tool) === 'running',
        )
      : [];

  let label: string;
  if (blocked) {
    label = copy.blocked[blocked];
  } else if (workingAgents.length > 0) {
    label =
      workingAgents.length === 1
        ? toolStepLabel(workingAgents[0]!, locale).text
        : getChildAgentsCopy(locale).status(workingAgents.length);
  } else if (!props.complete) {
    const last = steps.at(-1);
    const lastTool = tools.at(-1);
    label = props.live?.unsteady
      ? copy.streamUnsteady
      : last?.kind === 'thinking' && last.live
        ? copy.thinkingActive
        : lastTool
          ? toolStepLabel(lastTool, locale).text
          : copy.thinkingOnly;
  } else {
    // A run with no call is "Thought process". Deviation: the reference names
    // one block of reasoning by a summary it generates; the model gives none,
    // and its own first line reads as half a sentence, not a title. A run of
    // one call is named by that call, as the design does — an agent by its
    // description, a new file by its name — whatever reasoning sits beside it;
    // only two or more are summarised.
    label =
      tools.length === 1
        ? toolStepLabel(tools[0]!, locale).text
        : tools.length > 0
          ? summarizeToolGroup(tools, locale)
          : copy.thinkingOnly;
  }

  const state = blocked
    ? 'blocked'
    : props.complete && workingAgents.length === 0
      ? 'done'
      : 'busy';
  // The mark the row shows, and the one still leaving after the row stops
  // showing it: the run finished, or the turn moved on to its next run.
  const mark: RowMarkKind | undefined = blocked
    ? 'blocked'
    : state === 'busy' && props.live
      ? 'busy'
      : undefined;
  const [shownMark, setShownMark] = useState(mark);
  const [leavingMark, setLeavingMark] = useState<RowMarkKind>();
  if (shownMark !== mark) {
    setShownMark(mark);
    setLeavingMark(mark === undefined ? shownMark : undefined);
  }
  const markLeft = useCallback(() => setLeavingMark(undefined), []);
  const leaving = leavingMark && (
    <RowMark leaving onLeft={markLeft}>
      {leavingMark === 'blocked' ? <BlockedRing /> : <WorkingMark size={20} />}
    </RowMark>
  );
  const text = blocked ? (
    <span className="flex min-w-0 items-center">
      <RowMark>
        <BlockedRing />
      </RowMark>
      {/* The reference's pill: 12px medium on a 15px line, 8px sides, 22px
          tall, amber at 35% behind the warning ink. */}
      <span className="min-w-0 truncate rounded-[5.5px] bg-warning-fill/35 px-2 py-[3.5px] text-xs font-medium leading-[15px] text-warning">
        {label}
      </span>
    </span>
  ) : (
    <span className="flex min-w-0 items-center">
      {leaving}
      {state === 'busy' ? (
        <BusyText label={label} {...(props.live ? { live: props.live } : {})} />
      ) : (
        <span className="min-w-0 truncate">{label}</span>
      )}
    </span>
  );

  return (
    // The row's text sits on the prose column: `.standard-markdown` pads its
    // paragraphs by 0.5rem, and so does the row's `px-2`. The column keeps
    // blocks 20px apart and the row pulls 6px into that on each side — its
    // own vertical padding — so its WORDS stand 20px from the prose around
    // them, and the opened card ends 6px under it for the same reason.
    <div
      className="-my-1.5 flex min-w-0 flex-col"
      data-maka-turn-status={props.group.id}
      data-state={state}
      {...(state === 'busy' ? { role: 'status' } : {})}
      {...(state === 'busy' && props.live?.unsteady ? { 'data-maka-stream': 'unsteady' } : {})}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? copy.collapse(label) : copy.expand(label)}
        onClick={() => setOpen((value) => !value)}
        className="group/status flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm leading-5 text-text-muted outline-none transition-colors hover:text-text-secondary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
      >
        {text}
        <Anthropicon
          name="caretRight"
          size={12}
          className={cn('shrink-0 transition-transform duration-150', open && 'rotate-90')}
        />
      </button>
      {open && (
        <div className="pb-1.5 pt-2" aria-label={copy.stepsLabel}>
          <div className="flex min-w-0 flex-col divide-y divide-hairline overflow-hidden rounded-xl border-[1px] border-hairline">
            {/* A run with no call is words only — reasoning, and narration
                between it. The row already says "Thought process", so opening
                it shows the words themselves rather than a card whose only
                row says the same thing again and has to be opened a second
                time. */}
            {textOnly &&
              steps.map((step) =>
                step.kind === 'tool' ? null : (
                  <div
                    key={step.key}
                    className="min-w-0 px-3 py-2.5"
                    {...(step.kind === 'thinking'
                      ? { 'data-maka-thinking': '' }
                      : { 'data-maka-narration': '' })}
                  >
                    <ThinkingText
                      text={step.text}
                      {...(step.live ? { live: true } : {})}
                      onOpenExternal={props.context.onOpenExternal}
                    />
                    {step.kind === 'thinking' && step.truncated && (
                      <p className="mt-1 text-xs leading-4 text-text-muted">
                        {getTranscriptCopy(locale).thinking.truncated}
                      </p>
                    )}
                  </div>
                ),
              )}
            {!textOnly &&
              steps.map((step) => {
                if (step.kind === 'thinking') {
                  return (
                    <TurnStatusThinkingStep
                      key={step.key}
                      text={step.text}
                      live={step.live}
                      truncated={step.truncated}
                      onOpenExternal={props.context.onOpenExternal}
                    />
                  );
                }
                if (step.kind === 'narration') {
                  return (
                    <TurnStatusNarrationStep
                      key={step.key}
                      text={step.text}
                      live={step.live}
                      onOpenExternal={props.context.onOpenExternal}
                    />
                  );
                }
                return (
                  <TurnStatusToolStep
                    key={step.key}
                    item={step.item}
                    context={props.context}
                    {...(props.onSwitchToFullAccessAndRetry
                      ? {
                          onSwitchToFullAccessAndRetry: () =>
                            props.onSwitchToFullAccessAndRetry?.(step.item.toolUseId),
                        }
                      : {})}
                    {...(props.switchingToolUseId !== undefined
                      ? { switching: props.switchingToolUseId === step.item.toolUseId }
                      : {})}
                  />
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
});
