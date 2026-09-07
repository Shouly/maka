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

// `renderer/lib/theme.ts` is where four separate contracts meet, and three of
// them are invisible to a screenshot:
//
//   - `.dark` picks the design system's dark token block;
//   - `.light` suppresses its `@media (prefers-color-scheme: dark)` twin, which
//     is the only thing keeping Light light on a dark-mode OS;
//   - `documentElement.style.colorScheme` is what native scrollbars and form
//     controls resolve against, and must never disagree with the class;
//   - `maka-theme-v1` is what the pre-paint bootstrap reads next launch.
//
// A fake document is enough to assert all four, and keeps the test honest
// about what it covers: this is the DOM/storage contract, not the rendering.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import {
  applyCachedThemeBeforeMount,
  applyTheme,
  applyThemePalette,
  paintedBackgroundToHex,
  readCachedThemePreference,
} from '../../renderer/lib/theme.js';

interface FakeRoot {
  classList: Set<string>;
  attributes: Map<string, string>;
  style: { colorScheme: string; fontSize: string };
}

interface MediaQueryStub {
  matches: boolean;
  listeners: Set<(event: { matches: boolean }) => void>;
}

let root: FakeRoot;
let media: MediaQueryStub;
let store: Map<string, string>;
let previous: {
  document: unknown;
  window: unknown;
  localStorage: unknown;
  getComputedStyle: unknown;
};

/** The painted `<html>` background the canvas sample reads back. */
let paintedPixel: [number, number, number, number] = [252, 252, 251, 255];

function createRoot(): FakeRoot {
  return {
    classList: new Set<string>(),
    attributes: new Map<string, string>(),
    style: { colorScheme: '', fontSize: '' },
  };
}

function documentElementProxy(target: FakeRoot) {
  return {
    classList: {
      add: (name: string) => target.classList.add(name),
      remove: (name: string) => target.classList.delete(name),
      contains: (name: string) => target.classList.has(name),
      toggle: (name: string, force: boolean) => {
        if (force) target.classList.add(name);
        else target.classList.delete(name);
        return force;
      },
    },
    style: target.style,
    setAttribute: (name: string, value: string) => target.attributes.set(name, value),
    removeAttribute: (name: string) => target.attributes.delete(name),
    getAttribute: (name: string) => target.attributes.get(name) ?? null,
  };
}

beforeEach(() => {
  root = createRoot();
  media = { matches: false, listeners: new Set() };
  store = new Map<string, string>();
  paintedPixel = [252, 252, 251, 255];
  previous = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    getComputedStyle: globalThis.getComputedStyle,
  };

  const fakeDocument = {
    documentElement: documentElementProxy(root),
    // The titlebar overlay colour is sampled by painting the computed
    // background into a 1x1 canvas; `getImageData` is the only part that
    // matters here.
    createElement: (tag: string) => {
      if (tag !== 'canvas') return {};
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          fillStyle: '',
          fillRect: () => {},
          getImageData: () => ({ data: paintedPixel }),
        }),
      };
    },
    querySelector: () => null,
  };

  globalThis.document = fakeDocument as unknown as Document;
  globalThis.window = {
    matchMedia: (query: string) => ({
      matches: media.matches,
      media: query,
      addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
        media.listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
        media.listeners.delete(listener);
      },
    }),
  } as unknown as Window & typeof globalThis;
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  globalThis.getComputedStyle = (() => ({ backgroundColor: 'rgb(252, 252, 251)' })) as unknown as
    typeof globalThis.getComputedStyle;
});

afterEach(() => {
  globalThis.document = previous.document as Document;
  globalThis.window = previous.window as Window & typeof globalThis;
  globalThis.localStorage = previous.localStorage as Storage;
  globalThis.getComputedStyle = previous.getComputedStyle as typeof globalThis.getComputedStyle;
});

test('dark sets .dark, clears .light, and matches colorScheme', () => {
  applyTheme('dark');
  assert.ok(root.classList.has('dark'));
  assert.ok(!root.classList.has('light'));
  assert.equal(root.style.colorScheme, 'dark');
  assert.equal(store.get('maka-theme-v1'), 'dark');
});

test('light sets .light even on a dark-mode OS — that is what the class is for', () => {
  media.matches = true;
  applyTheme('light');
  assert.ok(root.classList.has('light'));
  assert.ok(!root.classList.has('dark'));
  assert.equal(root.style.colorScheme, 'light');
  assert.equal(store.get('maka-theme-v1'), 'light');
});

test('auto follows the system query, and keeps following it', () => {
  media.matches = true;
  const stop = applyTheme('auto');
  assert.ok(root.classList.has('dark'));
  assert.equal(root.style.colorScheme, 'dark');

  for (const listener of media.listeners) listener({ matches: false });
  assert.ok(root.classList.has('light'));
  assert.equal(root.style.colorScheme, 'light');

  stop();
  assert.equal(media.listeners.size, 0);
  assert.equal(store.get('maka-theme-v1'), 'auto');
});

test('re-applying a preference tears down the previous system subscription', () => {
  applyTheme('auto');
  assert.equal(media.listeners.size, 1);
  applyTheme('light');
  assert.equal(media.listeners.size, 0);
});

test('the cached preference is what the next launch paints from', () => {
  applyTheme('dark');
  assert.equal(readCachedThemePreference(), 'dark');

  store.set('maka-theme-v1', 'not-a-theme');
  assert.equal(readCachedThemePreference(), 'auto');
});

test('the pre-mount paint applies the cached theme, not the OS preference', () => {
  store.set('maka-theme-v1', 'dark');
  applyCachedThemeBeforeMount();
  assert.ok(root.classList.has('dark'));
  assert.equal(root.style.colorScheme, 'dark');
});

test('with nothing cached the pre-mount paint falls back to the OS preference', () => {
  media.matches = true;
  applyCachedThemeBeforeMount();
  assert.ok(root.classList.has('dark'));

  root = createRoot();
  (globalThis.document as unknown as { documentElement: unknown }).documentElement =
    documentElementProxy(root);
  media.matches = false;
  applyCachedThemeBeforeMount();
  assert.ok(root.classList.has('light'));
  assert.ok(!root.classList.has('dark'));
});

test('the pre-mount paint clears a palette attribute left by an older build', () => {
  root.attributes.set('data-maka-theme', 'nord');
  applyCachedThemeBeforeMount();
  assert.equal(root.attributes.has('data-maka-theme'), false);
});

test('applyThemePalette is a no-op that removes the attribute', () => {
  root.attributes.set('data-maka-theme', 'nord');
  applyThemePalette('nord');
  assert.equal(root.attributes.has('data-maka-theme'), false);
  assert.equal(store.get('maka-theme-palette-v1'), 'default');
});

test('the sampled titlebar colour is the painted pixel, in hex', () => {
  assert.equal(paintedBackgroundToHex({} as Element, '#000000'), '#fcfcfb');
  paintedPixel = [21, 21, 21, 255];
  assert.equal(paintedBackgroundToHex({} as Element, '#000000'), '#151515');
});

test('a non-opaque sample takes the fallback rather than reporting a see-through titlebar', () => {
  paintedPixel = [0, 0, 0, 0];
  assert.equal(paintedBackgroundToHex({} as Element, '#151515'), '#151515');
});
