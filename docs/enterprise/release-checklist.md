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
- **Company model gateway.** The plan's reason for the fork: add a provider
  entry for the GCP LLM gateway in `packages/core/src/provider-registry.ts`
  (and its display copy / brand mark under `lib/ported/provider-*`), so
  Settings › Models can create a connection to it. Not started.

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
- `@tiptap/extension-mention` and `@tiptap/suggestion` are installed but
  unused (knip-ignored); removing them is a lockfile + notices change.
- Upstream's local message delivery status (#4956): the fields are on
  `TransientUserMessageProjection` but the transcript does not render them.
- Carried from Phase 3: thinking-block duration, mermaid and `attachment://`
  images in markdown, branch banner / goal chip placement.
- Phase 5a: per-request usage log grid; Runtime Host add form is TLS/plain
  only (SSH/WSL wizards deferred); no "open logs folder" on About.

## Manual verification still owed (FakeBackend cannot exercise these)

- Real-provider turn: tool call, permission prompt, stop, regenerate, branch,
  edit-and-resend (Phase 3b).
- Files face with real artifacts (markdown / image / diff / html), "Open in
  Files" and "Open in Terminal" from real tool rows, Trace usage bands, a real
  page in the embedded browser incl. rect tracking while resizing (Phase 4).
- App-icon import/remove, adding a remote Runtime Host and browsing its
  directories, proxy test, config export/import round trip, macOS permission
  actions (Phase 5a).

## Tooling notes

- The pre-commit biome stdin step misreads any staged file containing `⚠`
  (Biome 2.5.11 prints it as `!`); upstream's
  `packages/cli/src/tui-copy-catalog.ts` trips it. Run the other three hook
  steps by hand and commit with `--no-verify` when that is the only failure.
- `@maka/runtime` tests need `rg` on `PATH` (see the first item).
