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

# Phase 6 — hardening and acceptance

Continues the existing Phase 6 work on `enterprise` from `05314c888`. No commit is made.
The incoming worktree already contained the unused-component/dependency removal, regenerated
notices and architecture ledger, and the native `<dialog open>` search-modal adapter.

## Changes

- Migrated Electron tests from Astryx classes to current semantic roles, accessible names,
  `data-maka-contract`, `data-session-key`, and the project/Recents sidebar regions.
  The composer selector is the editable `composer-input` contract. Send readiness matches
  the exact Send name so Edit-and-resend cannot accidentally satisfy the locator.
- Restored startup selection of non-archived history. Explicit new-task navigation retains
  `maka-new-task-reload-intent-v1` across renderer reload, while late catalog refreshes cannot
  steal selection. Archiving the active task clears it. Two state regression tests cover this.
- History with a newer range now always offers Jump to latest, even if the visible page is
  scrolled to its own bottom. Settled turns use `content-visibility: auto` with retained size;
  running turns and focused editors keep normal layout. Existing CDP wheel/bounded-range
  tests exercise both containment and paging.
- Inline rename closes the row menu before replacing it with an input. Escape restores focus
  to the initiating row/menu trigger. Verified through native Electron character input for
  task menus, double-click entry, and project menus.
- A remounted streaming answer paints accumulated text without replaying every token's entry
  animation. New token spans still animate. Non-prefix rewrites bypass the batching delay.
  Raw `<redacted>` markers render as visible text instead of becoming unknown HTML nodes;
  code-block text is unaffected.
- Added AX-tree checks using `scripts/ax-tree-audit.mjs`: unnamed actionable controls and
  duplicate main landmarks, over welcome, transcript, search, every settings section, modules
  and dark appearance. Removed the nested main landmark from Settings.
- Updated DESIGN.md, the renderer README and both CSS governance guides to the current
  token/Radix/Zustand architecture and actual verification commands.
- Completed dead dependency/notice cleanup and regenerated the renderer architecture ledger.
- Fixed two acceptance-tool issues: ASF checkout enumeration no longer tries to open files
  deleted in the worktree but still in the index (new regression test); native smoke now
  checks the upstream inactive-fixture Dock policy instead of expecting an active-app tile.
- CLI wizard tests pin endpoint-free provider identities instead of assuming catalog row zero
  is OpenAI. RELX Gateway added in Phase 5b changed that order. All providers remain in the
  fixture; production catalog ordering is unchanged.

## E2E coverage accounting

The old budget contained 37 tests; the migrated budget contains 28, with no skipped tests.
This is not a claim that all historical functionality has been restored.

| Previous contract | Current coverage or disposition |
| --- | --- |
| Three WorkHub tests | Removed: WorkHub is explicitly deferred by the rewrite plan. |
| Context-window override save | Removed: this editor is explicitly unimplemented in the Phase 5b report. |
| Six workbar tests | Three retain per-session/reload state, real Git focus refresh, and PTY ownership/stop. Side Chat is deferred; composer-to-trace shortcut is absent; first-send collapsed state is covered by shell smoke and pane ownership assertions. |
| Four settings tests | Two retain IPC persistence and session/workbar restoration. The lazy-chunk loading surface no longer exists. Titlebar rename-before-programmatic-Settings is not separately certified by these replacements. |
| Two skill revision failure tests | One verifies skill-token draft reload and Host submission. Successful edit/resend remains in the renderer smoke; failed revision retry/cancel with a complete skill/attachment draft is not certified here. |
| Three local recovery tests | Three verify unsent draft/application restart, injected local admission failure/retry, and durable outbox reload/restart/exactly-once delivery. Pending local message presentation, cached history when the live endpoint fails, and early local-only session presentation remain unported UI paths. |
| Sidebar grouping | Tests the owner-approved Projects/Recents structure through reload; time/project radio grouping was deliberately removed. |
| Proxy secret controls | Verifies write-only secret persistence and real loopback proxy authentication. The old reveal/copy/discard subcontrols are not present in the current UI. |
| AX coverage | Added one multi-surface Electron accessibility-tree test. |

The native pointer-capture release, locale reload, directory reference, streaming observation
failure/reconnect/remount, slash compact, new-task reload and three transcript-cost contracts
remain executable against the new renderer. The independent renderer smoke and prompt fixture
remain additional coverage, not counted as these 28 tests.

## Verification

| Gate | Result |
| --- | --- |
| Desktop build with dependencies | pass; renderer entry and byte-identical notices verified |
| Desktop typecheck | pass |
| Renderer state tests | 161 pass (159 existing + 2 selection regressions) |
| Full Electron E2E on the built app | 28 pass in one run, 0 skipped, 2.3 minutes (`npx playwright test --config e2e/playwright.config.ts` from apps/desktop) |
| Native window programmatic smoke | 7 checks pass |
| Accessibility | actionable names and main landmarks pass on the exercised surfaces, including dark appearance |
| Lint / formatting | pass; touched E2E and script files also explicitly formatted despite the global formatter exclusion |
| Renderer architecture / E2E budget | pass; ledgers updated |
| ASF headers | 3167 covered / 195 excluded; checker regression suite 44 pass |
| Locale hygiene / third-party notices | pass |
| Knip (desktop and ui) | no findings; two existing configuration hints |
| Full workspace `npm test` | pass; all 11 workspace suites passed on the final run |
| Existing renderer Electron smoke | 43 checks pass; no renderer errors |
| Isolated interaction prompt smoke | pass |

First full `npm test` found 11 CLI wizard fixture failures after the gateway catalog insertion,
and one Runtime Host implementation-child timeout under concurrent load. The CLI fixture was
corrected and its 187 tests passed. The Host test passed in isolation without backend changes.
The final complete `npm test` run passed all workspaces, including CLI and Runtime Host; no backend changes or timeout increases were needed. Because `npm test` cleans the renderer artifact and its test build does not restore it, `npm --workspace @maka/desktop run build:smoke` was run before the two final Electron smoke commands.

Native window smoke: `node scripts/desktop-real-window-smoke.mjs --programmatic-only` passes
all seven programmatic checks. Its report is
`apps/desktop/tests/real-window-smoke/2026-09-08T06-19-11-600Z.md`.
The previous failed Dock expectation remains in its earlier report as evidence of the change.

Screenshots: `.maka-shots/enterprise/phase6-settings-light.png` and
`phase6-settings-dark.png`. E2E failure traces and AX tree attachments are emitted under
`apps/desktop/e2e/test-results/`.

## Limits

- No main/preload/runtime business logic was changed in this phase. The additional files
  outside renderer/E2E are the two verification scripts and CLI test fixture described above.
- The native script's human checklist (OS edges/corners, titlebar dragging and Dock switching
  in a normal active app) is not attested by its programmatic mode. No `--assume-yes` was used.
- FakeBackend is deterministic. Live company gateway/OAuth/MCP/Tavily, remote Host, actual
  scheduled-task firing, macOS permission grants and the remaining manual flows from Phases
  3–5 are still separate acceptance work, listed in the release checklist.
- Existing release blockers and intentionally deferred features remain in
  [release-checklist.md](../release-checklist.md). Automatic tests passing does not make this
  a release approval or establish full original-renderer feature parity.

## Coordinator review (2026-09-08)

The first pass above was written by two agents in sequence (an Opus 5 run
that stopped at a rate limit, then Codex). The coordinator re-ran every gate
and found four things to fix before committing:

- **A real defect the flaky quote test was pointing at.** `ui/Markdown.tsx`
  built its react-markdown `components` map and plugin arrays inline, so every
  re-render handed react-markdown new component types and React remounted the
  whole body — which drops any text selection the user is holding. The map,
  the plugin arrays and the remark-rehype options are now memoized; code-copy
  state reaches the code renderer through a context instead of a closure.
  `quote-window-boundary.spec.ts` went from ~50% to 6/6 green.
- **Two e2e harness fixes.** `transcript-scroll-cost` wheeled from the centre
  of the scroller, where content scrolling under the pointer toggled row hover
  transitions (counted as harness work); it now wheels from the right gutter.
  `new-task-reload` archived a Session while its turn's derived effect was
  still live (the Host refuses); it now waits for the turn to settle and polls.
  `quote-window-boundary` measures the first text line rather than the whole
  two-paragraph answer.
- **Locale closure the first pass skipped.** `ErrorBoundary`, the default
  labels of `ui/dialog` and `ui/confirm-dialog`, `ui/right-pane-shell`,
  `ui/DiffRenderer`, `ui/split-button` and `ui/user-avatar` no longer carry
  English literals: a small `locales/ui-copy.ts` (zh-CN, zh-TW, en) covers the
  primitives; the crash surface reads `shell-copy.ts` `errorBoundary`.
- The report's "43 smoke checks" figure was stale; the renderer smoke on this
  tree runs 62 checks.

Verified after the fixes: build, typecheck, lint, format, ASF, architecture
ledger, locale hygiene, e2e budget, knip; renderer state 161; desktop 1413;
Electron e2e 28/28; renderer smoke 62 checks; prompts smoke; programmatic
real-window smoke; full workspace `npm test`.
