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

// The armed Goal, above the composer: what it is waiting for, how far it has
// got, and the brake.
//
// A Goal keeps taking turns on its own after every reply. The ＋ menu could
// arm one and then nothing on screen said a Goal existed, which left the only
// way to stop it — `goal.clear` — with no caller: the user had to close the
// task. So this strip is not a status decoration, it is the stop button.
//
// It stands where the queue plate and the revision banner stand, for the same
// reason they do: what governs the next turn belongs beside the box that
// sends it, not in a page the user has to go find.

import { useEffect, useReducer, useState } from 'react';
import { useStore } from 'zustand';
import { getConversationCopy, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { statusChipClass, statusChipNeutralClass } from '../../ui/status-chip.js';
import { cn } from '../../../lib/cn.js';
import { goalReadout } from '../../../lib/goal-readout.js';
import { goalStore, sessionsStore } from '../../../store/index.js';
import { getShellCopy } from '../../../locales/shell-copy.js';

/**
 * The elapsed label moves in minutes, so it is re-derived every 30s. A paused
 * Goal freezes by construction (`pausedAt`), and ticking a frozen clock would
 * repaint the strip for nothing.
 */
const CLOCK_TICK_MS = 30_000;

export function GoalBanner(props: {
  sessionId: string;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const chat = getConversationCopy(locale).chat;
  const shell = getShellCopy(locale);
  const app = shell.app;
  const goal = useStore(goalStore, (state) => state.data);
  // A first prompt from the welcome surface runs against a Session the Host
  // has not admitted yet: the row is here, `localState: 'pending'`, and its id
  // means nothing to the Host until the handoff lands. Asking for its Goal
  // fails with `Session does not exist` — a real error in the main log for a
  // Session that is simply not born yet. Same gate the composer uses for its
  // own Host reads.
  const hostAdmitted = useStore(sessionsStore, (state) => {
    const row = state.sessions.find((session) => session.id === props.sessionId);
    return row !== undefined && row.localState !== 'pending';
  });
  const [busy, setBusy] = useState(false);
  const [, tick] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    // Disconnect rather than just skip: the store would otherwise still hold
    // the Goal of the Session this one replaced, and the strip would report
    // another task's Goal over this one.
    if (!hostAdmitted) {
      goalStore.disconnect();
      return;
    }
    return goalStore.observe(props.sessionId);
  }, [props.sessionId, hostAdmitted]);

  const readout = goalReadout(goal, Date.now());
  const live = readout !== undefined && readout.status !== 'paused';
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(tick, CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [live]);

  if (!readout) return null;

  // One control at a time: pause and resume answer the same question, and a
  // second press before the Host has answered the first asks it twice.
  const run = (title: string, operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    void operation()
      .catch((error) => props.onError(title, error))
      .finally(() => setBusy(false));
  };

  const paused = readout.status === 'paused';
  const progress = [
    chat.goalProgress(readout.iterations, readout.maxIterations),
    chat.goalElapsed(readout.elapsedMs),
    readout.tokens ? chat.goalTokens(readout.tokens.spent, readout.tokens.budget) : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' · ');

  return (
    <div
      role="status"
      data-maka-contract="goal-banner"
      aria-label={
        paused
          ? chat.goalPausedAriaLabel
          : readout.status === 'waiting'
            ? chat.goalWaitingAriaLabel
            : chat.goalRunningAriaLabel
      }
      className="flex w-full items-center gap-3 rounded-xl border border-hairline bg-surface-2 px-3 py-2"
    >
      <Anthropicon name="flag" size={18} className="shrink-0 text-text-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm leading-5 text-text-primary" title={readout.condition}>
          {readout.condition}
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[0.8125rem] leading-[1.125rem] text-text-secondary">
          <span className={cn(statusChipClass, statusChipNeutralClass)}>
            {shell.goalDialog.statusLabels[readout.status]}
          </span>
          <span className="truncate tabular-nums">{progress}</span>
        </p>
      </div>
      {paused ? (
        <Button
          variant="ghost"
          size="iconSm"
          disabled={busy}
          aria-label={chat.resumeGoalAriaLabel(readout.iterations, readout.maxIterations)}
          title={chat.resumeGoal(readout.condition, readout.iterations, readout.maxIterations)}
          onClick={() => run(app.goalResumeFailedTitle, () => goalStore.resume(props.sessionId))}
        >
          <Anthropicon name="play" size={16} />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="iconSm"
          disabled={busy}
          aria-label={chat.pauseGoalAriaLabel(readout.iterations, readout.maxIterations)}
          title={chat.pauseGoal(
            readout.condition,
            readout.iterations,
            readout.maxIterations,
            shell.goalDialog.statusLabels[readout.status],
          )}
          onClick={() => run(app.goalPauseFailedTitle, () => goalStore.pause(props.sessionId))}
        >
          <Anthropicon name="pause" size={16} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="iconSm"
        disabled={busy}
        aria-label={chat.clearGoalAriaLabel(readout.iterations, readout.maxIterations)}
        title={chat.clearGoal(
          readout.condition,
          readout.iterations,
          readout.maxIterations,
          shell.goalDialog.statusLabels[readout.status],
        )}
        onClick={() => run(app.goalClearFailedTitle, () => goalStore.clear(props.sessionId))}
      >
        <Anthropicon name="stop" size={16} />
      </Button>
    </div>
  );
}
