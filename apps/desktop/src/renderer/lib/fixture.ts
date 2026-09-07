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

// E2E fixture application, split in two.
//
// `applyDocumentE2eFixture` is everything that has to happen before React
// mounts — a frozen clock, the `data-maka-*` attributes, the theme override,
// and above all the locale, which must be in place before any locale-dependent
// content enters the tree. It runs from `main.tsx`.
//
// What is left over is UI state (which session is active, which panels are
// open, which settings section is showing). Those have no owner until the
// stores exist, so this module hands them back as a typed record for Phase 2
// to consume rather than inventing a home for them now.
//
// `getState()` resolves to null for every real user — main only fills it in
// under `MAKA_E2E_FIXTURE` — so nothing in here is reachable in production.

import type { E2eFixtureState } from '@maka/core/e2e-fixture';
import type { SettingsSection } from '@maka/core/settings';
import { UI_LOCALES, type UiLocale } from '@maka/core/ui-locale';
import { getE2eFixtureState } from '../bridge/e2e-fixture.js';
import { applyTheme } from './theme.js';

/** The `workbarTab` values the workbar actually has a panel for. */
export type FixtureWorkbarTab = 'review' | 'terminal' | 'browser' | 'files' | 'inspector';

export type FixtureSidebarSection = 'sessions' | 'automations' | 'skills' | 'mcp' | 'daily-review';

/**
 * The fixture fields that describe UI state rather than the document. Phase 2
 * applies these once the stores that own them exist.
 */
export interface PendingE2eFixtureUiState {
  readonly activeSessionId?: string;
  readonly sidebarCollapsed?: boolean;
  readonly workbarCollapsed?: boolean;
  readonly workbarTab?: FixtureWorkbarTab;
  readonly openSettingsSection?: SettingsSection;
  readonly searchModalOpen?: boolean;
  readonly sidebarSection?: FixtureSidebarSection;
}

function isWorkbarTab(value: E2eFixtureState['workbarTab']): value is FixtureWorkbarTab {
  return (
    value === 'review' ||
    value === 'terminal' ||
    value === 'browser' ||
    value === 'files' ||
    value === 'inspector'
  );
}

/**
 * Apply everything the fixture asks of the document, and return the UI state
 * it still wants applied. Returns null on a normal launch.
 */
export async function applyDocumentE2eFixture(): Promise<PendingE2eFixtureUiState | null> {
  const state = await getE2eFixtureState();
  if (!state) return null;
  const root = document.documentElement;

  if (state.now !== undefined) {
    // Fixture-only clock freeze: a run must not differ from the previous one
    // because a relative timestamp crossed a minute boundary between them.
    const frozen = state.now;
    Date.now = () => frozen;
  }

  root.setAttribute('data-maka-e2e-fixture', 'true');

  // Before the persisted user preference, so the rendered fixture matches the
  // `<theme>-<viewport>-<motion>` variant it was asked for.
  if (state.theme) applyTheme(state.theme);

  // The matching CSS rule (styles/globals.css, Maka additions) collapses every
  // animation, so a reduced-motion variant is reachable without depending on
  // the host OS accessibility setting. `@maka/ui`'s `streaming-presentation.ts`
  // reads the same attribute from script.
  if (state.reducedMotion) root.setAttribute('data-maka-reduced-motion', 'true');

  // The locale override has to land before any locale-dependent content enters
  // the React tree, which is why this whole function runs pre-mount: the
  // attribute is the contract, and `main.tsx` seeds `LocaleProvider` from it.
  if (state.locale) root.setAttribute('data-maka-e2e-fixture-locale', state.locale);

  // The IANA name lands on `<html>` so any date/time formatter can opt in by
  // reading `document.documentElement.dataset.makaE2eFixtureTz`.
  if (state.timezone) root.setAttribute('data-maka-e2e-fixture-tz', state.timezone);

  return {
    ...(state.activeSessionId !== undefined ? { activeSessionId: state.activeSessionId } : {}),
    ...(state.sidebarCollapsed !== undefined ? { sidebarCollapsed: state.sidebarCollapsed } : {}),
    ...(state.workbarCollapsed !== undefined ? { workbarCollapsed: state.workbarCollapsed } : {}),
    ...(isWorkbarTab(state.workbarTab) ? { workbarTab: state.workbarTab } : {}),
    ...(state.openSettingsSection !== undefined
      ? { openSettingsSection: state.openSettingsSection }
      : {}),
    ...(state.searchModalOpen !== undefined ? { searchModalOpen: state.searchModalOpen } : {}),
    ...(state.sidebarSection !== undefined ? { sidebarSection: state.sidebarSection } : {}),
  };
}

/**
 * The locale the fixture pinned, if any. `main.tsx` feeds it to
 * `LocaleProvider` as the override, which is also what keeps the attribute on
 * `<html>` (`syncUiLocaleDocument` removes it when there is no override).
 */
export function readFixtureLocaleOverride(): UiLocale | null {
  const value = document.documentElement.getAttribute('data-maka-e2e-fixture-locale');
  return UI_LOCALES.includes(value as UiLocale) ? (value as UiLocale) : null;
}
