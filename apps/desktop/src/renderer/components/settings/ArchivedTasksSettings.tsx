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
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Input } from '../ui/input.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
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
      <SettingsSection
        title={copy.listAria}
        action={
          <Input
            value={query}
            aria-label={copy.searchLabel}
            placeholder={copy.searchLabel}
            className="w-56"
            onChange={(event) => setQuery(event.target.value)}
          />
        }
      >
        {rows.length === 0 ? (
          <div className="flex flex-col gap-1 py-6 text-center">
            <p className="text-sm leading-5 text-text-primary">
              {query.trim() ? copy.noMatchTitle : copy.emptyTitle}
            </p>
            <p className="text-[13px] leading-[18px] text-text-secondary">
              {query.trim() ? copy.noMatchBody : copy.emptyBody}
            </p>
          </div>
        ) : (
          rows.map((row) => (
            <SettingsRow
              key={row.id}
              title={
                <span className="flex items-center gap-2">
                  <Anthropicon name="archive" size={16} className="shrink-0 text-text-muted" />
                  <span className="truncate">{row.displayName}</span>
                </span>
              }
              description={[
                row.projectName ?? copy.noProject,
                row.activityAt > 0
                  ? formatCompactTimestamp(row.activityAt, Date.now(), locale)
                  : undefined,
              ]
                .filter((part): part is string => part !== undefined)
                .join(' · ')}
              control={
                <span className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
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
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={working !== null}
                    onClick={() => {
                      void previewSessionRemoval(row.id).then(
                        (count) => setPendingDelete({ row, count }),
                        () => setPendingDelete({ row, count: undefined }),
                      );
                    }}
                  >
                    {copy.delete}
                  </Button>
                </span>
              }
            />
          ))
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
