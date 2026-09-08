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

// What every settings page needs from the stores, in one place.
//
// The two settings snapshots are read separately on purpose. The Runtime Host
// projection carries the client-owned fields too, but it goes stale the moment
// a client-owned write lands (main pushes `settings:clientChanged`, not the
// external one), so a page that read the locale out of the Host snapshot would
// show the old language until something unrelated refreshed it. Client-owned
// values come from the client snapshot; Host-owned values from the Host's.

import { useCallback } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { settingsStore } from '../store/index.js';
import { toast } from '../store/toast-store.js';
import { localizedShellErrorMessage } from '../locales/shell-copy.js';
import { getShellCopy } from '../locales/shell-copy.js';

export function useClientSettings() {
  return {
    data: useStore(settingsStore.client, (state) => state.data),
    loading: useStore(settingsStore.client, (state) => state.loading),
    error: useStore(settingsStore.client, (state) => state.error),
  };
}

export function useHostSettings() {
  return {
    data: useStore(settingsStore.host, (state) => state.data),
    loading: useStore(settingsStore.host, (state) => state.loading),
    error: useStore(settingsStore.host, (state) => state.error),
  };
}

/**
 * Report a failed settings action. A settings write that silently does nothing
 * is indistinguishable from one that worked, which is why every page routes
 * its failures through here rather than swallowing them.
 */
export function useSettingsErrorReporter(): (title: string, error: unknown) => void {
  const locale = useUiLocale();
  const retry = getShellCopy(locale).actions.retry;
  return useCallback(
    (title: string, error: unknown) => {
      toast({
        title,
        description: localizedShellErrorMessage(error, retry, locale),
        variant: 'destructive',
      });
    },
    [locale, retry],
  );
}
