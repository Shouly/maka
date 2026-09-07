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

// The `appWindow` namespace of the preload bridge, wrapped.
//
// `window.maka` is undefined outside Electron (Vitest, a plain browser, the
// architecture check's own fixtures), and every method returns a Promise that
// rejects if main is mid-teardown. Both are normal, neither is the caller's
// problem — so every call here is optional-chained and every rejection is
// swallowed. Callers get `void`, never a floating rejection.
//
// This module and its siblings are the only place in the renderer allowed to
// name `window.maka`; `scripts/check-renderer-architecture.mjs` enforces it
// (`validateBridgeOwnership`).

import type { WindowCommand } from '../../preload/bridge-contract.js';
import type { ThemePreference } from '@maka/core/settings';

/** Native chrome (`nativeTheme.themeSource`) follows the user's preference. */
export function setThemeSource(preference: ThemePreference): void {
  void window.maka?.appWindow?.setThemeSource?.(preference).catch(() => {});
}

/** macOS traffic lights. No-op elsewhere (main gates on darwin). */
export function setTitlebarControlsVisible(visible: boolean): void {
  void window.maka?.appWindow?.setTitlebarControlsVisible?.(visible).catch(() => {});
}

/** Windows `titleBarOverlay` colours. No-op elsewhere. */
export function setTitleBarOverlayTheme(theme: {
  isDark: boolean;
  backgroundColor: string;
}): void {
  void window.maka?.appWindow?.setTitleBarOverlayTheme?.(theme).catch(() => {});
}

/**
 * The reveal handshake. Main creates the window with `show: false` and waits
 * for this call (falling back after 4s), so it must happen after the first
 * painted frame — see `main.tsx`.
 */
export function notifyRendererReady(): void {
  void window.maka?.appWindow?.notifyRendererReady?.().catch(() => {});
}

/**
 * Native-menu commands (`newTask` | `openSettings` | `openHelp`). Returns an
 * unsubscribe; subscribing late drops the commands sent before it.
 */
export function subscribeWindowCommand(handler: (command: WindowCommand) => void): () => void {
  const unsubscribe = window.maka?.appWindow?.subscribeCommand?.(handler);
  return () => unsubscribe?.();
}
