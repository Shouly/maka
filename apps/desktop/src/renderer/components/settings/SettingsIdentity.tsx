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

// Who the content column is showing, while it is showing Settings.
//
// The titlebar keeps its shape (plan §2.12): the same three columns, the same
// controls in the same places, only the identity slot changes — "Settings"
// followed by the page the nav has selected, so the window says what it is
// without a second header bar under the strip.

import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { resolveSettingsSection } from './settings-sections.js';
import { uiStore } from '../../store/index.js';
import { getSettingsCopy } from '../../locales/settings-copy.js';
import { getSettingsNavigationCopy } from '../../locales/settings-navigation-copy.js';

export function SettingsIdentity() {
  const locale = useUiLocale();
  const copy = getSettingsCopy(locale);
  const nav = getSettingsNavigationCopy(locale);
  const section = resolveSettingsSection(useStore(uiStore, (state) => state.settingsSection));
  return (
    <div
      data-maka-contract="titlebar-identity"
      className="flex min-w-0 items-center gap-1.5 px-1.5 text-sidebar-text-primary"
    >
      <Anthropicon name="settings" size={16} className="shrink-0 text-sidebar-text-muted" />
      <span className="truncate text-[13px] font-medium leading-5">{copy.title}</span>
      <span aria-hidden="true" className="px-0.5 text-sidebar-text-muted opacity-50">
        ·
      </span>
      <span className="truncate text-[13px] leading-5 text-sidebar-text-secondary">
        {nav.sections[section].label}
      </span>
    </div>
  );
}
