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

# relx-copilot frontend — design-system port inventory

Research snapshot, 2026-09-06. Source repo: `/Users/liangbing/program/relx-copilot/frontend`
(project "R27": Next.js 16 App Router, React 19, Tailwind CSS 4 CSS-first config, TS 5, alias `@/* -> ./src/*`).
This is the reference design for the Maka enterprise renderer rewrite. Facts only.

## 1. Design tokens — `src/app/globals.css` (1807 lines, the only CSS file)

Heavily annotated in Chinese with "measured from claude.ai via CDP" rationale; the comments are load-bearing.

| Lines | Content | Class |
|---|---|---|
| 1 | `@import "tailwindcss"` | foundational |
| 3–32 | `@utility border / border-t/r/b/l/x/y` -> all `border-width: 0.5px` | foundational hairline system |
| 34–136 | `@font-face` x6 + 4 metric-compatible serif fallbacks | foundational |
| 138–445 | `:root` light tokens | foundational |
| 448–574 | `.dark` | foundational |
| 579–659 | `@media (prefers-color-scheme: dark) { :root:not(.light) }` — byte-duplicate of `.dark` (comment at 576 mandates identical values) | foundational |
| 661–764 | `@theme inline` — Tailwind utility mapping | foundational |
| 766–887 | `.ui-control-squish` + 6 variants + reduced-motion | foundational (button press) |
| 889–938 | `.sidebar-nav-scroll[data-scrolled]` mask, `.bg-sidebar-selected` focus-ring override, `.sidebar-icon-btn` | shell |
| 940–1040 | toast + tooltip keyframes (`.ui-toast`, `.ui-tooltip`) | foundational (Radix) |
| 1042–1113 | `@property --scroll-fade-*` + `@utility scroll-fade-y` (scroll-driven mask) | foundational |
| 1115–1141 | `body`, `[data-app-shell][data-sidebar-collapsed]` header clearance | shell |
| 1143–1156 | `.highlight-message`, global `*:focus { outline:none }` | mixed |
| 1158–1244 | Prism `.custom-code-highlight` / `.custom-json-highlight` -> `--code-*` | foundational |
| 1246–1273 | global scrollbars (thin, 6px webkit thumb) | foundational |
| 1275–1318 | `.standard-markdown`, `.markdown-body sup`, GFM footnotes | foundational |
| 1320–1419 | `.chat-area`, `.chat-feed`, `.chat-user-bubble`, `.chat-user-content`, `.chat-assistant-response`, `.chat-composer-surface`, `.tiptap.ProseMirror`, `.task-welcome`, `.chat-composer-frame/-width` @768px | chat core |
| 1421–1461 | `shimmer`, `status-dot-breathe` | foundational |
| 1463–1487 | `.fade-clip-end` / `.fade-clip-wide` (mask title truncation) | sidebar rows |
| 1489–1533 | `.animate-typing-dot/-out` | group-chat only |
| 1535–1549 | `.animate-viz-loading-in` | visualizer only |
| 1551–1576 | `fadeIn` + `.stream-pop` | core streaming |
| 1578–1621 | `gradient-flow`, `composer-notice-in`, `ring-pulse-once`/`ring-breathe`/`ring-halo` | context-usage ring |
| 1623–1732 | `@media print` | export only |
| 1734–1741 | mobile `.chat-area` | chat |
| 1743–1753 | `.search-highlight mark` | search |
| 1756–1807 | `--series-1..8` dataviz palette (3 theme blocks) | xlsx charts only |

### Token families (`:root`)

- **Surface ladder** (monotonic; dark "raised = lighter"): light `--surface-0 #f9f9f7`, `-1 #fcfcfb`, `-2 #ffffff`, `-3 #ffffff`; dark `#0b0b0b / #151515 / #1a1a19 / #20201f`. Derived: `--sidebar-background` (light `color-mix(surface-0 50%, surface-1)`, dark `surface-1`), `--preview-backdrop` (light `alpha-1`, dark `surface-0`).
- **Alpha ladder**: `--alpha-base` = `--sidebar-text-primary` in light, pure `#ffffff` in dark (line 144: using warm `#f0efec` yellow-tints every hairline). `--alpha-0..9` = 0/5/10/20/35/50/60/70/85/95%.
- **Text tiers** (three co-equal): `--text-primary` `#0b0b0b`/`#f0efec`, `--text-secondary` `#52514e`/`#c3c2b7`, `--text-muted` `#898781` (both themes), `--text-disabled` = `alpha-4`. Floor: clickable text >= secondary, two named exceptions (icon-only buttons; sidebar "View all"/"More").
- **Role quads** (text / fill / fill-hover / border / bg / on), light/dark:
  - accent: `#184f95`/`#6da7ec` · `#2a78d6` · `#3987e5` · `#86b6ef`/`#0d366b` · `#cde2fb`/`#032042` · `#ffffff`
  - danger: `#8e2626`/`#ec7e7e` · `#d03b3b` · `#e34948` · `#f09595`/`#641919` · `#fad6d6`/`#3c0e0e` · `#ffffff`
  - warning: `#734500`/`#db9300` · `#fab219` · `#eda100` · `#eda100`/`#512e00` · `#f9dca4`/`#311a00` · `#0b0b0b`
  - success: `#006300`/`#0ca30c` · `#009300` · `#0ca30c` · `#73cb6d`/`#074506` · `#caeac7`/`#11260f` · `#0b0b0b`
- Also: `--fill-brand #c6613f` / `--fill-brand-hover #d97757` (brand orange, NOT the primary button colour), `--fill-primary` (= text-primary light, `#ffffff` dark) / `--fill-primary-hover` (`#2c2c2a`/`#e1e0d9`) / `--on-primary`, `--fill-secondary` `rgb(255 255 255 / 10%)` / `--fill-secondary-hover`, `--fill-field`, `--on-overlay #ffffff`.
- **Borders**: `--hairline` = alpha-2 (10%), `--border-strong` = alpha-3 (20%), `--border-stronger` = 40% off alpha-base. Painted at 0.5px via the `@utility border*` overrides.
- **Focus ring** `--sidebar-focus-shadow`: `inset 0 0 0 1px var(--focus-ring-bg), 0 0 0 1px var(--fill-accent), 0 0 6px 1px var(--bg-accent)`; `--focus-ring-bg` (default `--surface-1`) re-declared per container (only `.bg-sidebar-selected` does, line 911).
- **Shadows**: `--shadow-near/--shadow-far` (light `rgb(11 11 11 / 6%/8%)`, dark `rgb(0 0 0 / 12%/18%)`); composites `--field-shadow{,-hover}`, `--field-error-shadow`, `--card-shadow{,-hover}`, `--pane-shadow`, `--menu-shadow`, `--dialog-shadow`, `--tooltip-shadow`, `--tooltip-desc-shadow`, `--panel-shadow-color`, `--panel-ring-color`, `--composer-shadow{,-hover,-focus,-drag}` (dark switches to `inset 1px`).
- **Radii**: no scale; only `--chat-composer-radius: 14px`, `--tooltip-radius: 6px`.
- **Motion**: `--control-spring` (15-stop `linear()`), `--dur-fast .12s`, `--tooltip-duration 120ms`, `--tooltip-easing cubic-bezier(.32,.72,0,1)`, toast enter `.3s cubic-bezier(.16,1,.3,1)` / exit `.2s ease-out`, `.sidebar-icon-btn` 450ms. Every animation has a reduced-motion companion.
- **Z-index**: no tokens; ad-hoc Tailwind (`z-50` menus, `z-20` right pane, `z-10` header fade).
- **Tooltip** two sets: `--tooltip-*` and `--tooltip-desc-*` (black 80% + blur 8px). **Menu**: `--menu-{surface,text-primary,text-muted,hover,accent,hairline,shadow}`.
- **Chat**: `--chat-text-primary`, `--chat-response-font` (system-ui stack — AI body copy is NOT anthropic-sans), `--chat-composer-background`, `--chat-composer-radius`, `--chat-content-max: 50.5rem`, `--chat-feed-max: 48rem`.
- Misc: `--sidebar-{hover,selected,add-chip,control-hover,menu-hover}`, `--nav-active`, `--skeleton-fill`, `--status-dot-{strong,soft}`, `--scrollbar`, `--dialog-overlay` (.4/.5), `--code-*` (9 Prism roles x2), `--series-1..8`.

### Light vs dark
Three synchronized blocks: `:root` (light), `.dark` (class, via next-themes `attribute="class"`, `defaultTheme="system"`), and `@media (prefers-color-scheme: dark) { :root:not(.light) }` (duplicate). Most of the flip is `--alpha-base -> #ffffff`; ~40 tokens explicitly overridden.

### `@theme inline` utilities (661–764)
Colour utilities: `fill-brand`, `gc-user-message`, `{danger,warning,success}` + `-fill`, `-fill-hover`, `-line`, `-subtle`, `on-{role}`; `accent`, `accent-line`, `accent-subtle`, `accent-fill`, `accent-fill-hover`, `on-accent`; `scrollbar`, `dialog-overlay`, `surface-0..3`, `sidebar`, `sidebar-hover`, `sidebar-selected`, `nav-active`, `skeleton`, `sidebar-text-primary/secondary/muted`, `sidebar-add-chip`, `on-overlay`, `text-primary/secondary/muted/disabled`, `alpha-1..9`, `border-strong`, `border-stronger`, `fill-primary{,-hover}`, `on-primary`, `fill-secondary{,-hover}`, `fill-field`, `sidebar-control-hover`, `sidebar-menu-hover`, `hairline`, `menu-*`, `tooltip`, `tooltip-foreground`; `--shadow-tooltip`, `--radius-tooltip`. Convention: `text-<role>` / `bg|border-<role>-fill` / `border-<role>-line` / `bg-<role>-subtle` / `text-on-<role>`; `border-border-strong` is the correct class. Font-weight override: medium 500, semibold 580, bold 600.

### Global element styles
`body`: `background: var(--surface-1)`, `color: var(--text-primary)`, `font-family: var(--font-sans)`, `height: 100dvh`, `overflow: hidden`, antialiased. `*:focus { outline: none }`. Scrollbars thin + 6px webkit thumb. No global `::selection` (only in code blocks). `.standard-markdown`, `.markdown-body sup`, footnotes.

## 2. Fonts and icons

| family | file (public/fonts/) | weights | style | display |
|---|---|---|---|---|
| `Anthropicons-Variable` | `anthropic/anthropicons-variable.woff2` (93 KB) | 400–700 | normal | block |
| `anthropic-sans` | `anthropic/anthropic-sans.woff2` (118 KB) | 300–800 | normal | swap, `dlig 0` |
| `anthropic-sans` | `anthropic/anthropic-sans-italic.woff2` (129 KB) | 300–800 | italic | swap |
| `anthropic-serif` | `anthropic/anthropic-serif.woff2` (165 KB) | 300–800 | normal | swap |
| `anthropic-serif` | `anthropic/anthropic-serif-italic.woff2` (163 KB) | 300–800 | italic | swap |
| `anthropic-mono` | `mono/antmono.woff2` (65 KB) | 400 | normal | swap |
| `anthropic-mono` | `anthropic/anthropic-mono-italic.woff2` (70 KB) | 400 | italic | swap |

Four metric-compatible serif fallbacks (`Anthropic Serif Fallback Georgia/Times/DejaVu/Noto`) via `src: local()` + `size-adjust`/`ascent-override`/`descent-override`, Latin-only `unicode-range`. Unused on disk: `fonts/gc/*.otf`, `fonts/styreneb/asans.woff2`. Provenance: `public/fonts/anthropic/SOURCE.md` — scraped from claude.ai 2026-08-16, "No license or redistribution grant".

Stacks: `--font-sans` `'anthropic-sans'` -> system-ui -> ... -> PingFang SC, Microsoft YaHei, Noto Sans CJK SC -> emoji. `--font-display` `'anthropic-serif'` -> 4 metric fallbacks -> Georgia/Times -> CJK ladder -> emoji. `--font-mono` `'anthropic-mono'` -> SF Mono/ui-monospace/Menlo -> emoji. Serif (`font-display`) is used for page/section titles and hero copy (60 uses / 23 files incl. `ui/list-page-header.tsx`, `chat/TaskWelcomeContent.tsx`, `chat/ContextUsageIndicator.tsx`, `ErrorPage.tsx`; often with `[font-variation-settings:'opsz' N]`). `font-mono` 51 uses. Preloaded in `src/app/layout.tsx`: sans, serif, anthropicons.

### Icon system — Anthropicons icon font
`src/components/icons/Anthropicon.tsx` (234 lines) is the whole system: `ANTHROPICON_SPECS` maps ~135 semantic names -> `{ glyph: '\uEXXX', size, weight }` (codepoints ``–``, copied from Claude's icon registry). `AnthropiconSize = 12|16|18|20|24|32`; `REGULAR_WEIGHT_BY_SIZE = {12:577.75, 16:533.25, 18:483.25, 20:433.25, 24:400, 32:400}`. Renders `<span aria-hidden data-anthropicon={name}>` with inline `fontFamily`, `fontVariationSettings: 'ANIM' 0, 'ANM2' 0, 'opsz' <size>, 'wght' <weight>`, ligatures off, `fontSynthesis:none`, fixed square box.

Other icons (`src/components/icons/`): `GoogleDriveIcon`, `GmailIcon`, `GoogleCalendarIcon`, `GoogleWorkspaceIcon`, `NocobaseIcon`, `DingtalkIcon`, `RelxLogo` (barrel `index.ts`), `ProviderIcon.tsx` (model-provider logos). `public/icons/`: `logo.svg`, `logo-animated.svg`, `relx-y.svg`, PWA PNGs. `src/lib/utils/connector-icons.tsx`, `ui/ServerIcon.tsx`. **No icon library** in package.json (no Phosphor/lucide). Avatars: `avvvatars-react`.

Port must copy: the 7 woff2 files (incl. anthropicons), the `@font-face` block with rewritten `url()`s, `Anthropicon.tsx` verbatim, font preload hints; note `next.config.ts` sets `Access-Control-Allow-Origin: *` on `/fonts/*` for the sandboxed visualizer iframe.

## 3. Component inventory
Legend: (a) presentation-only, portable · (b) coupled to relx backend/stores/hooks · (c) Next.js-specific.

### `src/components/ui/` (52 files)
(a) 41: `button.tsx` (Radix Slot; variants default|secondary|destructive|outline|ghost|link; sizes default|sm|lg|icon|iconSm; surfaces via `.ui-control-squish`), `dialog`, `dropdown-menu`, `popover`, `select`, `switch`, `scroll-area`, `toast`, `tooltip`, `sidebar-tooltip`, `input`, `textarea`, `label`, `avatar`, `segmented-control`, `split-button`, `sort-select`, `confirm-dialog`, `skeleton`, `chats-list-skeleton`, `projects-list-skeleton`, `meetings-list-skeleton`, `chat-skeleton`, `LoadingSpinner`, `shimmer-title`, `text-shimmer`, `MeshGradientCircle` (`@paper-design/shaders-react`), `ServerIcon`, `user-avatar`, `pane-resizer`, `Console`, `JsonHighlight`, `CodeRenderer`, `DiffRenderer`, `Markdown`, `StreamPopMarkdown`, plus class-string modules `card-surface.ts`, `checkbox-box.ts`, `content-well.ts`, `count-badge.ts`, `field-surface.ts`, `menu-variants.ts`, `status-chip.ts`.
(b) 6: `AttachmentContent`, `AttachmentViewer`, `ImageViewer` (`@/lib/api`); `connector-picker` (mcpStore); `right-pane-shell` (uiStore, trivially re-wirable); `toaster` (useToast).
(c) 3: `compact-list-row` (next/link), `list-page-header` (pulls SidebarToggleButton), `user-menu` (next/navigation + next-intl).
Radix (one file each): slot->button, dialog, dropdown-menu, popover, select, switch, scroll-area, toast, tooltip.

### Layout / sidebar / settings / file-preview
- `layout/MainHeader.tsx` — (c) only for `next/link` in breadcrumb; exports `mainHeaderTextControlClass`, `mainHeaderTextLabelClass`, `mainHeaderIconControlClass`, `mainHeaderActionControlClass`, `MainHeaderActionButton` (h-7, rounded-[7px], `hover:bg-sidebar-menu-hover`).
- `sidebar-parts/` (19): (a) `sidebar-row-motion.ts`, `SidebarNavButton`, `SidebarNewButton`, `SidebarRowActionTrigger`, `SidebarTabPanel` (owns `data-scrolled`), `useSidebarPeek`, `useHiddenGroupKeys`, `index.ts`; (b+c) `ConversationItem`, `ProjectItem`, `GroupChatItem`, `ChannelItem`, `SidebarResources`, `SidebarScheduledSection`, `SidebarCustomizeDialog`, `useSidebar.ts` (720 lines, next/navigation + 5 stores), `useSidebarDisplayGroups` (types), `SidebarGrouping` (next-intl + next/link), `SidebarListFallback` (next-intl).
- `settings/` (16): all (b)/(c); only `settings-row.tsx` is presentation-only. `general/GeneralSettings.tsx` uses next-themes.
- `file-preview/` (18): (a) `FilePreviewSurface`, `PreviewRenderer`, `PreviewNotice`, `Audio/Image/Markdown/Mermaid/Office/Pdf/React/Svg/Xlsx FilePreview`, `XlsxChart`; (b) `FilePreviewContent`, `HtmlFilePreview`, `PublishArtifactDialog`, `FilePreviewViewer` (666 lines); (c) `PdfFilePreviewWrapper` (next/dynamic).

### Motion (`motion/react`, 65 files)
`sidebar-parts/sidebar-row-motion.ts` exports `sidebarRowFadeProps` = `{initial:{opacity:0}, animate:{opacity:1, transition:{duration:0.12, ease:'easeOut'}}, exit:{opacity:0, transition:{duration:0.1, ease:'easeIn'}}}` spread onto rows under `AnimatePresence mode="popLayout"`. `AnimatePresence` in 30 files; `layoutId` in `Sidebar.tsx` tab slider; springs only in `compact-list-row` (stiffness 500, damping 28) and `direct-chat/Reactions`. Anything with a CSS equivalent is CSS keyframes, not motion (globals.css 1426).

### TipTap composer
`chat/TipTapEditor.tsx` (18 KB): StarterKit, `tiptap-markdown` Markdown, Placeholder, two Mention instances (`@` default, `Mention.extend({name:'skillMention'})` with own `PluginKey`), custom markdown serializer for mention atoms; Enter sends / Shift+Enter newline, invertible via `sendOnShiftEnter`; suggestion popup owns the send key. Suggestions: `chat/mention-suggestion.tsx` (`@`), `chat/skill-slash-suggestion.tsx` (`/`), both `ReactRenderer` + `tippy.js`, reuse `ui/menu-variants.ts`. Draft model `src/lib/composer/draft.ts` (`ComposerDraft {version:2, doc?, markdown, plainText}`), `tokens.ts`, `surface.ts` (`COMPOSER_SHADOW_CLASS`, `COMPOSER_META_CHIP*`, `COMPOSER_DISCLAIMER*`). `chat/ChatInput.tsx` (41 KB) is the shell — heavily (b); its layout classes (`chat-composer-frame`, `chat-composer-width`, `chat-composer-surface`) are the portable part.

### Markdown pipeline
`ui/Markdown.tsx` (16 KB, a): react-markdown@10 + remark-gfm, remark-math, custom `remarkInlineDollarMath`; rehype-katex, rehype-raw (skippable via `disableRawHtml`), custom `rehypeStripBreakNewlines`, `rehypeStreamPop`; imports `katex/dist/katex.min.css`; custom renderers for code (CodeRenderer), tables, blockquotes, lists, footnotes, inline colour swatches (`lib/color-utils`), `@mention`/`/skill` tokens (`lib/utils/inline-tokens`, opt-in). Utils: `lib/utils/rehype-stream-pop.ts`, `rehype-strip-break-newlines.ts`, `remark-inline-math.ts`, `normalize-math.ts`, `hast-node.ts`, `highlight.ts`. `ui/StreamPopMarkdown.tsx`: 180ms flush batching + 800ms fade (`--stream-pop-duration`). `CodeRenderer`: Prism with 11 static languages, themed by `.custom-code-highlight` + `--code-*`. `JsonHighlight` (prism-json). `DiffRenderer` hand-rolled. `mermaid` only in `file-preview/MermaidFilePreview.tsx`.

### Tool-call rendering — `chat/tools/`
`types.ts`: `ToolData`, `ToolResult`, `ToolWithResult` (+thinking), `ToolDisplayData`, `ToolHeaderProps`, `ToolContentProps`, `CanExpandProps`, `MCPServerInfo`, `ToolSummaryLabel {one, other, merge?}`, `ToolRendererConfig {toolNames, renderHeader, summaryLabel?, activeLabel?, ContentComponent?, canExpand?, showContentOnError?, supportsStreaming?}`, `ToolGroupProps`. `renderers/registry.ts` singleton `toolRegistry` with "how to add a renderer" template; `renderers/index.ts` registers 22 renderers, `GenericRenderer` last (fallback). Agent-generic renderers: `Thinking`, `WebSearch`, `WebFetch`, `BashTool`, `CreateFile`, `View`, `StrReplace`, `Memory`, `ToolSearch`, `PresentFiles`, `TaskTool`, `SubagentOutput`, `BrowserTool`, `Skill`, `Generic`; relx-specific: `GoogleDrive`, `Gmail`, `GoogleCalendar`, `PastChats`, `Meetings`, `Projects`, `KnowledgeSearch`, `WorkspaceSearchContacts/Department`, `Dispatch`. Only 4 touch stores. `activeToolLabels.ts` (`getActiveToolLabel`, default 'Working on it'). `TaskToolGroup.tsx` (16 KB) / `TaskToolItem.tsx` (12 KB) collapsible group + row with motion; `tool-result.tsx`, `utils.ts` (`parseToolInput` via `partial-json`), `constants.ts`, `FileBadge.tsx`; `computer-use/` (`BashRenderer`, `FileOperationRenderer`, `CreateFileStreamingContent`); `chat/subagent/` (`SubagentGroup`, `useSubagentStream`); `chat/task-sidebar/` (8 files).

## 4. App shell and data model
- `src/app/layout.tsx` (server): font preloads, ThemeProvider -> NextIntlClientProvider -> AuthProvider -> children + MCPOAuthDialog; Toaster + ChunkReloadGuard outside intl.
- `src/app/(app)/layout.tsx` (server): reads cookies `sidebar-collapsed`/`sidebar-width` (Electron: replace with localStorage/main store).
- `components/AppLayout.tsx` (55 lines): `<div data-app-shell data-sidebar-collapsed class="flex h-dvh bg-surface-1">` + `<Sidebar>` + `<main data-sidebar-main class="relative min-w-0 flex-1 overflow-hidden">`; mounts relx-only `useQuota`, `useFaviconBadge`, `VersionUpdateManager`, `QuotaExceededDialog`; `useSidebarCollapsedHandshake`.
- `components/Sidebar.tsx` (53 KB): 5 tabs (`personal/group/talk/Y`; `MESSAGES_TAB_ENABLED=false`), `layoutId` tab slider, motion rows, next-intl/link/navigation, 2 websockets, 6 stores. Structure portable, wiring not.
- Resize: `hooks/useResizableSidebarWidth.ts` (pointer capture, 3px slop, keyboard 10/20, cookie) + `lib/sidebar-layout.ts` (DEFAULT 288, MIN 200, MAX 420). Collapse: `hooks/useSidebarCollapsedHandshake.ts`. Peek: `sidebar-parts/useSidebarPeek.ts` (120ms grace; pinned while `[data-sidebar-overlay="true"]` or `[data-app-dialog][data-state="open"]`; Esc returns focus). Grouping: `SidebarGrouping.tsx` + `useSidebarDisplayGroups.ts` + `useHiddenGroupKeys.ts`; buckets today/yesterday/older (`lib/utils/date.ts`).
- `ui/right-pane-shell.tsx`: 8px inset frame, r10, `surface-3`, `--pane-shadow`, 48px header, z-20, fullscreen auto-collapses sidebar. `ui/pane-resizer.tsx`: 3-layer grab handle (w-3 hit, focus layer, 3x48 grip).

### Zustand stores (`src/store/`, 38 stores, 13k lines) — key ones
`chatStore` (2670: streaming `ContentBlock` accumulation from SSE, `isConnecting/isGenerating/isStopping/isCompacting`, `streamingMessageId`, send/stop/resume/reconnect), `conversationsStore` (1292: `conversationById`, starred/recent/task lists, hasMore/isLoading, request-id guards, transient running/pendingAsk/compacting), `uiStore` (sidebar collapsed, right pane expanded, sidebar nav memory, `welcomeInputPrefill`), `filePreviewStore` (files by path, `streamingFiles` by toolUseId with partial-json state, panel ui), `authStore`, `attachmentStore`, `modelStore`, `tasksStore`/`taskStatsStore`, `askUserStore`, `chatComposerStore` (active TipTap handle), `browserPreviewStore`/`nocobasePreviewStore`/`webSearchPanelStore`; the rest are relx-server features.

### Types (`src/lib/api/types.ts`, 426 lines)
`ContentBlock { index, type: 'text'|'tool_use'|'tool_result'|'thinking'|'error', text?, id?, name?, input?, tool_use_id?, content?, is_error?, thinking?, start_timestamp?, stop_timestamp?, isCompleted? }` (Anthropic-shaped). `Message { id, conversation_id, parent_message_id (tree, ROOT '0000…'), role, content_blocks[], attachments[], created_at, token counts, extra_data, user_feedback }`. `Conversation { id, title, project_id, model_provider, model_name, tools_settings, is_starred, mode: 'chat'|'task'|'knowledge', current_leaf_message_id, is_generating, has_pending_ask, is_compacting, has_unread_reply, tasks, task_stats, archived_at, context_* , ... }`. `TaskItem`, `TasksData`, `TaskStats`, `MessageAttachment`, `StreamEvent` (union: message_start|message_delta|message_stop|user_message|content_block_start|content_block_delta|content_block_stop|context_compact_start|context_compact_stop|tasks_snapshot|task_stats_snapshot|error; `_event_id` for resume). `chatStore` has its own `Message` variant (timestamp Date, isStreaming, pending, synthetic, stop_reason).

### API / transport / i18n
`lib/api/client.ts` (ApiClient base, bearer auth, 401/403/429 mapping). `lib/api/sse.ts` — streaming transport (fetch SSE, 20s connect, 60s idle watchdog). WebSockets only for relx social features. Domain modules core-adjacent: chat, conversations, projects, files, user-files, sandbox-files, models, skills, plugins, mcp, subagent, share, publish, feedback, memory, agents, scheduled-chats, integrations, auth.
i18n: `src/i18n/config.ts` (`en`, `zh-CN`, default en), server-action cookie locale, `messages/en.json` + `zh-CN.json` (1093 lines, 13 namespaces: today, common, groupChat, chat, settings, sidebar(114), inputMenu, feedback, quota, knowledge, customize, memory, tag); `useTranslations('<ns>')` in 87 files; ICU plurals. Coverage partial — `ui/*` and tool renderers hard-code English.

## 5. Pages
Core (port): `/` -> `/welcome` (new-chat composer + `TaskWelcomeContent` greeting), `/chats`, `/chats/[id]` (ChatHeader + ChatMessages + ChatInput + RightPaneShell + FilesSidebar + TaskSidebar), `/projects`, `/projects/[id]`, `/files`, `/setting` (+ general, account, capabilities=skills, connectors=MCP; `layout.tsx` has the 220px sticky nav), `(standalone)/public/artifacts/[id]`, `(standalone)/shared/[id]`.
relx-server only (skip): meetings, knowledge, knowledge-bases, group-chats, direct-chats, channels, admin, setting/wallet, setting/dispatch, setting/usage, schedules, agents, extensions, digest/today, nocobase preview, auth/login/privacy/terms.

## 6. Dependencies
Needed: `@radix-ui/react-{dialog,dropdown-menu,popover,scroll-area,select,slot,switch,toast,tooltip}`, `motion@^12`, `zustand@^5`, `clsx` + `tailwind-merge` (`cn()` in `lib/utils/common-utils.ts`), `tailwindcss@^4` (+ Vite plugin instead of postcss), `@tiptap/{core,react,pm,starter-kit,suggestion}`, `@tiptap/extension-{mention,placeholder}`, `tiptap-markdown`, `tippy.js`, `fast-deep-equal`, `react-markdown`, `remark-gfm`, `remark-math`, `rehype-katex`, `rehype-raw`, `katex`, `prismjs`, `partial-json`, `throttleit`, `avvvatars-react`; optional `@paper-design/shaders-react` (MeshGradientCircle only).
File-preview only: `mermaid`, `react-pdf` (needs `canvas: false` alias), `xlsx`, `jszip`, `isomorphic-dompurify`.
Drop: `next`, `next-intl`, `next-themes`, `eslint-config-next`. Unused: `@xyflow/react`, `@dagrejs/dagre`, `unicornstudio-react`, `uuid`, `react-katex`.
Vendored: `public/libs/{chart.umd.js,d3.min.js,topojson.min.js}` for the sandboxed visualizer iframe (`lib/visualize/widget-host.ts`); `public/audio-processor.js` (meetings).
