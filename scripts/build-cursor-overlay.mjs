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

// Build the cursor overlay renderer bundle + preload into apps/desktop/dist/overlay.
// - cursor-overlay.js: the Canvas engine host (IIFE, browser). The `js→ts` resolve
//   shim lets us bundle the engine's NodeNext `./x.js` imports straight from source.
// - cursor-overlay-preload.cjs: receive-only main→renderer bridge (CJS, electron external).
// - cursor-overlay.html: copied verbatim.
import * as esbuild from 'esbuild';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..', 'apps', 'desktop');
const srcOverlay = join(desktop, 'src', 'overlay');
const outDir = join(desktop, 'dist', 'overlay');

const jsToTs = {
  name: 'js-to-ts',
  setup(build) {
    build.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.replace(/\.js$/, '.ts')),
    }));
  },
};

/** Build the overlay renderer bundle + preload + html into dist/overlay. */
export async function buildCursorOverlay({ logLevel = 'info' } = {}) {
  await mkdir(outDir, { recursive: true });
  await buildBrowserDialogDesignTokens();
  await esbuild.build({
    entryPoints: [join(srcOverlay, 'cursor-overlay.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: join(outDir, 'cursor-overlay.js'),
    plugins: [jsToTs],
    logLevel,
  });
  await esbuild.build({
    entryPoints: [join(srcOverlay, 'cursor-overlay-preload.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron'],
    outfile: join(outDir, 'cursor-overlay-preload.cjs'),
    logLevel,
  });
  await copyFile(join(srcOverlay, 'cursor-overlay.html'), join(outDir, 'cursor-overlay.html'));
  await buildPermissionOverlay({ logLevel });
  await buildComputerUsePip({ logLevel });
  return outDir;
}

/**
 * Browser-backed recovery dialogs run outside the React renderer, but they
 * answer to the same design authority it does: `styles/globals.css` (DESIGN.md).
 * Its `:root`, `.dark` and prefers-dark blocks are plain custom properties and
 * are taken verbatim, so the card cannot drift from the palette the app is
 * showing behind it.
 *
 * The slice stops at `@theme inline`. Everything from there on is Tailwind
 * source — it means nothing without the framework and must not reach a
 * standalone card. `--font-sans` is re-emitted out of it anyway, for its TAIL:
 * the card cannot load the app's own faces (the `@font-face` blocks sit above
 * the slice, their URLs are relative and the card is a `data:` document, and
 * its CSP grants no `font-src`), so it always lands on the next entry — but
 * sharing the stack keeps the system, CJK and emoji fallbacks in the app's
 * order, which is what a Chinese dialog actually renders in.
 */
async function buildBrowserDialogDesignTokens() {
  const globals = await readFile(join(desktop, 'src', 'renderer', 'styles', 'globals.css'), 'utf8');
  const tokensStart = globals.indexOf('\n:root {');
  const themeStart = globals.indexOf('\n@theme inline {');
  const fontSans = /^\s*--font-sans:.*$/m.exec(globals);
  if (tokensStart < 0 || themeStart < 0 || themeStart <= tokensStart || !fontSans) {
    throw new Error('Unable to locate the dialog design-token boundaries in globals.css');
  }
  await writeFile(
    join(outDir, 'browser-dialog-design-tokens.css'),
    [
      globals.slice(tokensStart + 1, themeStart),
      `:root {\n  ${fontSans[0].trim()}\n}`,
      await browserDialogIconFace(),
    ].join('\n'),
    'utf8',
  );
}

/**
 * The icon font, inlined.
 *
 * The card is a `data:` document with no `font-src` beyond `data:`, so it can
 * reach nothing on disk — and these marks have to be the app's own. Redrawing
 * them as SVG paths was the alternative, and it is the wrong one: a hand-traced
 * glyph is a second icon set that nobody regenerates when the real one moves.
 *
 * The whole variable face rides along (~92 KB, ~125 KB once base64'd) because
 * subsetting it would need a font toolchain this repo does not carry. It is
 * read once per dialog process and these windows are rare.
 */
async function browserDialogIconFace() {
  const woff2 = await readFile(
    join(desktop, 'src', 'renderer', 'assets', 'fonts', 'anthropic', 'anthropicons-variable.woff2'),
  );
  return [
    '@font-face {',
    "  font-family: 'Anthropicons-Variable';",
    `  src: url('data:font/woff2;base64,${woff2.toString('base64')}') format('woff2');`,
    '  font-weight: 400 700;',
    '  font-style: normal;',
    '  font-display: block;',
    '}',
    '',
  ].join('\n');
}

/**
 * The Computer Use picture-in-picture mirror. Same shape as the cursor overlay
 * — module page bundle + CJS preload + verbatim html — sharing `dist/overlay`
 * so one `build:overlay` step covers all three panels.
 *
 * Its preload is receive-only and narrower than the cursor overlay's: the
 * mirror displays frames main hands it and has nothing to report back.
 */
export async function buildComputerUsePip({ logLevel = 'info' } = {}) {
  await mkdir(outDir, { recursive: true });
  await esbuild.build({
    entryPoints: [join(srcOverlay, 'pip.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
    outfile: join(outDir, 'pip.js'),
    plugins: [jsToTs],
    logLevel,
  });
  await esbuild.build({
    entryPoints: [join(srcOverlay, 'pip-preload.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron'],
    outfile: join(outDir, 'pip-preload.cjs'),
    logLevel,
  });
  await copyFile(join(srcOverlay, 'pip.html'), join(outDir, 'pip.html'));
  return outDir;
}

/**
 * The drag-to-grant permission card. Same shape as the cursor overlay —
 * IIFE page bundle + CJS preload + verbatim html — and it shares
 * `dist/overlay`, so one `build:overlay` step covers both panels.
 *
 * Unlike the cursor overlay this page IS interactive (the user grabs the
 * row out of it), so its preload is send-capable; see the preload source
 * for what it is allowed to say.
 */
export async function buildPermissionOverlay({ logLevel = 'info' } = {}) {
  await mkdir(outDir, { recursive: true });
  await esbuild.build({
    entryPoints: [join(srcOverlay, 'permission-overlay.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: join(outDir, 'permission-overlay.js'),
    plugins: [jsToTs],
    logLevel,
  });
  await esbuild.build({
    entryPoints: [join(srcOverlay, 'permission-overlay-preload.ts')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    external: ['electron'],
    outfile: join(outDir, 'permission-overlay-preload.cjs'),
    logLevel,
  });
  await copyFile(
    join(srcOverlay, 'permission-overlay.html'),
    join(outDir, 'permission-overlay.html'),
  );
  return outDir;
}

// Run directly (npm run build:overlay) or import buildCursorOverlay (dev.mjs).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = await buildCursorOverlay();
  console.log('overlays built →', dir);
}
