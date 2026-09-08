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

// Settings, as a page in the content column — not a modal.
//
// The geometry is the reference design's `setting/layout.tsx`: a scrolling
// column with the page title in it and a `220px` sticky nav beside the
// content, capped at `max-w-6xl`. What is Maka's:
//
//   - the window titlebar above it does not change (plan §2.12). The sidebar
//     stays usable and its toggle never moves; only the content column is
//     replaced, and the titlebar's identity slot says "Settings" while it is.
//   - there is no routing. relx navigates with `next/link`; here the section
//     is `uiStore` state persisted under the unchanged `maka-settings-section-v1`,
//     because the main process forbids navigation outright.
//   - every page is bound to the Runtime Host the rest of the renderer is
//     reading from (`useScopedRuntimeHost`), so what Settings shows and what
//     the composer is talking to cannot disagree.

import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import type { SettingsSection } from '@maka/core/settings';
import { AboutSettings } from './AboutSettings.js';
import { AppearanceSettings } from './AppearanceSettings.js';
import { ArchivedTasksSettings } from './ArchivedTasksSettings.js';
import { DataSettings } from './DataSettings.js';
import { GeneralSettings } from './GeneralSettings.js';
import { HealthSettings } from './HealthSettings.js';
import { MemorySettings } from './MemorySettings.js';
import { ModelsSettings } from './models/ModelsSettings.js';
import { PermissionsSettings } from './PermissionsSettings.js';
import { SettingsNav } from './SettingsNav.js';
import { SubagentsSettings } from './SubagentsSettings.js';
import { UsageSettings } from './UsageSettings.js';
import { WebSearchSettings } from './WebSearchSettings.js';
import { WorkspaceSettings } from './WorkspaceSettings.js';
import { resolveSettingsSection } from './settings-sections.js';
import { useScopedRuntimeHost } from '../../hooks/use-workspace.js';
import { uiStore } from '../../store/index.js';
import { getSettingsCopy } from '../../locales/settings-copy.js';
import { getSettingsNavigationCopy } from '../../locales/settings-navigation-copy.js';

export function SettingsView(props: { onOpenKeyboardHelp: () => void }) {
  const locale = useUiLocale();
  const copy = getSettingsCopy(locale);
  const nav = getSettingsNavigationCopy(locale);
  const host = useScopedRuntimeHost();
  const stored = useStore(uiStore, (state) => state.settingsSection);
  const section = resolveSettingsSection(stored);

  return (
    <div
      data-maka-contract="settings-surface"
      className="relative min-w-0 flex-1 overflow-y-auto bg-surface-1"
    >
      <header className="mx-auto flex h-12 w-full max-w-7xl md:h-24 md:items-end">
        <div className="flex w-full items-center justify-between gap-4 px-4 md:px-8">
          <h1 className="min-w-0 font-display text-2xl font-medium leading-8 text-text-primary [font-variation-settings:'opsz'_24]">
            <span className="truncate">{copy.title}</span>
          </h1>
        </div>
      </header>

      <div className="mx-auto mt-4 w-full max-w-7xl flex-1 px-4 md:px-8 lg:mt-6">
        <div className="my-4 grid w-full max-w-6xl grid-cols-1 gap-x-8 md:my-8 md:grid-cols-[220px_minmax(0px,1fr)]">
          <SettingsNav
            section={section}
            label={copy.navLabel}
            copy={nav}
            onSelect={(next: SettingsSection) => uiStore.openSettings(next)}
          />
          <div
            className="min-w-0 pb-10"
            aria-label={copy.contentLabel}
            data-maka-contract="settings-content"
            data-settings-section={section}
          >
            {section === 'general' ? (
              <GeneralSettings host={host} />
            ) : section === 'appearance' ? (
              <AppearanceSettings />
            ) : section === 'projects' ? (
              <WorkspaceSettings host={host} />
            ) : section === 'models' ? (
              <ModelsSettings host={host} />
            ) : section === 'subagents' ? (
              <SubagentsSettings host={host} />
            ) : section === 'memory' ? (
              <MemorySettings host={host} />
            ) : section === 'search' ? (
              <WebSearchSettings host={host} />
            ) : section === 'usage' ? (
              <UsageSettings host={host} />
            ) : section === 'archived-tasks' ? (
              <ArchivedTasksSettings />
            ) : section === 'data' ? (
              <DataSettings host={host} />
            ) : section === 'permissions' ? (
              <PermissionsSettings host={host} />
            ) : section === 'health' ? (
              <HealthSettings host={host} />
            ) : section === 'about' ? (
              <AboutSettings host={host} onOpenKeyboardHelp={props.onOpenKeyboardHelp} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
