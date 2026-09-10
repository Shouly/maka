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

// The active Session's Goal, and the three controls over it.
//
// The `goal` namespace has no subscription of its own: the Host reports a Goal
// transition as a Session change with `reason: 'goal-change'`, which the
// Session catalog already receives for every observed Session. Taking it from
// there rather than opening a second channel is also what keeps the two in
// step — the catalog row and the Goal move on the same event.
//
// Session-scoped, one Session at a time: `observe` re-connects, which fences
// the previous Session's in-flight read so a slow answer cannot land under the
// Session that replaced it.

import type { SessionChangedEvent } from '@maka/core/session';
import type { GoalState } from '@maka/runtime/goal-state';
import * as api from '../bridge/goal.js';
import { createResourceStore } from './resource-store.js';

export type GoalBridge = Pick<typeof api, 'getGoal' | 'pauseGoal' | 'resumeGoal' | 'clearGoal'>;

export function createGoalStore(deps: {
  /** Every Session catalog change, before the refresh it triggers. */
  subscribeChanges(listener: (event: SessionChangedEvent) => void): () => void;
  bridge?: GoalBridge;
}) {
  const bridge = deps.bridge ?? api;
  const store = createResourceStore<GoalState | null>();
  return {
    ...store,
    observe(sessionId: string) {
      return store.connect(
        () => bridge.getGoal(sessionId),
        (refresh) =>
          deps.subscribeChanges((event) => {
            if (event.reason !== 'goal-change') return;
            // A broadcast transition (no Session named) concerns every Session.
            if (event.sessionId !== undefined && event.sessionId !== sessionId) return;
            refresh();
          }),
      );
    },
    pause: (sessionId: string) => store.mutate(() => bridge.pauseGoal(sessionId)),
    resume: (sessionId: string) => store.mutate(() => bridge.resumeGoal(sessionId)),
    clear: (sessionId: string) => store.mutate(() => bridge.clearGoal(sessionId)),
  };
}
