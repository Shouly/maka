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

// The live turn's running status line: a truthful activity label and the
// elapsed clock beside it (upstream `TurnRunningStatus`, #646).
//
// A quiet provider request does not prove that the model is actively making
// semantic progress. The default therefore says only that Maka is waiting for
// model output; a concrete tool label replaces it when the Runtime has direct
// evidence of work in flight. The clock is local presentation state so ticking
// it does not repaint the whole transcript.
//
// `startedAt` is the turn's own first-message timestamp, so the clock measures
// the wait the user actually experienced — from pressing send, not from
// whenever the model's first event happened to land. It is absent on the
// fallback path where no committed turn exists yet; the phrase then stands
// alone.

import { useLayoutEffect, useRef, useState } from 'react';
import {
  formatTurnDuration,
  getConversationCopy,
  isTimeDrivenMotionEnabled,
  useUiLocale,
} from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';

const ELAPSED_TICK_MS = 1_000;

export function TurnRunningStatus(props: {
  startedAt?: number;
  activityLabel?: string;
  turnId?: string;
}) {
  const copy = getConversationCopy(useUiLocale()).messages;
  const label = props.activityLabel ?? copy.awaitingModelOutput;
  return (
    <div
      className="mt-2 flex items-center gap-2 text-sm leading-5 text-text-muted"
      role="status"
      aria-live="polite"
      aria-label={label}
      data-maka-contract="turn-running-status"
    >
      <Anthropicon
        name="spinner"
        size={16}
        className="shrink-0 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      {/* Name the activity once; the clock must not announce each second. */}
      <span aria-hidden="true" className="inline-flex items-center gap-1.5">
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
      {elapsedMs !== undefined && (
        <>
          <span className="mx-0.5">·</span>
          {formatTurnDuration(elapsedMs)}
        </>
      )}
    </span>
  );
}
