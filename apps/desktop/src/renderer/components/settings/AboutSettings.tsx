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

// What this build is, and how it becomes the next one.
//
// The identity rows are deliberately few: version, build mode, channel and
// runtime. Everything else `DesktopAppInfo` carries (Electron/Node/Chrome
// versions, the workspace path, the commit) belongs in the diagnostic report,
// which is one button away — a settings page that lists twelve version numbers
// is a report nobody can paste.

import { useState } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import { getAppInfo, installUpdate } from '../../bridge/app.js';
import { copyDiagnosticReport } from '../../bridge/diagnostics.js';
import { openExternal } from '../../bridge/external-links.js';
import { useAsync } from '../../hooks/use-async.js';
import { useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { aboutChannelSummary, aboutUpdateRow } from '../../lib/ported/about-update-status.js';
import { updateStore } from '../../store/index.js';
import { toast } from '../../store/toast-store.js';
import { getSettingsCopy } from '../../locales/settings-copy.js';
import { getSettingsPreferencesCopy } from '../../locales/settings-preferences-copy.js';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

const REPOSITORY_URL = 'https://github.com/apache/maka';
const ISSUE_TRACKER_URL = `${REPOSITORY_URL}/issues`;
const RELEASES_URL = `${REPOSITORY_URL}/releases`;

export function AboutSettings(props: {
  host: DesktopRuntimeHostRef | undefined;
  onOpenKeyboardHelp: () => void;
}) {
  const locale = useUiLocale();
  const copy = getSettingsPreferencesCopy(locale).about;
  const own = getSettingsCopy(locale).about;
  const shared = getSettingsSharedCopy(locale);
  const report = useSettingsErrorReporter();
  const host = props.host;
  const info = useAsync(() => getAppInfo(host), [host?.profileId, host?.hostId]);
  const status = useStore(updateStore, (state) => state.status);
  const busy = useStore(updateStore, (state) => state.busy);
  const [copying, setCopying] = useState(false);
  const [installing, setInstalling] = useState(false);
  const row = aboutUpdateRow(status, copy);

  // Called directly rather than through `updateStore.install`, because the
  // install result is a REFUSAL with a reason ('tasks are running'), not a
  // status — the store only carries statuses, so routing it there would drop
  // the one thing the user needs to read.
  const install = () => {
    setInstalling(true);
    void installUpdate({ allowInterruptActiveTasks: false })
      .then((result) => {
        if (!result.ok)
          toast({
            title: own.installFailed,
            description: own.installReasons[result.reason],
            variant: 'destructive',
          });
      })
      .catch((error: unknown) => report(own.installFailed, error))
      .finally(() => setInstalling(false));
  };

  return (
    <>
      <SettingsSection title={own.version}>
        <SettingsRow
          title="Maka"
          description={info.data ? aboutChannelSummary(info.data, copy) : undefined}
          control={
            <span className="text-sm leading-5 text-text-secondary" data-mono="true">
              {info.data
                ? `v${info.data.appVersion}`
                : info.loading
                  ? copy.loading
                  : copy.unavailable}
            </span>
          }
        />
        {info.data && (
          <SettingsRow
            title={own.channel}
            control={
              <span className="text-sm leading-5 text-text-secondary">
                {`${own.build[info.data.buildMode]} · ${info.data.updateChannel}`}
              </span>
            }
          />
        )}
        {info.data && (
          <SettingsRow
            title={own.platform}
            control={
              <span className="text-sm leading-5 text-text-secondary">
                {`${info.data.platform} ${info.data.arch}`}
              </span>
            }
          />
        )}
        {info.error !== undefined && (
          <SettingsRow
            title={copy.loadFailed}
            control={
              <Button variant="secondary" size="sm" onClick={info.reload}>
                {shared.retry}
              </Button>
            }
          />
        )}
      </SettingsSection>

      {/* A development build is not updated by the updater, so offering the
          control would be a button that can only ever fail. */}
      {info.data?.buildMode !== 'dev' && (
        <SettingsSection title={own.updates} description={own.updatesHelp}>
          <SettingsRow
            title={row.label}
            description={row.description ?? undefined}
            control={
              row.action === 'none' ? null : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || installing || row.action === 'checking'}
                  onClick={() => {
                    if (row.action === 'install') install();
                    else if (row.action === 'retry-download')
                      void updateStore.retry().catch((error) => report(own.installFailed, error));
                    else
                      void updateStore.check().catch((error) => report(own.installFailed, error));
                  }}
                >
                  {row.action === 'install'
                    ? installing
                      ? own.installing
                      : own.install
                    : row.action === 'retry-download'
                      ? own.retryDownload
                      : row.action === 'checking'
                        ? copy.checkingForUpdates
                        : copy.checkForUpdates}
                </Button>
              )
            }
          />
        </SettingsSection>
      )}

      <SettingsSection title={copy.supportTitle}>
        <SettingsRow
          title={copy.copyDiagnostics}
          description={`${copy.copyHelp} ${own.logsNote}`}
          control={
            <Button
              variant="secondary"
              size="sm"
              disabled={copying}
              onClick={() => {
                setCopying(true);
                void copyDiagnosticReport({ surface: 'manual' })
                  .then((copied) => {
                    toast({
                      title: copied ? copy.copied : copy.copyFailed,
                      description: copied ? copy.pasteHint : copy.clipboardUnavailable,
                      variant: copied ? 'success' : 'destructive',
                    });
                  })
                  .finally(() => setCopying(false));
              }}
            >
              {copy.copyAction}
            </Button>
          }
        />
        <SettingsRow
          title={copy.reportIssueLabel}
          description={copy.reportIssueHelp}
          control={
            <Button variant="secondary" size="sm" onClick={() => openExternal(ISSUE_TRACKER_URL)}>
              {copy.reportIssueOpen}
            </Button>
          }
        />
        <SettingsRow
          title={copy.keyboardShortcuts}
          description={copy.keyboardShortcutsHelp}
          control={
            <Button variant="secondary" size="sm" onClick={props.onOpenKeyboardHelp}>
              {copy.keyboardShortcutsOpen}
            </Button>
          }
        />
      </SettingsSection>

      <p className="flex flex-wrap items-center gap-2 text-[13px] leading-[18px] text-text-muted">
        <span>{copy.openSourceSummary}</span>
        <button
          type="button"
          className="cursor-pointer text-accent underline-offset-2 hover:underline"
          onClick={() => openExternal(REPOSITORY_URL)}
        >
          {copy.sourceCode}
        </button>
        <button
          type="button"
          className="cursor-pointer text-accent underline-offset-2 hover:underline"
          onClick={() => openExternal(RELEASES_URL)}
        >
          {copy.releaseNotes}
        </button>
      </p>
    </>
  );
}
