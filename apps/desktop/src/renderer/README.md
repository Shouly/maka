<!--
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing,
  software distributed under the License is distributed on an
  "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
  KIND, either express or implied.  See the License for the
  specific language governing permissions and limitations
  under the License.
-->

# Renderer (`apps/desktop/src/renderer`)

**Status: mid-rewrite.** The Astryx-based renderer was removed in Phase 0a of
the enterprise renderer rewrite. What lives here now is the skeleton the rest of
the phases build on; the plan of record is
[`docs/enterprise/frontend-rewrite-plan.md`](../../../../docs/enterprise/frontend-rewrite-plan.md),
with the contract the new UI must program against in
[`docs/enterprise/research/maka-renderer-contract.md`](../../../../docs/enterprise/research/maka-renderer-contract.md)
and the feature inventory it must not lose in
[`maka-renderer-feature-inventory.md`](../../../../docs/enterprise/research/maka-renderer-feature-inventory.md).

## What is here today

| Path | What it is |
| --- | --- |
| `index.html` | The pinned entry document. Three `<meta>` (charset, viewport, exact CSP), one `<script type="module" src="/main.tsx">`, and the inline `.maka-preload` skeleton. `scripts/vite-renderer-entry-contract.ts` fails the build on any other shape. |
| `main.tsx` | Phase 0a placeholder. Mounts a `.appFrame` root, sets `colorScheme` from `prefers-color-scheme`, and calls `window.maka.appWindow.notifyRendererReady()` inside two nested `requestAnimationFrame`s so the main process reveals the window. Phase 0b replaces it with the real bootstrap. |
| `styles/globals.css` | Phase 0a placeholder: `@import "tailwindcss"` plus two opaque body colours. Phase 0b replaces it with the relx token file (`@theme inline`, fonts, utilities, the Maka additions in plan §2.6). |
| `lib/ported/` | Pure and portable modules carried over from the old renderer — transcript range store, live-turn snapshot, session health/settlement, workbar and session-rail layout, theme and titlebar sync, brand marks, copy helpers. Phase 1 re-homes them into `bridge/`, `store/` and `lib/`; until then they are the only renderer code with real behaviour. |
| `locales/` | The 28 typed `*-copy.ts` catalogs (`UiCatalog` shape, zh-CN / zh-TW / en). Kept verbatim; `scripts/check-locale-hygiene.mjs` and the copy-catalog validator in `check-renderer-architecture.mjs` gate them. |
| `assets/` | `fonts/anthropic/*.woff2` and the provider brand SVGs. |
| `public/THIRD_PARTY_LICENSES.txt` | Byte-compared against the packaged copy by `build:renderer`; regenerate with `npm run generate:third-party-notices`. |
| `computer-use-overlay/engine/` | Not renderer UI. `src/overlay/cursor-overlay.ts` and `src/main/computer-use/` import this engine, so it stays at this path. |
| `maka-tokens.css`, `astryx-theme/maka.css` | Also not renderer UI: `scripts/build-cursor-overlay.mjs` slices their token prefixes into `dist/overlay/browser-dialog-design-tokens.css`, which `src/main/browser-message-box.ts` loads. They leave when that seam does. |

## Rules that outlive the rewrite

- `window.maka` is reachable only from `src/renderer/bridge/` (Phase 1) and
  `main.tsx`. `check-renderer-architecture.mjs` enforces it; the files still
  carrying the old access are listed in `renderer-architecture.json` under
  `windowMakaPortedDebt` and that list may only shrink.
- No `electron` and no Node builtins anywhere in the renderer.
- Every user-visible string goes through a `UiCatalog` with zh-CN, zh-TW and en.
- Every source file carries the ASF header.
- The fixed main-process contracts: `.appFrame`, `.maka-error-surface`,
  `notifyRendererReady`, `data-maka-file-drop-target`,
  `data-maka-contract="search-modal"`, `--h-titlebar: 36px`, one
  `-webkit-app-region: drag` surface, and the `maka-*-v1` localStorage keys.
