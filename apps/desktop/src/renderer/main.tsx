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

// The renderer entry. Its path and shape are pinned:
// `scripts/vite-renderer-entry-contract.ts` requires `index.html` to load
// exactly this one module, and `check-renderer-architecture.mjs` re-checks it.
//
// The order below is the whole point of this file. Everything that must be
// true of the FIRST PAINTED FRAME happens before `createRoot(...).render`:
//
//   1. cached theme + font size — otherwise a dark-theme user gets a light
//      flash while settings.json loads;
//   2. the e2e fixture's document state — the clock, the attributes, and
//      above all the locale, which has to be pinned before any
//      locale-dependent copy enters the tree;
//   3. the locale itself, written to `<html>` synchronously.
//
// and the reveal handshake happens strictly after: main creates the window
// with `show: false` and waits for `notifyRendererReady` (4s fallback), so it
// is sent from inside two nested frames — the first is scheduled before paint,
// the second runs once the frame that painted the app has been committed.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { syncUiLocaleDocument } from '@maka/ui';
import { notifyRendererReady } from './bridge/app-window.js';
import { App } from './app.js';
import {
  applyDocumentE2eFixture,
  readFixtureLocaleOverride,
  type PendingE2eFixtureUiState,
} from './lib/fixture.js';
import { readSystemUiLocale } from './lib/ported/use-system-ui-locale.js';
import { applyCachedThemeBeforeMount, readCachedThemePreference } from './lib/theme.js';
import { applyPlatformAttribute } from './lib/platform.js';
import './styles/globals.css';

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) throw new Error('Renderer root element #root is missing');

  applyCachedThemeBeforeMount();
  // The titlebar gutters (traffic lights / caption buttons) are per platform.
  applyPlatformAttribute();

  // Awaited before the root is created: the fixture's own contract is that its
  // document state is in place before the first locale-dependent render.
  let fixture: PendingE2eFixtureUiState | null = null;
  try {
    fixture = await applyDocumentE2eFixture();
  } catch {
    // A fixture that cannot be read is a fixture that is not there.
  }

  const localeOverride = readFixtureLocaleOverride();
  const locale = localeOverride ?? readSystemUiLocale();
  syncUiLocaleDocument(locale, localeOverride);

  createRoot(container).render(
    <StrictMode>
      <App
        initialTheme={readCachedThemePreference()}
        locale={locale}
        localeOverride={localeOverride}
        fixture={fixture}
      />
    </StrictMode>,
  );

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      notifyRendererReady();
    });
  });
}

void bootstrap();
