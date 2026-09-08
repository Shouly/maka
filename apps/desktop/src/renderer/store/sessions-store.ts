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
import {
  hasNewTaskReloadIntent,
  markNewTaskReloadIntent,
  clearNewTaskReloadIntent,
} from '../lib/ported/new-task-reload-intent.js';
import { errorMessage } from './resource-store.js';
import type { DesktopSessionSummary, SessionRevisionFamilyOptions } from '../bridge/sessions.js';
import type { SessionChangedEvent } from '@maka/core/session';

/**
 * What an authority read of the catalog reports to the stores that keep
 * per-Session transients: `before` captures what they held as the read began,
 * `after` hands them the accepted rows with that capture, so a turn that
 * advanced while the read was in flight is never retired by the older
 * snapshot (upstream `reconcileSettledSessionTransients`).
 */
export interface CatalogReadHook<Observed = unknown> {
  before(): Observed;
  after(sessions: readonly DesktopSessionSummary[], observed: Observed): void;
}

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
  let selectionInitialized = false;
  let lifetime = 0;
  const changeListeners = new Set<(event: SessionChangedEvent) => void>();
  const catalogHooks = new Set<CatalogReadHook>();
  const refresh = async () => {
    const request = ++generation;
    store.setState({ loading: true, error: undefined });
    const observed = [...catalogHooks].map((hook) => [hook, hook.before()] as const);
    try {
      const result = await api.listSessionsWithCoverage();
      if (request !== generation) return;
      // Preload already reconciles offline Hosts, removed profiles and Guest access.
      const rows = result.sessions;
      for (const [hook, capture] of observed) hook.after(rows, capture);
      store.setState((s) => {
        const selected = s.sessions.find((row) => row.id === s.activeId);
        const removed = selected && !rows.some((row) => row.id === selected.id && !row.isArchived);
        // Bootstrap only once. A late catalog refresh must never steal an explicit
        // new-task selection or reopen an archived task.
        const bootstrap = !selectionInitialized && !hasNewTaskReloadIntent();
        selectionInitialized = true;
        const initial = bootstrap
          ? rows
              .filter((row) => !row.isArchived)
              .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))[0]?.id
          : undefined;
        return {
          sessions: rows,
          activeId: removed ? undefined : (s.activeId ?? initial),
          completeHostIds: result.completeHostIds,
          revision: s.revision + 1,
          loading: false,
        };
      });
    } catch (error) {
      if (request === generation) store.setState({ error: errorMessage(error), loading: false });
    }
  };
  const select = (activeId: string | undefined) => {
    selectionInitialized = true;
    if (activeId) clearNewTaskReloadIntent();
    else markNewTaskReloadIntent();
    store.setState({ activeId });
  };
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
    /** Hear every catalog change event before the refresh it triggers. */
    onChange(listener: (event: SessionChangedEvent) => void): () => void {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
    /** Take part in every catalog read; see `CatalogReadHook`. */
    onCatalogRead<Observed>(hook: CatalogReadHook<Observed>): () => void {
      catalogHooks.add(hook as CatalogReadHook);
      return () => {
        catalogHooks.delete(hook as CatalogReadHook);
      };
    },
    start() {
      const owner = ++lifetime;
      const off = api.subscribeSessionChanges((event) => {
        if (owner !== lifetime) return;
        for (const listener of changeListeners) listener(event);
        void refresh();
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
    /**
     * The family options exist on the wire but the Host decides for itself:
     * `sessions:archive` and `sessions:unarchive` resolve the revision family
     * regardless of what is passed. They are forwarded rather than dropped so
     * a caller can still be explicit about what it means.
     */
    async archive(id: string, options?: SessionRevisionFamilyOptions) {
      await api.archiveSession(id, options);
      await refresh();
    },
    async unarchive(id: string, options?: SessionRevisionFamilyOptions) {
      await api.unarchiveSession(id, options);
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
