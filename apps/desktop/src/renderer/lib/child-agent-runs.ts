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

// Child agents as their parent sees them while they work.
//
// An Agent call returns as soon as its child is running, and the child's
// Session stays off the rail, so read from the transcript alone the parent
// shows nothing while the work goes on. The session catalog says which
// children are running which Turns; the Agent rows, the tray above the
// composer and the parent's rail row all read it from here.

import { linkedSubagentParentSessionId, type SessionSummary } from '@maka/core/session';
import { projectTurnTools, type ToolActivityItem, type TurnViewModel } from '@maka/ui';

function isRunning(session: SessionSummary): boolean {
  return !session.isArchived && (session.runningTurnIds?.length ?? 0) > 0;
}

/**
 * A running child parked on a request the user can answer: the Host says so
 * live (`awaitingUser`), and a question, form or sandbox boundary also leaves
 * the Session's own status at `waiting_for_user`.
 */
export function awaitsUser(session: SessionSummary): boolean {
  return (
    isRunning(session) && (session.awaitingUser === true || session.status === 'waiting_for_user')
  );
}

/** A parent's children that are running a Turn now, in catalog order. */
export function runningChildAgentsOf<T extends SessionSummary>(
  sessions: readonly T[],
  parentSessionId: string,
): T[] {
  return sessions.filter(
    (session) => isRunning(session) && linkedSubagentParentSessionId(session) === parentSessionId,
  );
}

/** The sessions that have a child running a Turn now, and those with one waiting on the user. */
export function parentsOfRunningChildAgents(sessions: readonly SessionSummary[]): {
  readonly running: ReadonlySet<string>;
  readonly awaitingUser: ReadonlySet<string>;
} {
  const running = new Set<string>();
  const awaitingUser = new Set<string>();
  for (const session of sessions) {
    const parent = linkedSubagentParentSessionId(session);
    if (parent === undefined || !isRunning(session)) continue;
    running.add(parent);
    if (awaitsUser(session)) awaitingUser.add(parent);
  }
  return { running, awaitingUser };
}

const childTurnKey = (childSessionId: string, turnId: string) => `${childSessionId}/${turnId}`;
/** Marks a key whose child waits on the user. */
const AWAITING = '!';

/**
 * Every Turn a parent's children are running, as one string: a store selector
 * compares it by value, so the transcript moves only when the set does.
 */
export function runningChildTurnsKey(
  sessions: readonly SessionSummary[],
  parentSessionId: string,
): string {
  return runningChildAgentsOf(sessions, parentSessionId)
    .flatMap((session) =>
      (session.runningTurnIds ?? []).map(
        (turnId) => `${childTurnKey(session.id, turnId)}${awaitsUser(session) ? AWAITING : ''}`,
      ),
    )
    .sort()
    .join('\n');
}

/** Whether this row's child runs the Turn the row started, and whether it waits on the user. */
function runsOn(
  tool: ToolActivityItem,
  running: ReadonlySet<string>,
): 'running' | 'awaiting' | undefined {
  if (tool.result?.kind !== 'subagent') return undefined;
  const { childSessionId, turnId } = tool.result;
  if (childSessionId === undefined || turnId === undefined) return undefined;
  const key = childTurnKey(childSessionId, turnId);
  if (running.has(`${key}${AWAITING}`)) return 'awaiting';
  return running.has(key) ? 'running' : undefined;
}

/**
 * Marks each row whose child is still running the Turn that call started
 * (`childAgentRunning`): the Agent call that launched it, or the SendMessage
 * that resumed it — each names the Turn it started, so a resumed child runs
 * the SendMessage row and leaves the Agent row that launched it done.
 *
 * Cached per source turn, so an older turn with a running child is the same
 * object frame after frame while the live turn streams under it, and its
 * memoized view re-renders only when its own children move.
 */
export function createChildAgentOverlay(): (
  turns: readonly TurnViewModel[],
  runningKey: string,
) => readonly TurnViewModel[] {
  const cache = new WeakMap<
    TurnViewModel,
    { readonly key: string; readonly turn: TurnViewModel }
  >();
  return (turns, runningKey) => {
    if (runningKey === '') return turns;
    const running = new Set(runningKey.split('\n'));
    let moved = false;
    const overlaid = turns.map((turn) => {
      const states = new Map(
        turn.tools.flatMap((tool) => {
          const state = runsOn(tool, running);
          return state ? [[tool.toolUseId, state] as const] : [];
        }),
      );
      if (states.size === 0) return turn;
      moved = true;
      const key = [...states].map(([id, state]) => `${id}:${state}`).join('\n');
      const cached = cache.get(turn);
      if (cached?.key === key) return cached.turn;
      const next = projectTurnTools(
        [turn],
        turn.tools.map((tool) => {
          const state = states.get(tool.toolUseId);
          if (!state) return tool;
          return {
            ...tool,
            childAgentRunning: true as const,
            ...(state === 'awaiting' ? { childAgentAwaitingUser: true as const } : {}),
          };
        }),
      )[0]!;
      cache.set(turn, { key, turn: next });
      return next;
    });
    return moved ? overlaid : turns;
  };
}
