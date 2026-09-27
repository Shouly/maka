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
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const mainSource = readFileSync(
  fileURLToPath(new URL('../../../src/main/main.ts', import.meta.url)),
  'utf8',
);
const bootSource = readFileSync(
  fileURLToPath(new URL('../../../src/main/runtime-host-boot.ts', import.meta.url)),
  'utf8',
);
const appIpcSource = readFileSync(
  fileURLToPath(new URL('../../../src/main/app-ipc-main.ts', import.meta.url)),
  'utf8',
);
const mainWindowSource = readFileSync(
  fileURLToPath(new URL('../../../src/main/main-window.ts', import.meta.url)),
  'utf8',
);

test('retains process lifetime before a standalone startup dialog can close', () => {
  const retentionPolicy = mainSource.search(
    /app\.on\(['"]window-all-closed['"],\s*\(\)\s*=>\s*\{\s*\}\);/u,
  );
  const singleInstanceDecision = mainSource.indexOf('app.requestSingleInstanceLock()');

  assert.notEqual(retentionPolicy, -1);
  assert.notEqual(singleInstanceDecision, -1);
  assert.ok(retentionPolicy < singleInstanceDecision);

  const lifecycleStart = bootSource.indexOf('function wireLifecycle');
  const windowAllClosedStart = bootSource.indexOf(
    'app.on("window-all-closed"',
    lifecycleStart,
  );
  const windowAllClosed = bootSource.slice(
    windowAllClosedStart,
    bootSource.indexOf('powerMonitor.on("resume"', windowAllClosedStart),
  );
  // Registered only once the Host is ready, so the startup never reaches it:
  // closing the window before then is held (`holdsClose`), not quit.
  assert.match(
    windowAllClosed,
    /process\.platform !== "darwin" && !windowsAppTray\.hasTray\(\) && !isBrowserMessageBoxPresentationActive\(\)\) app\.quit\(\);/u,
  );
  assert.ok(
    bootSource.indexOf('app.on("window-all-closed"') > bootSource.indexOf('function wireLifecycle'),
  );
});

test('registers one shared quit cleanup before the initial Host handoff', () => {
  const hostStart = bootSource.indexOf('runtimeHostManager = await startLocalRuntimeHostManager');
  const quitRegistration = bootSource.indexOf('app.on("before-quit", quitCoordinator.handleBeforeQuit)');
  const workBoardDeclaration = bootSource.indexOf('let workBoardIpc:');
  assert.ok(workBoardDeclaration >= 0 && workBoardDeclaration < quitRegistration);
  assert.ok(quitRegistration >= 0 && quitRegistration < hostStart);
  assert.equal(bootSource.match(/createAppQuitCoordinator\(\{/gu)?.length, 1);
  assert.equal(bootSource.match(/app\.on\("before-quit"/gu)?.length, 1);
  assert.match(bootSource, /cleanup: closeRuntimeHostDesktop/u);
  assert.match(bootSource, /return runtimeHostDesktopShutdown \?\?= disposeRuntimeHostDesktop\(\)/u);
  assert.match(bootSource, /workBoardIpc\?\.close\(\)/u);
});

test('drains startup resources before cancellation quit or fatal presentation', () => {
  const callbackStart = bootSource.indexOf('onFatalError: (error, target) => {');
  const callback = bootSource.slice(callbackStart, bootSource.indexOf('\n);', callbackStart));
  assert.ok(callback.indexOf('if (!runtimeHostManager) return;') < callback.indexOf('app.quit()'));

  const hostStart = bootSource.indexOf('runtimeHostManager = await startLocalRuntimeHostManager');
  const failure = bootSource.slice(hostStart, bootSource.indexOf('// Runtime Host is the only', hostStart));
  const cleanup = failure.indexOf('await closeRuntimeHostDesktop()');
  assert.ok(cleanup >= 0 && cleanup < failure.indexOf('app.quit()'));
  assert.ok(cleanup < failure.indexOf('throw error'));
  assert.doesNotMatch(failure, /retireOwnedLocalHost|forceTerminate/u);
  assert.match(bootSource, /await runtimeHostPeerMeshComponent\?\.close\(\)[\s\S]*await runtimeHostPeerEndpointOwner\?\.close\(\)/u);
});

test('opens the main window before the Host connects and mounts the app once it is ready', () => {
  // No startup window: after ready, main only brands the Dock and menu, then boots.
  const ready = mainSource.indexOf("console.log('[startup] app ready')");
  const begin = mainSource.indexOf('beginDesktopStartup(', ready);
  const hostBoot = mainSource.indexOf("import('./runtime-host-boot.js')", ready);
  assert.ok(ready >= 0 && begin > ready && hostBoot > begin);
  assert.doesNotMatch(mainSource, /showDesktopStartupProgress|desktopStartupProgressWindow/u);

  // The window is asked for before the Host start is awaited, and the Dock and
  // a second launch can bring it forward from then on — registered once.
  const hostStart = bootSource.indexOf('runtimeHostManager = await startLocalRuntimeHostManager');
  const earlyWindow = bootSource.indexOf('void quitCoordinator.focusOrCreateWindow();');
  const activate = bootSource.indexOf('app.on("activate", quitCoordinator.focusOrCreateWindow)');
  const secondInstance = bootSource.indexOf('app.on("second-instance", quitCoordinator.focusOrCreateWindow)');
  assert.ok(earlyWindow >= 0 && earlyWindow < hostStart);
  assert.ok(activate >= 0 && activate < hostStart && secondInstance >= 0 && secondInstance < hostStart);
  assert.equal(bootSource.match(/app\.on\("activate"/gu)?.length, 1);
  assert.equal(bootSource.match(/app\.on\("second-instance"/gu)?.length, 1);
  const coordinatorStart = bootSource.indexOf('createAppQuitCoordinator({');
  const coordinator = bootSource.slice(
    coordinatorStart,
    bootSource.indexOf('app.on("before-quit"', coordinatorStart),
  );
  assert.doesNotMatch(coordinator, /if \(!runtimeHostManager\) return;/u, 'the window no longer waits for the Host');

  // The app mounts in it once the Host is ready and the shell is wired.
  const lifecycle = bootSource.indexOf('wireLifecycle();', hostStart);
  const markReady = bootSource.indexOf('markDesktopStartupReady();', hostStart);
  assert.ok(lifecycle > hostStart && markReady > lifecycle);

  // An "Open Maka" link can arrive while the Host connects (a sign-in needs none).
  const urlScheme = bootSource.indexOf('installAppUrlScheme(app, {');
  assert.ok(urlScheme >= 0 && urlScheme < hostStart);
  assert.equal(bootSource.match(/installAppUrlScheme\(app, \{/gu)?.length, 1);
  // The Dock, a second launch and a handoff can all ask while the window is
  // still being made: they share that one creation.
  assert.match(bootSource, /windowCreation \?\?= Promise\.resolve\(mainWindowController\.createWindow\(signal\)\)/u);
  // Closing the window minimizes it while that would strand something: during
  // the start where closing the last window quits, and while a decision waits
  // on any platform — but never against a quit that has begun.
  assert.match(
    bootSource,
    /holdsClose: \(\) =>\s*!quitCoordinator\.isQuitting\(\) &&\s*\(\(process\.platform !== "darwin" && isDesktopStartupInProgress\(\)\) \|\|\s*isDesktopHandoffAwaitingDecision\(\)\)/u,
  );
  // With no window a startup handoff has nowhere to be answered: it is cancelled.
  assert.match(bootSource, /onWindowCreationError: \(error\) => \{[\s\S]*?cancelDesktopStartupHandoffs\(\);/u);
  assert.match(
    mainWindowSource,
    /mainWindow\.on\('close', \(event\) => \{\s*if \(deps\.holdsClose\?\.\(\) && mainWindow\) \{\s*event\.preventDefault\(\);\s*mainWindow\.minimize\(\);/u,
  );
});

test('resolves persisted locale before first post-settings recovery prompt', () => {
  const rendererRecoveryStart = bootSource.indexOf('onRendererProcessGone: async');
  const rendererRecovery = bootSource.slice(
    rendererRecoveryStart,
    bootSource.indexOf('resolveBrowserDialogParent =', rendererRecoveryStart),
  );
  const defaultHostRecoveryStart = bootSource.indexOf(
    'async function promptForDefaultRuntimeHostRecovery',
  );
  const defaultHostRecovery = bootSource.slice(defaultHostRecoveryStart);

  assert.match(rendererRecovery, /const locale = await desktopLocale\.resolve\(\)/u);
  assert.match(bootSource, /handoffSurface: createDesktopHostHandoffSurface\(\(\) => desktopLocale\.resolve\(\)\)/u);
  assert.match(defaultHostRecovery, /const locale = await desktopLocale\.resolve\(\)/u);
  assert.doesNotMatch(rendererRecovery, /desktopLocale\.current\(\)/u);
  assert.doesNotMatch(defaultHostRecovery, /resolveSystemUiLocale/u);
});

test('lets the Runtime Host migrate its State Root before Desktop opens shared tables', () => {
  const hostStart = bootSource.indexOf(
    'runtimeHostManager = await startLocalRuntimeHostManager',
  );
  const workBoardOpen = bootSource.indexOf(
    'store: createWorkBoardStore(workspaceRoot',
  );
  const sessionCopyOpen = bootSource.indexOf(
    'createSessionCopyCleanupAuthority({',
  );

  assert.notEqual(hostStart, -1);
  assert.notEqual(workBoardOpen, -1);
  assert.notEqual(sessionCopyOpen, -1);
  assert.ok(hostStart < workBoardOpen);
  assert.match(
    bootSource.slice(workBoardOpen, bootSource.indexOf('});', workBoardOpen)),
    /schemaMigration: 'require_current'/u,
  );
  assert.match(
    bootSource.slice(sessionCopyOpen, bootSource.indexOf('}),', sessionCopyOpen)),
    /schemaMigration: 'require_current'/u,
  );
});

test('routes the first-paint IPC only to the active Renderer recovery listener', () => {
  const ipcHandlerStart = appIpcSource.indexOf(
    "targetIpc.handle('window:notifyRendererReady'",
  );
  const ipcHandler = appIpcSource.slice(
    ipcHandlerStart,
    appIpcSource.indexOf("targetIpc.handle('window:setThemeSource'", ipcHandlerStart),
  );
  const readyHandlerStart = mainWindowSource.indexOf(
    'notifyRendererReady(sender, senderFrame)',
  );
  const readyHandler = mainWindowSource.slice(
    readyHandlerStart,
    mainWindowSource.indexOf('setTitlebarControlsVisible(sender', readyHandlerStart),
  );
  const reloadStart = mainWindowSource.indexOf('    async reloadMainRenderer() {');
  const reloadHandler = mainWindowSource.slice(
    reloadStart,
    mainWindowSource.indexOf('    send: safeSendToRenderer', reloadStart),
  );

  assert.match(
    ipcHandler,
    /mainWindowController\.notifyRendererReady\(event\.sender, event\.senderFrame\)/u,
  );
  assert.match(
    reloadHandler,
    /clearShowFallbackTimer\(\);\s*revealGate\.reset\(\);\s*target\.hide\(\);/u,
  );
  assert.match(reloadHandler, /reloadMainRendererProcess\(/u);
  assert.match(reloadHandler, /subscribeMainFrameCommitted:/u);
  assert.match(
    reloadHandler,
    /if \(!isMainFrame\) return;\s*const frame = webFrameMain\.fromId\(frameProcessId, frameRoutingId\);\s*if \(frame\) listener\(rendererFrameIdentity\(frame\)\);/u,
  );
  assert.match(
    readyHandler,
    /sender !== mainWindow\.webContents\) return;/u,
  );
  assert.match(
    readyHandler,
    /if \(recovery\?\.contents === sender\) \{\s*[^}]*if \(!senderFrame \|\| !recovery\.listener\?\.\(rendererFrameIdentity\(senderFrame\)\)\) return;\s*\}/u,
  );
  assert.match(
    reloadHandler,
    /if \(rendererRecoveryReadiness === readiness\) \{\s*if \(loaded\) rendererRecoveryReadiness = undefined;\s*else readiness\.listener = undefined;\s*\}/u,
  );
  assert.match(readyHandler, /revealGate\.markReady\(mainWindow\)/u);
});
