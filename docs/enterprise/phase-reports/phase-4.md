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

# Phase 4 handoff — the right pane

Implements [plan §6 Phase 4](../frontend-rewrite-plan.md#phase-4--right-pane) under the desktop
shell rules of [§2.12](../frontend-rewrite-plan.md).

## What is on screen

- **The pane** (`components/workbar/WorkbarPane.tsx`): the reference design's 8px inset frame
  (`ui/right-pane-shell.tsx` — r10, `surface-3`, `--pane-shadow`, its own 48px header, `z-20`),
  rendered INSIDE the content column beside the transcript. It starts below the window titlebar and
  ends at the sidebar seam, so it never covers the titlebar and never covers the sidebar toggle.
  Resizable from its left edge with the ported `ui/pane-resizer.tsx` (pointer capture, 3px click
  slop, ← → ±10 / ⇧ ±50 / Home / End, width committed to the workbar layout on release; during a
  drag the width is written to the element, not to the store). Full screen fills the content column,
  collapses the sidebar on the way in, and hosts the "open sidebar" button in its own header — one
  such control on screen at a time, and using it narrows the pane rather than leaving full screen.
- **The switch** (`WorkbarToggle.tsx`) sits in the window titlebar's actions slot, right of the
  model switcher and right-most in the row, `maka-no-drag`. It carries the open-face count on
  `data-maka-contract="session-workbar-count"`.
- **The strip** (`WorkbarTabStrip.tsx`): the open faces, plus a `[+]` menu that lists every
  registered face with its chord and marks the open ones — the pre-rewrite rule that a face is
  opened and closed only from that menu. The selected face spells its name; the others are icons
  with tooltips and accessible names, because five labels do not fit the 340px floor. The strip
  scrolls the selected face back into view when a chord changes it.
- **Files** (`FilesTab.tsx`, `ArtifactPreview.tsx`, ⌘P): the user-visible artifact catalog
  (`isArtifactUserVisible`), re-read on a settled `tool_result` or a finished turn (debounced 400ms)
  rather than polled. One tab stop with roving selection (`artifact-list-keyboard.ts`); a row opens
  a full-panel preview with reveal / save-as / copy / delete-with-confirm. Previews: markdown
  rendered or source (segmented control), code through `CodeRenderer`, diff through `DiffRenderer`,
  html in a `sandbox=""` `srcdoc` iframe with the count of inert links stated up front, images
  through the shared registry decision into a blob URL revoked on unmount, PDF as a notice (below).
  Text is bounded twice — 256KB display, 64KB / 1000 lines highlight, remainder rendered plain
  (`lib/ported/artifact-preview-text.ts`).
- **Changes** (`ReviewTab.tsx`, ⌃⇧G): `gitReview.read` on the branch source, files paged 20 at a
  time, each diff redacted and capped at 500 lines, per-file disclosure, a refresh control, and
  re-reads on turn events plus window focus. A source that cannot be read is a failure with a retry,
  never the "nothing changed" empty state.
- **Terminal** (`TerminalTab.tsx`, ⌃`): xterm bound to a shell run, with the ported attach
  handshake (`session-terminal-hydration.ts` — snapshot first, raced PTY frames replayed after it,
  exactly once), the ported capability-reply suppression (`session-terminal-query.ts`), fit on
  resize and on activation with cols/rows pushed only when they change, live font-size updates, and
  a palette built from the design tokens at mount and rebuilt when the theme class flips. One face
  with a run picker and a "New terminal" control rather than one tab per run.
  `data-maka-contract="session-terminal-xterm"`.
- **Trace** (`InspectorTab.tsx`, `hooks/use-session-trace.ts`): the two ported pure models
  (`session-inspector-overview-model.ts`, `session-inspector-panel-model.ts`) laid out as the
  session's token and duration split, cost and cache-hit rate, the context budget bar and the
  context composition, then the turn → step timeline with cursor paging (load earlier / hide
  earlier) and the coverage notice. Trace, usage summary and context snapshot are three independent
  reads with three independent failure modes. Contracts `session-inspector`, `-usage`, `-context`,
  `-composition`, `-stats`, `-trace`, `-coverage`, `-turn`, `-step`.
- **Browser** (`BrowserTab.tsx`, ⌘T): address bar and back / forward / reload / stop / close over
  `browser.getState` + `onState`, `setActiveSession` on mount, and the reserved strip's on-screen
  rect published per animation frame (position changes without size changes, which a
  ResizeObserver would miss; the IPC only fires when the numbers change). A null rect hides the
  native layer whenever the face is not visible, the pane is collapsed, or any modal is open.
- **Handoffs from the transcript**: `file_write`, `file_diff` and `image` rows carry "Open in
  Files", shell-run rows carry "Open in Terminal" (`tool-result.tsx` `ToolHandoffButton`,
  `hooks/use-workbar.ts` `openWorkbarFile` / `openWorkbarTerminal`). The row names a workspace path;
  the pane owns the artifact catalog and resolves the two on the basename, newest match first
  (`store/workbar-store.ts`).
- **Keyboard**: ⌘⌥S toggles the pane, ⌘P / ⌃⇧G / ⌃` / ⌘T switch to a face (pressing the chord of
  the face already on screen puts the pane away). `use-hotkeys.ts` gained a literal-`ctrl` binding
  kind and a `code`-based fallback for Option chords, which macOS composes into a different
  character. A "Task workbar" section was added to the keyboard cheat sheet in all three locales.
- **Copy**: `locales/workbar-copy.ts` (zh-CN, zh-TW, en) for the pane's own chrome and the two
  handoffs. The faces reuse the catalogs written for them before the rewrite —
  `conversation-copy.ts` (`workbar`, `reviewPanel`, `terminalPanel`, `inspector`),
  `artifact-copy.ts` and `browser-copy.ts` — rather than translating the same sentences twice.

## Verification

| Gate | Result |
|---|---|
| `npm run build` | pass (renderer entry contract + third-party notices byte-identical) |
| `npm --workspace @maka/desktop run typecheck` | pass (preload + main + renderer) |
| `npm run lint` | pass, 2857 files |
| `npm run format:check` | pass, 2256 files |
| `npm run check:asf-headers` | pass, 3052 covered files |
| `npm run check:renderer-architecture` | pass, ledger regenerated (`--write`, +24 entries) |
| `npm run check:locale-hygiene` | pass |
| `npx knip --workspace apps/desktop` | no findings (`@xterm/*` dropped from `ignoreDependencies`) |
| `npm --workspace @maka/desktop run test:renderer-state` | 121 pass (105 + 16 new in `phase4-state.test.ts`) |
| `npm --workspace @maka/desktop run test:dist` | 1397 + 121 pass |
| `npm --workspace @maka/desktop run test:composer-prompts` | pass |
| `npm --workspace @maka/desktop run test:renderer-smoke` | 28 checks pass, no renderer errors |

The Electron smoke test (real preload, Runtime Host, SQLite and FakeBackend) gained nine Phase 4
checks: ⌘⌥S opens the pane on Files and the titlebar counts it; Files reads the catalog and states
that it is empty; ⌃⇧G opens Changes and reports that the workspace is not a Git repository; ⌃`
opens Terminal, starts a **real PTY** through the Runtime Host and a typed `echo mk-p4-$((2+2))`
prints `mk-p4-4`; the Trace face renders the turn timeline and prints an unpriced cost as words;
⌘T opens Browser with its address bar and nav controls; all five faces stay in the strip and the
badge reads 5; the pane renders in both themes; the toggle collapses it and writes
`maka-session-workbar-panels-v3` (four persisted faces, Terminal correctly transient),
`maka-session-workbar-collapsed-v2` and `-width-v1`, with `-collapsed-v1` still absent.

Screenshots: `.maka-shots/enterprise/phase4-{files,review,terminal,inspector,browser}-light.png`
and `phase4-pane-dark.png`.

One bug found and fixed while running the smoke: the Trace overview rendered an empty container for
a session whose backend meters nothing, because it was gated on the summary object arriving rather
than on any of its sections having something to draw.

## Deviations from the brief

- **Collapse key.** The brief named `maka-session-workbar-collapsed-v1`. The ported model
  (`lib/ported/workbar-layout.ts`) stores collapse **per session** under
  `maka-session-workbar-collapsed-v2` and deletes the v1 key, because the old global preference has
  no session owner and cannot be migrated without giving an unrelated conversation another one's
  expanded state. That behaviour is pinned by `main/__tests__/workbar-model.test.ts`, so the code
  and the tests follow v2.
- **One `@import` outside the additions block.** `styles/globals.css` gained
  `@import "@xterm/xterm/css/xterm.css"` immediately after `@import "tailwindcss"`. CSS requires
  every `@import` to precede the first rule, so it cannot live in the additions block at the end.
  The colours are still built from tokens in `TerminalTab.tsx`; only xterm's row/cursor/viewport
  geometry comes from that file. `@xterm/xterm` was already inside
  `maka.rendererBundledDependencies`.
- **`knip.json`** — `@xterm/addon-fit` and `@xterm/xterm` removed from `ignoreDependencies` now
  that they are imported.

## Deferred / open

- **Bottom placement.** The persisted bottom-panel state is still read and written by the ported
  reducer (`maka-session-bottom-panel-open-v1`, `-height-v1`), but nothing mounts a bottom dock —
  the placement is low-usage (inventory §8) and the plan asked for the right dock only.
- **Deferred faces.** `work-board` and `side-chat` are scope-deferred features; the strip filters
  them out, so a profile that persisted one keeps the entry but sees no empty tab.
- **PDF.** No PDF renderer is in the bundled-dependency closure, and the fixed CSP
  (`default-src 'self'`) blocks a `data:` URL in an `<embed>`, so an inline viewer would render a
  blank rectangle. The face says so and offers the system viewer / save-as. Adding `react-pdf` with
  a local worker means a lockfile, `rendererBundledDependencies` and third-party-notice change,
  which is gated.
- **Donuts → bands.** The pre-rewrite Trace panel drew the token and duration ledgers as SVG
  donuts with linked hover. They are horizontal band tracks here, the same shape as the context bar
  below them; three chart idioms stacked in a 340px column read as three unrelated widgets.
- **Multi-instance terminals** stay collapsed into one face with a run picker (inventory §8 lists
  multi-instance terminal as low-usage).
- **What the deterministic backend cannot show.** `FakeBackend` writes no user-visible artifacts,
  meters no tokens and records no trace steps, so the smoke asserts the empty catalog, the
  not-a-Git-repository notice and the turn timeline. Still to be exercised by hand against a real
  provider: an artifact preview with content in it (markdown / image / diff / html), the "Open in
  Files" and "Open in Terminal" handoffs from real tool rows, the Trace overview's token, duration,
  cost and context bands, and a real page in the embedded browser (including the rect tracking
  while the sidebar is dragged and the hide-behind-modal rule).
- **⌘⌥S on non-US layouts.** The Option-composition fallback matches `code === 'KeyS'`, which
  covers layouts whose S is on the physical S key; a layout that moves it needs the chord rebound,
  which there is no settings surface for yet.
- Carried from Phase 3: thinking-block duration, mermaid and `attachment://` images in the markdown
  pipeline, branch banner / goal chip placement.
