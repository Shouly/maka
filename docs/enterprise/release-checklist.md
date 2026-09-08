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

Things the renderer rewrite phases could not or deliberately did not settle.
Each item names where the problem lives and what would close it. Remove an
item when it lands; do not let this file become a second plan.

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

## Small defects inside the renderer

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

## Conversation-core gaps still open (audit 2026-09-08)

An audit of the rewrite against upstream's `app-shell-chat-actions.ts` and
session-event handling found 24 gaps; the first batch (optimistic message
reconciled with the Host's answer, #646 wait cues, stale live-turn
retirement, event-stream health probe, transcript load error + retry,
queue-by-default mid-turn routing, composer yielding to prompts and to an
unreadable boundary) landed the same day. Still open, in the order to fix:

- (Batch 2 landed the same day: stop retracts the queued messages it
  interrupted, a retracted queue entry takes its row, Host-cancelled
  optimistic rows are retired at each seed, Escape stops the turn, skill
  invocation feedback, the workspace-unavailable toast, Resume's `park`
  answer, and transients hidden while reading history.)
- Edit-and-resend: `abandonSessionCopy` is never called on cancel/failure
  (orphan forks in the rail); the fork is sent into before its transcript
  settles (`readSettledMessages` unused); no `waitForHostAdmission`.
- New-task creation sends only the model and then issues up to three extra
  IPCs, and writes `permissionMode: 'ask'` as an explicit override on every
  first send (upstream sends it only when the user chose one, plus
  `orchestrationMode`).
- `sessions:changed` side effects beyond a refresh: `clearPendingTurnActions`
  on turn/message changes, the `rebound` model toast, `retireSession`.
- `flushDisplayEvents` is not called on seed completion;
  `settleAssistantStreaming` (primary handoff) has no caller; the persisted
  composer model default (`composer-defaults.ts`) is not ported; the
  slash-command catalog port has no caller (`/compact` is hard-coded).

## Known defects outside the renderer allow-list

- **Archiving an edit-and-resend family is a silent no-op.** `sessions:archive`
  resolves but the Host ignores the lifecycle change for a family member
  (`apps/desktop/src/main/runtime-host-session-catalog-ipc-main.ts:145`), so a
  task that was ever edited-and-resent cannot be archived from the rail or
  from Settings › Archived tasks. Found in Phase 5a; needs a main/Host fix.

## Deliberately deferred in the rewrite

- PDF inline preview in the Files face (`react-pdf` is not in the bundled
  dependency closure and the fixed CSP blocks `data:` embeds) — currently a
  notice plus "open in the system viewer". Adding it changes the lockfile
  and third-party notices; owner decision.
- Bottom workbar placement, multi-instance terminals, Trace donut charts.
- `/side`, `/graph`, `/swarm` composer commands (their surfaces are in the
  plan's defer list).
- Upstream's local message delivery status (#4956): preload still durably admits
  through the desktop outbox, but the renderer does not show pending local messages
  or recover from the desktop transcript cache when the live endpoint is unavailable.
  Phase 6 verifies durable delivery/restart and separately records these UI gaps.
- Carried from Phase 3: thinking-block duration, mermaid and `attachment://`
  images in markdown, branch banner / goal chip placement.
- Phase 5a: per-request usage log grid; Runtime Host add form is TLS/plain
  only (SSH/WSL wizards deferred); no "open logs folder" on About.
- Phase 5b: the relay-profile editor ships only its thinking levels (vision,
  context-window override and the OpenAI fast tier are not editable, and only
  the two custom relay providers have profiles at all); no request-body overlay
  editor; advanced request settings are edited after a connection exists, never
  at creation; Memory offers no manual entry add, no per-entry archive and only
  the latest backup; scheduled tasks deliver locally because bot channels need
  the deferred Bots page; the MCP directory has no "coming soon" rows because
  the pre-rewrite page had none; no "write a skill from text" dialog, because no
  preload method writes one.

## Manual verification still owed (FakeBackend cannot exercise these)

- Real-provider turn: tool call, permission prompt, stop, regenerate, branch,
  edit-and-resend (Phase 3b).
- Files face with real artifacts (markdown / image / diff / html), "Open in
  Files" and "Open in Terminal" from real tool rows, Trace usage bands, a real
  page in the embedded browser incl. rect tracking while resizing (Phase 4).
- App-icon import/remove, adding a remote Runtime Host and browsing its
  directories, proxy test, config export/import round trip, macOS permission
  actions (Phase 5a).
- A real RELX Gateway connection end to end (verify, choose models, send a
  turn); each of the three OAuth sign-ins including sign-out and the local `gh`
  credential import; a connection test and a model-catalog refetch against a
  live provider; request headers against a real endpoint; a Tavily key saved and
  probed; an MCP server added from the directory, tested and signed into; a
  skill imported from a file; a scheduled task actually firing (Phase 5b).

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
