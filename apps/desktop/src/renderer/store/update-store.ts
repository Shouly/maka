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

// The app-update status, reduced to what the sidebar footer shows.
//
// Main pushes the whole state machine (idle / checking / available /
// downloading / verifying / downloaded / installing / error). The shell only
// ever surfaces two of them: a downloaded build the user can restart into, and
// a failure they can retry. Everything else is progress the user did not ask
// for and must not be interrupted by — About (Phase 5) shows the rest.

import { createStore } from 'zustand/vanilla';
import type { AppUpdateStatus } from '../bridge/app.js';
import * as api from '../bridge/app.js';
import { errorMessage } from './resource-store.js';

export interface UpdateChip {
  readonly kind: 'downloaded' | 'error';
  readonly version: string | undefined;
  readonly message: string | undefined;
}

export interface UpdateState {
  status: AppUpdateStatus | undefined;
  busy: boolean;
  error: string | undefined;
}

/** The footer chip, or nothing when the update state is not the user's business. */
export function updateChipOf(status: AppUpdateStatus | undefined): UpdateChip | undefined {
  if (!status) return undefined;
  if (status.state === 'downloaded')
    return { kind: 'downloaded', version: status.latestVersion, message: undefined };
  if (status.state === 'error')
    return { kind: 'error', version: status.latestVersion, message: status.message };
  return undefined;
}

export function createUpdateStore(bridge = api) {
  const store = createStore<UpdateState>(() => ({
    status: undefined,
    busy: false,
    error: undefined,
  }));
  let lifetime = 0;
  const run = async (operation: () => Promise<AppUpdateStatus | unknown>) => {
    const owner = lifetime;
    store.setState({ busy: true, error: undefined });
    try {
      const status = await operation();
      if (owner === lifetime && status && typeof status === 'object' && 'state' in status)
        store.setState({ status: status as AppUpdateStatus });
    } catch (error) {
      if (owner === lifetime) store.setState({ error: errorMessage(error) });
    } finally {
      if (owner === lifetime) store.setState({ busy: false });
    }
  };
  return {
    ...store,
    start(): () => void {
      const owner = ++lifetime;
      const off = bridge.subscribeUpdateStatus((status) => {
        if (owner === lifetime) store.setState({ status });
      });
      void bridge
        .getUpdateStatus()
        .then((status) => {
          if (owner === lifetime) store.setState({ status });
        })
        .catch((error) => {
          if (owner === lifetime) store.setState({ error: errorMessage(error) });
        });
      return () => {
        off();
        if (owner === lifetime) lifetime++;
      };
    },
    check: () => run(() => bridge.checkForUpdates()),
    retry: () => run(() => bridge.retryUpdateDownload()),
    // Installing is deliberately NOT here. `run` keeps only answers carrying a
    // `state`, and the install's interesting answer is a refusal —
    // `{ ok: false, reason }` — which it would drop on the floor, leaving a
    // pressed button with nothing to show for it. It lives in
    // `hooks/use-update-install`, which asks the user about the refusal.
  };
}

export const updateStore = createUpdateStore();
