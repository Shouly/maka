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

import type { PendingE2eFixtureUiState } from '../lib/fixture.js';
import { staticSessionWorkbarTabId } from '../lib/ported/workbar-tabs.js';
import { createStore } from 'zustand/vanilla';
import type { NavSelection, SessionViewMode } from '@maka/ui';
import type { SettingsSection } from '@maka/core/settings';
import { readNavigationState, selectNavigation } from '../lib/ported/nav-selection.js';
import { safeLocalStorageGet, safeLocalStorageSet } from '../lib/ported/browser-storage.js';
import {
  readSessionListWidth,
  readSessionListCollapsed,
  readSessionListViewMode,
  clampSessionListWidth,
  writeSessionListViewMode,
} from '../lib/ported/session-list-layout.js';
import {
  loadWorkbarLayout,
  persistWorkbarLayout,
  reduceWorkbarLayout,
  type WorkbarLayoutAction,
} from '../lib/ported/workbar-layout.js';

export function createUiStore() {
  const store = createStore(() => ({
    navigation: readNavigationState(),
    sidebarCollapsed: readSessionListCollapsed(),
    sidebarWidth: readSessionListWidth(),
    viewMode: readSessionListViewMode(),
    settingsOpen: false,
    settingsSection: safeLocalStorageGet('maka-settings-section-v1') ?? 'general',
    searchOpen: false,
    workbar: loadWorkbarLayout(),
  }));
  return {
    ...store,
    applyFixture(fixture: PendingE2eFixtureUiState) {
      let workbar = reduceWorkbarLayout(store.getState().workbar, {
        type: 'activate-session',
        sessionId: fixture.activeSessionId,
      });
      if (fixture.workbarTab)
        workbar = reduceWorkbarLayout(workbar, {
          type: 'open',
          placement: 'right',
          tab: { id: staticSessionWorkbarTabId(fixture.workbarTab), kind: fixture.workbarTab },
        });
      if (fixture.workbarCollapsed !== undefined)
        workbar = reduceWorkbarLayout(workbar, {
          type: 'collapse',
          placement: 'right',
          collapsed: fixture.workbarCollapsed,
        });
      const section = fixture.sidebarSection;
      const selection: NavSelection | undefined =
        section === 'skills' || section === 'mcp'
          ? { section: 'extensions', module: section }
          : section === 'automations' || section === 'daily-review'
            ? {
                section: 'automations',
                module: section === 'daily-review' ? 'daily-review' : 'scheduled-tasks',
              }
            : section === 'sessions'
              ? { section: 'sessions' }
              : undefined;
      store.setState((state) => ({
        workbar,
        ...(selection ? { navigation: selectNavigation(state.navigation, selection) } : {}),
        ...(fixture.sidebarCollapsed !== undefined
          ? { sidebarCollapsed: fixture.sidebarCollapsed }
          : {}),
        ...(fixture.openSettingsSection
          ? { settingsOpen: true, settingsSection: fixture.openSettingsSection }
          : {}),
        ...(fixture.searchModalOpen !== undefined ? { searchOpen: fixture.searchModalOpen } : {}),
      }));
    },
    navigate(selection: NavSelection) {
      const navigation = selectNavigation(store.getState().navigation, selection);
      store.setState({ navigation });
      safeLocalStorageSet('maka-nav-selection-v1', JSON.stringify(navigation));
    },
    setSidebarCollapsed(sidebarCollapsed: boolean) {
      store.setState({ sidebarCollapsed });
      safeLocalStorageSet('maka-chat-list-collapsed-v1', String(sidebarCollapsed));
    },
    setSidebarWidth(value: number) {
      if (!Number.isFinite(value) || value < 180) return;
      const sidebarWidth = clampSessionListWidth(value);
      store.setState({ sidebarWidth });
      safeLocalStorageSet('maka-chat-list-width-v1', String(sidebarWidth));
    },
    setViewMode(viewMode: SessionViewMode) {
      store.setState({ viewMode });
      writeSessionListViewMode(viewMode);
    },
    openSettings(settingsSection: SettingsSection) {
      store.setState({ settingsOpen: true, settingsSection });
      safeLocalStorageSet('maka-settings-section-v1', settingsSection);
    },
    closeSettings() {
      store.setState({ settingsOpen: false });
    },
    setSearchOpen(searchOpen: boolean) {
      store.setState({ searchOpen });
    },
    dispatchWorkbar(action: WorkbarLayoutAction) {
      if (action.type === 'resize' && !Number.isFinite(action.size)) return;
      const current = store.getState().workbar;
      const workbar = reduceWorkbarLayout(current, action);
      // The reducer returns the same object when nothing moved, and selecting
      // a task dispatches on every change of the active id — writing four
      // localStorage keys for a no-op would make every navigation a disk write.
      if (workbar === current) return;
      store.setState({ workbar });
      persistWorkbarLayout(workbar);
    },
  };
}
export const uiStore = createUiStore();
