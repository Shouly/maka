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

// The IM bridges' live status, and the one-at-a-time action gate over them.
//
// Status is read whole once and then patched per platform from the push
// channel; a failed read keeps the last snapshot on screen and records the
// failure beside it, the way every module list here does. The action gate is
// shared state rather than page state because the overview and the detail
// page are the same page in two poses and must disable together.

import { createStore } from 'zustand/vanilla';
import type { BotProvider } from '@maka/core/bot-chat-settings';
import * as api from '../bridge/bots.js';
import type { BotPendingAction, BotPendingActionName } from '../lib/bot-channel-view.js';
import { errorMessage } from './resource-store.js';

export type BotsBridge = Pick<
  typeof api,
  'listBotStatuses' | 'subscribeBotStatusChanges' | 'testBotChannel' | 'restartBot'
>;

export interface BotsState {
  readonly statuses: Record<BotProvider, api.BotStatus> | undefined;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly pending: BotPendingAction | null;
}

export function createBotsStore(bridge: BotsBridge = api) {
  const store = createStore<BotsState>(() => ({
    statuses: undefined,
    loading: false,
    error: undefined,
    pending: null,
  }));
  let generation = 0;

  const applyStatus = (status: api.BotStatus) => {
    store.setState((state) => ({
      error: undefined,
      statuses: {
        ...(state.statuses ?? ({} as Record<BotProvider, api.BotStatus>)),
        [status.platform]: status,
      },
    }));
  };

  const refresh = async (): Promise<boolean> => {
    const request = ++generation;
    store.setState({ loading: true });
    try {
      const statuses = await bridge.listBotStatuses();
      if (request !== generation) return false;
      store.setState({ statuses, loading: false, error: undefined });
      return true;
    } catch (error) {
      if (request !== generation) return false;
      store.setState({ loading: false, error: errorMessage(error) });
      return false;
    }
  };

  return {
    ...store,
    refresh,
    applyStatus,
    /** Read once and follow the push channel until the returned stop is called. */
    observe(): () => void {
      void refresh();
      const stop = bridge.subscribeBotStatusChanges(applyStatus);
      return () => {
        generation++;
        stop();
      };
    },
    /** Claims the action gate; false when another action is still answering. */
    begin(provider: BotProvider, action: BotPendingActionName): boolean {
      if (store.getState().pending !== null) return false;
      store.setState({ pending: { provider, action } });
      return true;
    },
    finish(provider: BotProvider, action: BotPendingActionName): void {
      const current = store.getState().pending;
      if (current && current.provider === provider && current.action === action) {
        store.setState({ pending: null });
      }
    },
    test: (provider: BotProvider) => bridge.testBotChannel(provider),
    async restart(provider: BotProvider): Promise<api.BotStatus> {
      const status = await bridge.restartBot(provider);
      applyStatus(status);
      return status;
    },
  };
}

export const botsStore = createBotsStore();
