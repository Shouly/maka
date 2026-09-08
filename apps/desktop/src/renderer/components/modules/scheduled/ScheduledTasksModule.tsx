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
// Ordering is `compareScheduledTaskForDisplay`: active first by next run, then
// paused, then spent. A list of automations sorted by creation date buries the
// one about to fire, which is the only one anybody is looking for.
//
// No Runtime Host prop, unlike the other two module pages. The store's list is
// read host-less (the default Host), and a page that WROTE to the selected
// task's Host while READING the default one would show a task it did not
// create and fail to delete the one it shows.

import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import {
  compareScheduledTaskForDisplay,
  createScheduledTaskFormSeed,
  formatScheduledTaskDeliveryTargetLabel,
  formatScheduledTaskRecurrence,
  formatTaskCountdown,
  formatTaskTime,
  getScheduledTaskCopy,
  runStatusLabel,
  scheduledTaskEditSeed,
  scheduledTaskRunStatusSemantic,
  scheduledTaskStatusLabel,
  scheduledTaskStatusSemantic,
  useUiLocale,
  type ScheduledTaskFormSeed,
} from '@maka/ui';
import type { ScheduledTask } from '@maka/core/scheduled-task';
import { Button } from '../../ui/button.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { Switch } from '../../ui/switch.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { menuDangerItemClass, menuTriggerButtonClass } from '../../ui/menu-variants.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { SettingsRow, SettingsSection } from '../../settings/settings-row.js';
import { ModuleEmpty, ModuleLead, ModuleListSkeleton, ModulePage } from '../module-page.js';
import { ScheduleFormDialog } from './ScheduleFormDialog.js';
import { cn } from '../../../lib/cn.js';
import { useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import { toast } from '../../../store/toast-store.js';
import { scheduledTasksStore } from '../../../store/index.js';
import { getSettingsSharedCopy } from '../../../locales/settings-shared-copy.js';
import { getModulesCopy } from '../../../locales/modules-copy.js';

export function ScheduledTasksModule() {
  const locale = useUiLocale();
  const catalog = getScheduledTaskCopy(locale);
  const copy = getModulesCopy(locale).scheduled;
  const shared = getSettingsSharedCopy(locale);
  const report = useSettingsErrorReporter();
  const tasks = useStore(scheduledTasksStore, (state) => state.data);
  const loading = useStore(scheduledTasksStore, (state) => state.loading);
  const error = useStore(scheduledTasksStore, (state) => state.error);
  const [busy, setBusy] = useState<string | null>(null);
  const [seed, setSeed] = useState<ScheduledTaskFormSeed | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScheduledTask | null>(null);

  const rows = useMemo(
    () => [...(tasks ?? [])].sort((a, b) => compareScheduledTaskForDisplay(a, b, locale)),
    [tasks, locale],
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

  return (
    <ModulePage
      title={catalog.page.title}
      icon="clock"
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => setSeed(createScheduledTaskFormSeed())}
          >
            {catalog.page.create}
          </Button>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={catalog.page.refresh}
            disabled={busy !== null}
            onClick={() => void scheduledTasksStore.refresh()}
          >
            <Anthropicon name="arrowClockwise" size={16} />
          </Button>
        </>
      }
    >
      <ModuleLead>{copy.description}</ModuleLead>

      <SettingsSection title={catalog.page.tasks}>
        {loading && rows.length === 0 ? (
          <div className="py-3">
            <ModuleListSkeleton />
          </div>
        ) : error ? (
          <div className="py-3">
            <ModuleEmpty
              title={copy.loadFailed}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void scheduledTasksStore.refresh()}
                >
                  {catalog.page.refresh}
                </Button>
              }
            />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-3">
            <ModuleEmpty
              title={catalog.page.emptyTitle}
              body={catalog.page.emptyBody}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => setSeed(createScheduledTaskFormSeed())}
                >
                  {catalog.page.create}
                </Button>
              }
            />
          </div>
        ) : (
          rows.map((task) => (
            <ScheduledTaskRow
              key={task.id}
              task={task}
              busy={busy}
              locale={locale}
              catalog={catalog}
              copy={copy}
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
              onEdit={() => setSeed(scheduledTaskEditSeed(task))}
              onDelete={() => setPendingDelete(task)}
            />
          ))
        )}
      </SettingsSection>

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

function ScheduledTaskRow(props: {
  task: ScheduledTask;
  busy: string | null;
  locale: Parameters<typeof formatTaskTime>[1];
  catalog: ScheduledCatalog;
  copy: ScheduledModulesCopy;
  onToggle: (enabled: boolean) => void;
  onTrigger: () => void;
  onEdit: () => void;
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

  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{task.title}</span>
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
        </span>
      }
      description={
        <span className="flex flex-col gap-0.5">
          <span>
            {formatScheduledTaskRecurrence(task, locale)} ·{' '}
            {formatScheduledTaskDeliveryTargetLabel(task.effect, locale)}
          </span>
          <span className="text-text-muted">{next}</span>
          {lastRun && (
            <span className="text-text-muted">
              {catalog.page.recentRun(formatTaskTime(lastRun.at, locale))}
            </span>
          )}
        </span>
      }
      control={
        <span className="flex items-center gap-2">
          <Switch
            aria-label={copy.enableTask(task.title)}
            // `expired` and `completed` are spent: there is nothing left to
            // arm, and a switch that flips back on its own is worse than none.
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
              <DropdownMenuItem onSelect={props.onEdit}>{catalog.page.edit}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className={menuDangerItemClass} onSelect={props.onDelete}>
                {catalog.page.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      }
    />
  );
}
