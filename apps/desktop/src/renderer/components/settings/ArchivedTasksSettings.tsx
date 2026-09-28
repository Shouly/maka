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

// The archive: tasks the sidebar deliberately does not list.
//
// It reads the same catalog the sidebar does — one store, one truth — and
// applies the same projection with `includeArchived`, so an edit-and-resend
// family collapses here exactly as it does in the rail rather than showing
// four rows for one conversation.
//
// Deleting asks the Host first: a family or a task with linked subtasks
// removes more than the row shows, and `previewRemoval` is the only thing that
// knows how much. A preview that fails still gets a confirm — it just cannot
// promise the count.

import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { formatCompactTimestamp } from '@maka/core/relative-time';
import { useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Input } from '../ui/input.js';
import {
  RowActionsMenu,
  SettingsEmpty,
  SettingsTable,
  SettingsTableCell,
  SettingsTableHeadCell,
  SettingsTableRow,
} from './settings-kit.js';
import { SettingsSection } from './settings-row.js';
import { previewSessionRemoval } from '../../bridge/sessions.js';
import { useProjectContext } from '../../hooks/use-workspace.js';
import { useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { buildSessionListModel, type SessionListRow } from '../../store/session-list-model.js';
import { sessionsStore } from '../../store/index.js';
import { toast } from '../../store/toast-store.js';
import { getSettingsTasksCopy } from '../../locales/settings-tasks-copy.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import { getShellCopy } from '../../locales/shell-copy.js';

export function ArchivedTasksSettings() {
  const locale = useUiLocale();
  const copy = getSettingsTasksCopy(locale);
  const shell = getShellCopy(locale).sessionRowActions;
  const sidebar = getSidebarCopy(locale);
  const report = useSettingsErrorReporter();
  const sessions = useStore(sessionsStore, (state) => state.sessions);
  const project = useProjectContext();
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{
    row: SessionListRow;
    count: number | undefined;
  } | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const rows = useMemo(() => {
    const archived = sessions.filter((session) => session.isArchived);
    return buildSessionListModel({
      sessions: archived,
      activeId: undefined,
      filter: query,
      mode: 'time',
      includeArchived: true,
      projects: project.projects,
      copy: sidebar,
      now: Date.now(),
    }).rows;
  }, [sessions, query, project.projects, sidebar]);

  return (
    <>
      <SettingsSection title={copy.listAria}>
        {/* The table toolbar: the search at the left, the count at the right. */}
        <div className="flex items-center justify-between gap-4 pb-2">
          <Input
            value={query}
            aria-label={copy.searchLabel}
            placeholder={copy.searchLabel}
            className="w-full max-w-md"
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="shrink-0 text-sm leading-5 text-text-muted">
            {copy.count(rows.length)}
          </span>
        </div>
        {rows.length === 0 ? (
          <SettingsEmpty
            title={query.trim() ? copy.noMatchTitle : copy.emptyTitle}
            body={query.trim() ? copy.noMatchBody : copy.emptyBody}
          />
        ) : (
          <SettingsTable
            label={copy.listAria}
            head={
              <>
                <SettingsTableHeadCell>{copy.columns.task}</SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-[24%]">
                  {copy.columns.project}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-32">
                  {copy.columns.activity}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-40" srOnly>
                  {copy.restore}
                </SettingsTableHeadCell>
              </>
            }
          >
            {rows.map((row) => (
              <SettingsTableRow key={row.id}>
                <SettingsTableCell className="truncate">{row.displayName}</SettingsTableCell>
                <SettingsTableCell className="truncate text-text-secondary">
                  {row.projectName ?? copy.noProject}
                </SettingsTableCell>
                <SettingsTableCell className="text-text-secondary">
                  {row.activityAt > 0
                    ? formatCompactTimestamp(row.activityAt, Date.now(), locale)
                    : ''}
                </SettingsTableCell>
                <SettingsTableCell className="pr-2">
                  <span className="flex items-center justify-end gap-1">
                    <Button
                      variant="secondary"
                      disabled={working !== null}
                      aria-label={copy.restoreTask(row.displayName)}
                      onClick={() => {
                        setWorking(row.id);
                        void sessionsStore
                          .unarchive(row.id)
                          .catch((error: unknown) => report(shell.unarchiveFailedTitle, error))
                          .finally(() => setWorking(null));
                      }}
                    >
                      {copy.restore}
                    </Button>
                    <RowActionsMenu
                      label={copy.rowActions(row.displayName)}
                      actions={[
                        {
                          label: copy.delete,
                          icon: 'trash',
                          danger: true,
                          disabled: working !== null,
                          onSelect: () => {
                            void previewSessionRemoval(row.id).then(
                              (count) => setPendingDelete({ row, count }),
                              () => setPendingDelete({ row, count: undefined }),
                            );
                          },
                        },
                      ]}
                    />
                  </span>
                </SettingsTableCell>
              </SettingsTableRow>
            ))}
          </SettingsTable>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? shell.deleteTitle(pendingDelete.row.displayName) : ''}
        description={
          pendingDelete
            ? [
                shell.deleteDescription,
                pendingDelete.count === undefined
                  ? shell.deleteSubtaskNoteUncertain()
                  : pendingDelete.count > 1
                    ? shell.deleteSubtaskNote()
                    : undefined,
              ]
                .filter((part): part is string => part !== undefined)
                .join(' ')
            : ''
        }
        confirmText={shell.deleteLabel}
        cancelText={shell.cancelLabel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          const target = pendingDelete;
          if (!target) return;
          try {
            // `requireArchived` is the race guard: a task restored between the
            // confirm and the write is kept, not deleted out from under whoever
            // restored it.
            await sessionsStore.remove(target.row.id, {
              revisionFamily: true,
              requireArchived: true,
            });
            toast({ title: shell.deletedTitle(target.row.displayName), variant: 'success' });
          } catch (error) {
            report(shell.deleteFailedTitle, error);
          } finally {
            setPendingDelete(null);
          }
        }}
      />
    </>
  );
}
