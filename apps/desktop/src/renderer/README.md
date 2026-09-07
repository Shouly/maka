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

**Status: Phase 1 bridge and state implemented; Phase 2 shell is next.**
The default entry is `components/dev/RuntimeDebug.tsx`, a temporary acceptance
surface over real Runtime Host sessions. It lists sessions, submits/stops turns,
shows the `TurnViewModel[]` projection, pages history, and exposes interaction
responses. The Design system button retains the Phase 0b component preview.

The plan of record is
[`docs/enterprise/frontend-rewrite-plan.md`](../../../../docs/enterprise/frontend-rewrite-plan.md).
The preload and turn contracts remain those in
[`maka-renderer-contract.md`](../../../../docs/enterprise/research/maka-renderer-contract.md).
See [PHASE1.md](./PHASE1.md) for the handoff, verification commands and limits.

## Layout

The tree follows plan §5. Phase 2 consumes the existing stores and hooks; it does not introduce another event pipeline.

| Path | What it is |
| --- | --- |
| `index.html` | The pinned entry document. Three `<meta>` (charset, viewport, exact CSP), one `<script type="module" src="/main.tsx">`, and the inline `.maka-preload` skeleton in the design system's surface-1 colours. `scripts/vite-renderer-entry-contract.ts` fails the build on any other shape. |
| `main.tsx` | Bootstrap. Cached theme + font size, the e2e fixture's document state and the UI locale, all before `createRoot`; `notifyRendererReady` after, inside two nested frames, so main reveals the window. |
| `app.tsx` | Providers (locale, tooltip, toaster), the error boundary, the `.appFrame` root and the one draggable titlebar strip. |
| `styles/globals.css` | The whole palette. Copied from the reference design system (`@theme inline`, the 0.5px hairline utilities, fonts, motion, Prism roles) with the relx-server-only blocks removed, plus a delimited *Maka desktop additions* block for what the main process requires. There is no `tailwind.config`: this file is the configuration. |
| `hooks/` | Renderer lifetime, scoped subscriptions, `useActiveTurns`, `useLiveTurnSnapshot`, and `useProjectContext`. |
| `bridge/` | The only modules allowed to name `window.maka`. Typed, optional-chained wrappers; `check-renderer-architecture.mjs` enforces the boundary. |
| `components/ui/` | The ported design-system primitives — button, dialog, dropdown-menu, popover, select, switch, scroll-area, toast, tooltip, fields, skeletons, shimmer, the markdown/code/diff/json renderers, and the class-string modules. |
| `components/icons/` | `Anthropicon.tsx` (the icon font is the icon system — no icon library) and the wordmark. |
| `components/layout/`, `components/dev/` | `MainHeader` geometry; temporary runtime and design-system acceptance pages. Phase 2 replaces the runtime debug surface. |
| `lib/` | `cn`, `theme.ts` (light/dark/auto, titlebar sampling and modal dim), `fixture.ts`, the markdown pipeline helpers, and `ported/` — reused pure modules carried over from the old renderer; existing paths remain stable for main-process contract tests. |
| `store/` | Zustand stores. Session catalog, active transcript/live events/interactions/queue, turn operations, scoped projects/connections/settings, UI/workbar layout and toasts. |
| `locales/` | Typed `*-copy.ts` catalogs (`UiCatalog` shape, zh-CN / zh-TW / en). |
| `assets/` | `fonts/anthropic/*.woff2` (7 files, Anthropicons included) and the provider brand SVGs. |
| `public/THIRD_PARTY_LICENSES.txt` | Byte-compared against the packaged copy by `build:renderer`; regenerate with `npm run generate:third-party-notices`. |
| `computer-use-overlay/engine/` | Not renderer UI. `src/overlay/cursor-overlay.ts` and `src/main/computer-use/` import this engine, so it stays at this path. |
| `maka-tokens.css`, `astryx-theme/maka.css` | Also not renderer UI: `scripts/build-cursor-overlay.mjs` slices their token prefixes into `dist/overlay/browser-dialog-design-tokens.css`, which `src/main/browser-message-box.ts` loads. They leave when that seam does. |

## Rules that outlive the rewrite

- `window.maka` is reachable only from `src/renderer/bridge/` and `main.tsx`.
  `check-renderer-architecture.mjs` enforces it; the files still carrying the
  old access are listed in `renderer-architecture.json` under
  `windowMakaPortedDebt` and that list may only shrink.
- Colours are named, never written. Under `components/**` and in `app.tsx` the
  architecture check rejects Tailwind arbitrary colour values (`bg-[#…]`) and
  raw colour literals in inline styles and class-string modules; use a
  semantic class from `@theme inline`, or `bg-[var(--token)]` for a token that
  has no utility. `components/icons/**` (brand marks) and `components/dev/**`
  are exempt.
- No `electron` or Node builtins in shipped renderer code. Node-only test runners live under `store/__tests__/` and are never imported by the app. No `next/*`.
- Every user-visible string goes through a `UiCatalog` with zh-CN, zh-TW and
  en. The one exception is `components/dev/`, which Phase 2 deletes.
- Every source file carries the ASF header.
- The fixed main-process contracts: `.appFrame`, `.maka-error-surface`,
  `notifyRendererReady`, `data-maka-file-drop-target`,
  `data-maka-contract="search-modal"`, `--h-titlebar: 36px`, one
  `-webkit-app-region: drag` surface, and the `maka-*-v1` localStorage keys.
