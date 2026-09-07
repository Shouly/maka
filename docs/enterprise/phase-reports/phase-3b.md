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

# Phase 3b handoff — composer and interaction prompts

Implements [plan §6 Phase 3b](../frontend-rewrite-plan.md#phase-3--conversation-and-composer).
First pass by Codex; reviewed and reworked by the coordinator (see "Review fixes").

## What is on screen

- `components/composer/ChatInput.tsx`: the relx composer surface (`chat-composer-surface`
  + `COMPOSER_SHADOW_CLASS`, drag shadow and overlay) serving both the welcome
  surface and `SessionView`'s `composerSlot`. Chips for staged attachments
  (image thumbnails), folder references and quotes; control row with attach /
  folder / skills icon controls, workspace + model pickers (welcome only),
  permission-mode and thinking-level meta-chip selects (`ComposerSelect.tsx`),
  Plan chip, goal dialog (`GoalControl`), context ring, and stop / send keys.
  Send is solid accent (`.ui-control-squish-accent-fill`, a Maka addition —
  the product's primary colour is blue, not relx's brand orange).
- `TipTapEditor.tsx`: StarterKit reduced to paragraphs + hard breaks, one
  `composerReference` atom (`@file` / `/skill`), `@` and `/` suggestion list
  in the shared menu chrome with file / skill / command icons, keyboard model
  (↑ ↓ ⏎ Tab Esc, Space commits an exact skill), IME-safe, live
  `aria-expanded` / `aria-activedescendant`.
- `lib/composer-document.ts`: one traversal produces wire text, `skillIds` and
  file-reference offsets after whitespace normalization.
- `store/composer-input-store.ts`: one draft per Session or new-task target
  (document, attachments, folders, welcome-time permission / thinking / plan,
  revision + admission intent). Document and folders persist to
  `localStorage['maka-composer-drafts']`, bounded to 32 drafts / 120k chars;
  attachments are process-local by nature.
- Send pipeline: preflight → `/compact` and unsupported `/side /graph /swarm` →
  fresh readiness → reserve admission id → (welcome) create Session, transfer
  draft and quotes, apply collected settings, select → `submitMessage` with
  steering placement while running → acknowledge only what was sent.
  `outcome_unknown` keeps the draft and the admission id.
- `InteractionPrompts.tsx`, pinned above the composer: sandbox boundary,
  client capability, the ask-user wizard in the relx `AskUserPanel` form
  (numbered option rows, "Something else" inline input, ← → paging, ✕ submits
  what is answered with `null` for the rest, Skip per question, pick advances
  and the last pick submits) over `@maka/ui` `user-question-prompt-state`, and
  typed forms over `form-interaction-prompt-state` with relx `Select` and
  `checkbox-box` controls.
- Copy: `locales/composer-copy.ts` (zh-CN, zh-TW, en).

## Review fixes (coordinator, after Codex's first pass)

- Deleted the unreferenced `ComposerPlaceholder.tsx` re-export shim.
- Drafts now survive a restart (persisted store with an injectable storage
  seam; two new tests cover round-trip and the bound).
- Ask-user wizard rewritten over the shared prompt-state module: skipping is
  allowed again (the old wizard forced an answer per question), option and
  free-text drafts no longer share a string, relx look and keyboard model.
- relx chrome throughout: icon controls, chip remove buttons with
  `Anthropicon` `x`, meta-chip selects, menu-variants suggestion list, relx
  `Select` / checkbox box in forms, `Label`-based goal dialog.
- Suggestion list a11y attributes track the open state and active option.
- Readiness probe no longer disables send while it is in flight (send
  re-checks anyway).
- Comma-chained declarations split; file-level comments explain the send
  failure model and the draft ownership rules.

## Verification

- build, desktop typecheck, lint, format:check, ASF headers, renderer
  architecture (ledger regenerated), locale hygiene, third-party notices,
  knip (no desktop findings).
- renderer state tests: 105 pass (96 + 9 composer).
- Electron smoke 19 checks with real preload / Host / SQLite and FakeBackend:
  multi-question wizard through the real Host, file + skill atoms, dropped
  attachment bytes, draft cleanup, full-access confirm cancel/commit, Plan
  round-trip, plus every Phase 3a check.
- `test:composer-prompts` (isolated Electron + bridge double): capability
  grant, sandbox deny, typed form validation, absent optionals, response
  failure and retry.
- Screenshots: `.maka-shots/enterprise/phase3b-composer.png`,
  `phase3a-tool-row.png` (wizard), refreshed 3a captures.

## Deferred / open

- `@tiptap/extension-mention` and `@tiptap/suggestion` stay installed but
  unused (knip-ignored); removing them means a lockfile + notices regeneration.
- Real-provider end-to-end (tool / permission / regenerate / branch against a
  live model) still to be exercised by hand; deterministic Host smoke covers
  the same paths.
- Carried from 3a: thinking-block duration, mermaid and `attachment://`
  images in markdown, branch banner / goal chip placement.
