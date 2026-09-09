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

// The projects on the selected Runtime Host, and the Hosts themselves.
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
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Input } from '../ui/input.js';
import { Skeleton } from '../ui/skeleton.js';
import { statusChipClass, statusChipToneClass } from '../ui/status-chip.js';
import { cn } from '../../lib/cn.js';
import { DirectoryBrowserDialog } from './DirectoryBrowserDialog.js';
import { RuntimeHostProfilesSection } from './RuntimeHostProfilesSection.js';
import { SettingsRow, SettingsSection, settingsFieldWidthClass } from './settings-row.js';
import { getAppInfo } from '../../bridge/app.js';
import {
  addProject,
  archiveProject,
  getProjectSnapshot,
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
import { newTaskStore, settingsStore } from '../../store/index.js';
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

  const capabilities = snapshot.data?.capabilities;
  const projects = snapshot.data?.projects ?? [];
  const defaultProjectId = client.data?.projects.defaultProjectId;
  const homePath = info.data?.homePath;

  return (
    <>
      <RuntimeHostProfilesSection />

      <SettingsSection
        title={copy.section}
        description={copy.sectionHelp}
        action={
          (capabilities?.chooseClientDirectory || capabilities?.chooseHostDirectory) && (
            <Button
              variant="secondary"
              size="sm"
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
          <div className="flex flex-col gap-1 py-6 text-center">
            <p className="text-sm leading-5 text-text-primary">{copy.emptyTitle}</p>
            <p className="text-[13px] leading-[18px] text-text-secondary">{copy.emptyBody}</p>
          </div>
        ) : (
          projects.map((project) => {
            const archived = project.archivedAt !== undefined;
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
                  renaming === project.id ? (
                    <span className="flex items-center gap-2">
                      <Input
                        autoFocus
                        aria-label={copy.renameLabel}
                        className={settingsFieldWidthClass}
                        maxLength={80}
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing) return;
                          if (event.key === 'Escape') setRenaming(null);
                          if (event.key === 'Enter' && renameValue.trim() && host) {
                            setRenaming(null);
                            run(
                              renameProject(project.id, renameValue.trim(), host),
                              copy.renameFailed,
                            );
                          }
                        }}
                      />
                      <Button
                        size="sm"
                        disabled={!renameValue.trim()}
                        onClick={() => {
                          if (!host) return;
                          setRenaming(null);
                          run(
                            renameProject(project.id, renameValue.trim(), host),
                            copy.renameFailed,
                          );
                        }}
                      >
                        {copy.save}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                        {copy.cancel}
                      </Button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Anthropicon name="folder" size={16} className="shrink-0 text-text-muted" />
                      <span className="truncate">{project.name}</span>
                      {isDefault && (
                        <span className={cn(statusChipClass, statusChipToneClass('active'))}>
                          {copy.defaultBadge}
                        </span>
                      )}
                      {archived && (
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
                  )
                }
                description={
                  renaming === project.id ? undefined : (
                    <span data-mono="true" title={path?.title} className="break-all">
                      {path?.text ?? copy.unavailable}
                    </span>
                  )
                }
                control={
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    {capabilities?.setLocalDefault === true && !archived && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || !project.available}
                        title={
                          project.available ? copy.setDefaultTitle : copy.setDefaultDisabledTitle
                        }
                        onClick={() =>
                          run(
                            settingsStore.updateClient({
                              projects: {
                                defaultProjectId: isDefault ? undefined : project.id,
                              },
                            }),
                            copy.setDefaultFailed,
                          )
                        }
                      >
                        {isDefault ? copy.clearDefault : copy.setDefault}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        setRenaming(project.id);
                        setRenameValue(project.name);
                      }}
                    >
                      {copy.rename}
                    </Button>
                    {capabilities?.viewClientPath === true && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || !project.available || !host}
                        onClick={() => {
                          if (!host) return;
                          run(
                            revealProject(project.id, host).then((result) => {
                              if (result.ok) return;
                              // A reveal that could not open says which of the
                              // Host's five reasons it was, not "failed".
                              throw new Error(paths.openPathFailures[result.reason]);
                            }),
                            copy.openFolderFailed,
                          );
                        }}
                      >
                        {copy.openFolder}
                      </Button>
                    )}
                    {!archived && !project.available && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || !host}
                        onClick={() => {
                          if (!host) return;
                          run(relinkProject(project.id, host), copy.actionFailed);
                        }}
                      >
                        {own.relinkProject}
                      </Button>
                    )}
                    {archived ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy || !host}
                        onClick={() => {
                          if (!host) return;
                          run(restoreProject(project.id, host), copy.actionFailed);
                        }}
                      >
                        {own.restoreProject}
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => setPendingRemove(project)}
                      >
                        {copy.remove}
                      </Button>
                    )}
                  </span>
                }
              />
            );
          })
        )}
      </SettingsSection>

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
          run(archiveProject(target.id, host), copy.actionFailed);
        }}
      />
    </>
  );
}
