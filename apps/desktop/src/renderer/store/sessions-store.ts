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

import { createStore } from 'zustand/vanilla';
import * as bridge from '../bridge/sessions.js';
import { errorMessage } from './resource-store.js';
import type { DesktopSessionSummary } from '../bridge/sessions.js';

export interface SessionsState {
  sessions: readonly DesktopSessionSummary[];
  activeId: string | undefined;
  revision: number;
  loading: boolean;
  error: string | undefined;
  completeHostIds: readonly string[];
}
export function createSessionsStore(api = bridge) {
  const store = createStore<SessionsState>(() => ({
    sessions: [],
    activeId: undefined,
    revision: 0,
    loading: false,
    error: undefined,
    completeHostIds: [],
  }));
  let generation = 0;
  let lifetime = 0;
  const refresh = async () => {
    const request = ++generation;
    store.setState({ loading: true, error: undefined });
    try {
      const result = await api.listSessionsWithCoverage();
      if (request !== generation) return;
      // Preload already reconciles offline Hosts, removed profiles and Guest access.
      const rows = result.sessions;
      store.setState((s) => {
        const selected = s.sessions.find((row) => row.id === s.activeId);
        const removed = selected && !rows.some((row) => row.id === selected.id);
        return {
          sessions: rows,
          activeId: removed ? undefined : s.activeId,
          completeHostIds: result.completeHostIds,
          revision: s.revision + 1,
          loading: false,
        };
      });
    } catch (error) {
      if (request === generation) store.setState({ error: errorMessage(error), loading: false });
    }
  };
  const select = (activeId: string | undefined) => store.setState({ activeId });
  const upsert = (row: DesktopSessionSummary) => {
    generation++;
    store.setState((s) => ({
      sessions: [...s.sessions.filter((item) => item.id !== row.id), row],
      loading: false,
    }));
  };
  return {
    ...store,
    refresh,
    select,
    upsert,
    start() {
      const owner = ++lifetime;
      const off = api.subscribeSessionChanges(() => {
        if (owner === lifetime) void refresh();
      });
      void refresh();
      return () => {
        off();
        if (owner === lifetime) {
          lifetime++;
          generation++;
          store.setState({ loading: false });
        }
      };
    },
    async create(input?: Parameters<typeof api.createSession>[0]) {
      const selected = store.getState().activeId;
      const row = await api.createSession(input);
      upsert(row);
      if (store.getState().activeId === selected) select(row.id);
      void refresh();
      return row;
    },
    async rename(id: string, name: string) {
      await api.renameSession(id, name);
      await refresh();
    },
    async archive(id: string) {
      await api.archiveSession(id);
      await refresh();
    },
    async unarchive(id: string) {
      await api.unarchiveSession(id);
      await refresh();
    },
    async flag(id: string, flagged: boolean) {
      await api.setSessionFlagged(id, flagged);
      await refresh();
    },
    async remove(...args: Parameters<typeof api.removeSession>) {
      const result = await api.removeSession(...args);
      await refresh();
      return result;
    },
  };
}
export const sessionsStore = createSessionsStore();
