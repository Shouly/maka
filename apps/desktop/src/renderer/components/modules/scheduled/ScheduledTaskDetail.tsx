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

// One scheduled task, as the reference draws its detail page.
//
// It is a PAGE, not a dialog: a task now owns a body of work and a history of
// runs, and both are things people come back to read rather than glance at.
// The list page's card carries a title and a cadence chip precisely because
// this exists to carry everything else.
//
// The layout is the reference's: the breadcrumb (drawn by the window titlebar,
// see `ScheduledTaskIdentity`), then the title with its switch, its status chip
// and its next run on one line and the three actions opposite. Below a
// hairline, two columns — what the task IS on the right (its instructions, its
// cadence), and its run history on the left. The right column comes first on a
// narrow window, because the instructions are the task.
//
// The status chip here is the LARGE one (22px, 12px text, a hairline border);
// the list page's is the small one (18px, 11px, no border). The reference uses
// two sizes in the two places and so does this.

import {
  describeScheduledTaskCadence,
  formatTaskCountdown,
  formatTaskTime,
  getScheduledTaskCopy,
  runStatusLabel,
  scheduledTaskRunStatusSemantic,
  scheduledTaskStatusLabel,
  useUiLocale,
} from '@maka/ui';
import type { ScheduledTask, ScheduledTaskRun } from '@maka/core/scheduled-task';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Switch } from '../../ui/switch.js';
import {
  STATUS_CHIP_ICON_SIZE,
  statusChipClass,
  statusChipLargeClass,
  statusChipLargeIconSlotClass,
  statusChipNeutralClass,
  statusChipSuccessClass,
  statusChipToneClass,
} from '../../ui/status-chip.js';
import { inlineIconButtonClass } from '../../ui/menu-variants.js';
import { listToolbarPrimaryButtonClass } from '../../ui/list-page.js';
import { cn } from '../../../lib/cn.js';
import { getScheduledPageCopy } from '../../../locales/scheduled-page-copy.js';

type Locale = Parameters<typeof scheduledTaskStatusLabel>[1];

export function ScheduledTaskDetail(props: {
  task: ScheduledTask;
  unreadSessionIds: ReadonlySet<string>;
  busy: string | null;
  onToggle: (enabled: boolean) => void;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenSession: (sessionId: string) => void;
}) {
  const locale = useUiLocale();
  const catalog = getScheduledTaskCopy(locale);
  const page = getScheduledPageCopy(locale);
  const detail = catalog.detail;
  const { task } = props;
  const live = task.status === 'active';
  const busy = props.busy !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-maka-contract="module-main">
      <div className="min-h-0 flex-1 overflow-y-auto pb-16">
        {/* No breadcrumb here: `ScheduledTaskIdentity` draws it in the window
            titlebar, where the reference puts it. The title starts 24px under
            that row, exactly as it does there. */}
        <main className="mx-auto w-full max-w-4xl px-8 pb-6 pt-6">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="break-words font-display text-2xl font-semibold leading-[1.3] text-text-primary">
                {task.title}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <Switch
                  aria-label={live ? page.pause : page.resume}
                  checked={live}
                  disabled={busy || task.status === 'completed' || task.status === 'expired'}
                  onCheckedChange={props.onToggle}
                />
                <span
                  className={cn(
                    statusChipLargeClass,
                    live ? statusChipSuccessClass : statusChipNeutralClass,
                  )}
                >
                  <span className={statusChipLargeIconSlotClass}>
                    <Anthropicon name={live ? 'clock' : 'pause'} size={STATUS_CHIP_ICON_SIZE} />
                  </span>
                  {scheduledTaskStatusLabel(task.status, locale)}
                </span>
                {/* Only a live task has a next run worth naming. A paused one
                    still carries a nextFireAt it is not going to act on, and
                    printing it would say the task is coming when it is not. */}
                {live && task.nextFireAt !== null && (
                  <span className="text-sm leading-5 text-text-muted">
                    {`${detail.nextRun}: ${formatTaskTime(task.nextFireAt, locale)} · ${formatTaskCountdown(task.nextFireAt, locale)}`}
                  </span>
                )}
              </div>
            </div>

            <div data-maka-contract="module-actions" className="flex shrink-0 items-center gap-1">
              {/* A spent task refuses every write, so it is not offered an
                  edit it cannot accept. */}
              {task.status !== 'completed' && task.status !== 'expired' && (
                <button
                  type="button"
                  onClick={props.onEdit}
                  disabled={busy}
                  aria-label={catalog.page.edit}
                  className={cn(inlineIconButtonClass, 'size-8 rounded-lg')}
                >
                  <Anthropicon name="edit" size={20} />
                </button>
              )}
              <button
                type="button"
                onClick={props.onDelete}
                disabled={busy}
                aria-label={catalog.page.delete}
                className={cn(inlineIconButtonClass, 'size-8 rounded-lg')}
              >
                <Anthropicon name="trash" size={20} />
              </button>
              <button
                type="button"
                onClick={props.onRun}
                disabled={busy}
                className={cn(listToolbarPrimaryButtonClass, 'gap-1')}
              >
                <Anthropicon name="play" size={20} className="-ms-1" />
                {props.busy === `trigger:${task.id}`
                  ? catalog.page.triggering
                  : catalog.page.triggerNow}
              </button>
            </div>
          </div>

          <div className="mb-8 border-t border-hairline" />

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[2fr_3fr] lg:gap-12">
            <div className="order-2 min-w-0 space-y-8 lg:order-1">
              <Section label={detail.history}>
                <RunHistory
                  runs={task.runs}
                  unreadSessionIds={props.unreadSessionIds}
                  unreadLabel={page.unreadRun}
                  locale={locale}
                  openLabel={detail.openRun}
                  emptyLabel={detail.noRuns}
                  onOpenSession={props.onOpenSession}
                />
              </Section>
            </div>

            <div className="order-1 min-w-0 space-y-8 lg:order-2">
              <Section label={detail.instructions}>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-primary">
                  {task.intent.body}
                </p>
              </Section>
              <Section label={detail.recurrence}>
                <p className="text-sm leading-5 text-text-primary">
                  {describeScheduledTaskCadence(task, locale)}
                </p>
              </Section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Section(props: { label: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <h2 className="mb-3 text-sm font-normal leading-5 text-text-muted">{props.label}</h2>
      {props.children}
    </section>
  );
}

/**
 * Every recorded run, newest first.
 *
 * A run that produced a session is a button into it — that session IS the
 * task's output, and it is the only place the work can be read. A run that did
 * not shows its message instead, because a row saying only "failed" sends the
 * reader nowhere.
 */
function RunHistory(props: {
  runs: readonly ScheduledTaskRun[];
  unreadSessionIds: ReadonlySet<string>;
  unreadLabel: string;
  locale: Locale;
  openLabel: string;
  emptyLabel: string;
  onOpenSession: (sessionId: string) => void;
}) {
  if (props.runs.length === 0) {
    return <p className="text-sm leading-5 text-text-secondary">{props.emptyLabel}</p>;
  }
  return (
    <ul className="flex flex-col">
      {props.runs.map((run) => {
        // Bound outside the handler: `sessionId` is optional, so the guard
        // below would not narrow inside a closure.
        const sessionId = run.sessionId;
        const unread = sessionId !== undefined && props.unreadSessionIds.has(sessionId);
        // A run that went fine is the ordinary case and says nothing — that is
        // how the reference writes this list, and a badge on every row would
        // make the one row that matters harder to find, not easier.
        //
        // The deviation: the reference has no failing runs to draw, and Maka
        // does. A run that was blocked or that failed keeps its chip, because
        // a scheduled run has nobody watching and the history is the only
        // place that says it did not happen.
        const outcomeLabel =
          run.outcome === 'ok' ? undefined : runStatusLabel(run.outcome, props.locale);
        const body = (
          <>
            {/* `first-letter:uppercase` rather than a capitalized string:
                the same phrase leads this row ("Yesterday at 9:10 AM") and
                sits mid-sentence in "Next run: today at 9:00 AM". The
                reference does exactly this. */}
            <span className="text-sm leading-5 text-text-primary first-letter:uppercase">
              {formatTaskTime(run.at, props.locale)}
            </span>
            {(outcomeLabel !== undefined || unread) && (
              <span className="ml-auto inline-flex shrink-0 items-center gap-2">
                {outcomeLabel !== undefined && (
                  <span
                    className={cn(
                      statusChipClass,
                      statusChipToneClass(scheduledTaskRunStatusSemantic(run.outcome)),
                    )}
                  >
                    {outcomeLabel}
                  </span>
                )}
                {unread && (
                  <span
                    aria-hidden="true"
                    title={props.unreadLabel}
                    className="size-1.5 shrink-0 rounded-full bg-accent-fill"
                  />
                )}
              </span>
            )}
          </>
        );
        return (
          <li
            key={run.id}
            className="border-b border-alpha-1 transition-colors last:border-b-0 hover:border-transparent"
          >
            {sessionId ? (
              <button
                type="button"
                onClick={() => props.onOpenSession(sessionId)}
                aria-label={`${props.openLabel}: ${formatTaskTime(run.at, props.locale)}`}
                aria-description={unread ? props.unreadLabel : undefined}
                className="-mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-3 text-left outline-none transition-colors hover:bg-alpha-1 focus-visible:shadow-[var(--sidebar-focus-shadow)]"
              >
                {body}
              </button>
            ) : (
              <div className="-mx-2 flex flex-col gap-1 px-2 py-3">
                <div className="flex items-center justify-between gap-2">{body}</div>
                {run.message && <p className="text-xs leading-4 text-text-muted">{run.message}</p>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
