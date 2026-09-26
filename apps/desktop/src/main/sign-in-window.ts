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

// The window while a company sign-in is required and there is none: 600×600,
// centred, not resizable — the Claude desktop's first-run window. Signing in
// gives the window back its own size (maximized if it was); signing out takes
// it down to the sign-in window again. The small window is never written to
// `window-state.json`, so the next launch after signing in opens at the size
// the user chose.

import type { OrgAccountState } from '../shared/org-account.js';
import type { SavedBounds } from './window-state.js';

export const SIGN_IN_WINDOW_SIZE = { width: 600, height: 600 } as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether the account calls for the sign-in window. */
export function wantsSignInWindow(state: OrgAccountState | undefined): boolean {
  return state !== undefined && state.enforced && state.status !== 'signed_in';
}

export function centeredIn(workArea: Rect, size: { width: number; height: number }): Rect {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

/** The part of a BrowserWindow the mode touches. */
export interface SignInWindowTarget {
  isDestroyed(): boolean;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  getBounds(): Rect;
  getNormalBounds(): Rect;
  setBounds(bounds: Partial<Rect>, animate?: boolean): void;
  center(): void;
  maximize(): void;
  unmaximize(): void;
  setFullScreen(flag: boolean): void;
  setResizable(resizable: boolean): void;
  setMaximizable(maximizable: boolean): void;
  once(event: 'leave-full-screen', listener: () => void): unknown;
}

export interface EnterSignInWindow {
  readonly workArea: Rect;
  readonly animate: boolean;
  /**
   * What to give back when the window never had its own bounds applied (it
   * was created for the sign-in); otherwise they are read off the window.
   */
  readonly restore?: SavedBounds;
  /** Called with the bounds taken, whenever they are taken (a full-screen window only once it has left). */
  readonly onTaken?: (bounds: SavedBounds) => void;
}

export interface LeaveSignInWindow {
  readonly animate: boolean;
  /** Keeps the bounds on a live display. */
  readonly place: (bounds: SavedBounds) => SavedBounds;
}

export interface SignInWindowMode {
  /** The window is the sign-in window, or on its way back from it: its bounds are not the user's. */
  readonly active: boolean;
  enter(target: SignInWindowTarget, options: EnterSignInWindow): void;
  leave(target: SignInWindowTarget, options: LeaveSignInWindow): void;
  /** The window closed; the next one starts over. */
  reset(): void;
}

/**
 * Follows the latest wish (in or out) and gets there as soon as the window
 * allows: bounds set on a full-screen window are dropped, so both ways wait
 * for it to leave full screen — going in asks it to, going back does not.
 * Until the user's bounds are given back the mode stays active, so a window
 * closed while still full screen never saves its full-screen frame.
 */
export function createSignInWindowMode(): SignInWindowMode {
  let own: SavedBounds | undefined;
  let wanted = false;
  let waiting = false;
  let entering: EnterSignInWindow | undefined;
  let leaving: LeaveSignInWindow | undefined;

  const take = (target: SignInWindowTarget, options: EnterSignInWindow) => {
    own =
      options.restore ??
      (target.isMaximized()
        ? { ...target.getNormalBounds(), isMaximized: true }
        : { ...target.getBounds(), isMaximized: false });
    if (target.isMaximized()) target.unmaximize();
    target.setResizable(false);
    target.setMaximizable(false);
    target.setBounds(centeredIn(options.workArea, SIGN_IN_WINDOW_SIZE), options.animate);
    options.onTaken?.(own);
  };

  const giveBack = (target: SignInWindowTarget, options: LeaveSignInWindow, bounds: SavedBounds) => {
    const placed = options.place(bounds);
    if (placed.x !== undefined && placed.y !== undefined) {
      target.setBounds(
        { x: placed.x, y: placed.y, width: placed.width, height: placed.height },
        options.animate,
      );
    } else {
      target.setBounds({ width: placed.width, height: placed.height }, options.animate);
      target.center();
    }
    if (placed.isMaximized) target.maximize();
  };

  const settle = (target: SignInWindowTarget) => {
    if (target.isDestroyed()) return;
    if (target.isFullScreen()) {
      if (!waiting) {
        waiting = true;
        target.once('leave-full-screen', () => {
          waiting = false;
          settle(target);
        });
        // Someone who took the sign-in window full screen keeps it that way;
        // only going in makes the window leave full screen.
        if (wanted && own === undefined) target.setFullScreen(false);
      }
      return;
    }
    if (wanted && own === undefined && entering) {
      take(target, entering);
    } else if (!wanted && own !== undefined && leaving) {
      const bounds = own;
      own = undefined;
      giveBack(target, leaving, bounds);
    }
  };

  return {
    get active() {
      return own !== undefined;
    },
    enter(target, options) {
      wanted = true;
      entering = options;
      settle(target);
    },
    leave(target, options) {
      wanted = false;
      leaving = options;
      if (own !== undefined && !target.isDestroyed()) {
        target.setResizable(true);
        target.setMaximizable(true);
      }
      settle(target);
    },
    reset() {
      own = undefined;
      wanted = false;
      waiting = false;
      entering = undefined;
      leaving = undefined;
    },
  };
}
