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

// Phase 0a placeholder entry for the enterprise renderer rewrite. It exists to
// keep the three fixed contracts alive while the old Astryx shell is gone:
// the single `/main.tsx` module the entry-contract plugin pins, the `.appFrame`
// root the main-process window probe and the real-window smoke gate look for,
// and the `notifyRendererReady` handshake that reveals the window (the window
// is created with `show: false`; main falls back after 4s).
//
// Phase 0b replaces this with the real bootstrap (cached theme + locale
// pre-mount, e2e fixture application, providers, error boundary) and Phase 1
// moves the `window.maka` call below behind `src/renderer/bridge/`.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

function applyInitialColorScheme(): void {
  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.style.colorScheme = prefersDark ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', prefersDark);
}

function notifyRendererReadyAfterFirstPaint(): void {
  // Two nested frames: the first is scheduled before paint, the second runs
  // once the frame that painted the app has been committed.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.maka?.appWindow?.notifyRendererReady?.();
    });
  });
}

function PlaceholderApp() {
  return <div className="appFrame">Maka enterprise renderer — Phase 0</div>;
}

const container = document.getElementById('root');
if (!container) throw new Error('Renderer root element #root is missing');

applyInitialColorScheme();
createRoot(container).render(
  <StrictMode>
    <PlaceholderApp />
  </StrictMode>,
);
notifyRendererReadyAfterFirstPaint();
