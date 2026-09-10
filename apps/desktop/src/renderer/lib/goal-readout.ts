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

// A Goal as the strip above the composer reads it (upstream `isLiveGoal` plus
// the projection its indicator builds).
//
// A Goal spends tokens with nobody watching, so the only Goal worth a strip is
// one that is still going: `active`, `waiting`, or `paused`. Every other
// status has stopped on its own and needs no brake — a strip for it would
// offer a Pause that does nothing.

import type { GoalState } from '@maka/core/goal';

export interface GoalReadout {
  readonly status: 'active' | 'waiting' | 'paused';
  readonly condition: string;
  readonly iterations: number;
  readonly maxIterations: number;
  /** Wall clock since the Goal was set; frozen at the pause for a paused Goal. */
  readonly elapsedMs: number;
  /** Only when a budget exists: without one there is nothing to read it against. */
  readonly tokens: { readonly spent: number; readonly budget: number } | undefined;
}

const LIVE = new Set(['active', 'waiting', 'paused']);

export function goalReadout(
  goal: GoalState | null | undefined,
  now: number,
): GoalReadout | undefined {
  if (!goal || !LIVE.has(goal.status)) return undefined;
  const paused = goal.status === 'paused';
  // A paused Goal without the moment it paused cannot show an honest clock,
  // and freezing it at "now" would tick. Upstream drops the same Goal.
  if (paused && !Number.isFinite(goal.pausedAt)) return undefined;
  const elapsedMs = Math.max(0, (paused ? (goal.pausedAt as number) : now) - goal.setAt);
  return {
    status: goal.status as GoalReadout['status'],
    condition: goal.condition,
    iterations: goal.iterations,
    maxIterations: goal.maxIterations,
    elapsedMs,
    // Spend is the DELTA from the baseline the Goal took when it started, which
    // is what the Runtime stops on (`goal-state.ts` `tokensSpent`). Showing
    // `tokensNow`, as upstream's indicator does, reads the whole Session's
    // spend into this Goal's budget: a Goal armed in a long task would open at
    // "180k / 100k" and never move off it.
    tokens:
      goal.tokenBudget === undefined
        ? undefined
        : {
            spent: Math.max(0, goal.tokensNow - goal.tokensAtStart),
            budget: goal.tokenBudget,
          },
  };
}
