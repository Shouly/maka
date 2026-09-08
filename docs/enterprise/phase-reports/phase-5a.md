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

# Phase 5a handoff — the Settings surface and its first nine pages

Implements [plan §6 Phase 5a](../frontend-rewrite-plan.md#phase-5--settings-and-module-pages)
under the desktop shell rules of [§2.12](../frontend-rewrite-plan.md).

## What is on screen

- **The surface** (`components/settings/SettingsView.tsx`, `data-maka-contract="settings-surface"`):
  the reference design's `setting/layout.tsx` geometry — a scrolling column carrying the page
  title, and a `220px` sticky nav beside a `max-w-6xl` content column with a `32px` gap. It
  replaces the CONTENT column only: the window titlebar keeps its three columns and its sidebar
  toggle, the sidebar stays usable, and Escape closes Settings and gives the column back. There is
  no routing — the section is `uiStore` state under the unchanged `maka-settings-section-v1`,
  because the main process blocks navigation outright.
- **The titlebar while Settings owns the column** (`SettingsIdentity.tsx`): the identity slot reads
  "Settings · <page>" on the same `data-maka-contract="titlebar-identity"` node the session
  identity uses; the actions slot is empty. `AppShell` gained two lines, not a restructure.
- **The nav** (`SettingsNav.tsx`, `data-maka-contract="settings-sidebar"`): 32px rows, r8, 14/20,
  a 20px icon that does not change colour when selected — only the label rises to the primary tier
  and 500. Thirteen rows in the pre-rewrite four groups (`nav-group-summary.ts`), each carrying
  `data-settings-section`. The three scope-deferred pages (`daily-review`, `import-tasks`,
  `bot-chat`) are absent; `SETTINGS_SECTIONS` in `@maka/core` is untouched, and
  `resolveSettingsSection` is the single place that turns a stored value, a deep link or the e2e
  fixture's `openSettingsSection` into a page — a deferred or unknown id lands on `general` rather
  than on an empty column.
- **General** (`GeneralSettings.tsx` + `NetworkProxySection.tsx`): display name, interface language,
  assistant tone; notifications, incognito, follow-project-instructions; the default model,
  permission mode (full access confirmed first, the same dialog the composer raises) and thinking
  level; shell preference and executable; the network proxy with its own section. Every write is
  fire-and-forget with a toast on failure and no success toast — a settings page that stays silent
  when it works. Two channels, one form: `settingsStore.update` routes each patch by the same
  `shared/settings-ownership.ts` predicate the main process routes by, and each row reads from the
  snapshot that owns it (Host-owned fields from the Host projection, client-owned from the client
  snapshot, because a client write does not refresh the Host projection). The default model is
  neither — it is a connection target, written through `connections.setDefaultModel`.
- **The proxy section** is the one optimistic form (`hooks/use-settings-draft.ts` over
  `lib/ported/optimistic-settings-draft.ts`): a typed host must not snap back mid-write, a failed
  write restores what is stored rather than what was typed, overlapping writes are last-intent-wins,
  and a subscription snapshot that arrives mid-flight lands only once the write settles. The
  password is never part of the settings object — it travels as a `credential: {kind:'replace'}`
  operation and comes back only as `passwordConfigured`, and "Test" flushes the pending secret to
  disk before asking the Host, so a just-typed password is not reported as missing.
- **Appearance** (`AppearanceSettings.tsx`): theme as a three-way segmented control, the app-icon
  picker (38 shipped tiles plus imported artwork, with import and per-tile remove), and the UI and
  terminal font sizes. Nothing here applies the change itself — `app.tsx` already watches the client
  settings and calls `applyTheme` / `applyUiFontSize` / `applyTerminalFontSize`, the same path the
  command palette's theme commands take, so a write that fails leaves the UI showing what is stored.
  The icon is the exception and deliberately so: `clientOwnedSettingsPatch` strips `appIcon` out of
  a generic patch, so selection goes through `app.selectIcon` and the tile follows the snapshot main
  pushes back.
- **Workspace** (`WorkspaceSettings.tsx` + `RuntimeHostProfilesSection.tsx` +
  `DirectoryBrowserDialog.tsx`): the Runtime Host list (readiness chip, default selector,
  enable/disable, remove) with a manual add form for a remote Host that is already running (TLS or
  acknowledged plaintext), and the project catalog for the selected Host — set/clear default,
  rename in place, reveal, relink, remove (archive) and restore. Every control reads the Host's
  `capabilities` rather than assuming what the local Host can do, which is also what decides whether
  "Add project" opens this machine's native dialog or the Host directory browser. The browser walks
  the Host's published roots and registers the folder currently open, because the breadcrumb is the
  selection.
- **Usage** (`UsageSettings.tsx`): the range is a persisted client setting, the four totals are
  read from `settings.usageStats`, and cost is qualified rather than asserted —
  `estimatedUsageCost` returns nothing when the range priced nothing, and `$0.00` in that case
  would be a claim the ledger cannot make. Breakdowns by provider, model, tool and price are bands
  rather than a chart, the same call the Trace face made in Phase 4.
- **Archived tasks** (`ArchivedTasksSettings.tsx`): the same catalog the rail reads, through the
  same projection with `includeArchived`, so an edit-and-resend family collapses here exactly as it
  does in the rail. Restore is one press; delete asks the Host how much it removes first
  (`previewRemoval`) and writes with `requireArchived`, so a task restored between the confirm and
  the write is kept.
- **Data** (`DataSettings.tsx`): the workspace path with open-in-Finder and copy, the two "clear"
  rows kept apart (prompt history is global, drafts are per-task and unsent), and the config
  export/import with its four categories and its conflict strategy. `cancelled` is a value, not a
  failure — pressing Escape in a native dialog does not earn a red toast.
- **Permissions & Capabilities** (`PermissionsSettings.tsx`): the four OS permissions with a status
  chip and up to three actions, plus the capability snapshot beside them with its five layers, its
  required permissions and its guidance. Which actions a row offers is main's answer
  (`canOpenSettings` / `canRequest` / the drag-grant id list), not a platform check here, so a
  non-macOS build shows the rows and none of the buttons. The page re-reads on window focus and on
  `visibilitychange`, because a grant made in System Settings notifies nobody.
- **Health** (`HealthSettings.tsx`): the snapshot's signals grouped by layer with a status chip
  each, a summary strip, a refresh, and the two blocker banners computed over the whole snapshot.
  Read-only by design: every row is produced by another subsystem, and a "fix" button would have to
  guess which.
- **About** (`AboutSettings.tsx` + `lib/ported/about-update-status.ts`): version, build mode and
  channel, platform; the updater's eight states reduced to one row and one button — check, retry the
  download, or install and restart; copy diagnostics; the issue tracker and the repository through
  `bridge/external-links.ts`.
- **Models / Subagents / Memory / Web Search** keep their nav rows and open `ComingSoon.tsx`, which
  says the page is not built rather than showing controls that do nothing.
- **Copy**: `locales/settings-copy.ts` (zh-CN, zh-TW, en) carries only what the rewrite introduced —
  the surface's chrome, the Runtime Host readiness vocabulary, the two update actions About did not
  offer, and the draft-clearing row Data did not have. Everything else reuses the catalogs that
  already existed: `settings-preferences-copy`, `settings-projects-copy`, `settings-data-copy`,
  `settings-tasks-copy`, `settings-usage-copy`, `permission-center-copy`, `settings-health-copy`,
  `settings-shared-copy`, `settings-navigation-copy`, `settings-test-result-copy` and
  `shell-copy`'s `projectActions`.

## Verification

| Gate | Result |
|---|---|
| `npm run build` | pass (renderer entry contract + third-party notices byte-identical) |
| `npm --workspace @maka/desktop run typecheck` | pass (preload + main + renderer) |
| `npm run lint` | pass, 2882 files |
| `npm run format:check` | pass, 2281 files |
| `npm run check:asf-headers` | pass, 3078 covered files |
| `npm run check:renderer-architecture` | pass, ledger regenerated (`--write`) |
| `npm run check:locale-hygiene` | pass |
| `npx knip` | no `apps/desktop` findings (one pre-existing `.css` configuration hint) |
| `npm --workspace @maka/desktop run test:renderer-state` | 139 pass (121 + 18 new in `phase5-state.test.ts`) |
| `npm --workspace @maka/desktop run build:test && … test:dist` | 1397 + 139 pass |
| `npm --workspace @maka/desktop run test:composer-prompts` | pass |
| `npm --workspace @maka/desktop run test:renderer-smoke` | 38 checks pass, no renderer errors |

The Electron smoke test (real preload, Runtime Host, SQLite and FakeBackend) gained ten Phase 5a
checks: ⌘, opens Settings with the sidebar toggle still in the titlebar and "Settings" in the
identity slot; the nav lists exactly the thirteen shipped pages and none of the three deferred ones;
About reads the running build's version and ⌘, reopens the section the user left off on; the
Appearance control flips `.dark` through the real settings IPC in both directions; a General switch
round-trips through the settings IPC and still reads back after a full reload; switching the
interface language to Simplified Chinese re-renders the sidebar and the settings nav and back;
Workspace, Usage, Data, Permissions and Health each render against the real Host; a Phase 5b page
states that it is not built; a task archived from the rail appears under Archived tasks and restores
from there; Escape closes Settings and the restored task is back in the rail. `openSettingsSection`
also asserts that the nav row carrying `aria-current="page"` is the page on screen — a highlight
that disagrees with the content is the kind of bug a screenshot rationalizes away.

Screenshots: `.maka-shots/enterprise/phase5a-{general,workspace,usage,data,permissions,health,about,archived,appearance}-light.png`,
`phase5a-appearance-dark.png` and `phase5a-general-zh.png`.

## Deviations from the brief

- **Settings binds to the Host the rest of the renderer reads from.** The brief did not say which
  Runtime Host Settings writes to. `useScopedRuntimeHost` (extracted from `useRendererStores`, one
  source of truth) answers it: the selected task's Host while one is open, the default Host
  otherwise. Two answers to "which Host" is exactly how a settings page ends up showing one
  machine's values and saving to another's. The pre-rewrite Host picker was part of the Runtime Host
  management dialog, which is deferred.
- **The Runtime Host add form takes TLS and acknowledged plaintext only.** The bridge would also
  accept a manually described SSH transport (destination, ports, websocket path), but that form is
  six more fields for a case the guided setup owns, and the guided setup is deferred. The UI says
  so (`settings-copy.workspace.wizardsDeferred`) rather than offering a button that opens nothing.
- **No per-request usage log.** The pre-rewrite Usage page had five tabs, the first a filterable
  table of every metered request. Four are here (providers, models, tools, pricing); the request log
  is a data grid with its own filter, status and session-jump behaviour and belongs with the module
  pages, not with a totals page. The brief asked for "totals, by model, by day"; the ledger has no
  day axis, so the breakdowns follow the axes it does have.
- **No app-icon group headings.** The 38 shipped tiles render as one grid rather than the
  pre-rewrite's twelve captioned groups. The captions exist in the copy catalog; the grouping table
  did not survive the old page, and a caption every four tiles is a lot of chrome for a picker whose
  tiles are the content. The light/dark split is out of scope (plan §3).
- **Backend-supplied reason strings are rendered as-is.** The old pages filtered CJK strings out of
  Host-supplied `reason` text when the UI locale was not `zh-CN` (`localizedSnapshotText`). That
  helper reads the language off the payload, which is precisely what `check-locale-hygiene`'s
  `cjk-sniff` rule bans; the strings are shown unfiltered instead.
- **`bridge/projects.ts` gained a typed `revealProject` return.** `bridge-contract.d.ts` declares
  `reveal(): Promise<OpenPathResult>` but never declares `OpenPathResult`, so the namespace method
  resolves to `any`. The wrapper now borrows the union `app.openPath` spells out inline — a typed
  wrapper is the whole reason that layer exists.
- **`composerInputStore.clearAll()` is new.** Data's "clear drafts" row needs to drop the drafts in
  memory *and* on disk *and* revoke the blob URLs the attachment previews hold; reaching into
  `localStorage['maka-composer-drafts']` from a settings page would have left the running store
  holding them.

## Deferred / open

- **Archiving an edit-and-resend family from the rail is a no-op.** Found while writing the smoke:
  the row menu's Archive on a collapsed revision family resolves successfully and changes nothing —
  the task stays in the rail and never appears under Archived tasks. A single task archives
  correctly, which is what the smoke exercises. The write is `sessions:archive` →
  `client.setSessionLifecycle(representativeId, 'archived')`
  (`main/runtime-host-session-catalog-ipc-main.ts:145`), and both the IPC handler and the Host
  lifecycle rule are outside this phase's allow-list, so it is reported rather than fixed. Its
  visible cost is that a task that was ever edited-and-resent cannot be archived at all.
- **No "open logs folder" on About.** `app.openPath` takes four keys (`workspace`, `skills`,
  `memory`, `project`) and none of them is the log directory; the diagnostic report already carries
  the recent logs, and the page says so rather than offering a button that cannot work.
- **Bulk purge of the archive.** `settings-tasks-copy` still carries the pre-rewrite purge vocabulary
  (`purgeAll`, `purgeKeptRestored`, the verification outcome). The page restores and deletes one
  task at a time; the sweep needs the `SessionPurgeOutcome` reconciliation the old controller owned,
  which has no port yet.
- **Runtime Host management, peer mesh, connection codes, local remote access, SSH terminal.** All
  scope-deferred (plan §3). The profiles section shows what exists and can add, enable, default and
  remove; it cannot install, update, rotate a credential or configure directory roots.
- **What the deterministic backend cannot show.** `FakeBackend` prices nothing, so Usage shows two
  metered calls with an honest "cost unavailable" rather than a populated ledger; there are no
  imported app icons, no remote Runtime Hosts and no proxy to test. Still to be exercised by hand:
  importing and removing a custom app icon, adding a real remote Host and browsing its directories,
  a proxy test against a live proxy, a config export/import round trip, and the macOS permission
  actions (System Settings, request, drag-to-grant).
- Carried from Phase 4: the bottom workbar placement, PDF preview, multi-instance terminals.
