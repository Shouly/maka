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

// The shell's global keyboard map.
//
// One `keydown` listener on the document, one table, one dispatcher. The
// matcher and the dispatcher are exported separately from the hook so the
// mapping can be tested without a DOM: what a chord means is product
// behaviour, while when the listener is attached is not.
//
// Text entry wins by default. A shortcut that fires while the user is typing
// into the composer is a bug, so anything reaching an input, textarea,
// contenteditable or `role="textbox"` is skipped unless the binding opts in
// (Escape does; it is how you leave a field).

import { useEffect, useRef } from 'react';

export type HotkeyAction =
  | 'palette'
  | 'settings'
  | 'newTask'
  | 'copyDiagnostics'
  | 'keyboardHelp'
  | 'escape'
  | 'focusFilter'
  | 'toggleSidebar'
  | 'toggleWorkbar'
  | 'workbarFiles'
  | 'workbarReview'
  | 'workbarTerminal'
  | 'workbarBrowser';

export interface HotkeyEventShape {
  readonly key: string;
  /**
   * The physical key, when the caller has one.
   *
   * Only Option chords need it: on macOS, holding Option composes the
   * character, so ⌘⌥S can arrive as `key: 'ß'`. `code` says `KeyS` either way.
   */
  readonly code?: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** `mod` is ⌘ on Apple platforms and Ctrl everywhere else. */
export interface HotkeyBinding {
  readonly action: HotkeyAction;
  readonly key: string;
  readonly mod?: boolean;
  /**
   * Literal Control on EVERY platform, `mod`'s opposite number. The workbar
   * inherits ⌃⇧G and ⌃` from the pre-rewrite key map, where they were Control
   * on macOS too — ⌘` is the OS window cycler and ⌘⇧G is "go to folder" in
   * every file dialog, so neither could be taken.
   */
  readonly ctrl?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  /** Fires even while a text field has focus. */
  readonly allowInTextEntry?: boolean;
}

// A modifier chord cannot be typed, so it stays live inside a text field —
// ⌘K and ⌘N are pressed from the composer more often than from anywhere else.
// The bare keys (`?`, `f`) are characters, and must lose to typing.
export const SHELL_HOTKEYS: readonly HotkeyBinding[] = [
  { action: 'palette', key: 'k', mod: true, allowInTextEntry: true },
  { action: 'settings', key: ',', mod: true, allowInTextEntry: true },
  { action: 'newTask', key: 'n', mod: true, allowInTextEntry: true },
  { action: 'toggleSidebar', key: 'b', mod: true, allowInTextEntry: true },
  { action: 'copyDiagnostics', key: 'd', mod: true, shift: true, allowInTextEntry: true },
  { action: 'keyboardHelp', key: '?' },
  // ⌘/ is the second half of the same binding: `?` needs Shift on most
  // layouts and is unreachable on some, so the slash carries a modifier.
  { action: 'keyboardHelp', key: '/', mod: true, allowInTextEntry: true },
  { action: 'escape', key: 'Escape', allowInTextEntry: true },
  { action: 'focusFilter', key: 'f' },
  // The workbar. Every one is a modifier chord, so all of them stay live
  // inside the composer — opening Files or the Terminal mid-sentence is the
  // normal way to reach them. The chords are the pre-rewrite ones
  // (`workbar-tool-definitions.ts`), except ⌘⌥S which toggled the deferred
  // Side chat and now shows or hides the pane itself.
  { action: 'toggleWorkbar', key: 's', mod: true, alt: true, allowInTextEntry: true },
  { action: 'workbarFiles', key: 'p', mod: true, allowInTextEntry: true },
  { action: 'workbarBrowser', key: 't', mod: true, allowInTextEntry: true },
  { action: 'workbarReview', key: 'g', ctrl: true, shift: true, allowInTextEntry: true },
  { action: 'workbarTerminal', key: '`', ctrl: true, allowInTextEntry: true },
];

export function isApplePlatform(platform: string = globalThis.navigator?.platform ?? ''): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true;
  if (target.isContentEditable) return true;
  return target.getAttribute('role') === 'textbox';
}

export function matchHotkey(
  event: HotkeyEventShape,
  binding: HotkeyBinding,
  apple: boolean,
): boolean {
  if (!matchesKey(event, binding)) return false;
  const wantsMod = binding.mod === true;
  if (binding.ctrl === true) {
    // A literal-Control chord: Control down, the platform modifier up. On
    // Windows and Linux `mod` IS Control, so a `ctrl` binding and a `mod`
    // binding for the same key would be the same chord — none exist.
    if (!event.ctrlKey || event.metaKey) return false;
  } else {
    if (wantsMod !== (apple ? event.metaKey : event.ctrlKey)) return false;
    // On Apple, Ctrl is a separate modifier and must not be held for a ⌘ chord.
    if (apple && wantsMod && event.ctrlKey) return false;
    if (!apple && wantsMod && event.metaKey) return false;
    if (!wantsMod && (event.metaKey || event.ctrlKey)) return false;
  }
  if ((binding.alt === true) !== event.altKey) return false;
  // Shift is only pinned when the binding names it; `?` already implies it on
  // most layouts and pinning it there would make the binding layout-specific.
  if (binding.shift === true && !event.shiftKey) return false;
  if (binding.shift !== true && binding.key.length === 1 && /[a-z,/]/i.test(binding.key)) {
    if (event.shiftKey) return false;
  }
  return true;
}

/** The action a key event maps to, or nothing. Pure; used by the tests. */
/** The binding's key, by character or — for Option chords — by physical key. */
function matchesKey(event: HotkeyEventShape, binding: HotkeyBinding): boolean {
  if (event.key.toLowerCase() === binding.key.toLowerCase()) return true;
  if (binding.alt !== true || binding.key.length !== 1) return false;
  return event.code === `Key${binding.key.toUpperCase()}`;
}

export function resolveHotkey(
  event: HotkeyEventShape & { readonly inTextEntry?: boolean },
  apple: boolean,
  bindings: readonly HotkeyBinding[] = SHELL_HOTKEYS,
): HotkeyAction | undefined {
  for (const binding of bindings) {
    if (event.inTextEntry === true && binding.allowInTextEntry !== true) continue;
    if (matchHotkey(event, binding, apple)) return binding.action;
  }
  return undefined;
}

export type HotkeyHandlers = Partial<Record<HotkeyAction, (event: KeyboardEvent) => void>>;

export function useShellHotkeys(handlers: HotkeyHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const apple = isApplePlatform();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = resolveHotkey(
        {
          key: event.key,
          code: event.code,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          inTextEntry: isTextEntryTarget(event.target),
        },
        apple,
      );
      if (!action) return;
      const handler = latest.current[action];
      if (!handler) return;
      // Only prevent the default once a handler actually exists: ⌘N with no
      // handler must still reach the native menu.
      event.preventDefault();
      handler(event);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
