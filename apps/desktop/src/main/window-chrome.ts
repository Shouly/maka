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

/**
 * The window chrome's two colours, per theme.
 *
 * Main paints the BrowserWindow background and the native Windows control strip
 * before any renderer exists, so it cannot read the design authority the way the
 * renderer does. These are transcribed from `styles/globals.css`: `--surface-1`
 * (the surface the shell paints) and `--text-primary` (the text that sits on
 * it). `titlebar-chrome-tokens.test.ts` reads that stylesheet and fails if
 * either drifts, which is the only thing keeping a transcription honest.
 *
 * Getting them wrong is visible twice: as a first-frame flash before the
 * renderer paints, and — on Windows — as a lasting colour seam between the
 * OS-drawn control strip and the app's own titlebar row, because the strip keeps
 * this colour until `setTitleBarOverlayTheme` reports the painted one.
 *
 * It lives apart from `main-window.ts` so the parity test can import it without
 * pulling in `electron`.
 */
export const WINDOW_CHROME = {
  light: { surface: '#fcfcfb', symbol: '#0b0b0b' },
  dark: { surface: '#151515', symbol: '#f0efec' },
} as const;

export function windowChrome(isDark: boolean): { surface: string; symbol: string } {
  return isDark ? WINDOW_CHROME.dark : WINDOW_CHROME.light;
}
