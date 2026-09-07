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

# Maka desktop renderer — feature inventory (pre-rewrite snapshot)

Research snapshot, 2026-09-06, of `apps/desktop/src/renderer` (127 tsx + ~140 ts) and `packages/ui/src` (61 tsx). All backend access goes through the `window.maka` preload bridge typed in `apps/desktop/src/preload/bridge-contract.d.ts` (1852 lines); the renderer never touches Node/Electron directly. Facts only.

## 0. Architectural frame
- Feature slices: 13 "features" under `apps/desktop/src/renderer/features/*`, each with `ports.ts`, `services-context.tsx`, `controller/`, `model/`, `ui/`, `testing.ts`; desktop adapters in `platform/desktop/create-*-services.ts`, composed in `composition/desktop-feature-services.tsx`.
- Design system: Astryx (`@astryxdesign/core`) + `@maka/ui` product compositions and trust boundaries (redaction, URL policy). Theme: `astryx-theme/makaTheme.ts` -> generated `maka.css`.
- Shell root: `App` -> `Theme` -> `LocaleProvider` -> `AstryxLocaleProvider` -> `ToastProvider` -> `ErrorBoundary` -> `AppUpdateProvider` -> `TaskEntryRoot` -> `AppShellContent` (`app-shell.tsx`, 3188 lines).
- Multi-host: nearly every settings call takes an optional `DesktopRuntimeHostRef`.

## 1. App shell and navigation
| Feature | Behaviour | Main files | Preload |
|---|---|---|---|
| Frameless titlebar | drag strip; topbar rail, session identity, workbar toggle; empties when Settings owns the window | `app-shell.tsx` ~2590–2650, `app-shell-chrome-actions.tsx`, `titlebar-modal-sync.ts`, `titlebar-dim-color.ts` | `appWindow.setTitlebarControlsVisible`, `appWindow.setTitleBarOverlayTheme` |
| Topbar rail | sidebar collapse + open search; `data-maka-contract="shell-topbar-rail"` | `app-shell-chrome-actions.tsx` | — |
| Titlebar session identity | inline rename, project name (opens folder), parent breadcrumb, share | `packages/ui/src/titlebar-session-identity.tsx` | `sessions.rename`, `app.openPath('project')` |
| 3-column AppShell | Astryx AppShell, resizable sidebar -> `--maka-sidenav-width` | `app-shell.tsx`, `styles/shell-layout.css`, `styles/sidebar.css` | — |
| Detail panel | main column + Workbar, `data-agents-view` | `app-shell-detail-panel.tsx` | — |
| Chat surface | `ChatSurfaceLayout` host-owned scroll, transcript + composer slot | `packages/ui/src/chat-surface-layout.tsx` | — |
| Sidebar resize | keyboard splitter ±10/±50, Home/End | `features/session-navigation/model/session-rail-layout-store.ts` | localStorage |
| Session history list | rows grouped by time/project, multi-select, roving focus, hover preview | `packages/ui/src/session-history-list.tsx` (1504), `session-list-panel.tsx`, `session-rail-context.tsx` | `sessions.list/listWithCoverage/subscribeChanges` |
| Row actions | rename, archive/unarchive, flag, delete-with-confirm, retry, open; project rows: new task, rename, archive, restore, relink | `features/session-navigation/controller/session-row-actions.ts`, `packages/ui/src/session-rename-dialog.tsx` | `sessions.archive/unarchive/setFlagged/rename/remove/previewRemoval`, `projects.rename/archive/restore/relink` |
| Session search filter | `F` focuses, Esc clears | `features/session-navigation/model/session-nav-filter.ts` | — |
| Revision families | collapse edit-and-resend chains, branch banners | `.../model/session-revisions.ts`, `branch-banner.ts` | core `collapseSessionRevisions` |
| Live/stale badges | run dot, stale detection, turn-request badge | `stale-sessions.ts`, `features/session-collaboration/ui/session-turn-request-badge.tsx` | `sessions.subscribeEvents` |
| Sidebar nav rows | New task (⌘N), WorkHub (gated), Extensions (skills/mcp), Automations (+pending count) | `packages/ui/src/session-sidebar-nav.tsx` | `scheduledTasks.list` |
| Sidebar footer | update chip (downloaded/error), settings | `session-sidebar-nav.tsx`, `sidebar-update-projection-context.ts` | `app.updateStatus/subscribeUpdateStatus` |
| Nav persistence | `maka-nav-selection-v1` | `nav-selection.ts` | localStorage |
| Workspace picker | new-task project chooser grouped by Host; add/manage projects | `packages/ui/src/workspace-picker.tsx`, `features/task-entry/**` | `newTasks.getCatalog/addProject/relinkProject/getConnections`, `projects.*` |
| Remote directory browser | browse Host roots, register project | `remote-project-directory-dialog.tsx` | `projects.getDirectoryRoots/listDirectory/registerDirectory` |
| Project context | active path, git branch, capabilities | `use-project-context.ts`, `project-path-display.ts` | `projects.getSnapshot/subscribeChanges`, `app.resolveProjectGitInfo` |
| Command palette ⌘K | ~26 commands + live session rows | `command-palette.tsx`, `command-palette-commands.ts`, `app-shell-command-actions.ts` | `diagnostics.copyReport`, `settings.testNetworkProxy`, `memory.openFile`, `dailyReview.*`, `connections.test/setDefault`, `sessions.saveConversationToFile`, `app.openPath` |
| Search modal | full-text thread search across Hosts, jump to turn | `packages/ui/src/search-modal.tsx`, `use-shell-search.ts`, `preload/multi-host-thread-search.ts` | `search.thread` |
| Keyboard help `?` ⌘/ | 5-section cheat sheet | `keyboard-help.tsx`, `locales/shell-copy.ts` | — |
| Global hotkeys | ⌘K, ⌘, , ⌘N, ⌘⇧D, ?, Esc; workbar ⌘⌥S/⌃⇧G/⌃`/⌘T/⌘P | `app-shell-effects.ts`, `app-shell-overlays.tsx`, `features/workbar/model/workbar-tool-definitions.ts` | `appWindow.subscribeCommand` |
| Toasts + confirm | 4 variants, actions, undo, promise confirm, "copy report" on errors | `packages/ui/src/toast.tsx` | `diagnostics.copyReport` |
| OS notifications | on turn end when unfocused | `app-shell-session-events.ts` | `notifications.runEnded` |
| Update banner/about | sidebar reminder; About shows status/progress/install | `features/app-update/**`, `settings/about-update-status.ts` | `app.updateStatus/checkForUpdates/retryUpdateDownload/installUpdate/subscribeUpdateStatus` |
| Onboarding hero | first-run recovery (add provider / fix connection / pick workspace) | `onboarding-hero.tsx`, `use-onboarding-snapshot.ts`, `locales/onboarding-copy.ts` | `onboarding.getSnapshot/setMilestone` |
| Empty states | `EmptyChatHero` greeting + suggestions, `DeepResearchEmptyHero` | `packages/ui/src/chat-empty-hero.tsx` | — |
| Error boundary | crash catch + copy report | `error-boundary.tsx` | `diagnostics.copyReport` |
| Pet companion | optional sprite mascot | `custom-pet-companion.tsx` | `pets.*` |
| WorkHub surface | gated coordination view (experimental) | `workhub-*.ts(x)` (~2700 lines) | `workHub.*` |

## 2. Conversation
### 2.1 Pipeline
`materializeChat` (`packages/ui/src/materialize.ts`, 1195: stored messages -> turns -> timeline items) -> `useTranscriptProjection` (`transcript-projection.ts`, `transcript-row-projection.ts`) -> `LiveTurnProjection` (`live-turn-projection.ts` 675; desktop `live-turn-reconciler.tsx`, `live-turn-snapshot.ts`, `use-shell-live-turn.ts`) -> scroll authority (`transcript-scroll-authority.tsx`, `use-chat-scroll.ts`, `features/conversation/controller/transcript-reading-position.ts`) -> `ChatView` (1109) / `ChatTurn` (1306) -> desktop `chat-message-surface.tsx`.

### 2.2 Message kinds
User message (text, timestamp, copy, edit->revision, attachment thumbs + lightbox, quote chips, directory-reference chips, inline references, skill tokens); assistant markdown; thinking/reasoning collapsible with duration/truncated pill (`astryx-chat-reasoning.tsx`, `thinking-stream.ts`); system messages (compaction/resume/abort); streaming with per-frame display redaction and size caps (`stream-delta.ts`, `assistant-stream.ts`, `streaming-display-redaction.ts`, `redact.ts`, `streaming-presentation.ts`).

### 2.3 Markdown / math / code
`markdown-body.tsx` (GFM, tables, task lists, `data-maka-contract="markdown"`, Han variant `data-maka-script="han"`), closed-world URL policy with `maka://` URIs (`maka-uri.ts`), KaTeX with streaming cache (`markdown-math.tsx`), Mermaid lazy + strict + render budget + zoom/fullscreen (`mermaid-diagram.tsx`), code blocks with copy and collapse >10 lines, `attachment://` images via `attachments.readBytes`.

### 2.4 Tool call timeline
Rendered by activity kind (`computer, read, search, websearch, webfetch, edit, command, explore, browser, tool` — `packages/core/src/events.ts` `TOOL_ACTIVITY_KINDS`) and result kind: `file_diff` (`tool-activity/diff-code-preview.tsx`), `file_write`, `terminal`/`shell_run` (command, cwd, exit code, stdout/stderr or PTY screen, live chunks, background-run status, `WriteStdin`; `tool-result-preview.tsx` 810, `result-projection.ts`, `tool-output-stream.ts`), `web_search`/`web_search_error` (plain text cards), `subagent`/`agent_swarm` (linked-agent rows, click opens child session; `tool-activity.tsx` 815), `rive_workflow`, `json` quiet preview (`@maka/core/tool-quiet-preview`), `image`, `archived_tool_result`, connector tools (`tool_search/load_tools/load_tool`), MCP grouping + brand marks (`mcp-brand-marks.tsx`), computer use action labels (`tool-activity/computer-action-label.ts`), skills tokens + failed-load toasts, sandbox denial + switch-to-bypass-and-retry (`tool-activity/sandbox-denial.ts`, `app-shell-turn-actions.ts`). Mechanics: folding (`timeline-fold.ts`), expand/collapse, copy output, spinner, 500-line cap (`preview-utils.ts`).

### 2.5 Interaction prompts (composer slot, queued via `interaction-queue.ts`)
Sandbox boundary (`sandbox-boundary-prompt.tsx` -> `sessions.respondToSandboxBoundary`), client capability (`client-capability-prompt.tsx` -> `sessions.respondToClientCapability`), ask-user wizard (`user-question-prompt.tsx` + state -> `sessions.respondToUserQuestion`), form interaction (`form-interaction-prompt.tsx` + state -> `sessions.respondToUserForm`). Styles `styles/interaction-prompts.css`.

### 2.6 Turn controls and lineage
Footer actions regenerate/branch/copy/info from `TurnStatus` (`turn-footer-actions.ts`, `use-turn-action-registry.ts`, `derive-turn-lineage-badges.ts` -> `sessions.regenerateTurn/branchFromTurn`); Stop incl. first-token wait (`app-shell-stop-action.ts` -> `sessions.stop`); edit-and-resend revision sessions with banner + prev/next nav (`app-shell-revision-actions.ts`, `session-copy-attempt.ts`, `packages/ui/src/session-context-layer.tsx` -> `sessions.reviseBeforeTurn`); branch banner; transcript history paging with byte budget (`desktop-transcript-range-store.ts`, `preload/transcript-contract.ts` -> `transcripts.open`, `sessions.listTurnLandmarks`); prompt anchor rail (`prompt-anchor-rail.tsx` 797, `styles/prompt-rail.css`).

### 2.7 Notices, context, recovery
Context usage pill + live probe -> Inspector (`chat-composer-region.tsx`, `features/workbar/tools/inspector/live-context-usage.ts` -> `inspector.context/subscribeUsageChanges`); `/compact` + toasts (`app-shell-context-compaction.ts` -> `sessions.compact`); session health notice (`session-health-notice.ts`, `chat-recovery-notice.tsx` -> `connections.getSnapshot`); workspace readiness recovery (`workspace-readiness-recovery.ts`); task readiness blockers (`features/conversation/model/task-readiness-notice.ts` -> `taskReadiness.getSnapshot`, `newTasks.getReadiness`); interrupted-run safe resume (`interrupted-resume.ts`, `runtime-resume-copy.ts` -> `sessions.resumeLatest`); main-process crash notice (`diagnostics.takePreviousMainProcessInterruption`); event health poll (`session-event-health.ts`); message queue while running: promote/edit/delete/reorder (`composer-message-queue.tsx` -> `sessions.promoteQueueEntry/updateQueueEntry/retractQueueEntry/reorderQueueEntries`); selection quote / side conversation (`use-message-selection-quote.ts`, `use-app-shell-composer-quotes.ts`); session context layer chips: branch, revision nav, goal (`session-context-layer.tsx` -> `goal.*`).

### 2.8 Modes above the composer
Plan mode proposal/execution (`plan-mode-panel.tsx` -> `sessions.getPlanState/subscribePlanChanges/requestPlanRevision/approvePlan/resumePlan/abandon*`); agent graph panel for `orchestrationMode==='graph'` (`agent-graph-panel.tsx` -> `graphs.*`); deep research progress + empty hero + handoff (`use-deep-research-run.ts` -> `deepResearch.get/subscribeChanges`); daily review module page (`daily-review-panel.tsx`, `features/module-hub/controller/use-daily-review-controller.ts` -> `dailyReview.*`); work board in Workbar (`work-board-panel.tsx`, `use-work-board.ts` -> `workBoard.*`); session collaboration share/invite/guest/turn-request inbox (`session-collaboration-dialog.tsx`, `features/session-collaboration/**` -> `sessionCollaboration.*` 14 methods).

## 3. Composer (`packages/ui/src/composer.tsx` 2294 + desktop `chat-composer-region.tsx` 412)
Astryx contenteditable input (max 10 rows; Enter send, Shift/Alt+Enter newline; never unmounts) · per-session drafts (`use-composer-draft.ts`, `new-task-reload-intent.ts`) · prompt history ↑/↓ (`use-composer-history.ts`, `input-history.ts`) · `@` file mentions (`composer-mentions.tsx` -> `workspace.searchFiles`, `newTasks.searchFiles`) · directory references (`attachments.pickDirectory`) · `/` slash + skills popup (`desktop-slash-command.ts`, `side-chat-command.ts`, `@maka/core/slash-command-catalog` -> `newTasks.listInvocableSkills`, `skills.listInvocable`; desktop commands `/compact /side /graph /swarm`) · attachments pick/paste/drop with preflight and lightbox (`use-composer-attachments.ts`, `attachment-preflight.ts`, `preload/attachment-ingest-payload.ts` -> `attachments.pickFiles/previewApproval/readBytes`) · quote chips · model switcher + new-chat picker (`chat-model-switcher.tsx`, `model-picker.tsx`, `use-shell-chat-model.ts` -> `sessions.setModelConfiguration`, `connections.getSnapshot`) · thinking level (`sessions.setThinkingLevel`) · permission mode 只读/自动/完全 with bypass confirm (`permission-mode-menu.tsx` -> `sessions.setPermissionMode`) · plan mode toggle (`sessions.setCollaborationMode`) · orchestration radio (`sessions.setOrchestrationMode`) · goal dialog (`features/goals/**` -> `goal.*`) · workspace picker · context pill · Send/Stop with `sendBlocked` hints (`sessions.send/submitMessage/stop`) · prompt suggestions · revision notice · guest turn-request composer (`features/session-collaboration/ui/session-turn-request-composer.tsx`).

## 4. Workbar (`features/workbar/**`, 11 252 lines; `model/workbar-tabs.ts`, `controller/use-workbar-controller.ts`, `ui/workbar-surface.tsx`)
| Tab | Shows | File | Preload |
|---|---|---|---|
| review ⌃⇧G | git diff: changed files paged 20, per-file diffs ≤500 lines, redacted, auto-refresh | `tools/review/session-review-panel.tsx` | `gitReview.read` |
| terminal ⌃` | xterm.js bound to shell run; theme from CSS vars; PTY hydrate/resync; multi-instance | `tools/terminal/*` | `shellRuns.attach/detach/start/write/stop/subscribePtyData/subscribeResync` |
| browser ⌘T | chrome for native WebContentsView: address bar, nav, secure indicator, rect mirroring | `tools/browser/browser-panel.tsx` | `browser.*` |
| files ⌘P | artifact list + preview (text/markdown, diff, sandboxed html iframe, image registry, pdf); copy/save-as/reveal/delete | `tools/artifacts/*`, `packages/ui/src/artifact-preview-registry.ts` | `artifacts.list/readText/readBinary/delete`, `app.openArtifactPath/saveArtifactAs` |
| inspector | context budget bar, composition rows, token usage, duration split, cost, turn->step timeline | `tools/inspector/*` | `inspector.trace/summary/context/subscribeUsageChanges` |
| work-board | todo board | `work-board-panel.tsx` | `workBoard.*` |
| side-chat ⌘⌥S | companion conversation seeded from a quote, own ChatView+Composer+prompts, multi-instance | `tools/side-chat/*` | `sessions.*` (child) |
Styles `styles/workbar/*.css` (1683).

## 5. Settings (modal, left nav in 4 groups; `settings/settings-modal.tsx`, `settings-surface.tsx` 1234, `settings-nav.ts` scopes client/mixed/runtime-host)
- **General**: identity (display name, UI language auto/zh-CN/zh-TW/en, tone) · privacy (incognito, notifications, follow project instructions, WorkHub toggle) · chat defaults (model, permission mode, thinking) · shell · network proxy + test. `general-settings-page.tsx` (1015), `features/network-proxy/**` -> `settings.getClient/update/testNetworkProxy`.
- **Appearance**: theme, 11 palettes, app icon (44 + custom, light/dark split), UI/terminal font size, pets. `appearance-settings-page.tsx`, `theme.ts`, `use-shell-appearance.ts` -> `app.iconPreviews/selectIcon/importIcon/removeIcon`, `pets.*`, `appWindow.setThemeSource`.
- **Workspace/Projects**: Runtime Host profiles (local/WSL/SSH/remote), management dialog (install/restart/update/policy/resources/roots/credentials/connection codes), local remote access, peer mesh (experimental), SSH terminal dialog, onboarding wizard, project catalog. `projects-settings-page.tsx`, `runtime-host-*.tsx`, `features/runtime-host-management/**` -> `runtimeHostProfiles.*`, `runtimeHostManagement.*`, `localRuntimeHostRemoteAccess.*`, `runtimeHostSshTerminal.*`, `runtimeHostOnboarding.*`, `runtimeHostPeerMesh.*`, `projects.*`.
- **Models**: connections list -> detail (rename, enable models, add model, API key, headers/body overlay, test, delete), provider catalog, add-provider stepper with discovery/OAuth, OAuth panels (OpenAI Codex, xAI, GitHub Copilot). `providers-panel.tsx`, `provider-connection-detail.tsx` (1187), `use-connection-detail.ts`, `provider-catalog-page.tsx`, `provider-add-form.tsx`, `provider-brand-marks.tsx`, `features/connection-settings/**` -> `connections.*` (14), `openAiCodex.*`, `xaiOAuth.*`, `githubCopilotSubscription.*`.
- **Subagents**: list/editor. `subagent-settings-page.tsx` -> `settings.update`.
- **Memory**: entries, agent-read toggle, prompt preview, MEMORY.md + backups. `memory-settings-page.tsx`, `use-memory-settings-controller.ts` -> `memory.*`.
- **Bots** (Telegram/Feishu/WeChat/...): `bot-chat-*.tsx`, `packages/ui/src/bot-brand-logo.tsx` -> `settings.bots.*`.
- **Web Search** (Beta, Tavily): `web-search-settings-page.tsx` -> `webSearch.query/test`.
- **Usage**: 5 tabs. `features/usage/**` -> `inspector.summary`.
- **Archived tasks**: `tasks-settings-page.tsx` -> `sessions.unarchive/remove/previewRemoval`.
- **Import tasks**: `import-tasks-settings-page.tsx` (1282) -> `externalSessions.*`.
- **Daily Review** config -> `dailyReview.getConfig/setConfig/runOnce`.
- **Data**: paths, config export/import, clear history. `data-settings-page.tsx` -> `config.export/import`, `app.openPath`.
- **Permissions & Capabilities**: macOS permissions + drag-to-grant, capability checks. `permission-center-page.tsx` -> `permissions.*`, `capabilities.getSnapshot`.
- **Health**: `health-center-page.tsx` -> `health.getSnapshot`.
- **About**: version/channel, updates, report issue, diagnostics. `about-settings-page.tsx` -> `app.info`, `app.checkForUpdates/installUpdate`, `diagnostics.copyReport`.
- Module pages (nav column): **Skills** (`packages/ui/src/skills-panel.tsx`, `features/module-hub/controller/use-skills-controller.ts` -> `skills.*`), **MCP** (`mcp-page.tsx` 1186 -> `mcp.*`), **Scheduled tasks** (`scheduled-task-panel.tsx` -> `scheduledTasks.*`), **Daily review**.

## 6. Cross-cutting
- Theming: light/dark/auto; pre-React bootstrap (`cached-theme-bootstrap.ts`, `main.tsx`); 11 palettes via `[data-maka-theme]`; titlebar overlay sync on Windows; fonts now the three bundled Anthropic families (`styles/fonts.css`, unlicensed — replace before external release).
- i18n: exactly `zh-CN`, `zh-TW`, `en` (`packages/core/src/ui-locale.ts`), preference `auto|<locale>`; copy in typed catalogs: 28 files in `renderer/locales/` (10 876 lines) + `@maka/ui` copy modules; Astryx catalog bridged by `astryx-i18n.tsx`.
- Accessibility contracts: `data-maka-contract` values incl. `markdown`, `markdown-flow`, `mermaid`, `composer-inner`, `composer-input`, `session-row`, `titlebar-identity`, `search-modal`, `shell-topbar-rail`, `onboarding-surface`, `onboarding-card`, `module-main`, `module-actions`, `mcp-market-row`, `settings-sidebar`, `providers-panel`, `provider-catalog`, `provider-setup`, `connection-detail`, `add-connection`, `subagent-detail`, `session-workbar-right|bottom`, `session-workbar-count`, `session-inspector*`, `session-terminal-xterm`. ARIA: `role=status`+`aria-live`, `aria-busy`, `inert` shell under modals, roving row focus, lightbox, reduced motion via `data-maka-reduced-motion`.
- E2E fixture: `window.maka.e2eFixture.getState()` under `MAKA_E2E_FIXTURE`; `applyE2eFixture` (`app-shell-e2e-fixture.ts`) freezes `Date.now`, sets `data-maka-e2e-fixture*`, forces theme/locale, selects session, opens tools; `window.makaE2eLatch` delays lazy Settings chunk. Scripts `check:e2e-budget`, `check:renderer-architecture`.
- No telemetry; display redaction on every streamed string; incognito pauses memory/web search/scheduled triggers.

## 7. Line counts
Renderer ts/tsx 93 402 (root modules 28 008 incl. `app-shell.tsx` 3188; `settings/` 24 686; `features/` 27 494; `locales/` 10 876; `platform/desktop` 755; computer-use overlay 1058). Renderer CSS 13 570. `packages/ui/src` 32 561 (+13 108 tests). Preload 8 683 (`preload.ts` 3899, `bridge-contract.d.ts` 1852).

## 8. Experimental / rarely used (scope candidates)
Gated: WorkHub (client setting, copy says not available yet, ~2700 lines); Runtime Host peer mesh/direct peer (experimental badges, 1805-line dialog); phase-3 experimental providers (form disabled); Web Search (Beta); MCP market cards ("coming soon"). Conditional: agent graph panel (graph mode), deep research, plan mode, goal chip, session collaboration (needs remote access), swarm/graph radio, pets, rive workflow, drag-to-grant overlay (macOS), SSH/WSL/Windows-task dialogs, WeChat scan login, app icon split, import tasks, OAuth enrollments, computer-use cursor overlay engine. Also low-usage: bottom Workbar placement, multi-instance terminal/side-chat, 14 MCP catalog brands, 44 app icons.
