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

// Pages Phase 5 owns, standing in for themselves until it does.
//
// Two of them, because they are shaped differently. `SettingsPlaceholder`
// keeps the reference design system's settings geometry — a 220px sticky nav
// beside a content column — so the section list is already navigable and Phase
// 5 fills panels rather than inventing a layout. `ModulePlaceholder` is the
// plain page the module views (skills, MCP, scheduled tasks) will replace.
//
// Both say what they are rather than pretending to work: a page that looks
// finished and does nothing is a bug report waiting to happen.

import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { SETTINGS_SECTIONS, type SettingsSection } from '@maka/core/settings';
import { Anthropicon, type AnthropiconName } from '../icons/Anthropicon.js';
import { Skeleton } from '../ui/skeleton.js';
import { cn } from '../../lib/cn.js';
import { MainHeader } from '../layout/MainHeader.js';
import { getSettingsNavigationCopy } from '../../locales/settings-navigation-copy.js';
import { getSharedPlaceholderCopy } from '../../locales/placeholder-copy.js';
import { uiStore } from '../../store/index.js';

export function ModulePlaceholder(props: {
  title: string;
  icon: AnthropiconName;
  description: string;
}) {
  const copy = getSharedPlaceholderCopy(useUiLocale());
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-maka-contract="module-main">
      <MainHeader
        contextIcon={<Anthropicon name={props.icon} size={16} />}
        title={<span className="px-2.5 font-medium">{props.title}</span>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pt-6">
          <p className="text-sm leading-5 text-text-secondary">{props.description}</p>
          <p className="text-sm leading-5 text-text-muted" role="status">
            {copy.comingInPhase}
          </p>
          <div className="flex flex-col gap-2" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsPlaceholder() {
  const locale = useUiLocale();
  const nav = getSettingsNavigationCopy(locale);
  const copy = getSharedPlaceholderCopy(locale);
  // Restored from localStorage, so it is a string until it is validated here.
  const stored = useStore(uiStore, (state) => state.settingsSection);
  const section: SettingsSection = SETTINGS_SECTIONS.includes(stored as SettingsSection)
    ? (stored as SettingsSection)
    : 'general';
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-maka-contract="settings-surface">
      <MainHeader
        contextIcon={<Anthropicon name="settings" size={16} />}
        title={<span className="px-2.5 font-medium">{copy.settingsTitle}</span>}
      />
      <div className="flex min-h-0 flex-1">
        <nav
          data-maka-contract="settings-sidebar"
          aria-label={copy.settingsTitle}
          className="w-[220px] shrink-0 overflow-y-auto border-r border-hairline px-2 py-3"
        >
          {SETTINGS_SECTIONS.map((id: SettingsSection) => (
            <button
              key={id}
              type="button"
              aria-current={id === section ? 'page' : undefined}
              onClick={() => uiStore.openSettings(id)}
              className={cn(
                'flex h-8 w-full cursor-pointer items-center rounded-lg px-2 text-left text-sm leading-[21px] text-sidebar-text-secondary transition-colors hover:bg-sidebar-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none',
                id === section && 'bg-sidebar-selected text-sidebar-text-primary',
              )}
            >
              <span className="truncate">{nav.sections[id].label}</span>
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 pt-6">
            <h2 className="font-display text-xl leading-7 text-text-primary">
              {nav.sections[section].label}
            </h2>
            <p className="text-sm leading-5 text-text-secondary">
              {nav.sections[section].description}
            </p>
            <p className="text-sm leading-5 text-text-muted" role="status">
              {copy.comingInPhase}
            </p>
            <div className="flex flex-col gap-2 pt-2" aria-hidden="true">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
