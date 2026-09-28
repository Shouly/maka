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
// it (and on its `data-startup`). So is the single `-webkit-app-region: drag` strip below — the window is
// frameless with a 36px native overlay, and that strip is the only surface in
// the whole tree allowed to be draggable (styles/globals.css).
//
// Everything the shell DOES lives in `components/layout/AppShell.tsx`. This
// file is only the things that must wrap it: locale, tooltips, toasts, the
// launch (the handoff layer and the Host-ready gate), the company sign-in
// gate, the error boundary, and the theme/titlebar effects that talk to the
// main process.

import { useEffect, type ReactNode } from 'react';
import { LocaleProvider } from '@maka/ui';
import type { UiLocale } from '@maka/core/ui-locale';
import type { ThemePreference } from '@maka/core/settings';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { OrgAccountGate } from './components/account/OrgAccountGate.js';
import { HostReadyGate, StartupHandoffLayer } from './components/startup/StartupGate.js';
import { AppShell } from './components/layout/AppShell.js';
import { useStore } from 'zustand';
import { settingsStore, startupStore } from './store/index.js';
import { useSystemUiLocale } from './lib/ported/use-system-ui-locale.js';
import { Toaster } from './components/ui/toaster.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import type { PendingE2eFixtureUiState } from './lib/fixture.js';
import { applyTheme, applyTranscriptTextSize, applyTerminalFontSize } from './lib/theme.js';
import { startTitlebarModalSync } from './lib/ported/titlebar-modal-sync.js';

export interface AppProps {
  /** The preference the pre-paint bootstrap restored from cache. */
  initialTheme: ThemePreference;
  locale: UiLocale;
  localeOverride: UiLocale | null;
  /** The e2e fixture's UI state, applied by the shell once the stores exist. */
  fixture: PendingE2eFixtureUiState | null;
}

export function App({ initialTheme, locale, localeOverride, fixture }: AppProps): ReactNode {
  // For the app's whole life, not the shell's: the welcome and sign-in
  // screens come before the shell and speak the chosen language too.
  useEffect(() => settingsStore.startClient(), []);
  const client = useStore(settingsStore.client, (state) => state.data);
  const startupReady = useStore(startupStore, (state) => state.startup?.ready === true);
  const systemLocale = useSystemUiLocale();
  const preference = client?.personalization.uiLocale;
  const resolvedLocale =
    localeOverride ??
    (preference && preference !== 'auto' ? preference : client ? systemLocale : locale);
  const theme = fixture ? initialTheme : (client?.appearance.theme ?? initialTheme);
  useEffect(() => {
    if (!client) return;
    applyTranscriptTextSize(client.appearance.transcriptTextSize);
    if (client.appearance.terminalFontSize !== undefined)
      applyTerminalFontSize(client.appearance.terminalFontSize);
  }, [client?.appearance.transcriptTextSize, client?.appearance.terminalFontSize]);
  useEffect(() => {
    // The pre-paint bootstrap set the DOM from cache; this is what tells the
    // main process (native chrome, titlebar overlay colour) about it.
    const stopThemeWatch = applyTheme(theme);
    const stopModalSync = startTitlebarModalSync();
    return () => {
      stopThemeWatch();
      stopModalSync();
    };
  }, [theme]);

  return (
    <LocaleProvider locale={resolvedLocale} override={localeOverride}>
      <TooltipProvider delayDuration={300}>
        {/* `data-startup` says whether the Runtime Host is ready — not that
            AppShell has mounted (a required sign-in can still stand in front
            of it). The frame itself is there from the first paint. */}
        <div className="appFrame" data-startup={startupReady ? 'ready' : 'starting'}>
          {/* The window titlebar strip (the one draggable surface) is rendered
              by AppShell so its columns can align to the sidebar — or by the
              login surface, which takes the shell's place while a deployment
              that requires a company sign-in has none, and while the Runtime
              Host starts. */}
          {/* The window opens before the Runtime Host connects: sign-in needs
              no Host, and the app mounts once the Host is ready. A handoff
              (an update, a repair) opens as a dialog over all of it — outside
              the error boundary, so a crashed screen cannot swallow a
              decision main is waiting on. */}
          <StartupHandoffLayer>
            <ErrorBoundary>
              <OrgAccountGate>
                <HostReadyGate>
                  <AppShell fixture={fixture} />
                </HostReadyGate>
              </OrgAccountGate>
            </ErrorBoundary>
          </StartupHandoffLayer>
        </div>
        <Toaster />
      </TooltipProvider>
    </LocaleProvider>
  );
}
