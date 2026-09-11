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
// sidebar's Automations badge — the badge has to be right whether or not this
// page has ever been opened, so there is one subscription and this is a
// reader of it. Every write goes back through the store so the list and the
// badge move together.
//
// The default order is `compareScheduledTaskForDisplay`: active first by next
// run, then paused, then spent. A list of automations sorted by creation date
// buries the one about to fire, which is the only one anybody is looking for —
// so that stays the default even now that the toolbar offers two other orders.
//
// Search, sort and the status pills all narrow the SAME list rather than
// re-reading it. The store holds one snapshot for the whole app, and a page
// that asked the Host for a filtered list would have made the badge and the
// list disagree about how many tasks exist.
//
// No Runtime Host prop, unlike the other two module pages. The store's list is
// read host-less (the default Host), and a page that WROTE to the selected
// task's Host while READING the default one would show a task it did not
// create and fail to delete the one it shows.

import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import {
  compareScheduledTaskBySort,
  compareScheduledTaskForDisplay,
  createScheduledTaskFormSeed,
  formatScheduledTaskDeliveryTargetLabel,
  formatScheduledTaskRecurrence,
  formatTaskCountdown,
  formatTaskTime,
  getScheduledTaskCopy,
  normalizeScheduledTaskSearchQuery,
  runStatusLabel,
  scheduledTaskDuplicateSeed,
  scheduledTaskEditSeed,
  scheduledTaskMatchesSearch,
  scheduledTaskRunStatusSemantic,
  scheduledTaskStatusLabel,
  scheduledTaskStatusSemantic,
  useUiLocale,
  type ScheduledTaskFormSeed,
} from '@maka/ui';
import type { ScheduledTask, ScheduledTaskStatus } from '@maka/core/scheduled-task';
import { uiLocaleToIntlLocale } from '@maka/core/ui-locale';
import { Button } from '../../ui/button.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { Switch } from '../../ui/switch.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { menuDangerItemClass, menuTriggerButtonClass } from '../../ui/menu-variants.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import {
  ListEmptyState,
  ListFilterPills,
  ListSearch,
  ListSortMenu,
  ListStaleNotice,
  listCardActionsSlotClass,
  listCardDescClass,
  listCardFooterClass,
  listCardGridClass,
  listCardShellClass,
  listCardSurfaceClass,
  listCardTitleClass,
  listToolbarIconButtonClass,
  listToolbarPrimaryButtonClass,
} from '../../ui/list-page.js';
import { ModuleListSkeleton, ModulePage } from '../module-page.js';
import { RunHistoryDialog } from './RunHistoryDialog.js';
import { ScheduleFormDialog } from './ScheduleFormDialog.js';
import { ScheduleTemplates } from './ScheduleTemplates.js';
import { cn } from '../../../lib/cn.js';
import { moduleListState } from '../../../lib/module-list-state.js';
import { useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import { toast } from '../../../store/toast-store.js';
import {
  scheduledTasksStore,
  sessionsStore,
  settingsStore,
  uiStore,
} from '../../../store/index.js';
import { getSettingsSharedCopy } from '../../../locales/settings-shared-copy.js';
import { getModulesCopy } from '../../../locales/modules-copy.js';
import { getShellRemainingCopy } from '../../../locales/shell-remaining-copy.js';
import {
  getScheduledPageCopy,
  type ScheduledPageSort,
} from '../../../locales/scheduled-page-copy.js';

type ScheduledFilter = 'all' | ScheduledTaskStatus;

const FILTER_ORDER: readonly ScheduledFilter[] = [
  'all',
  'active',
  'paused',
  'completed',
  'expired',
];

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
  const [pendingDelete, setPendingDelete] = useState<ScheduledTask | null>(null);
  const [pendingClear, setPendingClear] = useState<ScheduledTask | null>(null);
  // The id, not the task: the dialog must re-read the task from the list every
  // render, or clearing its history would leave the runs it just deleted on
  // screen until the dialog was closed and reopened.
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ScheduledPageSort>('next-run');
  const [filter, setFilter] = useState<ScheduledFilter>('all');

  const all = useMemo(() => tasks ?? [], [tasks]);
  const matched = useMemo(() => {
    const normalized = normalizeScheduledTaskSearchQuery(query);
    if (!normalized) return all;
    return all.filter((task) => scheduledTaskMatchesSearch(task, normalized, locale));
  }, [all, query, locale]);
  const counts = useMemo(() => {
    const byStatus = (status: ScheduledTaskStatus) =>
      matched.filter((task) => task.status === status).length;
    return {
      all: matched.length,
      active: byStatus('active'),
      paused: byStatus('paused'),
      completed: byStatus('completed'),
      expired: byStatus('expired'),
    } satisfies Record<ScheduledFilter, number>;
  }, [matched]);
  const rows = useMemo(() => {
    const visible = filter === 'all' ? matched : matched.filter((task) => task.status === filter);
    return [...visible].sort((a, b) => compareForSort(a, b, sort, locale));
  }, [matched, filter, sort, locale]);
  const historyTask = historyId ? (all.find((task) => task.id === historyId) ?? null) : null;

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
  const create = () => setSeed(createScheduledTaskFormSeed());

  const openSession = (sessionId: string) => {
    setHistoryId(null);
    uiStore.closeSettings();
    uiStore.navigate({ section: 'sessions' });
    sessionsStore.select(sessionId);
  };

  const setKeepSystemAwake = (next: boolean) => {
    void settingsStore
      .updateClient({ system: { keepSystemAwake: next } })
      .catch((cause: unknown) => report(catalog.page.keepAwakeErrorTitle, cause));
  };

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
          {keepSystemAwake !== undefined && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={catalog.page.pageSettings}
                  className={listToolbarIconButtonClass}
                >
                  <Anthropicon name="dotsVertical" size={20} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* Scheduled work is driven by an in-process timer, which a
                    sleeping machine freezes: the reminder then never fires and
                    says nothing about why. This is the one switch that decides
                    it, so it belongs on this page rather than in Settings. */}
                <DropdownMenuCheckboxItem
                  checked={keepSystemAwake}
                  onCheckedChange={setKeepSystemAwake}
                >
                  {catalog.page.keepAwake}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
      ) : (
        <>
          <ListFilterPills
            label={catalog.page.filtersAriaLabel}
            value={filter}
            onChange={setFilter}
            options={FILTER_ORDER.map((value) => ({
              value,
              label: value === 'all' ? catalog.page.all : catalog.status[value],
              count: counts[value],
            }))}
          />
          {rows.length === 0 ? (
            <ListEmptyState
              icon={clockIcon}
              title={query ? catalog.page.noSearchTitle : catalog.page.noFilterTitle}
              description={query ? catalog.page.noSearchBody : catalog.page.noFilterBody}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  {query ? catalog.page.clearSearch : catalog.page.all}
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
                  runHistoryLabel={page.viewRunHistory}
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
                  onHistory={() => setHistoryId(task.id)}
                  onEdit={() => setSeed(scheduledTaskEditSeed(task))}
                  onDuplicate={() => setSeed(scheduledTaskDuplicateSeed(task, locale))}
                  onDelete={() => setPendingDelete(task)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {(display.face === 'rows' || display.face === 'empty') && (
        <ScheduleTemplates disabled={busy !== null} onUse={setSeed} />
      )}

      <ScheduleFormDialog
        open={seed !== null}
        seed={seed ?? createScheduledTaskFormSeed()}
        saving={busy === 'save'}
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

      <RunHistoryDialog
        task={historyTask}
        clearing={historyTask !== null && busy === `clear:${historyTask.id}`}
        onOpenChange={(open) => {
          if (!open) setHistoryId(null);
        }}
        onClear={() => {
          // One modal at a time: the confirm takes the screen the history had,
          // and a confirm stacked on a dialog traps focus in the wrong one.
          if (!historyTask) return;
          setPendingClear(historyTask);
          setHistoryId(null);
        }}
        onOpenSession={openSession}
      />

      <ConfirmDialog
        open={pendingClear !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClear(null);
        }}
        title={pendingClear ? actions.clearTitle(pendingClear.title) : ''}
        description={actions.clearDescription}
        confirmText={actions.clear}
        cancelText={shared.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          const target = pendingClear;
          if (!target) return;
          const ok = await run(`clear:${target.id}`, actions.clearFailed, () =>
            scheduledTasksStore.clearRunHistory(target.id),
          );
          setPendingClear(null);
          if (ok) toast({ title: actions.cleared, description: target.title, variant: 'success' });
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
    </ModulePage>
  );
}

type ScheduledCatalog = ReturnType<typeof getScheduledTaskCopy>;
type ScheduledModulesCopy = ReturnType<typeof getModulesCopy>['scheduled'];
type Locale = Parameters<typeof formatTaskTime>[1];

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
 * One task as a list card (Claude's Scheduled page): title, the schedule and
 * where it delivers, the next run, then the status chips in the footer. The
 * switch and the ⋯ menu sit in the card's top-right corner.
 */
export function ScheduledTaskCard(props: {
  task: ScheduledTask;
  busy: string | null;
  locale: Locale;
  catalog: ScheduledCatalog;
  copy: ScheduledModulesCopy;
  runHistoryLabel: string;
  onToggle: (enabled: boolean) => void;
  onTrigger: () => void;
  onSnooze: () => void;
  onHistory: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { task, catalog, copy, locale } = props;
  const busy = props.busy !== null;
  const lastRun = task.runs[0];
  const next =
    task.nextFireAt === null
      ? catalog.page.unscheduled
      : `${catalog.page.nextRun(formatTaskTime(task.nextFireAt, locale))} · ${formatTaskCountdown(
          task.nextFireAt,
          locale,
        )}`;
  // Snooze moves the NEXT fire. A paused task has none, and a spent one will
  // never have another, so for those the Host would refuse what the menu
  // offered.
  const snoozable = task.status === 'active' && task.nextFireAt !== null;

  return (
    <article className={listCardShellClass} aria-busy={busy || undefined}>
      <div className={cn(listCardSurfaceClass, 'min-h-36')}>
        <h3 className={cn(listCardTitleClass, 'pr-20')}>{task.title}</h3>
        <p className={listCardDescClass}>
          {formatScheduledTaskRecurrence(task, locale)} ·{' '}
          {formatScheduledTaskDeliveryTargetLabel(task.effect, locale)}
        </p>
        <p className="text-xs leading-4 text-text-muted">{next}</p>
        {lastRun && (
          <p className="text-xs leading-4 text-text-muted">
            {catalog.page.recentRun(formatTaskTime(lastRun.at, locale))}
          </p>
        )}
        <div className={listCardFooterClass}>
          <span
            className={cn(
              statusChipClass,
              statusChipToneClass(scheduledTaskStatusSemantic(task.status)),
            )}
          >
            {scheduledTaskStatusLabel(task.status, locale)}
          </span>
          {lastRun && (
            <span
              className={cn(
                statusChipClass,
                statusChipToneClass(scheduledTaskRunStatusSemantic(lastRun.outcome)),
              )}
            >
              {runStatusLabel(lastRun.outcome, locale)}
            </span>
          )}
        </div>
      </div>
      <div className={cn(listCardActionsSlotClass, 'opacity-100')}>
        <Switch
          aria-label={copy.enableTask(task.title)}
          checked={task.status === 'active'}
          disabled={busy || task.status === 'completed' || task.status === 'expired'}
          onCheckedChange={props.onToggle}
        />
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
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={props.onTrigger}>
              {props.busy === `trigger:${task.id}`
                ? catalog.page.triggering
                : catalog.page.triggerNow}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!snoozable} onSelect={props.onSnooze}>
              {props.busy === `snooze:${task.id}` ? catalog.page.snoozing : catalog.page.snooze}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onHistory}>{props.runHistoryLabel}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onEdit}>{catalog.page.edit}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onDuplicate}>
              {catalog.page.duplicate}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={menuDangerItemClass} onSelect={props.onDelete}>
              {catalog.page.delete}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}
