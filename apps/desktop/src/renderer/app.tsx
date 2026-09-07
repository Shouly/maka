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

// The provider stack and the app frame.
//
// `.appFrame` is a contract, not a layout choice: `main-window.ts`'s
// diagnostic probe and `scripts/desktop-real-window-smoke.mjs` both gate on
// it. So is the single `-webkit-app-region: drag` strip below — the window is
// frameless with a 36px native overlay, and that strip is the only surface in
// the whole tree allowed to be draggable (styles/globals.css).

import { useEffect, type ReactNode } from 'react';
import { LocaleProvider } from '@maka/ui';
import type { UiLocale } from '@maka/core/ui-locale';
import type { ThemePreference } from '@maka/core/settings';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { DesignSmoke } from './components/dev/DesignSmoke.js';
import { Toaster } from './components/ui/toaster.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import type { PendingE2eFixtureUiState } from './lib/fixture.js';
import { applyTheme } from './lib/theme.js';
import { startTitlebarModalSync } from './lib/ported/titlebar-modal-sync.js';

export interface AppProps {
  /** The preference the pre-paint bootstrap restored from cache. */
  initialTheme: ThemePreference;
  locale: UiLocale;
  localeOverride: UiLocale | null;
  /**
   * The e2e fixture's UI state. Nothing consumes it yet — Phase 2 owns the
   * stores it describes — but it is threaded through so the fixture's
   * contract is visible at the top of the tree instead of being dropped.
   */
  fixture: PendingE2eFixtureUiState | null;
}

export function App({ initialTheme, locale, localeOverride }: AppProps): ReactNode {
  useEffect(() => {
    // The pre-paint bootstrap set the DOM from cache; this is what tells the
    // main process (native chrome, titlebar overlay colour) about it.
    const stopThemeWatch = applyTheme(initialTheme);
    const stopModalSync = startTitlebarModalSync();
    return () => {
      stopThemeWatch();
      stopModalSync();
    };
  }, [initialTheme]);

  return (
    <LocaleProvider locale={locale} override={localeOverride}>
      <TooltipProvider delayDuration={300}>
        <div className="appFrame">
          {/* The one draggable surface. Anything interactive placed inside it
              must opt back out with `.maka-no-drag`. */}
          <div className="maka-titlebar-drag shrink-0" />
          <ErrorBoundary>
            <DesignSmoke />
          </ErrorBoundary>
        </div>
        <Toaster />
      </TooltipProvider>
    </LocaleProvider>
  );
}
