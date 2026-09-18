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

import type { SessionSummary } from '@maka/core/session';

/**
 * Which sessions the rail lists. Archived tasks are managed in Settings › 活动 ›
 * 已归档任务 (#2985), so the rail shows everything else.
 *
 * This used to switch on `NavSelection.filter`. That filter is gone (#2984): its
 * last two values were a destination that moved to Settings and a value nothing
 * ever selected, which left one branch reachable — this one.
 */
export function sessionMatchesRail(session: SessionSummary): boolean {
  return !session.isArchived && !isScheduledRunSession(session);
}

/**
 * The label the Runtime Host puts on a Session it opened for a scheduled task.
 *
 * Set in `HostScheduledTaskCoordinator#ensureAgentSession`; the two must stay
 * spelled the same, which is why it is a named constant rather than a literal
 * at the comparison.
 */
export const SCHEDULED_RUN_SESSION_LABEL = 'scheduled-task';

/**
 * A Session a scheduled task opened when it fired.
 *
 * These are kept out of Projects and Recents on purpose: a task that runs every
 * morning would otherwise push a new row into the rail every day and bury the
 * conversations the person actually started. They are reached from the task —
 * the Scheduled band and the task's run history both open them — which is where
 * a run belongs, beside the other runs of the same task.
 */
export function isScheduledRunSession(session: SessionSummary): boolean {
  return session.labels?.includes(SCHEDULED_RUN_SESSION_LABEL) === true;
}

/** Share the catalog's unread state between Scheduled navigation and history. */
export function unreadHostSessionIds(
  sessions: readonly Pick<SessionSummary, 'id' | 'hasUnread'>[],
  parseKey: (key: string) => { sessionId: string },
): ReadonlySet<string> {
  const unread = new Set<string>();
  for (const session of sessions) {
    if (!session.hasUnread) continue;
    try {
      unread.add(parseKey(session.id).sessionId);
    } catch {
      // An unsupported desktop key must not hide other unread results.
    }
  }
  return unread;
}

/**
 * How many of each task's runs nobody has read yet.
 *
 * The sidebar aggregates these counts into the Scheduled menu indicator. A
 * run opens its own Session; the Host sets `hasUnread` when it produces output,
 * and opening that Session clears it.
 *
 * Sessions are keyed by the DESKTOP key (`[hostId, sessionId]`) while a run
 * records the Host's raw session id, so the caller supplies the mapping it
 * already has rather than this module re-deriving it — the same mismatch once
 * crashed the sidebar by casting one into the other.
 *
 * Counted by SESSION, not by run: SendLater delivers several fires into one
 * Session, and that Session is one thing to read, not three.
 */
export function unreadRunsByTask(
  tasks: readonly {
    readonly id: string;
    readonly runs: readonly { readonly sessionId?: string }[];
  }[],
  unreadHostSessionIds: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    const seen = new Set<string>();
    for (const run of task.runs) {
      if (run.sessionId && unreadHostSessionIds.has(run.sessionId)) seen.add(run.sessionId);
    }
    if (seen.size > 0) counts.set(task.id, seen.size);
  }
  return counts;
}

/**
 * The scheduled task a Session came out of, if any.
 *
 * A run records the Host's raw session id; a Session is keyed by the desktop
 * `[hostId, sessionId]` pair. The parse lives here so the two are never
 * compared raw — doing that once crashed the sidebar.
 *
 * Kept out of the component because a connected component cannot be rendered
 * under the presentation tests: `useStore` hands React `getInitialState()`
 * there, so a store written before the render is not what the component sees.
 */
export function scheduledTaskIdForSession(
  tasks: readonly {
    readonly id: string;
    readonly runs: readonly { readonly sessionId?: string }[];
  }[],
  desktopSessionKey: string,
  parseKey: (key: string) => { sessionId: string },
): string | undefined {
  let hostSessionId: string;
  try {
    hostSessionId = parseKey(desktopSessionKey).sessionId;
  } catch {
    return undefined;
  }
  return tasks.find((task) => task.runs.some((run) => run.sessionId === hostSessionId))?.id;
}
