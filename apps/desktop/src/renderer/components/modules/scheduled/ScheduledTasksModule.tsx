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

// Scheduled tasks: what will run, when, and what happened last time.
//
// The page reads `scheduledTasksStore`, which the app already started for the
// sidebar's Scheduled band — the band has to be right whether or not this
// page has ever been opened, so there is one subscription and this is a
// reader of it. Every write goes back through the store so the list and the
// badge move together.
//
// The default order is `compareScheduledTaskForDisplay`: active first by next
// run, then paused, then spent. A list of automations sorted by creation date
// buries the one about to fire, which is the only one anybody is looking for —
// so that stays the default even now that the toolbar offers two other orders.
//
// Search and sort narrow the SAME list rather than re-reading it. The store
// holds one snapshot for the whole app, and a page that asked the Host for a
// filtered list would have made the badge and the list disagree about how many
// tasks exist.
//
// There is no status filter. The reference has none, and the four counts it
// would carry ("All 2 · Scheduled 2 · Paused 0 · Completed 0 · Expired 0")
// spend a row of the page telling the user about statuses nothing on the page
// has. The default order already puts the live tasks first.
//
// No Runtime Host prop, unlike the other two module pages. The store's list is
// read host-less (the default Host), and a page that WROTE to the selected
// task's Host while READING the default one would show a task it did not
// create and fail to delete the one it shows.

import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import {
  compareScheduledTaskBySort,
  compareScheduledTaskForDisplay,
  describeScheduledTaskCadence,
  getScheduledTaskCopy,
  normalizeScheduledTaskSearchQuery,
  scheduledTaskDuplicateSeed,
  scheduledTaskEditSeed,
  scheduledTaskMatchesSearch,
  scheduledTaskStatusLabel,
  useUiLocale,
  type ScheduledTaskFormSeed,
} from '@maka/ui';
import type { ScheduledTask } from '@maka/core/scheduled-task';
import { uiLocaleToIntlLocale } from '@maka/core/ui-locale';
import { Button } from '../../ui/button.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import {
  STATUS_CHIP_ICON_SIZE,
  statusChipClass,
  statusChipIconSlotClass,
  statusChipNeutralClass,
  statusChipSuccessClass,
} from '../../ui/status-chip.js';
import { menuDangerItemClass, menuTriggerButtonClass } from '../../ui/menu-variants.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import {
  ListEmptyState,
  ListSearch,
  ListSortMenu,
  ListStaleNotice,
  listCardActionsSlotClass,
  listCardClass,
  listCardDescClass,
  listCardFooterClass,
  listCardGridClass,
  listCardShellClass,
  listCardTitleClass,
  listCardTitleRowClass,
  listToolbarIconButtonClass,
  listToolbarPrimaryButtonClass,
} from '../../ui/list-page.js';
import { ModuleListSkeleton, ModulePage } from '../module-page.js';
import { ScheduleFormDialog, blankScheduledTaskSeed } from './ScheduleFormDialog.js';
import { ScheduledTaskDetail } from './ScheduledTaskDetail.js';
import { cn } from '../../../lib/cn.js';
import { moduleListState } from '../../../lib/module-list-state.js';
import { useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import { toast } from '../../../store/toast-store.js';
import {
  newTaskStore,
  openScheduledTaskDetail,
  scheduledTaskDetailStore,
  scheduledTasksStore,
  sessionsStore,
  settingsStore,
  uiStore,
} from '../../../store/index.js';
import {
  desktopSessionKeyForRun,
  subscribeScheduledTaskFocus,
  takeScheduledTaskFocus,
} from '../../../store/scheduled-tasks-store.js';
import { getSettingsSharedCopy } from '../../../locales/settings-shared-copy.js';
import { getModulesCopy } from '../../../locales/modules-copy.js';
import { getShellRemainingCopy } from '../../../locales/shell-remaining-copy.js';
import {
  getScheduledPageCopy,
  type ScheduledPageCopy,
  type ScheduledPageSort,
} from '../../../locales/scheduled-page-copy.js';

export function ScheduledTasksModule() {
  const locale = useUiLocale();
  const catalog = getScheduledTaskCopy(locale);
  const page = getScheduledPageCopy(locale);
  const modulesShared = getModulesCopy(locale);
  const copy = modulesShared.scheduled;
  const actions = getShellRemainingCopy(locale).scheduledTaskActions;
  const shared = getSettingsSharedCopy(locale);
  const report = useSettingsErrorReporter();
  const tasks = useStore(scheduledTasksStore, (state) => state.data);
  const loading = useStore(scheduledTasksStore, (state) => state.loading);
  const error = useStore(scheduledTasksStore, (state) => state.error);
  // Client-owned, and read from the client snapshot rather than the Host's:
  // the Host projection carries the field but goes stale the moment a
  // client-owned write lands. `undefined` means the snapshot has not arrived —
  // the capability row stays hidden rather than claiming a value it lacks.
  const keepSystemAwake = useStore(
    settingsStore.client,
    (state) => state.data?.system.keepSystemAwake,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [seed, setSeed] = useState<ScheduledTaskFormSeed | null>(null);
  // A stable stand-in for the closed dialog, which ignores it (its own effect
  // early-returns while `open` is false).
  const closedSeed = useMemo(() => blankScheduledTaskSeed(), []);
  const [pendingDelete, setPendingDelete] = useState<ScheduledTask | null>(null);
  // The id, not the task: the detail page must re-read the task from the list
  // every render, or a run that just landed would not show until the page was
  // left and re-entered.
  // Held in the store, not here: the window titlebar draws this task's
  // breadcrumb, and the shell and the page are not inside one another.
  const openId = useStore(scheduledTaskDetailStore, (state) => state.taskId);
  const setOpenId = openScheduledTaskDetail;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ScheduledPageSort>('next-run');

  // The sidebar opens one task by asking for it and then navigating here. It
  // is a subscription rather than a mount-time read because the page stays
  // mounted: a second click from the sidebar would otherwise do nothing at
  // all, the initializer having already run.
  useEffect(() => {
    const pending = takeScheduledTaskFocus();
    if (pending) openScheduledTaskDetail(pending);
    return subscribeScheduledTaskFocus(openScheduledTaskDetail);
  }, []);
  // Leaving the page closes the detail, so coming back lands on the list and
  // the titlebar stops showing a breadcrumb for a page nobody is on.
  useEffect(() => () => openScheduledTaskDetail(null), []);

  const all = useMemo(() => tasks ?? [], [tasks]);
  const matched = useMemo(() => {
    const normalized = normalizeScheduledTaskSearchQuery(query);
    if (!normalized) return all;
    return all.filter((task) => scheduledTaskMatchesSearch(task, normalized, locale));
  }, [all, query, locale]);
  const rows = useMemo(
    () => [...matched].sort((a, b) => compareForSort(a, b, sort, locale)),
    [matched, sort, locale],
  );
  const openTask = openId ? (all.find((task) => task.id === openId) ?? null) : null;

  const display = moduleListState({
    loading,
    error,
    loaded: tasks !== undefined,
    // The FACE is about the catalog, not the current query: a search that
    // matches nothing must not offer "create your first task" to somebody who
    // already has nine.
    count: all.length,
  });
  const retry = (
    <Button variant="outline" size="sm" onClick={() => void scheduledTasksStore.refresh()}>
      {catalog.page.refresh}
    </Button>
  );

  const run = async (key: string, failure: string, operation: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await operation();
      return true;
    } catch (cause) {
      report(failure, cause);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const clockIcon = <Anthropicon name="clock" size={20} />;
  const create = () => setSeed(blankScheduledTaskSeed());

  // A run records the HOST's session id; the renderer keys sessions by
  // {hostId, sessionId}. Handing the raw id to `select` reached the transcript
  // store's key parser and crashed the renderer.
  const openSession = (hostSessionId: string) => {
    const key = desktopSessionKeyForRun(sessionsStore.getState().sessions, hostSessionId);
    if (!key) {
      toast({ title: page.runSessionGone, variant: 'warning' });
      return;
    }
    setOpenId(null);
    uiStore.closeSettings();
    uiStore.navigate({ section: 'sessions' });
    sessionsStore.select(key);
  };

  const setKeepSystemAwake = (next: boolean) => {
    void settingsStore
      .updateClient({ system: { keepSystemAwake: next } })
      .catch((cause: unknown) => report(catalog.page.keepAwakeErrorTitle, cause));
  };

  // Both faces share the dialogs: a task edited or deleted from the detail
  // page has to ask the same way it does from a card, and mounting a second
  // copy under the detail would leave two form dialogs racing one seed.
  const dialogs = (
    <>
      <ScheduleFormDialog
        open={seed !== null}
        // Only built when the dialog is actually opening: `blankScheduledTaskSeed`
        // reads the workspace catalog, and a closed dialog was doing that on
        // every render of the page.
        seed={seed ?? closedSeed}
        saving={busy === 'save'}
        keepSystemAwake={keepSystemAwake}
        onKeepSystemAwakeChange={setKeepSystemAwake}
        onOpenChange={(open) => {
          if (!open) setSeed(null);
        }}
        onCreate={(input) => {
          void (async () => {
            const ok = await run('save', copy.saveFailed, () => scheduledTasksStore.create(input));
            if (ok) setSeed(null);
          })();
        }}
        onUpdate={(id, patch) => {
          void (async () => {
            const ok = await run('save', copy.saveFailed, () =>
              scheduledTasksStore.update(id, patch),
            );
            if (ok) setSeed(null);
          })();
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? copy.deleteTitle(pendingDelete.title) : ''}
        description={copy.deleteDescription}
        confirmText={catalog.page.delete}
        cancelText={shared.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          const target = pendingDelete;
          if (!target) return;
          await run(`delete:${target.id}`, copy.deleteFailed, () =>
            scheduledTasksStore.remove(target.id),
          );
          setPendingDelete(null);
        }}
      />
    </>
  );

  // The detail page replaces the list rather than sitting beside it: it is the
  // same column, and a task that fills it has more to say than the list row it
  // came from.
  if (openTask) {
    return (
      <>
        <ScheduledTaskDetail
          task={openTask}
          busy={busy}
          onToggle={(enabled) =>
            void run(`enable:${openTask.id}`, copy.enableFailed, () =>
              scheduledTasksStore.setEnabled(openTask.id, enabled),
            )
          }
          onRun={() =>
            void (async () => {
              const ok = await run(`trigger:${openTask.id}`, copy.triggerFailed, () =>
                scheduledTasksStore.triggerNow(openTask.id),
              );
              if (ok) toast({ title: copy.triggered(openTask.title), variant: 'success' });
            })()
          }
          onEdit={() => setSeed(scheduledTaskEditSeed(openTask))}
          onDelete={() => setPendingDelete(openTask)}
          onOpenSession={openSession}
        />
        {dialogs}
      </>
    );
  }

  return (
    <ModulePage
      title={catalog.page.title}
      subtitle={copy.description}
      actions={
        <>
          {display.face === 'rows' && (
            <>
              <ListSearch
                value={query}
                onChange={setQuery}
                label={catalog.page.searchLabel}
                placeholder={catalog.page.searchPlaceholder}
              />
              <ListSortMenu<ScheduledPageSort>
                label={page.sortBy}
                value={sort}
                onChange={setSort}
                options={page.sortOptions.map(([value, label]) => ({ value, label }))}
              />
            </>
          )}
          <button
            type="button"
            disabled={busy !== null}
            onClick={create}
            className={listToolbarPrimaryButtonClass}
          >
            {catalog.page.create}
          </button>
        </>
      }
    >
      {display.staleNotice && (
        <ListStaleNotice title={modulesShared.refreshFailed} action={retry} />
      )}
      {display.face === 'loading' ? (
        <ModuleListSkeleton />
      ) : display.face === 'failed' ? (
        <ListEmptyState icon={clockIcon} title={copy.loadFailed} action={retry} />
      ) : display.face === 'empty' ? (
        <ListEmptyState
          icon={clockIcon}
          title={catalog.page.emptyTitle}
          description={catalog.page.emptyBody}
          action={
            <Button variant="secondary" size="sm" onClick={create}>
              {catalog.page.create}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <ListEmptyState
          icon={clockIcon}
          title={catalog.page.noSearchTitle}
          description={catalog.page.noSearchBody}
          action={
            <Button variant="secondary" size="sm" onClick={() => setQuery('')}>
              {catalog.page.clearSearch}
            </Button>
          }
        />
      ) : (
        <div className={listCardGridClass}>
          {rows.map((task) => (
            <ScheduledTaskCard
              key={task.id}
              task={task}
              busy={busy}
              locale={locale}
              catalog={catalog}
              copy={copy}
              page={page}
              onToggle={(enabled) =>
                void run(`enable:${task.id}`, copy.enableFailed, () =>
                  scheduledTasksStore.setEnabled(task.id, enabled),
                )
              }
              onTrigger={() =>
                void (async () => {
                  const ok = await run(`trigger:${task.id}`, copy.triggerFailed, () =>
                    scheduledTasksStore.triggerNow(task.id),
                  );
                  if (ok) toast({ title: copy.triggered(task.title), variant: 'success' });
                })()
              }
              onSnooze={() =>
                void (async () => {
                  const ok = await run(`snooze:${task.id}`, actions.snoozeFailed, () =>
                    scheduledTasksStore.snooze(task.id),
                  );
                  if (ok)
                    toast({
                      title: actions.snoozed,
                      description: task.title,
                      variant: 'success',
                    });
                })()
              }
              onOpen={() => setOpenId(task.id)}
              onEdit={() => setSeed(scheduledTaskEditSeed(task))}
              onDelete={() => setPendingDelete(task)}
            />
          ))}
        </div>
      )}

      {dialogs}
    </ModulePage>
  );
}

type ScheduledCatalog = ReturnType<typeof getScheduledTaskCopy>;
/**
 * What the detail page says a task runs on.
 *
 * A pinned task names the model itself; one that follows says so rather than
 * naming today's default, because the answer will be different tomorrow and a
 * page that printed today's would read as a promise.
 */
type ScheduledModulesCopy = ReturnType<typeof getModulesCopy>['scheduled'];
type Locale = Parameters<typeof scheduledTaskStatusLabel>[1];

/**
 * The list's order.
 *
 * `next-run` delegates to the page's own display comparator rather than
 * re-deriving it, so the default order is the one the page has always had.
 * `name` falls back to that comparator on a tie, which keeps the order total
 * — two tasks with the same title would otherwise swap places between renders.
 */
export function compareForSort(
  a: ScheduledTask,
  b: ScheduledTask,
  sort: ScheduledPageSort,
  locale: Locale,
): number {
  if (sort === 'created') return compareScheduledTaskBySort(a, b, 'created-desc', locale);
  if (sort === 'name') {
    return (
      a.title.localeCompare(b.title, uiLocaleToIntlLocale(locale)) ||
      compareScheduledTaskForDisplay(a, b, locale)
    );
  }
  return compareScheduledTaskForDisplay(a, b, locale);
}

/**
 * Which of the ⋯ menu's state rows a task earns.
 *
 * A separate function because the menu itself only exists while it is open,
 * so this is the only part of the card's behaviour a render can be asked
 * about. Completed and expired are SPENT: the Host refuses every write to
 * either, editing included, and a menu row that fails when chosen is worse
 * than one that is not there. Snooze moves the NEXT fire, so it needs one.
 */
export function scheduledTaskCardActions(task: ScheduledTask): {
  pause: boolean;
  resume: boolean;
  snooze: boolean;
  edit: boolean;
} {
  const live = task.status === 'active';
  const spent = task.status === 'completed' || task.status === 'expired';
  return {
    pause: live,
    resume: task.status === 'paused',
    snooze: live && task.nextFireAt !== null,
    edit: !spent,
  };
}

/**
 * One task as a list card, as the reference draws it: the title, and one chip
 * under it. Nothing else — no description row, no next-run line, no second
 * chip. The card collapses to 78px (16 + 20 + 8 + 18 + 16), which is the
 * whole point of the shape: a screen of scheduled tasks reads as a list of
 * titles, and the chip answers the one question a title leaves open.
 *
 * The chip carries the CADENCE while the task is live ("Every day at 09:00"),
 * and the status word when it is not ("Paused", "Completed", "Expired") —
 * because a task that will not run has no cadence worth stating. That is why
 * the tone is picked here rather than by `scheduledTaskStatusSemantic`: the
 * chip is not showing a status word for a live task, it is showing the
 * schedule, and the reference paints that green.
 *
 * The body is a button onto the task's run history. The ⋯ menu owns
 * everything else, Pause/Resume included — the reference has no switch on the
 * card, and a switch plus a menu row that do the same thing is one control too
 * many.
 */
export function ScheduledTaskCard(props: {
  task: ScheduledTask;
  busy: string | null;
  locale: Locale;
  catalog: ScheduledCatalog;
  copy: ScheduledModulesCopy;
  page: ScheduledPageCopy;
  onToggle: (enabled: boolean) => void;
  onTrigger: () => void;
  onSnooze: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { task, catalog, copy, page, locale } = props;
  const busy = props.busy !== null;
  const live = task.status === 'active';
  const can = scheduledTaskCardActions(task);

  return (
    <article className={listCardShellClass} aria-busy={busy || undefined}>
      <button
        type="button"
        data-card-body
        onClick={props.onOpen}
        aria-label={page.openTask(task.title)}
        className={cn(listCardClass, 'cursor-pointer text-left')}
      >
        <div className={listCardTitleRowClass}>
          <h3 className={cn(listCardTitleClass, !live && 'text-text-muted')}>{task.title}</h3>
        </div>
        {/* The instructions, clamped at three lines with 16px under them —
            measured off the reference's own card, where a three-line
            description is what sets the 162px the grid then equalises every
            card to. `listCardDescClass` already carries both. */}
        <p className={listCardDescClass}>{task.intent.body}</p>
        <div className={listCardFooterClass}>
          <span
            className={cn(statusChipClass, live ? statusChipSuccessClass : statusChipNeutralClass)}
          >
            <span className={statusChipIconSlotClass}>
              <Anthropicon
                name={live ? 'clock' : task.status === 'paused' ? 'pause' : 'checkCircle'}
                size={STATUS_CHIP_ICON_SIZE}
              />
            </span>
            {live
              ? describeScheduledTaskCadence(task, locale)
              : scheduledTaskStatusLabel(task.status, locale)}
          </span>
        </div>
      </button>
      <div className={listCardActionsSlotClass}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={menuTriggerButtonClass}
              aria-label={copy.rowActions(task.title)}
              disabled={busy}
            >
              <Anthropicon name="dotsVertical" size={20} />
            </button>
          </DropdownMenuTrigger>
          {/* Every row carries its glyph, like the rest of the app's menus.
              Opening the task is not one of them: the card itself does that,
              and a row that repeats the click the whole card already is only
              makes the menu longer. */}
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={props.onTrigger}>
              <DropdownMenuItemIcon>
                <Anthropicon name="play" size={20} />
              </DropdownMenuItemIcon>
              {props.busy === `trigger:${task.id}`
                ? catalog.page.triggering
                : catalog.page.triggerNow}
            </DropdownMenuItem>
            {(can.pause || can.resume) && (
              <DropdownMenuItem onSelect={() => props.onToggle(!live)}>
                <DropdownMenuItemIcon>
                  <Anthropicon name={can.pause ? 'pause' : 'play'} size={20} />
                </DropdownMenuItemIcon>
                {can.pause ? page.pause : page.resume}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={!can.snooze} onSelect={props.onSnooze}>
              <DropdownMenuItemIcon>
                <Anthropicon name="timer" size={20} />
              </DropdownMenuItemIcon>
              {props.busy === `snooze:${task.id}` ? catalog.page.snoozing : catalog.page.snooze}
            </DropdownMenuItem>
            {can.edit && (
              <DropdownMenuItem onSelect={props.onEdit}>
                <DropdownMenuItemIcon>
                  <Anthropicon name="edit" size={20} />
                </DropdownMenuItemIcon>
                {catalog.page.edit}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className={menuDangerItemClass} onSelect={props.onDelete}>
              <DropdownMenuItemIcon>
                <Anthropicon name="trash" size={20} />
              </DropdownMenuItemIcon>
              {catalog.page.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
