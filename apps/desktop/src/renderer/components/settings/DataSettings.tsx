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
// rather than one "clear local data" button.

import { useState } from 'react';
import { CONFIG_CATEGORIES, type ConfigCategory } from '@maka/storage/config-transfer';
import { clearGlobalInputHistory, useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Switch } from '../ui/switch.js';
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
  const [busy, setBusy] = useState<'export' | 'import' | 'history' | 'drafts' | null>(null);
  const workspacePath = info.data?.workspacePath;

  const openWorkspace = () => {
    setBusy('export');
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
                size="sm"
                disabled={busy !== null || !workspacePath}
                onClick={openWorkspace}
              >
                {copy.openWorkspace}
              </Button>
              <Button
                variant="secondary"
                size="sm"
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
        <SettingsRow
          title={copy.rows.history}
          description={copy.rows.historyDetail}
          control={
            <Button
              variant="destructive"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                clearGlobalInputHistory();
                toast({
                  title: copy.historyCleared,
                  description: copy.historyClearedDetail,
                  variant: 'success',
                });
              }}
            >
              {busy === 'history' ? copy.clearing : copy.clearHistory}
            </Button>
          }
        />
        <SettingsRow
          title={own.drafts}
          description={own.draftsDetail}
          control={
            <Button
              variant="destructive"
              size="sm"
              disabled={busy !== null}
              onClick={() => {
                const cleared = composerInputStore.clearAll();
                toast({
                  title: own.draftsCleared,
                  description: own.draftsClearedDetail(cleared),
                  variant: 'success',
                });
              }}
            >
              {busy === 'drafts' ? own.clearingDrafts : own.clearDrafts}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title={copy.configTitle} description={copy.configHelp}>
        {CONFIG_CATEGORIES.map((category) => (
          <SettingsRow
            key={category}
            title={copy.categories[category].label}
            description={
              <span className="flex flex-col gap-0.5">
                <span>{copy.categories[category].detail}</span>
                {copy.categories[category].sensitive === true && categories.has(category) && (
                  <span className="text-warning">{copy.sensitiveWarning}</span>
                )}
              </span>
            }
            control={
              <Switch
                checked={categories.has(category)}
                aria-label={copy.categories[category].label}
                onCheckedChange={(checked) =>
                  setCategories((current) => {
                    const next = new Set(current);
                    if (checked) next.add(category);
                    else next.delete(category);
                    return next;
                  })
                }
              />
            }
          />
        ))}
        <SettingsRow
          title={copy.conflictAria}
          control={
            <Select
              value={strategy}
              onValueChange={(value) => setStrategy(value as 'skip' | 'overwrite')}
            >
              <SelectTrigger aria-label={copy.conflictAria} className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">{copy.skip}</SelectItem>
                <SelectItem value="overwrite">{copy.overwrite}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title={copy.backupTitle}
          description={copy.backupNotice}
          control={
            <span className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  if (categories.size === 0) {
                    toast({ title: copy.selectCategory, variant: 'destructive' });
                    return;
                  }
                  setBusy('export');
                  void exportConfig({ categories: [...categories] }, host)
                    .then((result) => {
                      if (result.ok)
                        toast({
                          title: copy.exported,
                          description: copy.exportedDetail(
                            result.includedData.map((id) => copy.categories[id].label),
                          ),
                          variant: 'success',
                        });
                      else if (result.reason === 'no_categories')
                        toast({ title: copy.noCategories, variant: 'destructive' });
                      else if (result.reason !== 'canceled')
                        toast({ title: copy.exportFailed, variant: 'destructive' });
                    })
                    .catch((error: unknown) => report(copy.exportFailed, error))
                    .finally(() => setBusy(null));
                }}
              >
                {copy.exportConfig}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                onClick={() => {
                  setBusy('import');
                  void importConfig({ strategy }, host)
                    .then((result) => {
                      if (result.ok)
                        toast({
                          title: copy.imported,
                          description: summarizeImport(result.result, copy),
                          variant: 'success',
                        });
                      else if (result.reason !== 'canceled')
                        toast({
                          title: copy.importFailed,
                          description: copy.invalidFile,
                          variant: 'destructive',
                        });
                    })
                    .catch((error: unknown) => report(copy.importFailed, error))
                    .finally(() => setBusy(null));
                }}
              >
                {copy.importConfig}
              </Button>
            </span>
          }
        />
      </SettingsSection>
    </>
  );
}

/** What an import actually changed, in one line. */
function summarizeImport(
  result: {
    connections?: { created: number; overwritten: number; skipped: number };
    settings?: { applied: boolean };
    credentials?: { applied: number; skipped: number };
    memory?: { applied: boolean };
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
  return parts.length > 0 ? parts.join(' · ') : copy.importSummary.empty;
}
