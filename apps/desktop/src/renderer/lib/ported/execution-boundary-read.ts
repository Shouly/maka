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

// Ported from upstream `renderer/use-active-execution-boundary.ts` (#1629):
// the React-free half — the bounded retry schedule and the read loop. The
// enterprise renderer drives it from `store/active-session-store.ts`.

import type { ExecutionBoundaryReadModel } from '@maka/core/sandbox-boundary';

/**
 * The outcome of one attempt to learn a session's boundary from main.
 *
 * `unreadable` is the fact this read model exists to carry: main was asked,
 * every attempt failed, and the renderer still does not know what the session
 * may do. Without it a failed read is indistinguishable from a read that has
 * not answered yet, and the surface has no honest state to show (#1629).
 */
export type ExecutionBoundaryReadResult =
  | { outcome: 'read'; boundary: ExecutionBoundaryReadModel }
  | { outcome: 'unreadable' }
  | { outcome: 'cancelled' };

/**
 * Delays before each retry of a failed boundary read.
 *
 * Bounded on purpose. A boundary read fails for two very different reasons: a
 * main process that has not finished settling the session yet — which the next
 * attempt fixes — and something actually broken, which no number of attempts
 * fixes. This schedule rides out the first (four reads, with 1.75s of waiting
 * spread between them on top of whatever the reads themselves cost) and then
 * stops, so the second becomes a state the user is told about rather than a
 * poll that runs until the window closes.
 */
export const EXECUTION_BOUNDARY_READ_RETRY_DELAYS_MS: readonly number[] = [150, 400, 1200];

/** Read a boundary, retrying a failure on the bounded schedule above. */
export async function readExecutionBoundaryWithRetry(input: {
  read(): Promise<ExecutionBoundaryReadModel>;
  wait(delayMs: number): Promise<void>;
  cancelled(): boolean;
  retryDelaysMs?: readonly number[];
}): Promise<ExecutionBoundaryReadResult> {
  const retryDelaysMs = input.retryDelaysMs ?? EXECUTION_BOUNDARY_READ_RETRY_DELAYS_MS;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    if (input.cancelled()) return { outcome: 'cancelled' };
    try {
      const boundary = await input.read();
      // A read outlives its caller: main answers whenever it answers, and by
      // then the session may have been switched away from. Re-check before
      // claiming a result, or a reply nobody is waiting for any more comes back
      // looking exactly like a live answer.
      return input.cancelled() ? { outcome: 'cancelled' } : { outcome: 'read', boundary };
    } catch {
      // Retried below, or reported as unreadable once the schedule runs out.
    }
    const delayMs = retryDelaysMs[attempt];
    if (delayMs === undefined) break;
    if (input.cancelled()) return { outcome: 'cancelled' };
    await input.wait(delayMs);
  }
  return input.cancelled() ? { outcome: 'cancelled' } : { outcome: 'unreadable' };
}
