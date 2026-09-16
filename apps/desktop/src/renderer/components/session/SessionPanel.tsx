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

// The session panel: what this session IS, not what it opened. The workbar's
// faces show a thing you asked to see (a file, a diff, a terminal); this column
// shows the session's own state, and it is what the column holds when no face
// has taken it.
//
// Shape is relx's TaskSidebar, ported rather than approximated: a transparent
// column, a scroll layer, and one card that hugs its content.
//
// The eave is 8px on all four sides, the same as the pane's, because there is
// nothing above this column to clear: the window is two COLUMNS and the
// titlebar lives in the left one (see AppShell). Padding the titlebar's height
// in here puts back the 56px drop the two-column shape exists to avoid, and
// with no header of its own to fill it the column just opens with a band of
// empty space. The card's top edge belongs level with the pane's top edge —
// one column, two occupants, framed alike. It is NOT the workbar pane's shell
// — that paints a full-height surface and this must not, or the card's edge
// disappears into the pane it is sitting on and the column reads as one empty
// white slab.
//
// The scroll layer's negative margins are load-bearing: the card's ring and
// shadows are drawn OUTSIDE its box and a scroll container clips at its own
// edge, so without the bleed they are sheared into grey bands down both sides.
// The padding puts the content back where it belongs. The top 8px is the one
// eave that sits INSIDE the scroll layer for the same reason — a card flush
// with the layer's top edge loses the 1px ring and the 6px of shadow that are
// drawn above it.

import { useMemo, useState, type ReactNode } from 'react';
import type { SessionTask } from '@maka/core/session-task';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { cn } from '../../lib/cn.js';
import { openBlockersOf, useTaskProgress } from '../../hooks/use-task-progress.js';
import { getSessionPanelCopy } from '../../locales/session-panel-copy.js';

export function SessionPanel({ sessionId }: { sessionId: string }) {
  const copy = getSessionPanelCopy(useUiLocale());
  const progress = useTaskProgress(sessionId);
  const tasks = progress.tasks;
  const open = useMemo(() => tasks.filter((task) => task.status !== 'completed').length, [tasks]);

  return (
    <div
      id="maka-session-panel"
      className="flex h-full w-80 shrink-0 flex-col bg-transparent pb-2 pl-2 pr-2 pt-0"
      aria-label={copy.label}
      data-maka-contract="session-panel"
    >
      <div className="pointer-events-none -mx-8 min-h-0 flex-1 overflow-y-auto px-8">
        <div className="pointer-events-auto flex flex-col gap-3 pb-4 pt-2">
          {/* The card takes its height from what is in it. Stretching it would
              leave a field of white under a short list. */}
          {/* The pane's own frame token: a hairline ring plus two soft shadows,
              drawn as box-shadow rather than a border so it takes no layout
              width. Using it here is what makes the two occupants of this
              column frame identically. */}
          <div className="flex flex-shrink-0 flex-col divide-y divide-hairline overflow-hidden rounded-[10px] bg-surface-3 shadow-[var(--pane-shadow)]">
            <PanelSection
              // Keyed by session: the open/closed choice belongs to the session
              // the reader made it in, not to the column.
              key={`progress-${sessionId}`}
              title={copy.progress}
              collapsedMeta={
                tasks.length > 0 ? copy.count(tasks.length - open, tasks.length) : undefined
              }
            >
              {tasks.length === 0 ? (
                <p className="pb-3 text-sm leading-5 text-text-muted">
                  {progress.status === 'error' ? copy.unavailable : copy.empty}
                </p>
              ) : (
                tasks.map((task) => (
                  <TaskProgressRow
                    key={task.id}
                    task={task}
                    blockedBy={openBlockersOf(tasks, task)}
                  />
                ))
              )}
            </PanelSection>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One section of the card. The header is the whole control: title, then a
 * caret that turns a quarter when open, then — only while closed — the summary
 * the open body would otherwise repeat.
 */
function PanelSection(props: {
  title: string;
  children: ReactNode;
  collapsedMeta?: string | undefined;
}) {
  // Open. A section that closed itself when the work finished would hide the
  // record right when a reader goes looking for it, and one that opened itself
  // would overrule a reader who had just closed it.
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="flex flex-shrink-0 flex-col">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        className="flex w-full min-w-0 cursor-pointer items-center rounded p-3 text-left outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]"
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 truncate text-sm font-medium text-text-primary">
            {props.title}
          </span>
          <span
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center text-text-muted transition-transform duration-200 ease-[cubic-bezier(0,0,0.2,1)]',
              expanded && 'rotate-90',
            )}
          >
            <Anthropicon name="caretRight" size={16} />
          </span>
        </span>
        {!expanded && props.collapsedMeta && (
          <span className="ml-auto shrink-0 pl-2 text-[11px] leading-[17px] tabular-nums text-text-muted">
            {props.collapsedMeta}
          </span>
        )}
      </button>
      {expanded && <div className="max-h-96 overflow-y-auto px-3 pb-3">{props.children}</div>}
    </div>
  );
}

/**
 * One task. The badge holds the id while the task is open, so a reader can
 * follow a "blocked by #2" back to the row it names; once the task is done the
 * check earns that space, because at that point the state outranks the number.
 *
 * Two columns, not an inline badge: inline, a wrapped second line returns to
 * the badge's left edge and sits under it. The row's bottom padding IS the row
 * gap, so the list keeps one step instead of stacking padding on margin.
 */
export function TaskProgressRow({
  task,
  blockedBy,
}: {
  task: SessionTask;
  blockedBy: readonly string[];
}) {
  const completed = task.status === 'completed';
  const running = task.status === 'in_progress';
  return (
    <div className="flex" data-maka-task-id={task.id} data-maka-task-status={task.status}>
      <span
        className={cn(
          'mr-3 flex size-6 shrink-0 items-center justify-center rounded-full',
          completed
            ? 'bg-accent-fill text-on-accent'
            : running
              ? 'border-[1px] border-accent-fill bg-alpha-1'
              : 'bg-alpha-1',
        )}
      >
        {completed ? (
          <Anthropicon name="check" size={12} />
        ) : (
          <span className="text-xs font-semibold leading-none tabular-nums text-text-muted">
            {task.id}
          </span>
        )}
      </span>
      <div
        className={cn(
          'min-w-0 flex-1 pb-3 text-sm leading-5',
          completed
            ? 'text-text-muted'
            : running
              ? 'text-text-primary'
              : blockedBy.length > 0
                ? 'text-text-muted'
                : 'text-text-secondary',
        )}
      >
        {/* The strike belongs to the title alone: on the column it would cross
            out the "blocked by" note too, and a child cannot undraw a line an
            ancestor painted. */}
        <span className={completed ? 'line-through' : undefined}>
          {running ? (task.activeForm ?? task.subject) : task.subject}
        </span>
        {blockedBy.length > 0 && (
          <span className="ml-1.5 text-[12px] text-text-muted">
            blocked by #{blockedBy.join(', #')}
          </span>
        )}
      </div>
    </div>
  );
}
