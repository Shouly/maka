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

// Which settings pages the nav offers, and in what order.
//
// `SETTINGS_SECTIONS` in `@maka/core/settings` stays the authority on which
// ids exist — `maka://settings/<section>` is a public deep link and the
// e2e fixture's `openSettingsSection` names one of them, so the enum must not
// shrink. What the nav SHOWS is a different question, and it is answered here:
// three sections are scope-deferred for this rewrite (plan §3 "Defer"), and a
// nav row that opens a page nobody wrote is worse than no row.
//
// A deep link or a fixture that names a deferred section falls back to
// `general` rather than opening a blank page — `resolveSettingsSection` is the
// one place that decision is made, so the fixture, the palette and the
// restored localStorage value cannot disagree about it.

import { SETTINGS_SECTIONS, type SettingsSection } from '@maka/core/settings';
import type { AnthropiconName } from '../icons/Anthropicon.js';
import type { SettingsNavGroup } from '../../lib/ported/nav-group-summary.js';

/** Pages this rewrite does not ship (plan §3). They keep their core id. */
export const DEFERRED_SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'daily-review',
  'import-tasks',
  'bot-chat',
];

/** Pages Phase 5b fills. Their nav rows exist now and say so. */
export const PHASE_5B_SETTINGS_SECTIONS: readonly SettingsSection[] = [
  'models',
  'subagents',
  'memory',
  'search',
];

export interface SettingsNavGroupModel {
  readonly group: SettingsNavGroup;
  readonly sections: readonly SettingsSection[];
}

/**
 * The four groups the pre-rewrite nav used, minus the deferred pages. The
 * order inside a group is the order the pages are read in, not alphabetical.
 */
export const SETTINGS_NAV_GROUPS: readonly SettingsNavGroupModel[] = [
  { group: 'preferences', sections: ['general', 'appearance', 'projects'] },
  { group: 'capabilities', sections: ['models', 'subagents', 'memory', 'search'] },
  { group: 'activity', sections: ['usage', 'archived-tasks', 'data'] },
  { group: 'system', sections: ['permissions', 'health', 'about'] },
];

export const VISIBLE_SETTINGS_SECTIONS: readonly SettingsSection[] = SETTINGS_NAV_GROUPS.flatMap(
  (entry) => entry.sections,
);

export const SETTINGS_SECTION_ICONS: Record<SettingsSection, AnthropiconName> = {
  general: 'settings',
  appearance: 'sun',
  projects: 'folder',
  models: 'connectors',
  subagents: 'users',
  memory: 'memory',
  'daily-review': 'calendar',
  search: 'globe',
  usage: 'usage',
  'archived-tasks': 'archive',
  'import-tasks': 'download',
  'bot-chat': 'chats',
  data: 'library',
  permissions: 'lock',
  health: 'waveform',
  about: 'info',
};

export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * The page to show for a stored / deep-linked / fixture-supplied value.
 *
 * `uiStore.settingsSection` is restored from localStorage, so it is a string
 * until it is validated; a profile that last used a deferred page must land
 * somewhere real rather than on an empty content column.
 */
export function resolveSettingsSection(value: unknown): SettingsSection {
  if (!isSettingsSection(value)) return 'general';
  return VISIBLE_SETTINGS_SECTIONS.includes(value) ? value : 'general';
}
