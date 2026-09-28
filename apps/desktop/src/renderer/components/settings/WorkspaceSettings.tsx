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

// Settings › Projects, two sections of plain rows. Working folders: where a
// task with no project gets a folder of its own (a client setting, moved with
// the OS folder picker), and whether each project's instruction files are
// read (`host-default-settings.tsx`). Projects: the folders you added, each
// with its ⋯ menu; the default one wears a chip. Which computer runs the
// tasks (the Runtime Host profiles) is not shown: tasks run here.
//
// The catalog is per-Host, and its CAPABILITIES are too: a Host that owns its
// own filesystem cannot show a client path or open a folder here, and the
// "add" affordance is a native dialog on this machine but a directory browser
// on a remote one. Every control reads `capabilities` rather than assuming
// what the local Host can do.
//
// Archiving, not deleting: `projects.archive` keeps the record (and every task
// that points at it) and only takes the row out of the pickers. That is why
// the destructive action reads "remove" but the row can come back.

import { useCallback, useEffect, useState } from 'react';
import type { ProjectRecord } from '@maka/core/project';
import { useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Input } from '../ui/input.js';
import { Skeleton } from '../ui/skeleton.js';
import { statusChipClass, statusChipToneClass } from '../ui/status-chip.js';
import { cn } from '../../lib/cn.js';
import { DirectoryBrowserDialog } from './DirectoryBrowserDialog.js';
import { WorkspaceInstructionsRow } from './host-default-settings.js';
import {
  RowActionsMenu,
  SettingsEmpty,
  SettingsModal,
  SettingsModalField,
  type RowAction,
} from './settings-kit.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import { getAppInfo } from '../../bridge/app.js';
import {
  addProject,
  getProjectSnapshot,
  getTaskFolderDefault,
  pickTaskFolder,
  relinkProject,
  renameProject,
  restoreProject,
  revealProject,
  subscribeProjectChanges,
  type DesktopProjectSnapshot,
  type DesktopRuntimeHostRef,
} from '../../bridge/projects.js';
import { useAsync } from '../../hooks/use-async.js';
import { useClientSettings, useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { projectPathDisplay } from '../../lib/ported/project-path-display.js';
import { archiveProjectAndClearDefault, newTaskStore, settingsStore } from '../../store/index.js';
import { getSettingsCopy } from '../../locales/settings-copy.js';
import { getSettingsProjectsCopy } from '../../locales/settings-projects-copy.js';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';
import { getShellCopy } from '../../locales/shell-copy.js';

export function WorkspaceSettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const copy = getSettingsProjectsCopy(locale);
  const own = getSettingsCopy(locale).workspace;
  const shared = getSettingsSharedCopy(locale);
  const paths = getShellCopy(locale).projectActions;
  const report = useSettingsErrorReporter();
  const client = useClientSettings();
  const host = props.host;
  const [browser, setBrowser] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingRemove, setPendingRemove] = useState<ProjectRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const snapshot = useAsync<DesktopProjectSnapshot>(
    host ? () => getProjectSnapshot(undefined, host) : undefined,
    [host?.profileId, host?.hostId],
  );
  const info = useAsync(host ? () => getAppInfo(host) : undefined, [host?.profileId, host?.hostId]);
  const taskFolderDefault = useAsync(getTaskFolderDefault, []);
  const reload = snapshot.reload;
  useEffect(() => {
    if (!host) return;
    return subscribeProjectChanges(() => reload(), undefined, host);
  }, [host?.profileId, host?.hostId, reload]);

  const run = useCallback(
    (operation: Promise<unknown>, failure: string) => {
      setBusy(true);
      void operation
        .then(() => {
          reload();
          void newTaskStore.refresh();
        })
        .catch((error: unknown) => report(failure, error))
        .finally(() => setBusy(false));
    },
    [reload, report],
  );

  const commitRename = () => {
    const name = renameValue.trim();
    if (!renaming || !name || !host) return;
    setRenaming(null);
    run(renameProject(renaming, name, host), copy.renameFailed);
  };

  const capabilities = snapshot.data?.capabilities;
  const projects = snapshot.data?.projects ?? [];
  const defaultProjectId = client.data?.projects.defaultProjectId;
  const customTaskFolder = client.data?.projects.taskFolderRoot;
  const taskFolder = customTaskFolder ?? taskFolderDefault.data;
  const homePath = info.data?.homePath;

  // A project's ⋯ menu: default, rename, open, then relink / restore / remove.
  const projectActions = (project: ProjectRecord, isDefault: boolean): RowAction[] => {
    const archived = project.archivedAt !== undefined;
    const actions: RowAction[] = [];
    if (capabilities?.setLocalDefault === true && !archived)
      actions.push({
        label: isDefault ? copy.clearDefault : copy.setDefault,
        icon: isDefault ? 'xCircle' : 'checkCircle',
        disabled: busy || !project.available,
        onSelect: () =>
          run(
            settingsStore.updateClient({
              projects: { defaultProjectId: isDefault ? undefined : project.id },
            }),
            copy.setDefaultFailed,
          ),
      });
    actions.push({
      label: copy.rename,
      icon: 'edit',
      disabled: busy,
      onSelect: () => {
        setRenaming(project.id);
        setRenameValue(project.name);
      },
    });
    if (capabilities?.viewClientPath === true)
      actions.push({
        label: copy.openFolder,
        icon: 'folderOpen',
        disabled: busy || !project.available || !host,
        onSelect: () => {
          if (!host) return;
          run(
            revealProject(project.id, host).then((result) => {
              if (result.ok) return;
              // A reveal that could not open says which of the Host's five
              // reasons it was, not "failed".
              throw new Error(paths.openPathFailures[result.reason]);
            }),
            copy.openFolderFailed,
          );
        },
      });
    if (!archived && !project.available)
      actions.push({
        label: own.relinkProject,
        icon: 'link',
        disabled: busy || !host,
        onSelect: () => {
          if (!host) return;
          run(relinkProject(project.id, host), copy.actionFailed);
        },
      });
    if (archived)
      actions.push({
        label: own.restoreProject,
        icon: 'arrowCounterClockwise',
        disabled: busy || !host,
        onSelect: () => {
          if (!host) return;
          run(restoreProject(project.id, host), copy.actionFailed);
        },
      });
    else
      actions.push({
        label: copy.remove,
        icon: 'trash',
        danger: true,
        disabled: busy,
        onSelect: () => setPendingRemove(project),
      });
    return actions;
  };

  return (
    <>
      <SettingsSection title={copy.foldersSection}>
        {capabilities?.viewClientPath === true && taskFolder && (
          // Where a task with no project gets its own folder; the OS picker
          // only picks, and the choice is a client setting like the default
          // project.
          <SettingsRow
            title={copy.defaultDirectory}
            description={
              <>
                {copy.defaultDirectoryHelp}
                <span data-mono="true" title={taskFolder} className="mt-0.5 block truncate">
                  {projectPathDisplay(taskFolder, { homePath }).text}
                </span>
              </>
            }
            control={
              <div className="flex items-center gap-2">
                {customTaskFolder !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-[7px] text-sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        settingsStore.updateClient({ projects: { taskFolderRoot: undefined } }),
                        copy.changeFolderFailed,
                      )
                    }
                  >
                    {copy.resetFolder}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-[7px] text-sm"
                  disabled={busy}
                  onClick={() =>
                    run(
                      pickTaskFolder(taskFolder).then((picked) =>
                        picked === null
                          ? undefined
                          : settingsStore.updateClient({ projects: { taskFolderRoot: picked } }),
                      ),
                      copy.changeFolderFailed,
                    )
                  }
                >
                  {copy.changeFolder}
                </Button>
              </div>
            }
          />
        )}
        <WorkspaceInstructionsRow host={host} />
      </SettingsSection>

      <SettingsSection
        title={copy.section}
        description={copy.sectionHelp}
        action={
          (capabilities?.chooseClientDirectory || capabilities?.chooseHostDirectory) && (
            <Button
              variant="secondary"
              size="sm"
              className="rounded-[7px] text-sm"
              disabled={busy || !host}
              onClick={() => {
                if (!host) return;
                // A Host that owns its own filesystem cannot be browsed with
                // this machine's file dialog.
                if (capabilities?.chooseHostDirectory) setBrowser(true);
                else run(addProject(host), copy.actionFailed);
              }}
            >
              {copy.addProject}
            </Button>
          )
        }
      >
        {!host ? (
          <SettingsRow title={shared.runtimeHostUnavailable} control={null} />
        ) : snapshot.loading && !snapshot.data ? (
          <div className="flex flex-col gap-2 py-3" role="status" aria-label={shared.loading}>
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : snapshot.error !== undefined ? (
          <SettingsRow
            title={shared.settingsLoadFailed}
            control={
              <Button variant="secondary" size="sm" onClick={reload}>
                {shared.retry}
              </Button>
            }
          />
        ) : projects.length === 0 ? (
          <SettingsEmpty title={copy.emptyTitle} body={copy.emptyBody} />
        ) : (
          projects.map((project) => {
            const isDefault =
              capabilities?.setLocalDefault === true && project.id === defaultProjectId;
            const path =
              capabilities?.viewClientPath && project.preferredPath
                ? projectPathDisplay(project.preferredPath, { homePath })
                : undefined;
            return (
              <SettingsRow
                key={project.id}
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{project.name}</span>
                    {isDefault && (
                      <span className={cn(statusChipClass, statusChipToneClass('active'))}>
                        {copy.defaultBadge}
                      </span>
                    )}
                    {project.archivedAt !== undefined && (
                      <span className={cn(statusChipClass, statusChipToneClass('neutral'))}>
                        {own.archivedBadge}
                      </span>
                    )}
                    {!project.available && (
                      <span className={cn(statusChipClass, statusChipToneClass('error'))}>
                        {copy.unavailable}
                      </span>
                    )}
                  </span>
                }
                description={
                  <span data-mono="true" title={path?.title} className="block truncate">
                    {path?.text ?? copy.unavailable}
                  </span>
                }
                control={
                  <RowActionsMenu
                    label={own.projectActions(project.name)}
                    actions={projectActions(project, isDefault)}
                  />
                }
              />
            );
          })
        )}
      </SettingsSection>

      <SettingsModal
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) setRenaming(null);
        }}
        size="sm"
        title={copy.rename}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              {copy.cancel}
            </Button>
            <Button disabled={!renameValue.trim() || !host} onClick={commitRename}>
              {copy.save}
            </Button>
          </>
        }
      >
        <SettingsModalField label={copy.renameLabel} htmlFor="project-rename">
          <Input
            id="project-rename"
            autoFocus
            maxLength={80}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') commitRename();
            }}
          />
        </SettingsModalField>
      </SettingsModal>

      <DirectoryBrowserDialog
        open={browser}
        host={host}
        hostName={undefined}
        onOpenChange={setBrowser}
        onRegistered={() => {
          reload();
          void newTaskStore.refresh();
        }}
      />

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title={copy.removeConfirmTitle}
        description={copy.removeConfirmBody}
        confirmText={copy.removeConfirm}
        cancelText={copy.removeCancel}
        variant="destructive"
        onConfirm={() => {
          const target = pendingRemove;
          setPendingRemove(null);
          if (!target || !host) return;
          run(archiveProjectAndClearDefault(target.id, host), copy.actionFailed);
        }}
      />
    </>
  );
}
