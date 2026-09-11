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

// The live turn's status line under the transcript: the breathing mark, what
// the turn is doing now, and — once the wait is long enough to be worth
// counting — how long it has been.
//
// Ported from the reference design system's `ChatStatusIndicator`:
// - The label follows the newest block (`deriveTurnActivity`): Thinking…,
//   Writing…, or the running tool's own phrase; "Working on it…" until the
//   first block lands.
// - Between blocks (`gap`) the line KEEPS the last label. A gap follows every
//   tool result for a few hundred milliseconds; flipping to a generic phrase
//   and back on each one made the line flicker step by step. A new turn (or
//   session) clears the held label.
// - The clock appears after 5s. A turn that answers in two seconds never shows
//   a counter that would only have said "2s".
//
// `startedAt` is the turn's own first-message timestamp, so the clock measures
// the wait the user actually experienced — from pressing send, not from
// whenever the model's first event happened to land. It is absent on the
// fallback path where no committed turn exists yet; the phrase then stands
// alone. The clock is local state so ticking it never repaints the transcript.

import { useLayoutEffect, useRef, useState } from 'react';
import {
  formatTurnDuration,
  isTimeDrivenMotionEnabled,
  useUiLocale,
  type TurnViewModel,
} from '@maka/ui';
import { RelxMark } from '../icons/RelxMark.js';
import { deriveTurnActivity } from '../../lib/turn-activity.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';

const ELAPSED_TICK_MS = 1_000;
/** Below this the clock stays hidden: a quick reply is not a wait. */
const ELAPSED_SHOW_AFTER_MS = 5_000;

export function TurnRunningStatus(props: {
  startedAt?: number;
  turnId?: string;
  /** The committed turn this line stands under; absent while the send is on its way. */
  turn?: TurnViewModel;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).tools;
  const activity = deriveTurnActivity(props.turn, locale);

  // Held across gaps; dropped when the turn changes.
  const held = useRef<{ turnId: string | undefined; label: string | undefined }>({
    turnId: props.turnId,
    label: undefined,
  });
  if (held.current.turnId !== props.turnId)
    held.current = { turnId: props.turnId, label: undefined };
  if (activity.kind !== 'gap' && activity.kind !== 'none') held.current.label = activity.label;
  const label = held.current.label ?? copy.working;

  return (
    <div
      className="ml-1 mt-6 flex items-center gap-3"
      role="status"
      aria-live="polite"
      aria-label={label}
      data-maka-contract="turn-running-status"
      data-maka-activity={activity.kind}
    >
      <RelxMark size={32} animated className="text-fill-brand" />
      {/* Name the activity once; the clock must not announce each second. */}
      <span
        aria-hidden="true"
        className="inline-flex items-center text-sm leading-5 text-text-muted"
      >
        <span>{label}</span>
        <TurnElapsedTime startedAt={props.startedAt} turnId={props.turnId} />
      </span>
    </div>
  );
}

function TurnElapsedTime(props: { startedAt?: number; turnId?: string }) {
  // Latched to the earliest start this instance has seen. A live Turn whose
  // durable rows have not landed yet is synthesised by the projection with
  // `startedAt: Date.now()` on every delta; taking each value as it comes
  // would reset the clock to 0s on every token.
  const earliest = useRef<number | undefined>(undefined);
  const turnId = useRef(props.turnId);
  if (props.turnId && turnId.current && props.turnId !== turnId.current)
    earliest.current = undefined;
  if (props.turnId) turnId.current = props.turnId;
  if (
    props.startedAt !== undefined &&
    (earliest.current === undefined || props.startedAt < earliest.current)
  ) {
    earliest.current = props.startedAt;
  }
  const startedAt = earliest.current;
  const rootRef = useRef<HTMLSpanElement>(null);
  // Undefined until an effect measures it, so the first paint carries the
  // phrase alone and a static render stays deterministic.
  const [elapsedMs, setElapsedMs] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    // Frozen (fixture / reduced motion) the clock is dropped rather than
    // pinned: any value it could show is a real wall-clock difference, so a
    // capture taken a second later would differ from this one.
    if (startedAt === undefined || !isTimeDrivenMotionEnabled(rootRef.current)) return;
    setElapsedMs(Math.max(0, Date.now() - startedAt));
    const tick = window.setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startedAt));
    }, ELAPSED_TICK_MS);
    return () => window.clearInterval(tick);
  }, [startedAt]);
  return (
    <span ref={rootRef} className="tabular-nums" data-maka-contract="turn-elapsed">
      {elapsedMs !== undefined && elapsedMs >= ELAPSED_SHOW_AFTER_MS && (
        <>
          <span className="mx-1 select-none">·</span>
          {formatTurnDuration(elapsedMs)}
        </>
      )}
    </span>
  );
}
