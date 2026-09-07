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

// The `app` namespace of the preload bridge, wrapped.
//
// Build/runtime identity, the app-icon picker, the updater, and the handful of
// "open this in the OS" actions — all of which are main's to perform because
// the renderer has no filesystem and no shell.

import type { AppIconChoice, AppIconTarget } from '@maka/core/settings';
import type {
  AppUpdateInstallRequest,
  AppUpdateInstallResult,
  AppUpdateStatus,
} from '../../shared/app-update.js';
import type {
  DesktopAppInfo,
  DesktopRuntimeHostRef,
  MakaBridge,
} from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type App = MakaBridge['app'];

export type { DesktopAppInfo, AppUpdateStatus, AppUpdateInstallRequest, AppUpdateInstallResult };
export type OpenPathResult = Awaited<ReturnType<App['openPath']>>;
export type ProjectGitInfoResult = Awaited<ReturnType<App['resolveProjectGitInfo']>>;
export type ArtifactSaveOutcome = Awaited<ReturnType<App['saveArtifactAs']>>;

const app = (): App => requireNamespace('app');

export function getAppInfo(host?: DesktopRuntimeHostRef): Promise<DesktopAppInfo> {
  return app().info(host);
}

export function getSessionProjectInfo(sessionId: string): ReturnType<App['sessionProjectInfo']> {
  return app().sessionProjectInfo(sessionId);
}

export function openPath(
  key: 'workspace' | 'skills' | 'memory' | 'project',
  sessionId?: string,
  host?: DesktopRuntimeHostRef,
): Promise<OpenPathResult> {
  return app().openPath(key, sessionId, host);
}

export function resolveProjectGitInfo(
  projectPath: string,
  host?: DesktopRuntimeHostRef,
): Promise<ProjectGitInfoResult> {
  return app().resolveProjectGitInfo(projectPath, host);
}

export function openArtifactPath(sessionId: string, artifactId: string): Promise<OpenPathResult> {
  return app().openArtifactPath(sessionId, artifactId);
}

export function saveArtifactAs(
  sessionId: string,
  artifactId: string,
): Promise<ArtifactSaveOutcome> {
  return app().saveArtifactAs(sessionId, artifactId);
}

// ── app icon ───────────────────────────────────────────────────────────────

export function listIconPreviews(): ReturnType<App['iconPreviews']> {
  return app().iconPreviews();
}

export function selectAppIcon(
  icon: AppIconChoice,
  target?: AppIconTarget,
): ReturnType<App['selectIcon']> {
  return app().selectIcon(icon, target);
}

export function importAppIcon(): ReturnType<App['importIcon']> {
  return app().importIcon();
}

export function removeAppIcon(icon: AppIconChoice): ReturnType<App['removeIcon']> {
  return app().removeIcon(icon);
}

// ── updates ────────────────────────────────────────────────────────────────

export function getUpdateStatus(): Promise<AppUpdateStatus> {
  return app().updateStatus();
}

export function checkForUpdates(): Promise<AppUpdateStatus> {
  return app().checkForUpdates();
}

export function retryUpdateDownload(): Promise<AppUpdateStatus> {
  return app().retryUpdateDownload();
}

export function installUpdate(input: AppUpdateInstallRequest): Promise<AppUpdateInstallResult> {
  return app().installUpdate(input);
}

export function subscribeUpdateStatus(handler: (status: AppUpdateStatus) => void): () => void {
  return toUnsubscribe(tryNamespace('app')?.subscribeUpdateStatus(handler));
}
