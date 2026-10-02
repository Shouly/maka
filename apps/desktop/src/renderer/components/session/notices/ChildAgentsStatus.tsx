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

// The agents this conversation has running, above its composer: one line each.
//
// An Agent call returns once its child is running, and the reply that follows
// it usually ends the turn, so the transcript's own rows scroll away while the
// work goes on — and the child's Session is not on the rail. These lines are
// where a running agent can always be found, and where it is opened.
//
// A line is the rail's running dot, what the agent was asked to do, its type
// (Explore, Plan — the default says nothing), and — last, in a column of its
// own — how long it has been at it: the clock is what says an agent is still
// getting somewhere rather than stuck, and lined up, the clocks compare at a
// glance. A line opens its agent.

import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useUiLocale } from '@maka/ui';
import { GENERAL_PURPOSE_AGENT_NAME } from '@maka/core/subagent-settings';
import { cn } from '../../../lib/cn.js';
import { TurnElapsedTime } from '../tools/TurnStatus.js';
import { awaitsUser, runningChildAgentsOf } from '../../../lib/child-agent-runs.js';
import { sessionsStore } from '../../../store/index.js';
import { getChildAgentsCopy } from '../../../locales/child-agents-copy.js';

export interface ChildAgentRow {
  readonly id: string;
  readonly name: string;
  /** The agent's type, when it says more than the name does. */
  readonly type?: string;
  /** When the Turn it is running started, as the Host says: the clock counts from here. */
  readonly since?: number;
  /** It waits on the user: its request is on the card above the composer. */
  readonly awaiting?: boolean;
}

/** Past this many lines the list scrolls rather than pushing the transcript up. */
const VISIBLE_LINES = 4;

export function ChildAgentsStatus(props: {
  sessionId: string;
  /** False while the composer is away (a revision draft, an unreadable boundary). */
  docked?: boolean;
}) {
  // The rows themselves, which the catalog keeps by identity while unchanged:
  // a fresh projection per read would never compare equal.
  const sessions = useStore(
    sessionsStore,
    useShallow((state) => runningChildAgentsOf(state.sessions, props.sessionId)),
  );
  if (sessions.length === 0) return null;
  const agents = sessions.map((session): ChildAgentRow => {
    const name = session.name.trim() || session.subagent?.agentName || '';
    // The default type says nothing the line does not; Explore, Plan and a
    // preset's own name do.
    const type = session.subagent?.agentName;
    return {
      id: session.id,
      name,
      ...(type && type !== name && type !== GENERAL_PURPOSE_AGENT_NAME ? { type } : {}),
      ...(session.runningSince !== undefined ? { since: session.runningSince } : {}),
      ...(awaitsUser(session) ? { awaiting: true } : {}),
    };
  });
  return (
    <ChildAgentsStatusView
      agents={agents}
      docked={props.docked ?? true}
      onOpen={(id) => sessionsStore.select(id)}
    />
  );
}

/** The rail's running dot; amber and still while the agent waits on the user. */
function RunningDot(props: { awaiting?: boolean }) {
  return props.awaiting ? (
    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning-fill" />
  ) : (
    <span
      aria-hidden="true"
      className="animate-status-dot-breathe size-1.5 shrink-0 rounded-full bg-fill-brand [--status-dot-strong:var(--fill-brand)] [--status-dot-soft:color-mix(in_srgb,var(--fill-brand)_45%,var(--surface-3))]"
    />
  );
}

/** The lines themselves, from rows: what the design surface and the tests draw. */
export function ChildAgentsStatusView(props: {
  agents: readonly ChildAgentRow[];
  onOpen: (sessionId: string) => void;
  /** Tucked under the composer, or — with no composer under it — a tray of its own. */
  docked?: boolean;
}) {
  const docked = props.docked ?? true;
  const copy = getChildAgentsCopy(useUiLocale());
  const agents = props.agents;
  return (
    // A tray tucked under the composer's top edge: it stands right above the
    // composer, and the composer's 14px radius covers its foot, so the two
    // read as one piece rather than as a second box to type in. With the
    // composer away it closes its own foot.
    <div
      role="status"
      data-maka-contract="child-agents"
      aria-label={copy.status(agents.length)}
      className={cn(
        'relative flex w-full flex-col bg-alpha-1 px-1 pt-1',
        docked
          ? '-mb-[22px] rounded-t-[var(--chat-composer-radius)] pb-[22px]'
          : 'rounded-[var(--chat-composer-radius)] pb-1',
        // 28px a line: past `VISIBLE_LINES` the tray scrolls.
        agents.length > VISIBLE_LINES && (docked ? 'max-h-[9rem]' : 'max-h-[7.75rem]'),
        agents.length > VISIBLE_LINES && 'overflow-y-auto',
      )}
    >
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          aria-label={copy.open(agent.name)}
          onClick={() => props.onOpen(agent.id)}
          className="flex h-7 min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left text-[13px] leading-5 outline-none transition-colors hover:bg-alpha-1 focus-visible:shadow-[var(--sidebar-focus-shadow)]"
        >
          <RunningDot {...(agent.awaiting ? { awaiting: true } : {})} />
          <span className="min-w-0 truncate text-text-primary" title={agent.name}>
            {agent.name}
          </span>
          {agent.type && <span className="shrink-0 text-text-muted">{agent.type}</span>}
          {/* The clocks line up in a column at the composer's right edge; an
              agent waiting on the user says so there instead. */}
          {agent.awaiting ? (
            <span className="ml-auto shrink-0 pl-6 text-warning">{copy.awaiting}</span>
          ) : (
            <span className="ml-auto shrink-0 pl-6 text-text-muted tabular-nums">
              {/* No latch key: the Host's start is the reading, and the
                  transcript's per-turn latch is no place for these. */}
              <TurnElapsedTime
                bare
                {...(agent.since !== undefined ? { startedAt: agent.since } : {})}
              />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
