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

// Startup has no window of its own. From app ready until the main window
// exists nothing is shown: the steps before it are local (a slow login shell
// is the one that can stretch them — `resolveShellEnv`). The main
// window then opens before the Runtime Host has connected, and its renderer
// shows the state kept here (desktop-startup-state.ts): nothing for a moment,
// a quiet spinner and the step if the wait grows, the elapsed time and
// diagnostics if it grows long. A Runtime Host handoff — an upgrade, a
// repair, a replacement that needs a decision — appears in the same window.

import { app, type BrowserWindow, type IpcMain, type WebContents } from 'electron';
import type { UiLocale } from '@maka/core/ui-locale';
import {
  formatHostHandoff,
  type HostHandoffAction,
  type HostHandoffView,
  type OpenHostHandoffSurface,
} from '@maka/runtime-host/client';
import type { DesktopStartupPhase, DesktopStartupState } from '../shared/desktop-startup.js';
import { installApplicationMenu } from './application-menu.js';
import { installDesktopStartupBranding } from './desktop-shell-presentation.js';
import { createDesktopStartupState } from './desktop-startup-state.js';
import { isIsolatedE2e } from './startup-context.js';
import { resolveWindowRevealMode, type WindowRevealMode } from './window-reveal.js';

export type StartupPhase = DesktopStartupPhase;

// The launch starts with this process; the elapsed time counts from here.
const startup = createDesktopStartupState(Date.now());
let copyStartupDiagnostics: (
  phase: StartupPhase,
  handoff?: HostHandoffView,
) => void | Promise<void> = () => {};
let focusMainWindow: () => void = () => {};
let visibleMainWindow: () => BrowserWindow | undefined = () => undefined;
/**
 * Every open handoff surface, by the owner key the state knows it by: the view
 * the Host published last, the one on screen (worded once the locale is
 * known, so it can trail), and how to answer it.
 */
const handoffSurfaces = new Map<
  string,
  {
    latest: HostHandoffView;
    shown?: HostHandoffView;
    readonly submit: (revision: string, action: HostHandoffAction) => void;
  }
>();
let nextHandoffOwner = 0;

/**
 * The run's reveal mode as it reads before the Runtime Host boot resolves its
 * own copy. Every input is available pre-ready (`app.isPackaged` included), so
 * a dialog raised during startup can consult the same answer the windows do.
 */
export function startupRevealMode(): WindowRevealMode {
  return resolveWindowRevealMode(
    isIsolatedE2e || Boolean(process.env.MAKA_E2E_FIXTURE),
    process.env.MAKA_E2E_SHOW_WINDOW === '1',
    app.isPackaged,
  );
}

/**
 * Called after ready, before importing the Runtime Host boot: the Dock
 * branding and, until the shell installs its own, an application menu (Quit,
 * Edit) whose window commands bring the main window forward.
 */
export function beginDesktopStartup(
  copyDiagnostics: (phase: StartupPhase, handoff?: HostHandoffView) => void | Promise<void>,
): void {
  const revealMode = startupRevealMode();
  installDesktopStartupBranding(revealMode);
  copyStartupDiagnostics = copyDiagnostics;
  // Automated runs retain their one-main-window contract and never steal focus.
  if (revealMode !== 'active') return;
  try {
    installApplicationMenu({
      platform: process.platform,
      isPackaged: app.isPackaged,
      dispatch: () => focusMainWindow(),
    });
  } catch (error) {
    console.error('[startup] application menu failed:', error);
  }
}

export function updateDesktopStartupProgress(phase: StartupPhase): void {
  startup.update(phase);
}

/** The Runtime Host is connected and the shell wired: the app itself can mount. */
export function markDesktopStartupReady(): void {
  startup.markReady();
}

/**
 * The Runtime Host is not ready yet. Where closing the last window quits, a
 * close now must not: a start may be replacing or upgrading the Host.
 */
export function isDesktopStartupInProgress(): boolean {
  return !startup.state().ready;
}

/** A handoff on screen waits on a decision: the window that shows it must stay. */
export function isDesktopHandoffAwaitingDecision(): boolean {
  return startup.state().handoff?.state === 'attention';
}

/** The main window, when it is on screen: a startup dialog stands over it. */
export function startupDialogParent(): BrowserWindow | undefined {
  return visibleMainWindow();
}

/**
 * The main window could not be made while starting: nothing can show a
 * handoff, so each one waiting is cancelled (as the startup window did when it
 * could not load) rather than left to wait for an answer that cannot come.
 */
export function cancelDesktopStartupHandoffs(): void {
  if (!isDesktopStartupInProgress()) return;
  for (const surface of handoffSurfaces.values())
    surface.submit(surface.latest.revision, 'cancel');
}

/**
 * Tie the state to the main window: its pushes, its IPC, and how to bring it
 * forward. Only the main window shows the launch and answers a handoff; any
 * other view of the renderer (WorkHub's) reads the launch without one.
 */
export function connectDesktopStartup(input: {
  readonly ipcMain: Pick<IpcMain, 'handle'>;
  readonly send: (state: DesktopStartupState) => void;
  readonly isMainWindow: (sender: WebContents) => boolean;
  readonly focusMainWindow: () => void;
  readonly visibleMainWindow: () => BrowserWindow | undefined;
}): void {
  focusMainWindow = input.focusMainWindow;
  visibleMainWindow = input.visibleMainWindow;
  startup.subscribe(input.send);
  input.ipcMain.handle('startup:state', (event): DesktopStartupState => {
    const state = startup.state();
    if (input.isMainWindow(event.sender)) return state;
    const { handoff: _handoff, ...withoutHandoff } = state;
    return withoutHandoff;
  });
  input.ipcMain.handle('startup:handoff', (event, revision: unknown, action: unknown): boolean => {
    if (!input.isMainWindow(event.sender)) return false;
    if (typeof revision !== 'string' || typeof action !== 'string') return false;
    const owner = startup.answerable(revision, action);
    const surface = owner === undefined ? undefined : handoffSurfaces.get(owner);
    // The Host takes an answer only to its newest view; one to a view still
    // being worded would be dropped there, so it is refused here.
    if (!surface || surface.latest.revision !== revision) return false;
    surface.submit(revision, action as HostHandoffAction);
    return true;
  });
  input.ipcMain.handle('startup:copyDiagnostics', async (event): Promise<void> => {
    if (!input.isMainWindow(event.sender)) return;
    const shown = startup.state().handoff;
    const surface = shown === undefined ? undefined : handoffSurfaces.get(shown.owner);
    await copyStartupDiagnostics(startup.state().phase, surface?.shown);
  });
}

/**
 * Runtime Host handoffs show in the main window, over whatever it shows. One
 * that waits on a decision brings the window forward (opening it if it was
 * closed); one under way does not. Each target's handoff is its own surface;
 * the window shows one at a time and the next once it closes.
 */
export function createDesktopHostHandoffSurface(
  resolveLocale: () => Promise<UiLocale>,
): OpenHostHandoffSurface {
  return (submit) => {
    const owner = String((nextHandoffOwner += 1));
    let closed = false;
    return {
      update(view) {
        const surface = handoffSurfaces.get(owner);
        if (surface) surface.latest = view;
        else handoffSurfaces.set(owner, { latest: view, submit });
        // Only a handoff that cannot be worded is cancelled: one that is not
        // on screen cannot be answered, and waiting for it would hang the Host.
        void resolveLocale()
          .then((locale) => formatHostHandoff(view, locale))
          .then(
            (presentation) => {
              const current = handoffSurfaces.get(owner);
              if (closed || !current || current.latest !== view) return;
              current.shown = view;
              const { becameAttention } = startup.showHandoff(owner, {
                revision: view.revision,
                state: view.state,
                title: presentation.title,
                description: presentation.description,
                detail: presentation.detail,
                ...(view.diagnostic ? { diagnostic: view.diagnostic } : {}),
                actions: presentation.actions,
              });
              if (becameAttention) focusMainWindow();
            },
            (error: unknown) => {
              console.error('[runtime-host] handoff presentation failed:', error);
              if (!closed) submit(view.revision, 'cancel');
            },
          );
      },
      close() {
        closed = true;
        handoffSurfaces.delete(owner);
        // The next one in line may be waiting on a decision of its own.
        if (startup.clearHandoff(owner).becameAttention) focusMainWindow();
      },
    };
  };
}
