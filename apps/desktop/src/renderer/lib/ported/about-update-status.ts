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

// The updater's eight states, reduced to one row and one button.
//
// Ported from the pre-rewrite `settings/about-update-status.ts`, with the two
// actions the old page did not offer (plan §6 Phase 5a): a downloaded build is
// installed from About, and a download that failed is retried from About. The
// sidebar footer chip still owns the same two actions; both go through
// `updateStore`, so whichever the user reaches for, one call is made.
//
// Progress is a rounded percent inside the label rather than a bar: the value
// only exists in one of eight states, and a bar that is absent seven-eighths
// of the time reads as a layout bug.

import type { AppUpdateStatus } from '../../bridge/app.js';
import type { DesktopAppInfo } from '../../bridge/app.js';

export type AboutUpdateAction = 'check' | 'checking' | 'retry-download' | 'install' | 'none';

export interface AboutUpdateRow {
  readonly label: string;
  readonly description: string | null;
  readonly action: AboutUpdateAction;
}

export interface AboutUpdateCopy {
  readonly checkingForUpdates: string;
  readonly updateIdle: string;
  readonly updateNotAvailable: string;
  readonly updateAvailable: (version: string) => string;
  readonly updateDownloading: (version: string, percent: number) => string;
  readonly updateVerifying: (version: string) => string;
  readonly updateDownloaded: (version: string) => string;
  readonly updateDownloadedHint: string;
  readonly updateInstalling: (version: string) => string;
  readonly updateFailed: Record<'check' | 'download' | 'install', string>;
  readonly channelSummaries: Record<'dev' | 'nightly' | 'release', string>;
}

/** One sentence saying what following this build's channel means. */
export function aboutChannelSummary(
  info: Pick<DesktopAppInfo, 'buildMode' | 'updateChannel'>,
  copy: Pick<AboutUpdateCopy, 'channelSummaries'>,
): string {
  return copy.channelSummaries[info.buildMode === 'dev' ? 'dev' : info.updateChannel];
}

export function aboutUpdateRow(
  status: AppUpdateStatus | undefined,
  copy: AboutUpdateCopy,
  options: { readonly errorDetail?: (message: string) => string } = {},
): AboutUpdateRow {
  if (!status) return { label: copy.updateIdle, description: null, action: 'check' };
  switch (status.state) {
    case 'idle':
      return { label: copy.updateIdle, description: null, action: 'check' };
    case 'checking':
      return { label: copy.checkingForUpdates, description: null, action: 'checking' };
    case 'not-available':
      return { label: copy.updateNotAvailable, description: null, action: 'check' };
    case 'available':
      return {
        label: copy.updateAvailable(status.latestVersion),
        description: null,
        action: 'none',
      };
    case 'downloading':
      return {
        label: copy.updateDownloading(status.latestVersion, Math.round(status.progress.percent)),
        description: null,
        action: 'none',
      };
    case 'verifying':
      return {
        label: copy.updateVerifying(status.latestVersion),
        description: null,
        action: 'none',
      };
    case 'downloaded':
      return {
        label: copy.updateDownloaded(status.latestVersion),
        description: copy.updateDownloadedHint,
        action: 'install',
      };
    case 'installing':
      return {
        label: copy.updateInstalling(status.latestVersion),
        description: null,
        action: 'none',
      };
    case 'error':
      return {
        label: copy.updateFailed[status.operation],
        description: options.errorDetail?.(status.message) ?? status.message,
        // A failed download is retried; a failed check is checked again; a
        // failed install has nothing left to press here — the downloaded
        // build is still on disk and the next launch installs it.
        action:
          status.operation === 'download'
            ? 'retry-download'
            : status.operation === 'check'
              ? 'check'
              : 'none',
      };
  }
}
