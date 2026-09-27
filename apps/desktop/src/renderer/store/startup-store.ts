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

// The launch, as the renderer knows it: a read on start, then main's pushes.
// Started by StartupHandoffLayer at the app root; until its first read lands
// the launch counts as unknown, which holds the app like "not ready" does.

import { createStore } from 'zustand/vanilla';
import * as api from '../bridge/startup.js';
import type { DesktopStartupState } from '../bridge/startup.js';

export type StartupBridge = Pick<typeof api, 'getStartupState' | 'subscribeStartup'>;

export interface StartupStoreState {
  /** `undefined` until the first read or push lands. */
  readonly startup: DesktopStartupState | undefined;
}

export function createStartupStore(bridge: StartupBridge = api) {
  const store = createStore<StartupStoreState>(() => ({ startup: undefined }));
  let lifetime = 0;
  let pushes = 0;
  return {
    ...store,
    start(): () => void {
      const owner = ++lifetime;
      let off = () => {};
      try {
        off = bridge.subscribeStartup((startup) => {
          if (owner !== lifetime) return;
          pushes++;
          store.setState({ startup });
        });
      } catch {
        // No startup bridge (outside Electron): nothing to wait for.
      }
      const seen = pushes;
      void Promise.resolve()
        .then(() => bridge.getStartupState())
        .then(
          (startup) => {
            // A push newer than this read has already said more.
            if (owner === lifetime && pushes === seen) store.setState({ startup });
          },
          () => {
            // Unreadable: treat the launch as done rather than hold the app forever.
            if (owner === lifetime && store.getState().startup === undefined) {
              store.setState({
                startup: { ready: true, phase: 'renderer', startedAt: Date.now() },
              });
            }
          },
        );
      return () => {
        off();
        if (owner === lifetime) lifetime++;
      };
    },
  };
}

export const startupStore = createStartupStore();
