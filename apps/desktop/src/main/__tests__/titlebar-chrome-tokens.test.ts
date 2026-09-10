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

// Main paints window chrome before a renderer exists, so it transcribes two
// colours out of the design authority instead of reading them. A transcription
// nobody checks is a transcription that drifts: these had gone to #ffffff /
// #191a18 against a shell painting #fcfcfb / #151515, which shows on Windows as
// a permanent seam between the OS control strip and the app's titlebar row.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { WINDOW_CHROME } from '../window-chrome.js';

// From `dist/main/__tests__/` back to the desktop workspace root. The compiled
// copy is the one that runs (`npm run test:dist`).
const GLOBALS_CSS = new URL('../../../src/renderer/styles/globals.css', import.meta.url);

/**
 * The declarations of one selector block, last-wins, with one level of
 * `var(--x)` indirection resolved — `--text-primary` is declared once as
 * `var(--sidebar-text-primary)` and re-themed through that alias.
 */
function tokensOf(css: string, from: string, to: string): Map<string, string> {
  const block = css.slice(css.indexOf(from), css.indexOf(to));
  const declared = new Map<string, string>();
  for (const match of block.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gmu)) {
    declared.set(match[1]!, match[2]!.trim());
  }
  return declared;
}

function resolve(theme: Map<string, string>, root: Map<string, string>, name: string): string {
  const raw = theme.get(name) ?? root.get(name);
  assert.ok(raw, `${name} is not declared`);
  const alias = /^var\((--[a-z0-9-]+)\)$/u.exec(raw);
  return alias ? resolve(theme, root, alias[1]!) : raw;
}

test('window chrome matches the design system it transcribes', () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8');
  const root = tokensOf(css, '\n:root {', '\n.dark {');
  const dark = tokensOf(css, '\n.dark {', '\n/* 系统偏好的深色');

  assert.equal(WINDOW_CHROME.light.surface, resolve(root, root, '--surface-1'));
  assert.equal(WINDOW_CHROME.light.symbol, resolve(root, root, '--text-primary'));
  assert.equal(WINDOW_CHROME.dark.surface, resolve(dark, root, '--surface-1'));
  assert.equal(WINDOW_CHROME.dark.symbol, resolve(dark, root, '--text-primary'));
});
