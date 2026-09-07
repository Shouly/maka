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

// Theme and font-size application for the enterprise renderer.
//
// Ported from the pre-rewrite `renderer/theme.ts`. The semantics main relies on
// are unchanged (contract doc §4): a `ThemePreference` of light | dark | auto,
// `.dark` on `<html>` plus an inline `color-scheme` on both branches, the
// `maka-theme-v1` cache the pre-paint bootstrap reads, the sampled titlebar
// overlay colour, and the modal dim. What changed:
//
//   - every `window.maka` call now goes through `bridge/app-window.ts`;
//   - `.light` is toggled alongside `.dark`, because the design system's dark
//     tokens also live behind `@media (prefers-color-scheme: dark)
//     { :root:not(.light) }` — without the class, choosing Light on a
//     dark-mode OS would paint dark tokens under a light `color-scheme`;
//   - `applyThemePalette` is a no-op that removes the attribute: the product
//     has one palette now (plan §2.6).

import {
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_UI_FONT_SIZE,
  normalizeTerminalFontSize,
  normalizeUiFontSize,
  type ThemePalette,
  type ThemePreference,
} from '@maka/core/settings';
import {
  setThemeSource,
  setTitleBarOverlayTheme,
  setTitlebarControlsVisible,
} from '../bridge/app-window.js';
import { safeLocalStorageGet, safeLocalStorageSet } from './ported/browser-storage.js';
import { compositeScrimOverBackground, parseCssRgbColor } from './ported/titlebar-dim-color.js';
import { TYPE_SCALE_BASE_PX } from './ported/type-scale.js';

const DARK_CLASS = 'dark';
const LIGHT_CLASS = 'light';

export const THEME_STORAGE_KEY = 'maka-theme-v1';
export const THEME_PALETTE_STORAGE_KEY = 'maka-theme-palette-v1';

// Persisted alongside the theme cache so the pre-React paint
// (`applyCachedThemeBeforeMount`) can restore a non-default size before the
// first frame, same rationale as `maka-theme-v1`.
const UI_FONT_SIZE_STORAGE_KEY = 'maka-ui-font-size-v1';
const TERMINAL_FONT_SIZE_STORAGE_KEY = 'maka-terminal-font-size-v1';

// Every `--font-size-*` in the design system is rem-derived, so the root
// font-size that reproduces a chosen base px is `16 * px / base`. At the
// default (which equals the type-scale base) that is the 16px browser default
// and nothing scales; other values scale what is rem-derived — text — while
// px-literal spacing and widths stay fixed.
const BROWSER_ROOT_FONT_SIZE_PX = 16;

// Sampling fallbacks. They are the design system's `--surface-1` in each mode,
// which is also what `<html>` paints (styles/globals.css), so a failed sample
// lands on the colour the successful one would have produced.
const FALLBACK_SURFACE_LIGHT = '#fcfcfb';
const FALLBACK_SURFACE_DARK = '#151515';

let currentUiFontSize: number = DEFAULT_UI_FONT_SIZE;
let currentTerminalFontSize: number = DEFAULT_TERMINAL_FONT_SIZE;
const terminalFontSizeListeners = new Set<(size: number) => void>();

export function getUiFontSize(): number {
  return currentUiFontSize;
}

/**
 * Apply the UI base font size by writing the proportional document-root
 * font-size, then persist so the pre-React paint can restore it next launch.
 * Clamps out-of-range / wrong-typed input to a sane value.
 */
export function applyUiFontSize(size: number): void {
  const next = normalizeUiFontSize(size);
  currentUiFontSize = next;
  document.documentElement.style.fontSize = `${(BROWSER_ROOT_FONT_SIZE_PX * next) / TYPE_SCALE_BASE_PX}px`;
  safeLocalStorageSet(UI_FONT_SIZE_STORAGE_KEY, String(next));
}

export function getTerminalFontSize(): number {
  return currentTerminalFontSize;
}

/**
 * Set the xterm font size. There is no DOM to touch here — live terminals
 * subscribe via `subscribeTerminalFontSize` and re-fit themselves; a terminal
 * opened later reads `getTerminalFontSize()` at creation.
 */
export function applyTerminalFontSize(size: number): void {
  const next = normalizeTerminalFontSize(size);
  currentTerminalFontSize = next;
  safeLocalStorageSet(TERMINAL_FONT_SIZE_STORAGE_KEY, String(next));
  for (const listener of terminalFontSizeListeners) listener(next);
}

/** Subscribe to live terminal font-size changes. Returns an unsubscribe fn. */
export function subscribeTerminalFontSize(listener: (size: number) => void): () => void {
  terminalFontSizeListeners.add(listener);
  return () => {
    terminalFontSizeListeners.delete(listener);
  };
}

/**
 * Restore the cached UI font size before React mounts, so a non-default size
 * does not paint at the default and snap once settings.json loads. Also seeds
 * the terminal size cache so an early terminal open uses the right size.
 */
export function applyCachedFontAppearanceBeforeMount(): void {
  const cachedUi = Number.parseInt(safeLocalStorageGet(UI_FONT_SIZE_STORAGE_KEY) ?? '', 10);
  if (Number.isFinite(cachedUi)) applyUiFontSize(cachedUi);
  const cachedTerminal = Number.parseInt(
    safeLocalStorageGet(TERMINAL_FONT_SIZE_STORAGE_KEY) ?? '',
    10,
  );
  if (Number.isFinite(cachedTerminal)) {
    currentTerminalFontSize = normalizeTerminalFontSize(cachedTerminal);
  }
}

/**
 * Apply the cached theme before React mounts so dark-theme users don't get a
 * brief light-mode flash while settings.json loads. `applyTheme` persists the
 * preference on every change and this reads it synchronously before the first
 * paint — the standard "FOUC prevention via inline script" pattern, except it
 * runs inside the bundle so the CSP's `script-src 'self'` stays intact.
 */
export function applyCachedThemeBeforeMount(): void {
  const cached = safeLocalStorageGet(THEME_STORAGE_KEY);
  const isDark =
    cached === 'dark' ||
    (cached !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  // The class and `color-scheme` are set on BOTH branches on purpose: leaving
  // either at its stylesheet default would paint the first frame by OS
  // preference rather than by the user's setting — the very flash this exists
  // to prevent, in the case where the two disagree.
  setThemeClasses(isDark);
  // A palette cached by a previous build must not survive into a tree that no
  // longer defines palettes; `applyThemePalette` is the authority now.
  applyThemePalette('default');
  applyCachedFontAppearanceBeforeMount();
}

let unsubscribeMediaQuery: (() => void) | null = null;

/**
 * Apply a theme preference to `<html>`. Returns an unsubscribe function for
 * the caller; the active subscription is also memoized internally so
 * re-applying a different preference tears the previous listener down.
 *
 * Persists to `maka-theme-v1` so the pre-React paint can apply the mode
 * synchronously on the next launch.
 */
export function applyTheme(preference: ThemePreference): () => void {
  unsubscribeMediaQuery?.();
  unsubscribeMediaQuery = null;

  // Cache the user-facing preference (not the resolved light/dark). The
  // pre-React paint reapplies the auto → system-matchMedia branch itself.
  safeLocalStorageSet(THEME_STORAGE_KEY, preference);

  // Electron's own native chrome follows `nativeTheme.themeSource`; the DOM
  // flip below is not enough on its own (see main-window.ts).
  setThemeSource(preference);

  if (preference === 'auto') {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    setThemeClasses(query.matches);
    const onChange = (event: MediaQueryListEvent) => setThemeClasses(event.matches);
    query.addEventListener('change', onChange);
    unsubscribeMediaQuery = () => query.removeEventListener('change', onChange);
  } else {
    setThemeClasses(preference === 'dark');
  }

  return () => {
    unsubscribeMediaQuery?.();
    unsubscribeMediaQuery = null;
  };
}

/** The preference in effect, as cached. `auto` when nothing has been chosen. */
export function readCachedThemePreference(): ThemePreference {
  const cached = safeLocalStorageGet(THEME_STORAGE_KEY);
  return cached === 'light' || cached === 'dark' || cached === 'auto' ? cached : 'auto';
}

function setThemeClasses(isDark: boolean): void {
  const root = document.documentElement;
  root.classList.toggle(DARK_CLASS, isDark);
  // `.light` is not decoration: the design system duplicates its dark tokens
  // under `@media (prefers-color-scheme: dark) { :root:not(.light) }`, so on a
  // dark-mode OS the only thing that keeps Light light is this class.
  root.classList.toggle(LIGHT_CLASS, !isDark);
  // This picks the mode as much as it reports it: native scrollbars, form
  // controls and any `light-dark()` value resolve against it. It must stay in
  // lockstep with the class and must be set before the first paint.
  root.style.colorScheme = isDark ? 'dark' : 'light';
  syncTitleBarOverlay(root);
}

/**
 * A modal dialog's ::backdrop dims every pixel of the page — except the
 * OS-drawn window-controls strip (the Windows titleBarOverlay box, the macOS
 * traffic lights), which is composited above web content and stays bright.
 * While any native `<dialog>` is modal-open, `ported/titlebar-modal-sync.ts`
 * sets this flag so the overlay colour folds the backdrop scrim in and the
 * strip reads as part of the dimmed window; macOS additionally hides its
 * traffic lights outright via the same signal.
 */
let titlebarModalDimmed = false;

export function setTitlebarModalDimmed(dimmed: boolean): void {
  if (titlebarModalDimmed === dimmed) return;
  titlebarModalDimmed = dimmed;
  setTitlebarControlsVisible(!dimmed);
  syncTitleBarOverlay(document.documentElement);
}

/**
 * Palettes are gone (plan §2.6): the product ships one. The export survives so
 * ported callers still compile, and it actively removes a stale attribute
 * rather than ignoring the call — a `data-maka-theme` left over from a
 * previous build would otherwise be mirrored into main's message-box chrome
 * (`browser-message-box.ts`) forever.
 */
export function applyThemePalette(_palette: ThemePalette = 'default'): void {
  const root = document.documentElement;
  root.removeAttribute('data-maka-theme');
  safeLocalStorageSet(THEME_PALETTE_STORAGE_KEY, 'default');
  syncTitleBarOverlay(root);
}

function syncTitleBarOverlay(root: HTMLElement): void {
  // The native Windows overlay sits on top of the renderer's content surface.
  // Sample the actually painted `<html>` background instead of approximating
  // it with a hard-coded light/dark pair.
  const isDark = root.classList.contains(DARK_CLASS);
  const backgroundColor = paintedBackgroundToHex(
    root,
    isDark ? FALLBACK_SURFACE_DARK : FALLBACK_SURFACE_LIGHT,
  );
  setTitleBarOverlayTheme({
    isDark,
    backgroundColor: titlebarModalDimmed
      ? dimmedTitlebarColor(backgroundColor, isDark)
      : backgroundColor,
  });
}

/**
 * The colour the titlebar strip appears under an open modal: the dialog
 * backdrop scrim composited over the painted background. The scrim is sampled
 * from the open modal's own ::backdrop, so the dim tracks the theme.
 */
function dimmedTitlebarColor(backgroundHex: string, isDark: boolean): string {
  const scrim = readModalBackdropColor() ?? { r: 0, g: 0, b: 0, a: isDark ? 0.5 : 0.4 };
  return compositeScrimOverBackground(scrim, backgroundHex);
}

/**
 * The computed colour of the open modal's ::backdrop. Callers only dim while a
 * `dialog:modal` exists, so a null here means something unusual happened —
 * fall back rather than dimming wrong.
 */
function readModalBackdropColor(): { r: number; g: number; b: number; a: number } | null {
  const dialog = document.querySelector('dialog:modal');
  if (!dialog) return null;
  return parseCssRgbColor(getComputedStyle(dialog, '::backdrop').backgroundColor);
}

/**
 * The opaque colour an element is painted, as hex. Takes the element rather
 * than a colour string because a token's declared value is not necessarily a
 * colour a canvas can parse — reading `background-color` off the element that
 * paints it hands the canvas an already-resolved colour.
 */
export function paintedBackgroundToHex(element: Element, fallback: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return fallback;

  // A fillStyle the canvas cannot parse is ignored, leaving the previous value
  // in place — so start transparent. Anything unparseable then reads back at
  // alpha 0 and takes the fallback, rather than sampling the opaque black that
  // fillStyle defaults to.
  context.fillStyle = 'rgba(0, 0, 0, 0)';
  context.fillStyle = getComputedStyle(element).backgroundColor;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (alpha !== 255) return fallback;
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
