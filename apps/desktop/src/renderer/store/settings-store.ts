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

import * as api from '../bridge/settings.js';
import type { DesktopRuntimeHostRef } from '../bridge/projects.js';
import { createResourceStore } from './resource-store.js';

export function createSettingsStore(bridge = api) {
  const client = createResourceStore<api.AppSettings>();
  const host = createResourceStore<api.RuntimeHostAppSettings>();
  // Serialize patches: a later user intent must be written after an earlier one.
  let clientWrites: Promise<unknown> = Promise.resolve();
  const hostWrites = new Map<string, Promise<void>>();
  return {
    client,
    host,
    startClient() {
      return client.connect(
        () => bridge.getClientSettings(),
        bridge.subscribeClientSettingsChanged,
      );
    },
    observeHost(owner: DesktopRuntimeHostRef) {
      return host.connect(
        () => bridge.getHostSettings(owner),
        (refresh) => bridge.subscribeExternalSettingsChanged(refresh, owner),
      );
    },
    updateClient(patch: api.UpdateAppSettingsInput) {
      const mutate = client.captureMutation();
      const result = clientWrites.then(() => mutate(() => bridge.updateClientSettings(patch)));
      clientWrites = result.catch(() => undefined);
      return result;
    },
    updateHost(patch: api.UpdateAppSettingsInput, owner: DesktopRuntimeHostRef) {
      const mutate = host.captureMutation();
      const key = JSON.stringify([owner.profileId, owner.hostId]);
      const result = (hostWrites.get(key) ?? Promise.resolve()).then(() =>
        mutate(() => bridge.updateHostSettings(patch, owner)),
      );
      const settled = result.then(
        () => {},
        () => {},
      );
      hostWrites.set(key, settled);
      void settled.then(() => {
        if (hostWrites.get(key) === settled) hostWrites.delete(key);
      });
      return result;
    },
  };
}
export const settingsStore = createSettingsStore();
