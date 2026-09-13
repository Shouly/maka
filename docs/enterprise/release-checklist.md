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

# Enterprise build — open items before a release

What the renderer rewrite has not settled. Nothing here is a decision never to
do it: an item is open until it lands. Each names where the problem lives and
what would close it. When an item lands, delete it here; the phase reports
under `phase-reports/` keep the record of what closed and when.

Ordered by what it is, not by when it was found: release blockers, then
defects, then unimplemented features, then the verification still owed. How the
gap list was measured — and what that measure cannot see — is at the end.

**Baseline.** Measured 2026-09-12 against upstream `c08626bf2`, the head of the
eleventh sync. The twelve commits from there to `ca4136a02` (the twelfth
sync) add or remove no renderer surface, so the table holds for both. The eight
commits from there to `09f0a5d36` (the thirteenth sync, 2026-09-13) touch only
surfaces already listed — WorkHub (#5198, #4878) and its Astryx choice panel —
or ones re-implemented here in the same sync (the Generated Files menu of
#5216, the skill-picker filter of #5249). Re-measure after the sync that
follows.

## Must fix before shipping to users

- **ripgrep is a hard runtime dependency the app does not bundle.**
  `packages/runtime/src/workspace-executor.ts` spawns a bare `rg` for the
  `Grep` tool, and `packages/runtime/src/filesystem-worker/launch-spec.ts`
  probes `PATH` plus `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`. A
  packaged app launched from Finder gets a minimal `PATH`, so on a machine
  without Homebrew ripgrep the Grep tool fails with `spawn rg ENOENT`
  (upstream only documents `winget install` for Windows). Five
  `@maka/runtime` tests fail the same way on a dev machine without `rg`.
  Close by bundling a platform `rg` binary next to the other bundled tools
  (`apps/desktop/bundled-tools.json`, electron-builder resources) and
  resolving it first, or by giving `Grep` a JS fallback. Decide before the
  first internal release. (Found 2026-09-07.)
- **Font licensing.** `apps/desktop/src/renderer/assets/fonts/` carries the
  three Anthropic families scraped from claude.ai with no licence (owner
  accepted the risk for internal builds). Replace before any external
  release; `styles/globals.css` `--font-sans/serif/mono` are the only seams.
- **Company model gateway — the endpoint is still nobody's to hand out.**
  Landed in Phase 5b: `relx-gateway` is a registered provider
  (`packages/core/src/provider-registry.ts`, OpenAI-compatible chat
  completions, `category: 'custom'`, `catalogGroup: 'recommended'`,
  `catalogOrder: -1` so it heads the add-connection catalog, API key required,
  base URL required, `GET <baseUrl>/models` discovery), with display copy in
  three locales and a drawn (non-trademark) mark under
  `apps/desktop/src/renderer/lib/ported/provider-*`. What is NOT settled is
  operational: the gateway host is deployment-specific, so every user has to be
  told the URL out of band. Decide before the first internal release whether
  the build ships a default `baseUrl` for the company deployment (one line in
  the registry entry) or keeps asking each user for it.

## Defects — wrong behaviour, lost data, crashes

Ours does something upstream does not, and the difference costs the user. These
come before any feature work.

- **Archiving an edit-and-resend family is a silent no-op.** `sessions:archive`
  resolves but the Host ignores the lifecycle change for a family member
  (`apps/desktop/src/main/runtime-host-session-catalog-ipc-main.ts:130`), so a
  task that was ever edited-and-resent cannot be archived from the rail or
  from Settings › Archived tasks. Found in Phase 5a; needs a main/Host fix —
  it is outside the renderer allow-list.

## Not implemented

Everything below is implemented in the main process and the backend packages:
their IPC handlers are registered and the preload exposes them. This fork's
only change to `apps/desktop/src/preload/bridge-contract.d.ts` is two added
methods (`projects.prepareDirectory`, `projects.createPrepared`); nothing is
removed. The gap is the renderer alone.

### Whole surfaces with no page here

A namespace counts as unreached when no file under `src/renderer/bridge/`
opens it. Method counts are from the contract.

| Feature | Unreached methods | What it is |
| --- | --- | --- |
| Session collaboration | 19 | `sessionCollaboration.*`: share a task with another Maka — invitations, guest grants, mounts, turn requests and their decisions |
| Runtime Host management | 14 | `runtimeHostManagement.*`: install and update policy, project directories, resources, direct peer, credential rotation |
| Pets | 7 | `pets.*`: pet packs — list, select, sprite sheet, import a local directory |
| Daily review | 7 | `dailyReview.*`: the review itself plus its config, run-now, archive list and Markdown export |
| Host onboarding | 6 | `runtimeHostOnboarding.*`: first-run Host setup, including WSL distribution enumeration |
| Agent Graph | 6 | `graphs.*`: epochs, snapshot, operator inspection, stop |
| Local remote access | 5 | `localRuntimeHostRemoteAccess.*`: turn remote access on for this machine's Host, mint and revoke a connection code |
| Host SSH terminal | 5 | `runtimeHostSshTerminal.*`: a terminal against a remote Host |
| WorkHub | 5 | `workHub.*`: the persistent WorkHub session and its floating window |
| External agents | 4 | `externalAgents.*`: install and configure an ACP agent (Antigravity) from Settings › External agents. Upstream #5164, arrived with the eleventh sync; the `external-agents` nav id is already registered in `components/settings/settings-sections.ts` but has no page |
| Peer Mesh | 4 | `runtimeHostPeerMesh.*`: connectivity policy and execution |
| External session import | 3 | `externalSessions.*`: import history from another tool |
| Session bundles | 2 | `sessionBundles.export/import`: move a Session between installations from Settings › Import/export tasks. Upstream #5197, arrived with the eleventh sync |
| Todo | 2 | `todo.*`: the current Todo projection |
| Deep research | 2 | `deepResearch.*`: deep-research sessions |

Also with no page: IM Hub (upstream's `im_hub` agents view) and the Runtime Host
management / onboarding / SSH-terminal dialogs. Work board is deliberately parked, not missing; see
"Narrowed during the rewrite".

### Inside surfaces we do have

**Conversation** — no failure message on a failed turn (only the error class);
no "who stopped it" line on an aborted turn; no provider-retry banner with
reason, attempt and countdown during a 429 back-off; one generic "started by
the runtime" chip instead of four distinct host origins; a search hit opens the
conversation but never scrolls to or highlights the matched turn; no prompt
anchor rail; no branch-lineage breadcrumb; no memory-active pill.

**Tool rows** — no per-call duration, no live `current/total` progress, no
runtime-authored intent as the label, diff counts only inside the expanded
panel, failure text only after expanding, and connector/tool-activation
results dumped as raw JSON instead of the friendly card.

**Composer** — a large paste is not staged as a quote; attachments cannot be
added while a turn runs; the draft does not follow a newly picked workspace
target (it vanishes); no orchestration (Swarm / Graph) control; the Goal entry
is offered even when a goal is already running.

**Queued messages** — actions are not gated by entry state, and the edit box
has no Enter / Escape. (Steering and follow-up rows now say which they are and
carry different controls.)

**Sidebar** — no time ⇄ project grouping switch and no chronological list (a
project's tasks need the project expanded; project-less tasks stop at 20); no
multi-select, no bulk pin/archive, no right-click menu; no per-row last
activity, host badge, worktree marker, or "waiting for you" / "blocked" state;
no session or project hover cards; no directory-unavailable state or relink in
the rail; collapsing hides the rail entirely instead of leaving an icon strip.

**Command palette and search** — no permission-mode commands, no connection
test, substring instead of fuzzy matching; the search modal drops the matched
turn, has no keyboard navigation, and does not highlight the query.

**Settings** — General: no WorkHub switch, single-line assistant tone, no
retry on a failed Host read. Permissions: no status filter, no "last read", no
per-layer reason, no audit records, capability snapshot does not refresh on
focus. Health: counts are not clickable filters, no "last read". Memory: no
manual entry add, no per-entry archive/restore, no jump-to-draft, only the
latest backup (upstream lists save/reset/restore), no open-folder or
copy-path. Usage: no per-request log, filters, detail toggle or jump to the
session; the tab choice is not persisted. Workspace: no project-directory
editor, no "default project unavailable" notice, no refresh on Host changes.
Web search: no reveal toggle on the API key. Archived tasks: no purge-all or
purge-matching, no orphaned-subtask marker. Models: writes the whole
`modelOverrides` table on every thinking-level or add-model change (core
since #5225 documents that field as a full replacement for imports and offers
a per-model `modelOverride` CAS input with `enable`; move the toggle and
add-model there), no request-body overlay,
no per-model vision / context window / fast tier, no bulk thinking level, no
headers at creation, no select-all in the model picker, no retired-provider
handling, no signup link, no OAuth relogin from the connection page, no cancel
on an in-progress field edit, no model refresh after saving a credential.

**Modules** — against Claude's Customize, still missing: a Plugins face,
"Create a skill" / "Create with Claude" entries under Add, and a featured
banner on Discover. (Search, sort, filters and the per-page details closed
2026-09-11.)

Reached through a channel we already call, but only partly:

- **Memory** — `openBackup`, `openLatestBackup`, `restoreBackup`.
- **Runtime Host profiles** — `importConnectionCode`, `discardPairing`,
  `resolvePairingRecovery`: no recovery path when a pairing breaks.

### Entry points and commands

- **Session start modes** (`SESSION_START_MODE_SPECS`): `deep_research` and
  `bot` both start through `sessions.create` with a mode. Neither has an entry
  point here. Upstream's Quick Chat panel is gone (#1433) — what survived of
  it is exactly these two modes.
- **`/side`, `/graph`, `/swarm`**: parsed by `lib/ported/desktop-slash-command.ts`
  and refused by the composer (`components/composer/ChatInput.tsx`, the
  `^/(side|graph|swarm)` guard).
- **Palette commands.** `STATIC_COMMAND_IDS` in `locales/shell-copy.ts` names
  25 user-facing actions; `components/palette/commands.ts` implements 14 of
  them (plus `diag:runtime-debug`, which is ours). The 11 without a handler:
  `action:side-chat`, `action:new-deep-research`,
  `action:new-scheduled-task` (upstream opens the create form; `nav:automations`
  only reaches the page), `nav:daily-review`, `diag:open-skills`,
  `diag:export-conversation`, `diag:save-conversation-file`,
  `diag:open-local-memory`, and the three daily-review clipboard/save
  commands. Export and save-conversation are a real gap — upstream has an e2e
  for it (`context-window-save.spec.ts`).
- **Settings surfaces with no page here**: daily review, import/export tasks,
  external agents, the custom pet section, Host management / onboarding / SSH
  terminal / project-directory editor dialogs.

What none of this measures: a surface that calls its channel but renders only
part of the feature. That needs a page-by-page comparison.

### Narrowed during the rewrite

These were scoped out while rebuilding, not judged unnecessary. They are gaps
like any other; two of them need a change in `packages/core` as well as a
renderer surface, which is the only thing that makes them different.

- **Theme palettes** — upstream ships 11 palettes in two groups and a picker
  writing `appearance.palette`. Here `THEME_PALETTES` still exists in
  `packages/core/src/settings.ts` and the setting is still persisted, but
  `lib/theme.ts:245` makes `applyThemePalette` a no-op and no picker exists.
- **App icons** — upstream ships 40 grouped icons and a separate light/dark
  slot with its own target selector. `packages/core/src/settings.ts:191`
  narrows `APP_ICONS` to one id here, and every write is `'both'`, so
  `appIconDark` can never be set.
- **Work board** — a workbar face holding a user-owned list of deferred items:
  Inbox or current project, todo / in progress / done, rename, move, archive,
  delete. The model never sees it and nothing writes to it but the panel's own
  input box. Upstream shipped only its Phase 1; the "capture from a side chat"
  and "start as task" phases that would set it apart from a `TODO.md` have not
  landed there (`linkedSessions` has no consumer). Main, preload
  (`workBoard.*`, 7 methods) and the copy in all three locales are here;
  `hooks/use-workbar.ts:35` keeps the face out of the strip so a persisted tab
  never shows an empty body. Closing it is a port of upstream's
  `use-work-board.ts` and `work-board-panel.tsx` (about 670 lines) plus a
  `bridge/work-board.ts`. Decide when upstream's Phase 3 lands.
- **WorkHub** — the persistent session and its floating window; listed above
  under the surfaces with no page.
- **Bottom workbar dock** — `hooks/use-workbar.ts:27-32` preserves the state
  but never renders it, so a face parked at the bottom is invisible.
- **Side chat** — `/side` is parsed and refused, ⌘⌥S was repurposed to toggle
  the pane, and the `side-chat` workbar face is not registered.

### Still open from the conversation-core audit (2026-09-08)

The 2026-09-08 audit against upstream's `app-shell-chat-actions.ts` found 24
gaps; three batches and a round of regression fixes landed the same day, and
`phase-reports/core-dialogue-regressions.md` records what changed. What that
audit left open:

- The slash-command catalog port has no caller (`/compact` is hard-coded).
- `orchestrationMode` is not part of the new-task draft; the composer sends
  `'default'` unconditionally.
- Upstream's local message delivery status (#4956): preload still durably
  admits through the desktop outbox, but the renderer does not show pending
  local messages or recover from the desktop transcript cache when the live
  endpoint is unavailable.
- Carried from Phase 3: thinking-block duration, and branch banner placement.
  (Markdown attachment resources already use upstream's current
  `maka://runtime/attachments/<id>` protocol; the earlier `attachment://`
  wording was stale. The Goal chip now stands above the composer beside the
  queue plate and the revision banner, not in upstream's context layer — a
  placement, not a gap.)
- Multi-instance terminals, Trace donut charts, no "open logs folder" on About.
- The MCP directory has no "coming soon" rows because the pre-rewrite page had
  none; there is no "write a skill from text" dialog, because no preload method
  writes one.
- PDF inline preview in the Files face: `react-pdf` is not in the bundled
  dependency closure and the fixed CSP blocks `data:` embeds, so the face
  offers a notice plus "open in the system viewer". Adding it changes the
  lockfile and the third-party notices.

## Where ours goes further than upstream

Every interaction prompt carries Stop, not only the ask-user one: the prompt
slot replaces the composer for all four kinds, so a boundary, capability or
form request would otherwise trap a running turn just as completely.

About offers install-now and retry-download; Data clears composer drafts;
Permissions refreshes capabilities on its own; Web search keeps the credential
verdict on the page and offers the live query for the model provider; the
connection list has a per-connection enable switch and a global default-model
selector.

## Manual verification still owed (FakeBackend cannot exercise these)

- Real-provider turn: tool call, permission prompt, stop, regenerate, branch,
  edit-and-resend (Phase 3b).
- Files face with real artifacts (markdown / image / diff / html), "Open in
  Files" and "Open in Terminal" from real tool rows, Trace usage bands, a real
  page in the embedded browser incl. rect tracking while resizing (Phase 4).
- App-icon import/remove, adding a remote Runtime Host and browsing its
  directories, proxy test, config export/import round trip, macOS permission
  actions (Phase 5a).
- A refused update install. Both entries — the About button and the sidebar
  footer chip — now ask before interrupting, and confirming re-issues the
  request with `allowInterruptActiveTasks`. Neither the dialog nor the
  interrupt can be exercised here: it needs a downloaded update AND running
  work at the same time. The decision itself is unit-tested
  (`updateInstallOutcome`); what is owed is seeing the Host actually retire and
  the app come back on the new build.
- Resuming a paused Goal. The Host answers `goal.resume` by taking a
  continuation Turn immediately, which is why the renderer smoke arms, pauses
  and clears but does not press Resume — pressing it there would leave a Turn
  running under the next check. The call itself is unit-tested; what is owed is
  seeing the resumed Goal actually take its next Turn.
- A refused write on the MCP or Scheduled page — make the Host reject one (a
  read-only config file will do) and confirm the list stays on screen with the
  "could not refresh" row above it, rather than being replaced. The store rule
  and the branch are unit-tested; only a real refusal exercises the wiring.
- A real RELX Gateway connection end to end (verify, choose models, send a
  turn); each of the three OAuth sign-ins including sign-out and the local `gh`
  credential import; a connection test and a model-catalog refetch against a
  live provider; request headers against a real endpoint; a Tavily key saved and
  probed; an MCP server added from the directory, tested and signed into; a
  skill imported from a file; a scheduled task actually firing (Phase 5b).

## How the gap list was measured (2026-09-12, against `c08626bf2`)

Measured three ways, because no single one is complete:

1. **Bridge-layer reach.** The architecture check forces every preload call
   through `src/renderer/bridge/*`, so grepping those files against the
   contract gives an exact answer. The contract declares 47 namespaces; 16 are
   never opened here (the table above). Count per method, not per namespace:
   a namespace we do use can still hide an unreached sub-namespace, as
   `settings.bots.*` did until Phase 7b. The first pass on 2026-09-09 counted
   359 callable paths with 122 unreached; since then the eleventh sync added
   two namespaces and Phase 7b reached nine methods.
2. **Command palette ids.** `STATIC_COMMAND_IDS` against the handlers in
   `components/palette/commands.ts`: 25 named, 14 implemented.
3. **Surface inventory.** Upstream's renderer pages and settings pages
   (`git ls-tree upstream/main apps/desktop/src/renderer`), mapped against
   ours. Upstream's renderer is deleted here, so its files are read with
   `git show upstream/main:<path>`.

A second pass on 2026-09-09 compared upstream's surfaces with ours page by
page — six parallel audits reading both sides, every claim grepped against our
tree and the defects re-verified by hand. The 2026-09-12 pass re-ran the reach
and inventory checks after the eleventh sync and confirmed every row of the
table still holds on both sides.

What none of this measures: a surface that renders the whole feature but gets
a detail wrong without saying so. Only using the app finds those.

## Tooling notes

- The pre-commit biome stdin step misreads any staged file containing `⚠`
  (Biome 2.5.11 prints it as `!`); upstream's
  `packages/cli/src/tui-copy-catalog.ts` trips it. Run the other three hook
  steps by hand and commit with `--no-verify` when that is the only failure.
- `@maka/runtime` tests need `rg` on `PATH` (see the first item).
- **`npm run dev` poisons `dist/main` for every later `e2e` and `test:dist`
  run.** `apps/desktop/scripts/dev.mjs:139` esbuilds `src/main/main.ts` into a
  single bundled `dist/main/main.js`, where `build:main` (plain `tsc`) writes
  one file per module. `tsc` is incremental, so unless `main.ts` itself changed
  it never overwrites that bundle: the app then runs stale bundled main code
  while the sibling `dist/main/*.js` files are freshly compiled and loaded by
  nobody. Specs that reach into main through
  `createRequire(...)('dist/main/<module>.js')` get a second copy of the class
  and their stubs silently do nothing, so
  `session-local-recovery.spec.ts` fails on delivery states it believed it had
  paused. `npm run check:stale` does NOT catch it — it reports "dist is fresh".
  Close by `rm -rf apps/desktop/dist/main apps/desktop/tsconfig.main.tsbuildinfo`
  and rebuilding, or for good by teaching `check:stale` to reject a bundled
  `main.js`. (Found 2026-09-10.)
- Upstream #5001 (transcript navigation) shipped two tests the enterprise
  renderer cannot host: `transcript-send-viewport.test.ts` and the five
  paging-gate cases of `transcript-reading-position-controller.test.ts` drove
  the old React controller through a fake DOM. That logic now lives in
  `renderer/store/active-session-store.ts` (`loadHistory`, `prepareSend`,
  `setReadingAnchor`); the `partial-history-notice` and `transcript-scroll-cost`
  e2e specs cover it end to end, but a renderer-state unit test for the gate
  replacement rules would close the gap.
