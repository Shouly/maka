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

// Where the data lives, how to move it, and how to throw away what is local.
//
// Export and import both open a native dialog in the main process, so
// `cancelled` is a value rather than an error and must not be reported as a
// failure — a user who pressed Escape does not need a red toast about it.
//
// The two "clear" rows are separated on purpose: prompt history is a global
// list of things the user typed, drafts are per-task unsent text. Losing the
// wrong one is not recoverable, so they are two rows and two confirmations
// rather than one "clear local data" button — and neither is a red button on
// the page; the red is in the confirmation.
//
// What to export and how to import are choices that belong to the act, not
// standing settings, so each opens as a dialog with its choices inside rather
// than leaving four switches on the page that look like preferences.

import { useState } from 'react';
import {
  CONFIG_CATEGORIES,
  type ConfigCategory,
  type MemoryImportSkipReason,
} from '@maka/storage/config-transfer';
import { clearGlobalInputHistory, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { checkboxBoxClass, CHECKBOX_TICK_SIZE } from '../ui/checkbox-box.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { SegmentedControl } from '../ui/segmented-control.js';
import { cn } from '../../lib/cn.js';
import { SettingsModal } from './settings-kit.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import { getAppInfo, openPath } from '../../bridge/app.js';
import { exportConfig, importConfig } from '../../bridge/config.js';
import { useAsync } from '../../hooks/use-async.js';
import { useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { composerInputStore } from '../../store/composer-input-store.js';
import { toast } from '../../store/toast-store.js';
import { getDataSettingsCopy } from '../../locales/settings-data-copy.js';
import { getSettingsCopy } from '../../locales/settings-copy.js';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

export function DataSettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const copy = getDataSettingsCopy(locale);
  const own = getSettingsCopy(locale).data;
  const shared = getSettingsSharedCopy(locale);
  const paths = getShellCopy(locale).projectActions;
  const report = useSettingsErrorReporter();
  const host = props.host;
  const info = useAsync(() => getAppInfo(host), [host?.profileId, host?.hostId]);
  const [categories, setCategories] = useState<ReadonlySet<ConfigCategory>>(
    () => new Set<ConfigCategory>(['connections', 'settings']),
  );
  const [strategy, setStrategy] = useState<'skip' | 'overwrite'>('skip');
  const [busy, setBusy] = useState<'open' | 'export' | 'import' | null>(null);
  const [dialog, setDialog] = useState<'export' | 'import' | 'history' | 'drafts' | null>(null);
  const workspacePath = info.data?.workspacePath;
  const closeDialog = (open: boolean) => {
    if (!open && busy === null) setDialog(null);
  };

  const openWorkspace = () => {
    setBusy('open');
    void openPath('workspace', undefined, host)
      .then((result) => {
        if (!result.ok)
          toast({
            title: copy.openFailed(paths.openPathLabels.workspace),
            description: paths.openPathFailures[result.reason],
            variant: 'destructive',
          });
      })
      .catch((error: unknown) => report(copy.openFailed(paths.openPathLabels.workspace), error))
      .finally(() => setBusy(null));
  };

  const runExport = () => {
    setBusy('export');
    void exportConfig({ categories: [...categories] }, host)
      .then((result) => {
        if (result.ok) {
          setDialog(null);
          toast({
            title: copy.exported,
            description: copy.exportedDetail(
              result.includedData.map((id) => copy.categories[id].label),
            ),
            variant: 'success',
          });
        } else if (result.reason === 'no_categories')
          toast({ title: copy.noCategories, variant: 'destructive' });
        // The native save dialog closed without a file: the dialog stays for
        // another go rather than reporting a failure nobody had.
        else if (result.reason !== 'canceled')
          toast({ title: copy.exportFailed, variant: 'destructive' });
      })
      .catch((error: unknown) => report(copy.exportFailed, error))
      .finally(() => setBusy(null));
  };

  const runImport = () => {
    setBusy('import');
    void importConfig({ strategy }, host)
      .then((result) => {
        if (result.ok) {
          setDialog(null);
          toast({
            title: copy.imported,
            description: summarizeImport(result.result, copy),
            variant: 'success',
          });
        } else if (result.reason !== 'canceled')
          toast({
            title: copy.importFailed,
            description: copy.importFailures[result.reason],
            variant: 'destructive',
          });
      })
      .catch((error: unknown) => report(copy.importFailed, error))
      .finally(() => setBusy(null));
  };

  return (
    <>
      <SettingsSection
        title={shared.groups.dataLocation}
        description={shared.groups.dataLocationHelp}
      >
        <SettingsRow
          title={copy.rows.workspace}
          description={
            <span data-mono="true" className="break-all">
              {workspacePath ?? (info.loading ? copy.rows.loading : copy.rows.loadValueFailed)}
            </span>
          }
          control={
            <span className="flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={busy !== null || !workspacePath}
                onClick={openWorkspace}
              >
                {copy.openWorkspace}
              </Button>
              <Button
                variant="secondary"
                disabled={!workspacePath}
                onClick={() => {
                  if (!workspacePath) return;
                  void navigator.clipboard
                    .writeText(workspacePath)
                    .then(() => toast({ title: copy.pathCopied, variant: 'success' }))
                    .catch(() =>
                      toast({
                        title: copy.copyFailed,
                        description: copy.copyFailedDetail,
                        variant: 'destructive',
                      }),
                    );
                }}
              >
                {copy.copyPath}
              </Button>
            </span>
          }
        />
        <SettingsRow title={copy.backupTitle} description={copy.backupNotice} control={null} />
      </SettingsSection>

      <SettingsSection title={copy.localTitle} description={copy.localHelp}>
        <SettingsRow
          title={copy.rows.history}
          description={copy.rows.historyDetail}
          control={
            <Button variant="secondary" onClick={() => setDialog('history')}>
              {copy.clearAction}
            </Button>
          }
        />
        <SettingsRow
          title={own.drafts}
          description={own.draftsDetail}
          control={
            <Button variant="secondary" onClick={() => setDialog('drafts')}>
              {copy.clearAction}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title={copy.configTitle}>
        <SettingsRow
          title={copy.exportRow}
          description={copy.exportRowHelp}
          control={
            <Button variant="secondary" onClick={() => setDialog('export')}>
              {copy.exportAction}
            </Button>
          }
        />
        <SettingsRow
          title={copy.importRow}
          description={copy.importRowHelp}
          control={
            <Button variant="secondary" onClick={() => setDialog('import')}>
              {copy.importAction}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsModal
        open={dialog === 'export'}
        onOpenChange={closeDialog}
        title={copy.exportRow}
        description={copy.configHelp}
        data-maka-contract="config-export"
        footer={
          <>
            <Button variant="secondary" disabled={busy !== null} onClick={() => setDialog(null)}>
              {copy.cancel}
            </Button>
            <Button disabled={busy !== null || categories.size === 0} onClick={runExport}>
              {copy.exportConfirm}
            </Button>
          </>
        }
      >
        <div role="group" aria-label={copy.categoryAria} className="flex flex-col gap-1">
          {CONFIG_CATEGORIES.map((category) => {
            const checked = categories.has(category);
            return (
              <button
                key={category}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() =>
                  setCategories((current) => {
                    const next = new Set(current);
                    if (checked) next.delete(category);
                    else next.add(category);
                    return next;
                  })
                }
                className="group/cb -mx-2 flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-alpha-1 focus-visible:shadow-[var(--sidebar-focus-shadow)]"
              >
                <span className={cn(checkboxBoxClass(checked, 'xs'), 'mt-0.5')} aria-hidden>
                  {checked && <Anthropicon name="check" size={CHECKBOX_TICK_SIZE.xs} />}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm leading-5 text-text-primary">
                    {copy.categories[category].label}
                  </span>
                  <span className="text-[0.8125rem] leading-[1.0625rem] text-text-muted">
                    {copy.categories[category].detail}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        {CONFIG_CATEGORIES.some(
          (category) => copy.categories[category].sensitive === true && categories.has(category),
        ) && (
          <p
            role="status"
            className="rounded-xl bg-warning-subtle px-4 py-3 text-sm leading-5 text-warning"
          >
            {copy.sensitiveWarning}
          </p>
        )}
      </SettingsModal>

      <SettingsModal
        open={dialog === 'import'}
        onOpenChange={closeDialog}
        title={copy.importRow}
        description={copy.importRowHelp}
        data-maka-contract="config-import"
        footer={
          <>
            <Button variant="secondary" disabled={busy !== null} onClick={() => setDialog(null)}>
              {copy.cancel}
            </Button>
            <Button disabled={busy !== null} onClick={runImport}>
              {copy.importConfirm}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium leading-[0.875rem] text-text-primary">
            {copy.importConflict}
          </span>
          <SegmentedControl
            ariaLabel={copy.conflictAria}
            value={strategy}
            onChange={(value: 'skip' | 'overwrite') => setStrategy(value)}
            options={[
              { value: 'skip', label: copy.skip },
              { value: 'overwrite', label: copy.overwrite },
            ]}
          />
          <p className="text-[0.8125rem] leading-[1.0625rem] text-text-muted">
            {copy.importConflictHelp}
          </p>
        </div>
      </SettingsModal>

      <ConfirmDialog
        open={dialog === 'history'}
        onOpenChange={closeDialog}
        title={copy.clearHistoryTitle}
        description={copy.clearHistoryBody}
        confirmText={copy.clearConfirm}
        cancelText={copy.cancel}
        variant="destructive"
        onConfirm={() => {
          clearGlobalInputHistory();
          toast({
            title: copy.historyCleared,
            description: copy.historyClearedDetail,
            variant: 'success',
          });
        }}
      />
      <ConfirmDialog
        open={dialog === 'drafts'}
        onOpenChange={closeDialog}
        title={copy.clearDraftsTitle}
        description={copy.clearDraftsBody}
        confirmText={copy.clearConfirm}
        cancelText={copy.cancel}
        variant="destructive"
        onConfirm={() => {
          const cleared = composerInputStore.clearAll();
          toast({
            title: own.draftsCleared,
            description: own.draftsClearedDetail(cleared),
            variant: 'success',
          });
        }}
      />
    </>
  );
}

/** What an import actually changed, in one line. */
function summarizeImport(
  result: {
    connections?: { created: number; overwritten: number; skipped: number };
    settings?: { applied: boolean };
    credentials?: { applied: number; skipped: number };
    memory?: { applied: true } | { applied: false; reason: MemoryImportSkipReason };
  },
  copy: ReturnType<typeof getDataSettingsCopy>,
): string {
  const parts: string[] = [];
  if (result.connections)
    parts.push(
      copy.importSummary.connections(
        result.connections.created,
        result.connections.overwritten,
        result.connections.skipped,
      ),
    );
  if (result.settings?.applied === true) parts.push(copy.importSummary.settings);
  if (result.credentials)
    parts.push(
      copy.importSummary.credentials(result.credentials.applied, result.credentials.skipped),
    );
  if (result.memory?.applied === true) parts.push(copy.importSummary.memory);
  else if (result.memory) parts.push(copy.importSummary.memorySkipped[result.memory.reason]);
  return parts.length > 0 ? parts.join(' · ') : copy.importSummary.empty;
}
