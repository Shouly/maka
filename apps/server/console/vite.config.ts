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

// The admin console's build (design §3.2): a single-page app served by the
// server under /admin. It is drawn with the desktop app's own design system
// — its tokens, fonts and components are imported from the renderer's
// source, not copied — so the console and Maka's Settings look the same.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

export default defineConfig({
  root: HERE,
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: /^@desktop\//, replacement: `${resolve(REPO_ROOT, 'apps/desktop/src/renderer')}/` },
      // The renderer's components read only the locale from @maka/ui; the
      // rest of that package (markdown, math, code) has no place here.
      {
        find: /^@maka\/ui$/,
        replacement: resolve(REPO_ROOT, 'packages/ui/src/locale-context.tsx'),
      },
    ],
  },
  build: {
    outDir: resolve(HERE, '../dist/console'),
    emptyOutDir: true,
    assetsDir: 'assets',
    // Fonts ship as files: the page's policy has no reason to take them inline.
    assetsInlineLimit: (filePath: string) =>
      /\.(?:woff2?|ttf|otf|eot)$/iu.test(filePath) ? false : undefined,
  },
});
