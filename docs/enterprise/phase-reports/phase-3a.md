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

# Phase 3a handoff — transcript

Implements [plan §6 Phase 3a](../frontend-rewrite-plan.md#phase-3--conversation-and-composer).

## What is on screen
- `components/session/SessionView.tsx`: relx `.chat-area`/`.chat-feed` measure, `@maka/ui` scroll authority (follow tail vs reading anchor, jump to latest), byte-budgeted history paging (`HistoryControls`), notices, message queue, a `composerSlot` (placeholder textarea until Phase 3b).
- `TranscriptTurn.tsx` over `TurnViewModel`: user rows (`UserMessageRow`: attachments, quotes, references, edit-and-resend), assistant markdown (`StreamPopMarkdown` → `Markdown`), `ThinkingBlock`, `TurnFooter` (copy / regenerate / branch / info from `hooks/use-turn-presentation.ts` + lineage badges + failure labels).
- Tool timeline `components/session/tools/`: registry keyed by Maka **activity kind** and **result kind** (exhaustive, test-enforced) — diff (Prism via `@maka/ui` `diff-syntax.ts`), terminal/shell run with live output and background status, web search, subagent rows (open child session), json quiet preview, image, archived result, connector labels, MCP brand marks, computer-use labels, sandbox-denied → switch to full access + regenerate; folding, expand/collapse, copy, 500-line cap.
- Notices: session health, workspace readiness, task readiness, safe resume, stream health, compaction outcome, `RevisionBanner` with version navigation, `ContextUsageIndicator` (`store/context-usage-store.ts`).
- `MessageQueue.tsx` (promote / edit / delete / reorder), `ModelSwitcher.tsx` in the titlebar's actions slot, `SelectionQuote.tsx` → `store/composer-draft-store.ts`, `store/revision-draft.ts`.
- A pending-interaction status row (`data-maka-contract="interaction-pending"`) stands in for the Phase 3b prompts.

## Verification
All gates green (build, typecheck, lint, format, ASF, architecture ledger regenerated, locale hygiene, notices, knip); 1397 desktop + 96 renderer state tests + 200 `@maka/ui` tests; Electron smoke 16 checks (markdown settles, model switcher lists the seeded connection, regenerate, tool request row + pending answer, edit-and-resend fork, both themes, all four renderers). Screenshots `.maka-shots/enterprise/phase3a-*.png`.

Bug found and fixed: an unstable `useStore` selector (`s.pending[id] ?? []`) produced React error #185 on forked sessions; replaced by a frozen-constant selector.

## Deferred / open
Phase 3b: TipTap composer into `composerSlot`, the four interaction prompts, send/stop blocked hints, permission-mode menu, plan toggle, attachments, mentions, slash. Phase 4: PTY input from tool rows, artifact previews for `file_write`/`image`, workbar toggle beside the model switcher. Carried: thinking-block duration (needs a projection field), mermaid and `attachment://` images in the ported markdown pipeline, branch banner and goal chip placement.
