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

# Desktop renderer

The enterprise renderer implements the shell, transcript and TipTap composer, interaction prompts,
five right-pane faces, settings and the Skills/MCP/Scheduled module pages. Phase reports and
remaining acceptance limits live in [`docs/enterprise`](../../../../docs/enterprise/).

## Data flow

`bridge/` is the only production renderer entry to `window.maka`. Zustand stores own the
session catalog, active-session subscriptions, Host-scoped resources, mutation state and layout.
`hooks/` binds those lifetimes to React; components consume projections and call store actions.
The active-session pipeline reuses `@maka/ui`'s event projection and `TurnViewModel`, with a
bounded transcript range. Do not create a second event reducer inside a component.

| Path | Responsibility |
| --- | --- |
| `main.tsx`, `app.tsx` | Cached theme/locale bootstrap, fixtures, providers, error boundary and renderer-ready handshake |
| `components/layout/` | Desktop titlebar, sidebar, shell navigation and global overlays |
| `components/session/`, `components/composer/` | Transcript, history, tool timeline, drafts, steering and interaction prompts |
| `components/workbar/` | Files, Git changes, xterm, trace and native browser viewport |
| `components/settings/`, `components/modules/` | Host-scoped settings and module management |
| `components/ui/`, `styles/globals.css` | Shared primitives and design tokens |
| `store/`, `hooks/`, `bridge/` | State ownership, subscriptions and typed preload wrappers |
| `lib/ported/` | Reused pure models and browser persistence helpers |
| `locales/` | Typed zh-CN / zh-TW / en catalogs |
| `components/dev/` | Explicit debug views; not the default application surface |

The composer persists document/folder drafts under `maka-composer-drafts`; File objects stay
process-local. Successful admission clears only the submitted snapshot. Unknown outcomes retain
the draft and admission id. `maka-new-task-reload-intent-v1` preserves an explicit welcome
surface during renderer reload; ordinary startup restores available non-archived history.

## Contracts and checks

Preserve `index.html`'s exact CSP and entry shape, `.appFrame`, `.maka-error-surface`,
`notifyRendererReady`, `data-maka-file-drop-target`, search-modal diagnostics, existing storage
keys, and the single titlebar drag surface. No Node/Electron imports in production renderer
code. Legacy overlay/browser-dialog token assets still have native consumers; they are not
unused renderer CSS.

From the repository root:

```sh
npm run build
npm --workspace @maka/desktop run typecheck
npm run lint
npm run format:check
npm run check:renderer-architecture
npm run check:locale-hygiene
npm run check:third-party-notices
npm run check:e2e-budget
npm --workspace @maka/desktop run e2e
npm --workspace @maka/desktop run test:renderer-smoke
npm --workspace @maka/desktop run test:composer-prompts
npm test
```

E2E uses disposable profiles and FakeBackend with real preload, Runtime Host and SQLite.
`e2e/accessibility.spec.ts` audits Chromium's accessibility tree using the repository's
unnamed-actionable-role rules. `scripts/desktop-real-window-smoke.mjs --programmatic-only`
checks native window flags and search-modal diagnostics. Manual OS edge dragging and live
provider credentials remain separate acceptance evidence; automated passes do not certify them.
