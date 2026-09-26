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

// The app's serif and sans for the browser page, read out of the renderer
// bundle: Vite emits them into `dist-renderer/assets` under a content hash
// (`anthropic-serif-<hash>.woff2`), and that directory ships in every build.
// Read once; a bundle without them (a Vite dev server run) leaves the page on
// the system's faces.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoopbackFonts } from './loopback-listener.js';

/** The upright faces only: Vite's hash is 8 characters, so `-italic-…` never matches. */
const FACE = { serif: /^anthropic-serif-[\w-]{8}\.woff2$/, sans: /^anthropic-sans-[\w-]{8}\.woff2$/ };

export function findLoopbackFontFiles(names: readonly string[]): { serif: string; sans: string } | undefined {
  const serif = names.find((name) => FACE.serif.test(name));
  const sans = names.find((name) => FACE.sans.test(name));
  return serif && sans ? { serif, sans } : undefined;
}

export function loopbackFontsLoader(assetsDir: string): () => LoopbackFonts | undefined {
  let loaded: LoopbackFonts | null | undefined;
  return () => {
    if (loaded === undefined) {
      try {
        const files = findLoopbackFontFiles(readdirSync(assetsDir));
        loaded = files
          ? {
              serif: readFileSync(join(assetsDir, files.serif)).toString('base64'),
              sans: readFileSync(join(assetsDir, files.sans)).toString('base64'),
            }
          : null;
      } catch {
        loaded = null;
      }
    }
    return loaded ?? undefined;
  };
}
