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
import { MakaWordmark, useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import { getAppInfo } from '../../bridge/app.js';
import { copyDiagnosticReport } from '../../bridge/diagnostics.js';
import { openExternal } from '../../bridge/external-links.js';
import { useAsync } from '../../hooks/use-async.js';
import { useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { aboutChannelSummary, aboutUpdateRow } from '../../lib/ported/about-update-status.js';
import { useUpdateInstall } from '../../hooks/use-update-install.js';
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
  const row = aboutUpdateRow(status, copy);
  // The same install the sidebar footer's chip runs, confirmation and all.
  const update = useUpdateInstall();

  const provenance = (
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
  );

  return (
    <>
      {/* The one page whose subject is the app itself leads with the mark
          (upstream #5130). The version then stands alone — the mark already
          says "Maka" — and as plain text rather than a heading, so it does not
          rank beside the group titles below it. Provenance moves up here with
          it: it describes this build, and trailing the page made it read as a
          footnote to the support links. */}
      <SettingsSection>
        <div className="flex flex-col gap-4 pb-2">
          <MakaWordmark width={112} title="Maka" className="text-fill-brand" />
          {info.data ? (
            <div className="flex min-w-0 flex-col gap-1">
              <p
                className="text-sm font-semibold leading-5 text-text-primary"
                data-mono="true"
              >{`v${info.data.appVersion}`}</p>
              <p className="text-[13px] leading-[18px] text-text-secondary">
                {aboutChannelSummary(info.data, copy)}
              </p>
            </div>
          ) : (
            <p className="text-[13px] leading-[18px] text-text-secondary" role="status">
              {info.loading ? copy.loading : copy.unavailable}
            </p>
          )}
          {provenance}
        </div>
      </SettingsSection>

      <SettingsSection title={own.buildTitle}>
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
              // One button, one slot, in every state: it goes quiet while the
              // updater works on its own rather than leaving and taking the
              // row's shape with it.
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || update.installing || row.working}
                onClick={() => {
                  if (row.action === 'install') update.install();
                  else if (row.action === 'retry-download')
                    void updateStore.retry().catch((error) => report(own.installFailed, error));
                  else void updateStore.check().catch((error) => report(own.installFailed, error));
                }}
              >
                {row.action === 'install'
                  ? update.installing
                    ? own.installing
                    : own.install
                  : row.action === 'retry-download'
                    ? own.retryDownload
                    : row.working
                      ? copy.checkingForUpdates
                      : copy.checkForUpdates}
              </Button>
            }
          />
          {update.confirmation}
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
    </>
  );
}
