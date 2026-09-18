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

// The sidebar's Scheduled band.
//
// A nav button says the page exists; it does not say what is scheduled, which
// one is about to run, or which one produced the session being read. The tasks
// are things the person owns, and this is where owned things live.
//
// It is a `SidebarGroup`, not a hand-rolled copy of one. Projects and Recents
// are groups, and a band that drew its own label row would drift from them on
// the next metric change — the 44px label, the caret that appears on hover,
// the collapse animation and the 10px gap between sections all come from
// there. Its rows take `SessionRow`'s measurements for the same reason: they
// sit in the same column, a row apart.
//
// Only ACTIVE tasks. A paused one is not going to happen and a completed
// one-shot already did; a band listing either would report work that is not
// coming. The page is where those are brought back or cleaned up.

import { useMemo, useState } from 'react';
import { getScheduledTaskCopy, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { menuDangerItemClass } from '../../ui/menu-variants.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import { getModulesCopy } from '../../../locales/modules-copy.js';
import { getSettingsSharedCopy } from '../../../locales/settings-shared-copy.js';
import { SidebarRowActionTrigger } from './SidebarRowActionTrigger.js';
import type { ScheduledTask } from '@maka/core/scheduled-task';
import { cn } from '../../../lib/cn.js';
import type { SidebarCopy } from '../../../locales/sidebar-copy.js';
import { SidebarGroup } from './SidebarGroup.js';

/** The newest session a task produced, or nothing when it produced none. */
function latestSessionOf(task: ScheduledTask): string | undefined {
  let best: { id: string; at: number } | undefined;
  for (const run of task.runs) {
    // A failed run's session is a half-finished turn, not the task's output.
    if (run.outcome !== 'ok' || !run.sessionId) continue;
    if (!best || run.at > best.at) best = { id: run.sessionId, at: run.at };
  }
  return best?.id;
}

export function SidebarScheduledSection(props: {
  tasks: readonly ScheduledTask[];
  /** The session being read, so the task that produced it can light up. */
  activeSessionId: string | undefined;
  /** The task whose page is open, which lights its own row. */
  openTaskId: string | null;
  isContentHidden: boolean;
  onContentHiddenChange: (hidden: boolean) => void;
  copy: SidebarCopy;
  /**
   * Runs nobody has read yet, by task id — `unreadRunsByTask`.
   *
   * It takes the trailing slot the cadence word used to hold, as the reference
   * does: the cadence is already on the card and on the task's page, and this
   * is the only place that says how much has piled up unread.
   */
  unreadRuns: ReadonlyMap<string, number>;
  /** The run's HOST session id, and the task it came from as the fallback. */
  onOpenSession: (hostSessionId: string, taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  /** Fire the task now, as the ⋯ menu's first row does. */
  onTriggerTask: (taskId: string) => void;
  /** Delete it, after this band's own confirmation. */
  onDeleteTask: (taskId: string) => void;
}) {
  const locale = useUiLocale();
  const catalog = getScheduledTaskCopy(locale);
  const modules = getModulesCopy(locale).scheduled;
  const shared = getSettingsSharedCopy(locale);
  // Deleting a task cannot be undone, and the band has no page behind it to
  // host the question — so it asks here, the way the list card does.
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const active = useMemo(
    () => props.tasks.filter((task) => task.status === 'active'),
    [props.tasks],
  );

  if (active.length === 0) return null;

  return (
    <>
      <SidebarGroup
        groupKey="scheduled"
        // "Scheduled", the same word as the nav row above it — which is what the
        // reference does: the row is the page, the band is what is on it, and
        // naming the band anything else invents a second noun for one thing.
        title={props.copy.nav.scheduled}
        isContentHidden={props.isContentHidden}
        onContentHiddenChange={props.onContentHiddenChange}
        copy={props.copy}
      >
        {active.map((task) => {
          const sessionId = latestSessionOf(task);
          // Lit when this task's page is open, or when the session being read
          // came out of one of its runs — both are "you are looking at this
          // task", and the nav row above stands down for either.
          const isActive =
            props.openTaskId === task.id ||
            (props.activeSessionId !== undefined &&
              task.runs.some((run) => run.sessionId === props.activeSessionId));
          const unread = props.unreadRuns.get(task.id);
          return (
            <div
              key={task.id}
              data-maka-contract="scheduled-row"
              data-scheduled-task={task.id}
              className={cn(
                'group relative rounded-lg transition-colors',
                isActive
                  ? 'bg-sidebar-selected'
                  : 'hover:bg-sidebar-hover focus-within:bg-sidebar-hover',
              )}
            >
              <button
                type="button"
                onClick={() =>
                  sessionId ? props.onOpenSession(sessionId, task.id) : props.onOpenTask(task.id)
                }
                className="group/item relative flex h-7 w-full cursor-pointer items-center rounded-lg px-[2px] py-0 text-left text-[0.8125rem] leading-5 text-sidebar-text-secondary transition-[color,box-shadow] hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none"
              >
                {/* Read or unread, exactly as `SessionRow` draws it — the
                  reference gives a scheduled task the same leading mark as an
                  ordinary chat, and so does Maka's own rail. It used to mean
                  "the last run failed", which was a second vocabulary for this
                  one dot; failure is told on the task's page, where the run
                  that failed says so and carries its reason. */}
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center"
                >
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      unread === undefined
                        ? 'border-[1px] border-sidebar-text-muted/50'
                        : 'bg-accent-fill',
                    )}
                  />
                </span>
                <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap fade-clip-end text-[0.8125rem] leading-5">
                  {task.title}
                </span>
                {/* The tail sits 6px from the row's edge, mirroring the 28px lead
                  slot — the same optical inset the session row's own trailing
                  content uses.

                  A pill, measured off the reference: 22px tall, 5.5px corners,
                  8px of side padding, 12px/500, on 5% ink — which is exactly
                  `--alpha-1`. It is NOT `statusChipLargeClass`: that one carries
                  a 0.5px border and 6px padding, because the chip it was built
                  for (the detail page's status) really does have a border and
                  this one does not. Same size, different control. */}
                {unread !== undefined && (
                  <span
                    className={cn(
                      'mr-1 inline-flex h-[22px] shrink-0 items-center rounded-[5.5px] bg-alpha-1 px-2 text-xs font-medium text-sidebar-text-secondary',
                      // The ⋯ lands on exactly this spot, so the pill gets out
                      // of its way — which is what the reference does too.
                      // Without it the two draw on top of each other the moment
                      // the pointer enters the row.
                      'transition-opacity duration-[var(--dur-fast)]',
                      openMenu === task.id
                        ? 'opacity-0'
                        : 'group-hover:opacity-0 group-focus-within:opacity-0',
                    )}
                  >
                    {props.copy.nav.unreadRuns(unread)}
                  </span>
                )}
              </button>

              {/* The ⋯ menu, revealed on hover like every other sidebar row's.
                Three rows, the reference's own minus "Mark all as read", which
                needs a Host operation Maka does not have: it can only ever
                CLEAR unread, by opening a run. Edit opens the task's page
                rather than the create dialog — from here the page is what you
                want, and it carries the dialog on its own header. */}
              <div
                className={cn(
                  'absolute right-1 top-1/2 flex -translate-y-1/2 items-center transition-opacity duration-[var(--dur-fast)]',
                  openMenu === task.id
                    ? 'pointer-events-auto opacity-100'
                    : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
                )}
              >
                <DropdownMenu
                  open={openMenu === task.id}
                  onOpenChange={(open) => setOpenMenu(open ? task.id : null)}
                >
                  <DropdownMenuTrigger asChild>
                    <SidebarRowActionTrigger
                      label={props.copy.scheduledActions(task.title)}
                      isOpen={openMenu === task.id}
                    />
                  </DropdownMenuTrigger>
                  {/* A bare glyph and a `flex-1` label, the shape
                      `SessionActionMenuItems` next door uses. The base
                      `menuItemClass` is `justify-between` — right for a row
                      with a trailing check, wrong for a glyph-and-label action,
                      where it pushes the words against the menu's right edge.
                      The label filling the row is what settles it. */}
                  <DropdownMenuContent variant="sidebar" align="end" side="bottom">
                    <DropdownMenuItem onSelect={() => props.onTriggerTask(task.id)}>
                      <Anthropicon name="play" size={20} />
                      <span className="flex-1">{catalog.page.triggerNow}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => props.onOpenTask(task.id)}>
                      <Anthropicon name="edit" size={20} />
                      <span className="flex-1">{catalog.page.edit}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className={menuDangerItemClass}
                      onSelect={() => setPendingDelete({ id: task.id, title: task.title })}
                    >
                      <Anthropicon name="trash" size={20} />
                      <span className="flex-1">{catalog.page.delete}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          );
        })}
      </SidebarGroup>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? modules.deleteTitle(pendingDelete.title) : ''}
        description={modules.deleteDescription}
        confirmText={catalog.page.delete}
        cancelText={shared.cancel}
        variant="destructive"
        onConfirm={() => {
          if (pendingDelete) props.onDeleteTask(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );
}
