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

// The updater's eight states, reduced to one row that keeps ONE shape.
//
// Ported from the pre-rewrite `settings/about-update-status.ts`, with the two
// actions the old page did not offer (plan §6 Phase 5a): a downloaded build is
// installed from About, and a download that failed is retried from About. The
// sidebar footer chip owns the same two actions, and both go through the same
// install path, so whichever the user reaches for, one call is made.
//
// The shape is upstream's (#5130) and the reason is width, not taste: the row
// used to put the version in the label and drop the button entirely while the
// updater worked, so the page jumped between states and the label truncated
// against the button at narrow widths. Now the label is a phase word, the
// second line always carries the version and what happens next, and one button
// sits in the same slot — disabled while the updater is working on its own.
//
// Progress is a rounded percent inside the label rather than a bar: the value
// only exists in one of eight states, and a bar that is absent seven-eighths
// of the time reads as a layout bug.

import type { AppUpdateStatus } from '../../bridge/app.js';
import type { DesktopAppInfo } from '../../bridge/app.js';

export type AboutUpdateAction = 'check' | 'retry-download' | 'install';

export interface AboutUpdateRow {
  /** The phase, in one short phrase. Never carries the version. */
  readonly label: string;
  /** Always present: which version, and what happens next. */
  readonly description: string;
  readonly action: AboutUpdateAction;
  /**
   * The updater is doing this by itself — checking, downloading, verifying,
   * installing. The button stays in its slot and goes quiet, rather than
   * vanishing and taking the row's shape with it.
   */
  readonly working: boolean;
}

export interface AboutUpdateCopy {
  readonly checkingForUpdates: string;
  readonly updateIdle: string;
  readonly updateNotAvailable: string;
  readonly updateAvailable: string;
  readonly updateDownloading: (percent: number) => string;
  readonly updateVerifying: string;
  readonly updateDownloaded: string;
  readonly updateInstalling: string;
  readonly updateScheduleHint: string;
  readonly updateFetchingHint: (version: string) => string;
  readonly updateDownloadedHint: (version: string) => string;
  readonly updateInstallingHint: (version: string) => string;
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
  const check = (label: string, working = false): AboutUpdateRow => ({
    label,
    description: copy.updateScheduleHint,
    action: 'check',
    working,
  });
  if (!status) return check(copy.updateIdle);
  switch (status.state) {
    case 'idle':
      return check(copy.updateIdle);
    case 'checking':
      return check(copy.checkingForUpdates, true);
    case 'not-available':
      return check(copy.updateNotAvailable);
    // The updater fetches on its own from here to `downloaded`. The button
    // stays a Check, quiet, so the row does not change shape three times
    // while nothing is being asked of the user.
    case 'available':
      return {
        label: copy.updateAvailable,
        description: copy.updateFetchingHint(status.latestVersion),
        action: 'check',
        working: true,
      };
    case 'downloading':
      return {
        label: copy.updateDownloading(Math.round(status.progress.percent)),
        description: copy.updateFetchingHint(status.latestVersion),
        action: 'check',
        working: true,
      };
    case 'verifying':
      return {
        label: copy.updateVerifying,
        description: copy.updateFetchingHint(status.latestVersion),
        action: 'check',
        working: true,
      };
    case 'downloaded':
      return {
        label: copy.updateDownloaded,
        description: copy.updateDownloadedHint(status.latestVersion),
        action: 'install',
        working: false,
      };
    case 'installing':
      return {
        label: copy.updateInstalling,
        description: copy.updateInstallingHint(status.latestVersion),
        action: 'install',
        working: true,
      };
    case 'error':
      return {
        label: copy.updateFailed[status.operation],
        description: options.errorDetail?.(status.message) ?? status.message,
        // A failed download is retried; a failed check is checked again; a
        // failed install leaves the downloaded build on disk, so the button
        // that can still do something is the restart — pressing it again is
        // the whole recovery, and the next launch installs it anyway.
        action:
          status.operation === 'download'
            ? 'retry-download'
            : status.operation === 'check'
              ? 'check'
              : 'install',
        working: false,
      };
  }
}
