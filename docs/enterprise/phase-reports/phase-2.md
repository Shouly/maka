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

# Phase 2 handoff — shell, sidebar, welcome, palette

Implements [plan §6 Phase 2](../frontend-rewrite-plan.md#phase-2--shell-sidebar-welcome-palette)
plus the desktop-shell rule added as [plan §2.12](../frontend-rewrite-plan.md).

## What is on screen

- **Window titlebar row** (`components/layout/WindowTitlebar.tsx`, `.maka-window-titlebar` in
  `styles/globals.css`): one absolute, transparent 36px strip — the only drag surface — laid out as a
  three-column grid aligned to the sidebar width. Column 1 (`shell-topbar-rail`): sidebar toggle and
  search, immediately right of the macOS traffic lights (gutters from `env(titlebar-area-*)`,
  floored at 24px). Column 2 (`titlebar-identity`): the session identity from
  `SessionIdentity.tsx` — parent breadcrumb for branches, inline-renameable title, project (opens the
  folder), git branch badge. Column 3: right-side actions (empty until Phase 3/4 add the model
  switcher and workbar toggle). ⌘B toggles the sidebar; the toggle also drives the collapsed-state
  hover peek.
- **Sidebar** (`components/layout/Sidebar.tsx` + `sidebar-parts/`): relx row structure and motion,
  Maka data — sessions grouped by time or project (`store/session-list-model.ts`), running/stale/
  flagged/branch badges, row menu (open, rename, flag, archive, delete with Host-side removal
  preview), project rows with new task / rename / archive / restore / relink / reveal, nav rows for
  Skills / MCP / Automations (pending count), footer with the update chip and Settings. Collapse,
  resize and peek come from `hooks/use-sidebar-layout.ts`; layout keys are the original
  `maka-chat-list-*` localStorage keys. No logo header: the sidebar starts with "New task".
- **Welcome** (`components/welcome/`): serif time-of-day greeting, prompt suggestions, a plain
  textarea composer (Phase 3 replaces it with TipTap) with the workspace picker and model picker,
  readiness notice, onboarding recovery hero.
- **Palette and overlays** (`components/palette/`): ⌘K command palette (tasks, settings sections,
  theme, modules, folders, diagnostics, proxy test, default connection, runtime debug), keyboard
  help, search modal (`search.thread`, `data-maka-contract="search-modal"`).
- **Stores added**: `session-list-model`, `new-task-store`, `onboarding-store`,
  `scheduled-tasks-store`, `update-store`, `window-commands`; `hooks/use-session-list.ts`,
  `use-sidebar-layout.ts`, `use-hotkeys.ts`. The e2e fixture's UI state is applied once the stores
  start.
- **Placeholders** for Settings and the module pages (Phase 5) and a card-list `SessionView`
  (Phase 3). `RuntimeDebug` stays reachable from the palette.

## Verification

All gates green (`build`, desktop `typecheck`, `lint`, `format:check`, ASF headers, renderer
architecture with a regenerated ledger, locale hygiene, third-party notices, knip); 1397 desktop
tests + 63 renderer state/presentation tests; the Electron smoke test
(`store/__tests__/electron-smoke.mjs`, real preload + Runtime Host + SQLite, FakeBackend) passes
nine checks: shell mounts, new task streams a reply, sidebar lists it, rename persists, filter
narrows, ⌘K, search modal, theme switch through settings IPC, collapse publishes
`data-sidebar-state`. Screenshots under `.maka-shots/enterprise/phase2-*.png`.

## Open for Phase 3 / 4 / 5

- Titlebar column 3 is empty: Phase 3 places the model switcher, Phase 4 the workbar toggle.
- `SessionView.tsx` and the welcome textarea are placeholders for the Phase 3 transcript/composer.
- `useTurnPresentation` (footer actions, lineage badges) is still to be built from
  `lib/ported/turn-footer-actions.ts` + `derive-turn-lineage-badges.ts`.
- Settings and module pages are placeholders (Phase 5).
- The collapsed-sidebar screenshot shows the hover peek (the pointer rests on the toggle after the
  click); the collapsed state itself is asserted through `data-sidebar-state`.
