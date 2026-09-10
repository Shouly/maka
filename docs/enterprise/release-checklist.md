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
what would close it; remove it when it lands.

Ordered by what it is, not by when it was found: release blockers, then
defects, then unimplemented features, then the verification still owed. How the
gap list was measured — and what that measure cannot see — is at the end.

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
come before any feature work: several lose data silently.

### In the renderer

1. **Editing a bot-delivery scheduled task converts it to a local
   notification.** `scheduledTaskEffectFromFields`
   (`lib/ported/scheduled-task-form-payload.ts:80`) returns `{ kind:'notify',
   channel:'local' }` whenever the seed carries no locked effect, and bot tasks
   seed unlocked. Platform and chat id are dropped with no warning, and every
   row offers Edit.
2. **A failed skills catalog read renders as "empty".** `SkillsModule.tsx`
   branches on `loading` and length only; `catalog.error` / `sources.error` are
   never read, so a rejected call says there are no skills and no sources.
3. **"Restart to update" silently does nothing while a task runs.**
   `store/update-store.ts:96` passes `allowInterruptActiveTasks: false`; main
   answers `{ ok:false, reason:'active_tasks' }` with no status change, and
   `run()` keeps only results carrying a `state` field, so the refusal is
   discarded. Upstream turns that refusal into a confirm-and-interrupt dialog.
4. **Archived project rows offer Archive, not Restore.** The rail lists
   archived projects (`hooks/use-session-list.ts:60`) but `Sidebar.tsx:217-225`
   never passes `archived`, so `ProjectRow` always renders Archive and the
   Restore item is dead code.
5. **Archiving the default project leaves a dangling preference.**
   `WorkspaceSettings.tsx:361-366` calls `archiveProject` alone; upstream also
   writes `defaultProjectId: undefined` in the same action.
6. **An unknown `providerType` crashes the connection detail page.**
   `components/settings/models/ConnectionDetail.tsx:91` dereferences
   `PROVIDER_REGISTRY[...].authKind` unguarded. Upstream returns a
   non-actionable fallback page first.
7. **A hand-added model lands disabled and disappears on refresh.**
   `ConnectionDetail.tsx:335-343` appends to `models` and forces `modelSource:
   'fallback'`; upstream writes `enabledModelIds` plus
   `relayModelProfiles[id]`, so the model is on and its declaration survives.
8. **An enabled model missing from the catalog is invisible and silently
   dropped.** `ConnectionModelsSection.tsx:71-91` builds rows from catalog
   entries only, so a stale or quarantined id cannot be unticked and the next
   unrelated toggle removes it.
9. **A turn cannot be stopped while an interaction prompt is up.**
   `SessionView.tsx:479` unmounts the composer (with its Stop button and
   Escape-to-stop) during ask-user / boundary / form prompts, and
   `InteractionPrompts.tsx` has no stop path. Upstream's prompt carries its own
   Stop.
10. **Live tool output keeps the FIRST 500 lines.** `capLines`
    (`packages/ui/src/tool-activity/preview-utils.ts:25-32`) truncates the
    head, so a long-running command's panel freezes on its opening output and
    the live tail is unreachable. Upstream streams into a pinned-to-bottom
    `<pre>` and marks stderr.

Smaller, same kind:

- **Scheduled-task due notifications are unwired.** `scheduledTasks.subscribeDue`
  has no subscriber anywhere in the renderer, so a task that fires while the app
  is open raises no OS notification. It belongs in the shell's store lifetime
  (`store/index.ts` `startRendererStores`), not in the module page, which may not
  be mounted. (Found in Phase 5b.)
- **The xAI mark does not paint in its OAuth card.** `ProviderAssetMask` is a CSS
  mask that needs an explicit size the account card does not give it; the slot
  renders empty beside OpenAI's and GitHub's glyphs
  (`.maka-shots/enterprise/phase5b-provider-catalog-light.png`).
- **MCP brand marks are monochrome.** Their colour rule died with
  `styles/module-pages/mcp.css`; restoring it is a rule in `styles/globals.css`.

### Outside the renderer allow-list

- **Archiving an edit-and-resend family is a silent no-op.** `sessions:archive`
  resolves but the Host ignores the lifecycle change for a family member
  (`apps/desktop/src/main/runtime-host-session-catalog-ipc-main.ts:145`), so a
  task that was ever edited-and-resent cannot be archived from the rail or
  from Settings › Archived tasks. Found in Phase 5a; needs a main/Host fix.

## Not implemented

Everything below is implemented in the main process and the backend packages —
their IPC handlers are registered and this fork does not modify
`apps/desktop/src/preload/bridge-contract.d.ts`. The gap is the renderer alone.

### Whole surfaces with no page here

| Feature | Unreached methods | What it is |
| --- | --- | --- |
| Session collaboration | 19 | Share a task with another Maka: invitations, guest grants, mounts, turn requests and their decisions |
| Runtime Host management | 14 | Install and update policy, project directories, resources, direct peer, credential rotation |
| Bot chats | 9 | `settings.bots.*` and `testBotChannel`: bot onboarding, the WeChat QR login, per-bot status and restart. Scheduled tasks deliver locally because this is missing |
| Pets | 7 | Pet packs: list, select, sprite sheet, import a local directory |
| Work board | 7 | Create, update, archive, remove, subscribe |
| Daily review | 7 | The review itself plus its config, run-now, archive list and Markdown export |
| Host onboarding | 6 | First-run Host setup, including WSL distribution enumeration |
| Agent Graph | 6 | Epochs, snapshot, operator inspection, stop |
| Local remote access | 5 | Turn remote access on for this machine's Host, mint and revoke a connection code |
| Host SSH terminal | 5 | A terminal against a remote Host |
| WorkHub | 5 | The persistent WorkHub session and its floating window |
| Peer Mesh | 4 | Connectivity policy and execution |
| External session import | 3 | Import history from another tool |
| Todo | 2 | The current Todo projection |
| Deep research | 2 | Deep-research sessions |

Also with no page: Daily Review, IM Hub, the Plan approval panel, and the
Runtime Host management / onboarding / SSH-terminal dialogs.

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

**Queued messages** — actions are not gated by entry state, `next_turn` and
`current_turn` rows are indistinguishable and carry the same controls, and the
edit box has no Enter / Escape.

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
purge-matching, no orphaned-subtask marker. Models: no request-body overlay,
no per-model vision / context window / fast tier, no bulk thinking level, no
headers at creation, no select-all in the model picker, no retired-provider
handling, no signup link, no OAuth relogin from the connection page, no cancel
on an in-progress field edit, no model refresh after saving a credential.

**Modules** — MCP: no search or filter, no tool names, no stderr tail, no
negotiated protocol or transport row, no counts, no manage-from-market. Skills:
no search, category filter or sort, no "use this skill", no open-folder, no
capability-audit warning, no path or tool names. Scheduled: no duplicate, no
run history (only the last outcome, never the failure message), no search /
sort / status filter, no keep-system-awake, no bot delivery, no templates.

Reached through a channel we already call, but only partly:

- **Plan** (`sessions`, 8 methods) — `getPlanState`, `subscribePlanChanges`,
  `approvePlan`, `requestPlanRevision`, `resumePlan`, `abandonPlanProposal`,
  `abandonPlanExecution`, plus `queryMessageExecutions`. Plan mode here is a
  switch in the ＋ menu with no panel behind it: nothing shows the plan, and
  nothing can approve, revise or resume it.
- **Skills** — `previewUpdate` and `updateManaged`: a managed skill cannot be
  updated from the page that lists it.
- **Memory** — `openBackup`, `openLatestBackup`, `restoreBackup`.
- **MCP** — `importConfig` (paste an `mcp.json`) and `cancelInstall`
  (withdraw a directory install that is still running). The copy for both is
  already in `mcp-copy.ts`; only the surface is missing.
- **Scheduled tasks** — `snooze` and `clearRunHistory`.
- **Runtime Host profiles** — `importConnectionCode`, `discardPairing`,
  `resolvePairingRecovery`: no recovery path when a pairing breaks.

### Entry points and commands

- **Session start modes** (`SESSION_START_MODE_SPECS`): `deep_research` and
  `bot` both start through `sessions.create` with a mode. Neither has an entry
  point here. Upstream's Quick Chat panel is gone (#1433) — what survived of
  it is exactly these two modes.
- **`/side`, `/graph`, `/swarm`**: parsed by `desktop-slash-command.ts` and
  deliberately refused by the composer.
- **Palette commands not implemented**: `action:side-chat`,
  `action:new-deep-research`, `nav:daily-review`,
  `diag:open-skills`, `diag:export-conversation`,
  `diag:save-conversation-file`, `diag:open-local-memory`, and the three
  daily-review clipboard/save commands. `action:new-scheduled-task` is partial:
  ours navigates to the page, upstream also opens the create form. Export and
  save-conversation are a real gap — upstream has an e2e for it
  (`context-window-save.spec.ts`).
- **Settings surfaces with no page here**: bot chats (5 upstream files), daily
  review, import tasks, the custom pet section, Host management / onboarding /
  SSH terminal / project-directory editor dialogs.

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
  slot with its own target selector. `packages/core/src/settings.ts:190`
  narrows `APP_ICONS` to one id here, and every write is `'both'`, so
  `appIconDark` can never be set.
- **WorkHub** — the persistent session and its floating window; listed above
  under the surfaces with no page.
- **Bottom workbar dock** — `hooks/use-workbar.ts:27-32` preserves the state
  but never renders it, so a face parked at the bottom is invisible.
- **Side chat** — `/side` is parsed and refused, ⌘⌥S was repurposed to toggle
  the pane, and the `side-chat` workbar face is not registered.

### Still open from the conversation-core audit (2026-09-08)

The 2026-09-08 audit against upstream's `app-shell-chat-actions.ts` found 24
gaps; three batches and a round of regression fixes landed the same day, and
`docs/enterprise/phase-reports/core-dialogue-regressions.md` records what
changed. What that audit left open:

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

## How the gap list was measured (2026-09-09)

Everything below is implemented in the main process and the backend packages —
their IPC handlers are registered and this fork does not modify
`apps/desktop/src/preload/bridge-contract.d.ts`. The gap is the renderer alone.

Measured three ways, because no single one is complete:

1. **Bridge-layer call audit.** The architecture check forces every preload
   call through `src/renderer/bridge/*`, so parsing those files against the
   contract gives an exact answer: of 359 callable paths, 122 are never
   reached. This finds whole namespaces AND methods nested inside namespaces we
   do use (`settings.bots.*` would be invisible to a namespace-level count).
2. **Command palette ids.** `STATIC_COMMAND_IDS` in `shell-copy.ts` names 25
   user-facing actions; this renderer implements 15.
3. **Surface inventory.** Upstream's renderer pages and settings pages, mapped
   against ours.

A second pass compared upstream's surfaces with ours page by page — six
parallel audits reading both sides, every claim grepped against our tree and
the defects re-verified by hand. Upstream's renderer is deleted here, so its
files are read with `git show main:<path>`.

What none of this measures: a surface that renders the whole feature but gets
a detail wrong without saying so. Only using the app finds those.

## Tooling notes

- The pre-commit biome stdin step misreads any staged file containing `⚠`
  (Biome 2.5.11 prints it as `!`); upstream's
  `packages/cli/src/tui-copy-catalog.ts` trips it. Run the other three hook
  steps by hand and commit with `--no-verify` when that is the only failure.
- `@maka/runtime` tests need `rg` on `PATH` (see the first item).
- Upstream #5001 (transcript navigation) shipped two tests the enterprise
  renderer cannot host: `transcript-send-viewport.test.ts` and the five
  paging-gate cases of `transcript-reading-position-controller.test.ts` drove
  the old React controller through a fake DOM. That logic now lives in
  `renderer/store/active-session-store.ts` (`loadHistory`, `prepareSend`,
  `setReadingAnchor`); the `partial-history-notice` and `transcript-scroll-cost`
  e2e specs cover it end to end, but a renderer-state unit test for the gate
  replacement rules would close the gap.
