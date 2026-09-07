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

// The `settings` namespace of the preload bridge, wrapped.
//
// Two stores, not one: `getClient`/`updateClient` are the Desktop client's own
// settings (theme, locale, notifications), `get`/`update` are the Runtime
// Host's (`settings-ownership.ts` decides which owns what). Both have their
// own change subscription, and the renderer mirrors both.

import type {
  AppSettings,
  RuntimeHostAppSettings,
  SettingsTestResult,
  UpdateAppSettingsInput,
  UpdateAppSettingsResult,
  UsageRange,
  UsageStats,
} from '@maka/core/settings';
import type { TestProxyInput } from '@maka/core/settings/network-settings';
import type { DesktopRuntimeHostRef, MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type Settings = MakaBridge['settings'];

export type { AppSettings, RuntimeHostAppSettings, UpdateAppSettingsInput };

const settings = (): Settings => requireNamespace('settings');

export function getClientSettings(): Promise<AppSettings> {
  return settings().getClient();
}

export function getHostSettings(host?: DesktopRuntimeHostRef): Promise<RuntimeHostAppSettings> {
  return settings().get(host);
}

export function updateClientSettings(
  patch: UpdateAppSettingsInput,
): Promise<UpdateAppSettingsResult> {
  return settings().updateClient(patch);
}

export function updateHostSettings(
  patch: UpdateAppSettingsInput,
  host?: DesktopRuntimeHostRef,
): Promise<UpdateAppSettingsResult<RuntimeHostAppSettings>> {
  return settings().update(patch, host);
}

export function subscribeClientSettingsChanged(handler: () => void): () => void {
  return toUnsubscribe(tryNamespace('settings')?.subscribeClientChanged(handler));
}

export function subscribeExternalSettingsChanged(
  handler: () => void,
  host?: DesktopRuntimeHostRef,
): () => void {
  return toUnsubscribe(tryNamespace('settings')?.subscribeExternalChanged(handler, host));
}

export function testNetworkProxy(
  input?: TestProxyInput,
  host?: DesktopRuntimeHostRef,
): Promise<SettingsTestResult> {
  return settings().testNetworkProxy(input, host);
}

export function getUsageStats(
  range?: UsageRange,
  host?: DesktopRuntimeHostRef,
): Promise<UsageStats> {
  return settings().usageStats(range, host);
}
