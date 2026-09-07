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

# Enterprise renderer rewrite — plan of record

Branch: `enterprise` (product branch; `main` mirrors `upstream/main`). Owner: the coordinating agent; implementation by Opus 5 subagents, one phase at a time. This document is the single source of truth for scope, architecture, phase contracts and acceptance gates. Research inputs live in `docs/enterprise/research/`:

- `relx-frontend-inventory.md` — the reference design system (tokens, fonts, icons, components, motion, data model) at `/Users/liangbing/program/relx-copilot/frontend`.
- `maka-renderer-contract.md` — what the new renderer must program against (preload API, turn protocol, main-process expectations, build/CI gates, what breaks).
- `maka-renderer-feature-inventory.md` — everything the current renderer does, so nothing important is lost.

## 1. Goal and non-goals

**Goal.** Replace the Maka desktop renderer with a new React UI that reproduces the relx-copilot design system verbatim — its fonts (anthropic-sans/serif/mono), its colour tokens (surface/alpha ladders, blue accent, role quads), its Anthropicons icon font, its component shapes, layout and motion — while keeping every Maka capability the product needs: local Runtime Host execution, sessions and projects, streaming turns with tool timelines, permission prompts, artifacts, terminal, git review, model connections, MCP, skills, scheduled tasks, memory, settings.

**Non-goals.** No changes to `apps/desktop/src/main`, `src/preload`, `src/shared`, or any backend package except the few seams listed in §4. No new backend features. No server-side runtime. The relx-server features (meetings, knowledge bases, group/direct chats, channels, admin, wallet, quota, dispatch, agents, digest, NocoBase) are not ported.

## 2. Architecture decisions (settled)

1. **In-place renderer replacement.** The new UI lives in `apps/desktop/src/renderer`. `index.html` and `main.tsx` keep their exact paths and the entry contract (three `<meta>`, fixed CSP, one module script). Reason: main pins these paths and the CSP; `main-renderer-loader.ts` and the entry-contract plugin are not ours to change.
2. **Stack = relx stack.** React 19, Vite 8 (existing), Tailwind CSS 4 via `@tailwindcss/vite` (CSS-first config in one `globals.css`, no `tailwind.config`), Radix primitives (dialog, dropdown-menu, popover, select, slot, switch, scroll-area, toast, tooltip), `motion` 12, Zustand 5, TipTap 3 (+ `tiptap-markdown`, mention, placeholder, suggestion, `tippy.js`), react-markdown 10 + remark-gfm/math + rehype-katex/raw, KaTeX, Prism, `partial-json`, `clsx` + `tailwind-merge`. Astryx (`@astryxdesign/core`, `theme-neutral`) and the Fontsource Geist packages are removed from the renderer.
3. **`@maka/ui` shrinks to a logic package.** Keep every pure-logic and React-hook module listed in the contract doc §3 (a), (a'), (b) — live-turn projection, materialize, transcript projection, interaction queue, streams/redaction, chat-model helpers, input history, copy catalogs, locale context, `module-panel-types.ts` (the preload contract imports it), `maka-uri`, `artifact-preview-registry`. Delete every Astryx-visual component (c), `styles.css`, `index.ts` re-exports of Astryx atoms, and `.test.tsx` files that render Astryx. Replace `tool-activity/diff-syntax.ts`'s Astryx `tokenize` with Prism. Keep the package name and the five Vite aliases so `vite.config.ts`, `tsconfig` and the preload contract keep resolving.
4. **One bridge module touches `window.maka`.** `src/renderer/bridge/` wraps the preload API with typed, optional-chained accessors and subscription helpers. Nothing else in the renderer references `window.maka`. Session ids in the renderer are the Desktop-projected keys from `shared/runtime-host-identity.ts`; never parse them in UI code.
5. **State = Zustand stores fed by the bridge.** Store shapes mirror Maka's read models, not relx's REST types. The turn pipeline reuses `@maka/ui` verbatim: `applyLiveTurnEvent` → `LiveTurnProjection`, `reduceInteractionQueues`, `DesktopTranscriptRangeStore` (ported from the old renderer as pure code) → `useTranscriptProjection` → `TurnViewModel[]`. Views consume `TurnViewModel`, never raw events.
6. **Design tokens are copied, not translated.** `globals.css` from relx becomes `src/renderer/styles/globals.css` with only these edits: `url()` paths for fonts, removal of relx-server-only blocks (group-chat typing dots, visualizer, print, dataviz series unless Phase 4 needs them), and the additions Maka's main process requires (`--h-titlebar: 36px`, opaque `--background`/`background-color` on `<html>`, `-webkit-app-region` drag surface, reduced-motion collapse under `[data-maka-reduced-motion]`). Light/dark: `.dark` class on `<html>` plus `color-scheme`, driven by Maka's `theme.ts` semantics and the same localStorage keys (`maka-theme-v1`). Palettes (`data-maka-theme`) are dropped: the product has one palette. `applyThemePalette` becomes a no-op that removes the attribute.
7. **Icons = Anthropicons font.** `Anthropicon.tsx` and `anthropicons-variable.woff2` are copied verbatim; `lucide-react` is removed from the renderer once no consumer remains. Provider/MCP brand marks keep their existing SVG modules and vendored licences.
8. **i18n = Maka's typed catalogs.** Keep `UiCatalog`/`getXCopy(locale)` and the 28 `renderer/locales/*-copy.ts` files where the strings still apply; add new catalogs for new surfaces in the same shape; relx's `messages/*.json` strings are translated into catalogs where needed (zh-CN, zh-TW, en all required — en may be the source, others may start as copies but must exist). `check-locale-hygiene.mjs` stays green.
9. **Contracts main relies on are preserved**: `.appFrame` root, `.maka-error-surface`, `notifyRendererReady` after first paint, titlebar overlay sampling and modal dimming, `data-maka-file-drop-target`, `data-maka-contract="search-modal"` on the search dialog, the e2e fixture application, the fixed localStorage keys.
10. **Gates that describe the old renderer are removed or regenerated in Phase 0**, not worked around. Storybook is dropped entirely (config, stories, visual smoke, `typecheck:stories`). E2E specs are rewritten in Phase 6 against the new selectors.
11. **Desktop-specific adjustments to the relx stack.** TipTap `@`/`/` suggestion popups use Radix Popover (or a Radix-styled portal) instead of `tippy.js`. `@paper-design/shaders-react`, `unicornstudio-react`, `@xyflow/react`, `@dagrejs/dagre`, `uuid`, `react-katex` are not added. `react-pdf` ships its worker locally (CSP forbids CDN). Long transcripts keep Maka's byte-budgeted transcript paging (`DesktopTranscriptRangeStore`) — never render the whole history at once. A lint rule (Phase 0b) forbids Tailwind arbitrary colour values (`bg-[#...]`, `text-[rgb...]`) and raw hex/oklch colours in component files; only the semantic classes generated by `globals.css` `@theme inline` are allowed.

## 3. Scope

### Ship in this rewrite (core product)
Shell (titlebar, sidebar with sessions grouped by time/project, project rows, search filter, nav rows, update chip, settings entry, collapse/resize/peek), welcome/empty state (serif greeting, prompt suggestions, workspace picker, model picker), command palette ⌘K (core commands), keyboard help, toasts, OS notifications, onboarding recovery hero, error boundary, update banner; conversation (user/assistant/thinking rows, markdown/math/code/mermaid, tool timeline with renderers for diff/write/terminal/web search/subagent/json/image/computer-use/MCP/skills, folding, expand/collapse/copy, sandbox-denied affordance, footer actions copy/regenerate/branch/info, stop, edit-and-resend revisions with banner and nav, history paging, context usage pill, compaction notices, health/readiness/resume/crash notices, message queue while running, selection quote → composer); composer (TipTap input, drafts, prompt history, `@` file mentions, `/` slash + skills, attachments pick/paste/drop with preflight and lightbox, directory references, quotes, model switcher, thinking level, permission mode with bypass confirm, plan-mode toggle, goal dialog, send/stop with blocked hints); interaction prompts (sandbox boundary, client capability, ask-user wizard, form); right pane (artifacts/files preview incl. markdown/image/pdf/html-sandbox/diff, git review, terminal, inspector, native browser chrome); settings (General, Appearance minus palettes, Workspace/Projects incl. Runtime Host profiles add/enable/default/remove and remote-project browser, Models incl. connection detail/add form/catalog/OAuth, Subagents, Memory, Web Search, Usage, Archived tasks, Data, Permissions & Capabilities, Health, About); module pages (Skills, MCP, Scheduled tasks).

### Defer (keep backend, no UI in this rewrite; tracked for a follow-up)
Side chat (quote companion), work board, WorkHub, agent graph panel, deep research surfaces, plan-mode proposal/execution panels beyond the toggle, daily review, session collaboration (share/invite/guest/turn requests), import tasks, bots/IM settings, Runtime Host management dialog (install/update/credentials/peer mesh), SSH terminal/onboarding wizard dialogs, pets, app-icon split light/dark, prompt anchor rail, 11 palettes, Storybook.

### Drop
relx-server features listed in §1; Astryx; Geist fonts; `lucide-react` in renderer.

## 4. Allowed touches outside the renderer
- `packages/ui/*` — shrink per §2.3; update `package.json` exports/deps; keep tests for surviving modules.
- `apps/desktop/package.json` — dependencies, `maka.rendererBundledDependencies`, scripts (remove storybook/app-shell-hooks/astryx inventory; keep `build:renderer` string unchanged).
- `apps/desktop/vite.config.ts` — add `@tailwindcss/vite`; aliases unchanged.
- `apps/desktop/tsconfig*.json`, `knip.json`, `biome.jsonc` (only if needed), root `package.json` scripts that reference removed gates.
- `apps/desktop/renderer-architecture.json` + `apps/desktop/scripts/check-renderer-architecture.mjs` — regenerate the ledger for the new tree; relax the historical-owner guard; the environment rules (no `electron`/Node imports in renderer; `window.maka` only under `src/renderer/bridge/`) stay.
- Delete: `scripts/check-app-shell-hooks.mjs` (+test, npm script), `scripts/check-astryx-surface-inventory.mjs`, `scripts/generate-astryx-surface-inventory.mjs`, `docs/astryx-surface-file-inventory.{md,paths}`, `scripts/build-astryx-theme.mjs`, `scripts/storybook-visual-smoke.mjs`, `apps/desktop/.storybook/`, `apps/desktop/stories/`, `packages/ui/stories/`, `apps/desktop/src/main/__tests__/ink-ladder-contract.test.ts`, `session-project-hierarchy-contract.test.ts`, and every `main/__tests__` file whose subject is a deleted renderer module (list them in the phase report).
- `apps/desktop/src/renderer/public/THIRD_PARTY_LICENSES.txt` and `apps/desktop/resources/licenses/renderer/*` — regenerate via `npm run generate:third-party-notices`.
- `apps/desktop/e2e/*` and `e2e-budget.json` — Phase 6 only.
- Root `DESIGN.md` — replaced in Phase 6 by a short pointer to the relx token file (the old rules no longer apply).
- **Never**: `src/main/**` (except deleting tests), `src/preload/**`, `src/shared/**`, `packages/{core,runtime,runtime-host,storage,mcp,eval,cli,computer-use}`, `native/**`.

## 5. Directory layout of the new renderer
```
apps/desktop/src/renderer/
  index.html            (unchanged contract; preload skeleton colours = relx surface-1 light/dark)
  main.tsx              (bootstrap: cached theme + locale pre-mount, fixture, ReactDOM root, notifyRendererReady)
  app.tsx               (providers: Theme, Locale, Toaster, ErrorBoundary; <div class="appFrame"> root)
  styles/
    globals.css         (relx tokens + @theme inline + utilities + fonts + Maka additions)
  assets/fonts/anthropic/*.woff2   (7 files incl. anthropicons)
  assets/provider-brands/          (existing SVGs, keep)
  bridge/               (the only window.maka consumers; typed wrappers + subscription helpers + session-key helpers)
  store/                (zustand: sessions, activeSession/transcript, liveTurn, interactions, messageQueue, projects, connections, settings, ui, workbar, toasts)
  lib/                  (cn, theme.ts, locale bootstrap, fixture, titlebar sync, keyboard, formatters; ported pure modules from the old renderer)
  locales/              (typed copy catalogs, UiCatalog shape)
  components/
    icons/              (Anthropicon.tsx, RelxLogo, ProviderIcon, brand marks)
    ui/                 (relx primitives: button, dialog, dropdown-menu, popover, select, switch, scroll-area, toast(er), tooltip, input, textarea, label, avatar, segmented-control, split-button, confirm-dialog, skeleton*, spinner, shimmer, pane-resizer, right-pane-shell, Markdown, StreamPopMarkdown, CodeRenderer, DiffRenderer, JsonHighlight, Console, class-string modules)
    layout/             (AppLayout, Sidebar + sidebar-parts, MainHeader, titlebar drag strip)
    chat/               (ChatMessages, UserMessage, AssistantText, Thinking, tools/{registry,renderers}, ChatInput/TipTapEditor, suggestions, prompts/{sandbox,capability,ask-user,form}, ContextUsageIndicator, notices, MessageQueue, TurnFooter, HistoryControls)
    welcome/            (TaskWelcomeContent, prompt suggestions, workspace + model pickers)
    workbar/            (RightPane tabs: files/artifacts, review, terminal, inspector, browser)
    settings/           (layout + pages)
    modules/            (skills, mcp, scheduled tasks)
    palette/            (command palette, keyboard help, search modal)
```

## 6. Phases

Each phase is executed by one Opus 5 subagent (some phases split into sequential sub-agents). Every phase must end with: `npm --workspace @maka/desktop run typecheck`, `npm run build`, `npm run lint`, `npm run format:check`, `npm run check:asf-headers`, `npm run check:renderer-architecture`, targeted `node --test` runs, and a launch screenshot when the UI is affected. The agent reports files changed, what was verified, and open issues. The coordinator reviews, runs the gates again, and commits with a `Generated-by: Claude Code` trailer.

### Phase 0 — Unwind and foundation
**0a. Remove the old renderer and its gates.** Delete `src/renderer/**` except `index.html`, `public/`, `assets/provider-brands/`, `assets/fonts/`, `locales/`, and the pure modules to be ported (move them to `lib/` as listed in Phase 1). Shrink `@maka/ui` (§2.3). Remove Astryx/Geist/lucide deps; add the relx stack deps (§2.2) to `apps/desktop`; update `rendererBundledDependencies`; regenerate third-party notices. Delete the gates and Storybook artefacts in §4. Regenerate `renderer-architecture.json` for the new tree and relax the owner guard. Update `knip.json`. Delete `main/__tests__` files whose subjects are gone; keep and fix the rest so `npm --workspace @maka/desktop run test:dist` passes.
**0b. Design system foundation.** `styles/globals.css` from relx per §2.6; `@tailwindcss/vite` wired in `vite.config.ts`; fonts + `Anthropicon.tsx`; `components/ui/*` primitives ported; `lib/theme.ts` (light/dark/auto, `.dark` + `colorScheme`, `maka-theme-v1`, titlebar overlay sampling and modal dimming from the old `theme.ts`/`titlebar-dim-color.ts`); `main.tsx`/`app.tsx` bootstrap with fixture application, locale pre-mount, `notifyRendererReady`, `.appFrame`, error boundary. Placeholder shell renders "hello" in the new fonts and colours.
**Acceptance:** app launches, window reveals, light/dark follow the setting, all gates green, screenshot attached.

### Phase 1 — Bridge and state
`bridge/` wrappers for every namespace the shipped scope uses; `store/` per §5; ported pure modules: `desktop-transcript-range-store.ts`, `session-event-health.ts`, `transient-message-projection.ts`, `settled-message-merge.ts`, `turn-footer-actions.ts`, `derive-turn-lineage-badges.ts`, `model-connection-errors.ts`, `live-turn-snapshot.ts`, `session-message-settlement.ts`, `interrupted-resume.ts`, `stale-sessions.ts`, `nav-selection.ts`, `session-revisions.ts`, `branch-banner.ts`, `session-nav-filter.ts`, `session-rail-layout-store.ts`, `workbar-layout.ts`/`workbar-tabs.ts` model, `use-project-context.ts` logic. The active-session pipeline reproduces `useActiveSessionEvents` + `createAppShellSessionEventHandlers` semantics (rAF-batched deltas, refresh on `text_complete`/`tool_result`, interaction reconciliation, complete/abort/error handling, resubscribe backoff). Unit tests for stores with `node --test` and a fake bridge.
**Acceptance:** a temporary debug view lists sessions from the bridge and streams a turn's `TurnViewModel[]` as JSON.

### Phase 2 — Shell, sidebar, welcome, palette
`AppLayout`, `Sidebar` (relx structure and motion; Maka data: time/project grouping, row actions, search filter, new task, nav rows Extensions/Automations, update chip, settings), collapse/resize/peek, `MainHeader` with session identity (rename, project, branch/revision badges), titlebar drag strip, `TaskWelcomeContent` (serif greeting, suggestions, workspace picker, new-chat model picker, onboarding recovery hero), command palette + keyboard help + search modal (`data-maka-contract="search-modal"`), toaster, OS notification wiring, update banner, theme toggle wiring, native menu commands.
**Acceptance:** create/rename/archive/delete sessions, switch projects, open settings placeholder, screenshots light + dark.

### Phase 3 — Conversation and composer
**3a. Transcript.** `ChatMessages` over `TurnViewModel[]`: user rows (attachments, quotes, references, edit), assistant markdown with `StreamPopMarkdown`, thinking, tool timeline via a renderer registry keyed by Maka activity/result kinds (diff, write, terminal incl. live output and background status, web search, subagent rows that open the child session, json quiet preview, image, computer-use labels, MCP grouping, skills, generic), folding, expand/copy, sandbox-denied affordance, turn footer (copy/regenerate/branch/info), stop, revision banner + nav, history paging controls, scroll authority (follow tail vs reading anchor), context usage indicator, compaction/system notices, health/readiness/resume/crash notices.
**3b. Composer and prompts.** `ChatInput`/`TipTapEditor` with Maka wire text (`chat-input-behavior.ts`), drafts, history, `@` mentions (`workspace.searchFiles`), `/` slash + skills, attachments with `data-maka-file-drop-target`, directory references, quotes, model switcher, thinking level, permission mode + bypass confirm, plan-mode toggle, goal dialog, send/stop and blocked hints, message queue (promote/edit/delete/reorder); interaction prompts: sandbox boundary, client capability, ask-user (relx `AskUserPanel` look), form.
**Acceptance:** full turn round-trip against a real model connection: send, stream, tool calls render, permission prompt answered, stop, regenerate, branch, edit-and-resend; screenshots.

### Phase 4 — Right pane
`RightPaneShell` tabs: Files/artifacts (list + previews: text/markdown, image registry, pdf, html sandbox iframe, diff; copy/save-as/reveal/delete), Review (git diff paged, redacted), Terminal (xterm bound to shell runs; theme from CSS vars), Inspector (context budget, composition, usage, cost, timeline), Browser (address bar/nav, rect publishing to `browser.setViewport`, hide behind modals). Workbar layout persistence keys preserved.
**Acceptance:** each tab works against a live session; screenshots.

### Phase 5 — Settings and module pages
**5a.** Settings layout (relx 220px sticky nav), General, Appearance (theme, app icon, font sizes), Workspace/Projects (project catalog; Runtime Host profiles add/enable/default/remove; remote directory browser), Data, Permissions & Capabilities, Health, About/updates, Usage, Archived tasks.
**5b.** Models (connections list/detail/add form/catalog/OAuth panels), Subagents, Memory, Web Search; module pages Skills, MCP, Scheduled tasks.
**Acceptance:** add a provider and set default; toggle settings that round-trip through `settings.updateClient/update`; screenshots.

### Phase 6 — Hardening
E2E: rewrite `apps/desktop/e2e/fixtures.ts` and specs for the new selectors; update `e2e-budget.json`; `npm run e2e` green. `desktop-real-window-smoke.mjs` green. Accessibility pass with `scripts/ax-tree-audit.mjs` semantics (accessible names on all actionable roles). `check-locale-hygiene` green with zh-CN/zh-TW/en catalogs complete. Remove dead code, regenerate notices, update `DESIGN.md`, `apps/desktop/src/renderer/README.md`, `docs/frontend-css-governance*.md`. Final full `npm test`.

## 7. Rules for implementation agents
- Read this file and the three research docs first. Do not re-derive facts; cite them.
- Stay inside the phase's directories and the §4 allow-list. If a change outside is unavoidable, stop and report instead of editing.
- Copy relx components verbatim where they are presentation-only; rewire container components to the bridge/stores. Never import `next/*`, `next-intl`, `next-themes`.
- No `window.maka` outside `src/renderer/bridge/`. No `electron` or Node imports anywhere in the renderer.
- Every new source file carries the ASF header. Every user-visible string goes through a `UiCatalog` with zh-CN, zh-TW and en.
- Keep the fixed contracts: `index.html` shape and CSP, `main.tsx` single entry, `.appFrame`, `.maka-error-surface`, `notifyRendererReady`, `data-maka-file-drop-target`, `data-maka-contract="search-modal"`, localStorage keys, `--h-titlebar: 36px`, one `-webkit-app-region: drag` surface.
- Run the gates in §6 before reporting. Report: summary, files added/changed/deleted, commands run with results, screenshots paths, known gaps.
- Do not commit. The coordinator commits.

## 8. Verification toolkit
- Build/typecheck/lint: `npm run build`, `npm --workspace @maka/desktop run typecheck`, `npm run lint`, `npm run format:check`, `npm run check:asf-headers`, `npm run check:renderer-architecture`, `npm run check:locale-hygiene`, `npx knip --workspace apps/desktop`, `npx knip --workspace packages/ui`.
- Tests: `npm --workspace @maka/desktop run build:test && npm --workspace @maka/desktop run test:dist`; `npm --workspace @maka/ui run build && npm --workspace @maka/ui run test:dist`.
- Launch: `npm --workspace @maka/desktop run start` (human) or Playwright `_electron.launch({ executablePath: node_modules/electron/dist/Electron.app/Contents/MacOS/Electron, args: ['apps/desktop'] })` then `firstWindow().screenshot()` (agent). Screenshots go to `.maka-shots/enterprise/`.
