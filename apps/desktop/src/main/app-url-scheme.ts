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

// The app's URL scheme. A browser page hands one of these links back to bring
// Maka to the front — the sign-in completion page's "Open Maka", after the
// Claude desktop's. The link carries nothing and opening it only focuses the
// window, so there is nothing in it to trust or parse.
//
// A development build answers to its own scheme so it never takes over the
// installed app's links; the packaged scheme is also declared to the OS by
// electron-builder (`protocols`), which is what lets a link launch Maka cold.

import { resolve } from 'node:path';
import type { App } from 'electron';

export function appUrlScheme(isPackaged: boolean): 'maka' | 'maka-dev' {
  return isPackaged ? 'maka' : 'maka-dev';
}

/** The link that brings the app forward. */
export function appOpenUrl(isPackaged: boolean): string {
  return `${appUrlScheme(isPackaged)}://open`;
}

/**
 * Whether this process may claim the scheme. On macOS a link reaches only a
 * bundle whose Info.plist declares the scheme: the packaged app (builder
 * `protocols`) and the staged `Maka Dev.app` (`scripts/dev-app-runtime.mjs`)
 * do; the stock Electron.app a plain `npm start` runs from does not, and
 * claiming there hands the links to whichever stock Electron LaunchServices
 * finds — a bare Electron window, not Maka.
 */
export function canClaimAppUrlScheme(platform: NodeJS.Platform, execPath: string): boolean {
  return !(platform === 'darwin' && /\/node_modules\/electron\/dist\/Electron\.app\//.test(execPath));
}

/**
 * Claims the scheme and brings the window forward when a link arrives. macOS
 * delivers it as `open-url`; Windows and Linux start a second instance with
 * the link on its command line, which the single-instance lock turns into the
 * existing `second-instance` focus. Automated runs pass `claim: false` and
 * leave the OS's handlers alone.
 */
export function installAppUrlScheme(
  app: Pick<App, 'isPackaged' | 'setAsDefaultProtocolClient' | 'on' | 'focus'>,
  options: { claim: boolean; focus: () => void },
): void {
  const scheme = appUrlScheme(app.isPackaged);
  if (options.claim && canClaimAppUrlScheme(process.platform, process.execPath)) {
    // Unpackaged, Electron is the executable and the app path its argument.
    const claimed = process.defaultApp && process.argv[1]
      ? app.setAsDefaultProtocolClient(scheme, process.execPath, [resolve(process.argv[1])])
      : app.setAsDefaultProtocolClient(scheme);
    if (!claimed) console.warn(`[app-url] could not register ${scheme}://`);
  }
  app.on('open-url', (event, url) => {
    if (!url.startsWith(`${scheme}:`)) return;
    event.preventDefault();
    // Someone chose "Open Maka": macOS's cooperative activation would
    // otherwise leave the browser in front.
    app.focus({ steal: true });
    options.focus();
  });
}
