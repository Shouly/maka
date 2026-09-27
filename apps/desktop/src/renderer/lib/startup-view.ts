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

// How much the window says while the launch goes on (the usual thresholds of
// waiting): nothing for a short wait, which would only flash; a quiet spinner
// with the step once it is noticeable; and the elapsed time, a word on why
// and the diagnostics once it is long.

import type { DesktopStartupState } from '../bridge/startup.js';

/** Under this nothing is shown. */
export const STARTUP_QUIET_MS = 2_000;
/** From this on the wait is long: elapsed time, why, diagnostics. */
export const STARTUP_SLOW_MS = 10_000;

export type StartupStage = 'quiet' | 'working' | 'slow';

export function startupStage(elapsedMs: number): StartupStage {
  if (elapsedMs < STARTUP_QUIET_MS) return 'quiet';
  if (elapsedMs < STARTUP_SLOW_MS) return 'working';
  return 'slow';
}

/** m:ss. */
export function formatStartupElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * What stands between the window and the app: the launch until it is ready
 * (an unknown launch — the first read still out — counts as not ready).
 */
export function startupHoldsApp(startup: DesktopStartupState | undefined): boolean {
  return startup === undefined || !startup.ready;
}

/**
 * Where the wait on screen counts from: the launch, unless the gate showing it
 * mounted late within its own document — after a company sign-in, which is
 * not the Runtime Host keeping anyone waiting — so the wait starts at the
 * mount. Measured from the document, not the launch: the main process takes
 * its own time before the window exists (a login shell, the storage check),
 * and that wait is part of the launch.
 */
export function startupWaitSince(
  startedAt: number | undefined,
  mountedAt: number,
  documentStartedAt: number,
): number | undefined {
  if (startedAt === undefined) return undefined;
  return mountedAt - documentStartedAt > STARTUP_QUIET_MS ? mountedAt : startedAt;
}

/** How long a handoff's actions ignore presses once its view changes. */
export const HANDOFF_ANSWER_GRACE_MS = 800;

/**
 * One answer per view of a handoff, and none in the moment after a view
 * appears. A click's second half must not answer the view the first half
 * produced: pressing Replace turns the dialog to progress, and its Cancel —
 * which ends the app — can land under the pointer.
 */
export function createHandoffAnswerGuard(now: () => number = Date.now) {
  let revision: string | undefined;
  let armedAt = 0;
  let answered = false;
  return {
    /** The view on screen; a new one re-arms the guard. Idempotent. */
    show(next: string): void {
      if (next === revision) return;
      revision = next;
      armedAt = now() + HANDOFF_ANSWER_GRACE_MS;
      answered = false;
    },
    /** Whether this press may answer. */
    take(): boolean {
      if (answered || now() < armedAt) return false;
      answered = true;
      return true;
    },
    /** The answer did not land (the view had moved on): the next press may. */
    release(): void {
      answered = false;
    },
  };
}
