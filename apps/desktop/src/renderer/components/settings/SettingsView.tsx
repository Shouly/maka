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

// Settings is a dialog over whatever the window was showing, not a page that
// replaces it. Its geometry was measured off a running window (2026-09-27):
// 44.5px clear of the window's top and bottom edges — not the titlebar's
// height; the titlebar is 48 and the dialog's top edge sits 3.5px into it — 1rem clear of its sides, at most
// 1024 × 800, r12 on surface-2 with the light panel shadow; the 192px rail on the left; on the right a 52px bar that
// holds the close button — and, while a page shows one of its sub-views, the
// way back (`useSettingsBack`) — then the page, scrolling under it. A dialog
// opened from a page stacks on this one, which dims itself rather than the
// window getting a second backdrop (`DialogStackContext`).
//
// What is Maka's:
//
//   - there is no routing. The section is `uiStore` state persisted under the
//     unchanged `maka-settings-section-v1`, and the dialog is not a place in
//     the window's back/forward history — the page underneath is.
//   - every page is bound to the Runtime Host the rest of the renderer is
//     reading from (`useScopedRuntimeHost`), so what Settings shows and what
//     the composer is talking to cannot disagree.

import { useCallback, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import type { SettingsSection } from '@maka/core/settings';
import { AboutSettings } from './AboutSettings.js';
import { AccountSettings } from './account/AccountSettings.js';
import { BotChatSettings } from './bots/BotChatSettings.js';
import { ArchivedTasksSettings } from './ArchivedTasksSettings.js';
import { DataSettings } from './DataSettings.js';
import { GeneralSettings } from './GeneralSettings.js';
import { HealthSettings } from './HealthSettings.js';
import { MemorySettings } from './MemorySettings.js';
import { ModelsSettings } from './models/ModelsSettings.js';
import { PermissionsSettings } from './PermissionsSettings.js';
import { SettingsNav } from './SettingsNav.js';
import { Anthropicon } from '../icons/Anthropicon.js';
import { DialogOverlay, DialogPortal, DialogStackContext } from '../ui/dialog.js';
import { SettingsBackButton, SettingsBackProvider, type SettingsBack } from './settings-kit.js';
import { SubagentsSettings } from './SubagentsSettings.js';
import { UsageSettings } from './UsageSettings.js';
import { WebSearchSettings } from './WebSearchSettings.js';
import { WorkspaceSettings } from './WorkspaceSettings.js';
import { resolveSettingsSection } from './settings-sections.js';
import { useScopedRuntimeHost } from '../../hooks/use-workspace.js';
import { uiStore } from '../../store/index.js';
import { getSettingsCopy } from '../../locales/settings-copy.js';
import { getSettingsNavigationCopy } from '../../locales/settings-navigation-copy.js';
import { getUiCopy } from '../../locales/ui-copy.js';

export function SettingsDialog(props: { open: boolean; onOpenKeyboardHelp: () => void }) {
  const locale = useUiLocale();
  const copy = getSettingsCopy(locale);
  const nav = getSettingsNavigationCopy(locale);
  const host = useScopedRuntimeHost();
  const stored = useStore(uiStore, (state) => state.settingsSection);
  const section = resolveSettingsSection(stored);
  // A sub-view's way back, shown in the top bar while it is set.
  const [back, setBack] = useState<SettingsBack | null>(null);
  // Dialogs open on top of this one: while any is, this one dims itself.
  const [stacked, setStacked] = useState(0);
  // The same count, current the moment a dialog enters — before this one
  // re-renders. Radix hands Escape only to the topmost layer, but this layer
  // learns it is no longer topmost on its next render; an Escape in between
  // would close Settings along with the dialog on top of it.
  const stackedNow = useRef(0);
  const enterStack = useCallback(() => {
    stackedNow.current += 1;
    setStacked((count) => count + 1);
    return () => {
      stackedNow.current -= 1;
      setStacked((count) => count - 1);
    };
  }, []);

  return (
    <DialogPrimitive.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) uiStore.closeSettings();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          data-app-dialog=""
          data-maka-contract="settings-surface"
          data-nested-dialog-open={stacked > 0 ? '' : undefined}
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            if (stackedNow.current > 0) event.preventDefault();
          }}
          className="settings-dialog fixed inset-0 z-50 m-auto flex h-[calc(100dvh-89px)] max-h-[50rem] w-[calc(100vw-2rem)] max-w-[1024px] overflow-hidden rounded-xl bg-surface-2 text-sm leading-5 text-text-primary shadow-[var(--dialog-shadow-sm)] outline-none dark:border dark:border-alpha-1 after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-[inherit] after:bg-dialog-overlay after:opacity-0 after:transition-opacity after:duration-200 data-[nested-dialog-open]:after:opacity-100"
        >
          <DialogStackContext.Provider value={enterStack}>
            <SettingsBackProvider value={setBack}>
              <DialogPrimitive.Title className="sr-only">{copy.title}</DialogPrimitive.Title>
              <SettingsNav
                section={section}
                label={copy.navLabel}
                searchPlaceholder={copy.search}
                searchLabel={copy.searchLabel}
                noResults={copy.noResults}
                copy={nav}
                onSelect={(next: SettingsSection) => uiStore.openSettings(next)}
              />
              <div className="flex min-w-0 flex-1 flex-col bg-surface-2">
                <div className="flex h-[3.25rem] shrink-0 items-center justify-between gap-3 pt-3 pr-3 pb-2 pl-6">
                  <div className="flex min-w-0 items-center">
                    {back && <SettingsBackButton back={back} ariaLabel={copy.backTo(back.label)} />}
                  </div>
                  <DialogPrimitive.Close className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-primary transition-colors hover:bg-sidebar-menu-hover focus:outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]">
                    <Anthropicon name="x" size={20} />
                    <span className="sr-only">{getUiCopy(locale).close}</span>
                  </DialogPrimitive.Close>
                </div>
                <div
                  // Keyed by page, so each page opens at its top rather than at
                  // wherever the previous one had been scrolled to.
                  key={section}
                  className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-4"
                  aria-label={copy.contentLabel}
                  data-maka-contract="settings-content"
                  data-settings-section={section}
                >
                  {section === 'account' ? (
                    <AccountSettings />
                  ) : section === 'general' ? (
                    <GeneralSettings host={host} />
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
                  ) : section === 'bot-chat' ? (
                    <BotChatSettings host={host} />
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
            </SettingsBackProvider>
          </DialogStackContext.Provider>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
