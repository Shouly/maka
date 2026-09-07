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

// External links.
//
// There is no `openExternal` on the preload bridge, and there does not need to
// be: `main-window.ts` installs `setWindowOpenHandler`, which intercepts every
// `window.open` / `target="_blank"`, hands the URL to `shell.openExternal` and
// denies the in-app open. That interception is the renderer's whole API for
// leaving the app, and it is why the old renderer's markdown link rendered as
// an `isExternalLink` anchor rather than calling IPC.
//
// The scheme gate is `@maka/ui`'s `isSafeExternalScheme` (http/https/mailto),
// the same predicate `markdown-body.tsx` used before the rewrite: main's own
// `isExternalUrl` accepts exactly those three, so anything else would open
// nothing and silently look broken.

import { isSafeExternalScheme } from '@maka/ui/maka-uri';

/**
 * Hand a URL to the OS. Returns false when the scheme is not one the host will
 * open, so a caller can render the link as inert rather than pretending.
 */
export function openExternal(url: string): boolean {
  if (!isSafeExternalScheme(url)) return false;
  const host = (globalThis as { window?: Window }).window;
  if (!host?.open) return false;
  // `noopener` also forces a fresh browsing context, which is what makes the
  // window-open handler — rather than a same-window navigation — see the URL.
  host.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
