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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OrgAccountState } from '../../shared/org-account.js';
import {
  centeredIn,
  createSignInWindowMode,
  type Rect,
  type SignInWindowTarget,
  wantsSignInWindow,
} from '../sign-in-window.js';

const WORK_AREA: Rect = { x: 0, y: 25, width: 1512, height: 944 };

function fakeWindow(initial: Rect, flags: { maximized?: boolean; fullScreen?: boolean } = {}) {
  const calls: string[] = [];
  let bounds = { ...initial };
  let maximized = flags.maximized ?? false;
  let fullScreen = flags.fullScreen ?? false;
  const onLeaveFullScreen: (() => void)[] = [];
  const target: SignInWindowTarget & { bounds(): Rect; resizable: boolean; maximizable: boolean } = {
    resizable: true,
    maximizable: true,
    bounds: () => bounds,
    isDestroyed: () => false,
    isMaximized: () => maximized,
    isFullScreen: () => fullScreen,
    getBounds: () => (maximized ? { ...WORK_AREA } : { ...bounds }),
    getNormalBounds: () => ({ ...bounds }),
    setBounds(next, animate) {
      calls.push(`setBounds${animate ? ' animated' : ''}`);
      bounds = { ...bounds, ...next };
    },
    center() {
      calls.push('center');
      bounds = centeredIn(WORK_AREA, bounds);
    },
    maximize() {
      calls.push('maximize');
      maximized = true;
    },
    unmaximize() {
      calls.push('unmaximize');
      maximized = false;
    },
    setFullScreen(flag) {
      calls.push(`fullScreen ${flag}`);
    },
    setResizable(value) {
      target.resizable = value;
    },
    setMaximizable(value) {
      target.maximizable = value;
    },
    once(_event, listener) {
      onLeaveFullScreen.push(listener);
    },
  };
  const leaveFullScreen = () => {
    fullScreen = false;
    for (const listener of onLeaveFullScreen.splice(0)) listener();
  };
  return { target, calls, leaveFullScreen };
}

const place = (bounds: { x?: number; y?: number; width: number; height: number; isMaximized?: boolean }) => bounds;

test('only a required sign-in that has not happened calls for the small window', () => {
  const base = { serverUrl: 'https://maka.example' };
  assert.equal(wantsSignInWindow(undefined), false);
  assert.equal(wantsSignInWindow({ ...base, enforced: true, status: 'signed_out' } as OrgAccountState), true);
  assert.equal(wantsSignInWindow({ ...base, enforced: true, status: 'signing_in' } as OrgAccountState), true);
  assert.equal(wantsSignInWindow({ ...base, enforced: true, status: 'signed_in' } as OrgAccountState), false);
  assert.equal(wantsSignInWindow({ ...base, enforced: false, status: 'signed_out' } as OrgAccountState), false);
});

test('the sign-in window is 600 by 600, centred, fixed; signing in gives the user their size back', () => {
  const own = { x: 100, y: 80, width: 1240, height: 820 };
  const { target, calls } = fakeWindow(own);
  const mode = createSignInWindowMode();
  const taken: unknown[] = [];
  const enter = () =>
    mode.enter(target, { workArea: WORK_AREA, animate: true, onTaken: (bounds) => taken.push(bounds) });
  enter();
  assert.deepEqual(taken, [{ ...own, isMaximized: false }]);
  assert.equal(mode.active, true);
  assert.deepEqual(target.bounds(), { x: 456, y: 197, width: 600, height: 600 });
  assert.equal(target.resizable, false);
  assert.equal(target.maximizable, false);
  // Every account push repeats the wish; only the first one acts.
  enter();
  assert.equal(taken.length, 1);
  assert.deepEqual(calls, ['setBounds animated']);

  mode.leave(target, { animate: true, place });
  assert.equal(mode.active, false);
  assert.deepEqual(target.bounds(), own);
  assert.equal(target.resizable, true);
  assert.equal(target.maximizable, true);
  // Leaving again (a push while signed in) does nothing.
  mode.leave(target, { animate: true, place });
  assert.deepEqual(calls, ['setBounds animated', 'setBounds animated']);
});

test('a window created for the sign-in gives back its saved bounds, maximized if they were', () => {
  const { target, calls } = fakeWindow({ x: 0, y: 0, width: 1240, height: 820 });
  const mode = createSignInWindowMode();
  mode.enter(target, {
    workArea: WORK_AREA,
    animate: false,
    restore: { width: 1400, height: 900, isMaximized: true },
  });
  assert.deepEqual(target.bounds(), { x: 456, y: 197, width: 600, height: 600 });
  mode.leave(target, { animate: false, place });
  // No saved position: the size comes back centred, then maximized.
  assert.deepEqual(calls, ['setBounds', 'setBounds', 'center', 'maximize']);
  assert.equal(target.bounds().width, 1400);
});

test('a maximized window is brought down first; a full-screen one leaves full screen, once', () => {
  const own = { x: 10, y: 30, width: 1300, height: 850 };
  const maximized = fakeWindow(own, { maximized: true });
  const mode = createSignInWindowMode();
  const taken: unknown[] = [];
  mode.enter(maximized.target, { workArea: WORK_AREA, animate: true, onTaken: (b) => taken.push(b) });
  assert.deepEqual(taken, [{ ...own, isMaximized: true }]);
  assert.deepEqual(maximized.calls, ['unmaximize', 'setBounds animated']);

  const full = fakeWindow(own, { fullScreen: true });
  const second = createSignInWindowMode();
  const fullTaken: unknown[] = [];
  const enter = () =>
    second.enter(full.target, { workArea: WORK_AREA, animate: true, onTaken: (b) => fullTaken.push(b) });
  enter();
  enter();
  enter();
  assert.equal(second.active, false);
  assert.deepEqual(full.calls, ['fullScreen false'], 'asked once, however many pushes arrive');
  full.leaveFullScreen();
  assert.equal(second.active, true);
  assert.deepEqual(fullTaken, [{ ...own, isMaximized: false }], 'the bounds taken late are still reported');
  assert.deepEqual(full.target.bounds(), { x: 456, y: 197, width: 600, height: 600 });

  // Signed in before full screen had ended: no small window after all.
  const racing = fakeWindow(own, { fullScreen: true });
  const third = createSignInWindowMode();
  third.enter(racing.target, { workArea: WORK_AREA, animate: true });
  third.leave(racing.target, { animate: true, place });
  racing.leaveFullScreen();
  assert.equal(third.active, false);
  assert.deepEqual(racing.target.bounds(), own);
});

test('signing in while the sign-in window is full screen gives the size back when full screen ends', () => {
  const own = { x: 10, y: 30, width: 1300, height: 850 };
  const { target, calls, leaveFullScreen } = fakeWindow(own);
  const mode = createSignInWindowMode();
  mode.enter(target, { workArea: WORK_AREA, animate: false });
  // The person takes the sign-in window full screen, then signs in.
  (target as unknown as { isFullScreen: () => boolean }).isFullScreen = () => true;
  mode.leave(target, { animate: false, place });
  assert.equal(mode.active, true, 'still not the user\'s bounds: a close now must not save them');
  assert.equal(calls.includes('fullScreen false'), false, 'full screen is theirs to leave');
  (target as unknown as { isFullScreen: () => boolean }).isFullScreen = () => false;
  leaveFullScreen();
  assert.equal(mode.active, false);
  assert.deepEqual(target.bounds(), own);
});

test('closing the window forgets the sign-in window', () => {
  const { target } = fakeWindow({ x: 0, y: 0, width: 1240, height: 820 });
  const mode = createSignInWindowMode();
  mode.enter(target, { workArea: WORK_AREA, animate: false });
  mode.reset();
  assert.equal(mode.active, false);
  assert.deepEqual(centeredIn({ x: 0, y: 0, width: 500, height: 400 }, { width: 600, height: 600 }), {
    x: 0,
    y: 0,
    width: 500,
    height: 400,
  });
});
