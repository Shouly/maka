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

# Phase 5b handoff — Models, Subagents, Memory, Web Search, and the three module pages

Implements [plan §6 Phase 5b](../frontend-rewrite-plan.md#phase-5--settings-and-module-pages)
under the desktop shell rules of [§2.12](../frontend-rewrite-plan.md). It closes the four
settings pages Phase 5a left as `ComingSoon` and the three module pages the shell was still
drawing a `ModulePlaceholder` for; both placeholders and their copy catalog are deleted.

## The company gateway

The reason the fork exists, and the one allowed touch outside the renderer:
`packages/core/src/provider-registry.ts` gains `relx-gateway` — "RELX Gateway", an
OpenAI-compatible chat-completions endpoint, `category: 'custom'`,
`catalogGroup: 'recommended'`, `authKind: 'api_key'`, `runtimeAdapter` the connection-scoped
`openai-compatible` one with `requireBaseUrl`, discovery over `GET <baseUrl>/models`, and
`catalogOrder: -1` so it is the first row of the add-connection catalog. Additive: a new key,
nothing else in the file moved.

Two decisions inside it are worth stating because they look like omissions:

- **No `baseUrl`.** The gateway host is per deployment. `category: 'custom'` is what admits an
  empty endpoint in `provider-catalog-contract.test.ts`, and it makes the setup form ask for a
  URL — which is the honest state until someone decides the build should ship the company's.
- **No `relayModelProfiles`.** `isRelayProviderType` in `@maka/core/llm-connections` narrows to
  the two custom-relay ids; a third provider answering `true` through it would make that type
  predicate false. The gateway's models are described by discovery and built-in metadata like
  every other endpoint's.

Display copy in three locales lives in `lib/ported/provider-display-copy.ts` (whose
`satisfies Record<ProviderType, …>` is what forced the entry), and the mark is *drawn* in
`provider-brand-marks.tsx` in `currentColor` — a doorway between two columns — rather than
vendored, because the gateway is a deployment of this build and has no third-party trademark to
reproduce. Nothing was added to the third-party notice closure.

`npm --workspace @maka/core run build && … test:dist` is green with no fixture edits: every
`Record<ProviderType, …>` in core except the display copy is `Partial`, and the catalog contract
test admits a custom connection with no endpoint by design.

## What is on screen

- **Models** (`components/settings/models/`, `ModelsSettings.tsx` switching four faces over
  `models-view.ts`; no routing, `modelsViewParent` is the whole Back contract):
  - `ConnectionsList.tsx` (`data-maka-contract="providers-panel"`) — the default-model selector
    over `chatModelChoices`, then one row per connection: brand mark, name, provider, default
    badge, enabled-model count, and a status chip only when there is something to act on.
    `lib/ported/provider-connection-status.ts` decides label and tone in one branch so the two
    cannot drift: retired outranks everything (the row can never work again), `needs_reauth`
    outranks disabled (a lapsed OAuth login arrives as both, and "sign in again" is not "you
    turned this off"), disabled+error keeps both facts, and a merely `verified` connection earns
    no badge at all — it proves the credential validated, not that a turn will run.
  - `ConnectionDetail.tsx` (`connection-detail`) — rename, endpoint presentation, a four-state
    credential row (never "not set" while the read is in flight), replace-key, enabled models
    with a filter and a manual add, catalog refetch, request-headers editor with the
    retain-saved-value state, test-connection with latency and tested model or the classified
    failure, and the delete danger row.
  - `AddConnection.tsx` (`add-connection`) → `ProviderCatalog.tsx` (`provider-catalog`) →
    `ProviderSetupForm.tsx` (`provider-setup`). The catalog is the registry's own order grouped
    by `catalogGroup`, with the three account sign-ins above it. Setup verifies before it
    writes: `verifyConnectionOnboarding` → pick models → `saveConnectionOnboarding`, with a
    distinct message for every rejection reason, every failure class, and — separately —
    `not_saved` versus `outcome_unknown`, because "nothing was written" and "we do not know" are
    not the same sentence.
  - `OAuthPanel.tsx` — one panel, three configurations, over the new `bridge/oauth.ts`.
    Enrollment-disabled, signed out, authorizing (with the device `stateHint`), authenticated,
    refreshing, refresh_failed, storage_failed; sign in, complete, cancel, refresh, sign out,
    and the local `gh` credential import for Copilot only. Every state comes from the bridge.
- **Subagents** (`SubagentsSettings.tsx` + `subagents/SubagentEditor.tsx`,
  `data-maka-contract="subagent-detail"`) — the preset list over
  `RuntimeHostAppSettings.subagents.presets`, each row badged only when its route is broken
  (`lib/ported/subagent-preset-presentation.ts`: missing connection / retired provider /
  disabled connection / disabled model, in that order). The editor derives the `subagent_id`
  from the name until the user takes it over, caps name and description where the store's
  normalizer *drops* rather than trims, and writes the whole array through
  `settingsStore.update`, then re-reads for the id it wrote — a preset the normalizer rejected
  disappears silently otherwise.
- **Memory** (`MemorySettings.tsx` + `memory/MemoryEntryList.tsx` +
  `lib/ported/memory-settings-presentation.ts`) — the two switches, the status chip, the
  remembered entries with their filter, the MEMORY.md document with save / reload / open, reset
  and restore-latest behind confirms, and a model-context preview built through
  `buildLocalMemoryPromptBody` that names *which* of the four reasons is blocking injection when
  one is. Every mutation returns the new `LocalMemoryState` and that value replaces the page's,
  rather than a second read racing the first.
- **Web Search** (`WebSearchSettings.tsx`) — source select, enable switch with a credential
  status chip plus source and last-test lines, the Tavily key as a write-only field (env /
  saved / unset), save and clear (clearing turns the feature off in the same write), the
  credential test, and a query probe marked **Beta** whose results render on the page and are
  never written into a task.
- **Skills / MCP / Scheduled tasks** (`components/modules/`) — one frame,
  `modules/module-page.tsx`, carrying `module-main` on the page and `module-actions` on the
  header's right slot, over the same 48px `MainHeader` the conversation uses. Skills: installed
  list with enable / pin / open / delete, the built-in catalog with install, and the local
  source library fed by `skills.sources.importLocalFile`. MCP: configured servers from
  `getMcpConfig` + `listMcpStatuses` kept live by `subscribeMcpChanges` and stored as ONE value
  (`store/mcp-store.ts`) so a row can never exist without its status, add / edit through a
  stdio-or-URL dialog validated by `lib/ported/mcp-server-draft.ts`, test, remove, the OAuth
  login/logout the preload exposes, and the catalog directory with `mcp-market-row` on every
  card. Scheduled tasks: the list from `scheduledTasksStore` (which gained its mutations, each
  re-reading after the write), enable / run now / edit / delete, and a create-and-edit dialog
  bound to the real `CreateScheduledTaskInput` through
  `lib/ported/scheduled-task-form-payload.ts`.
- **Copy**: `locales/settings-models-copy.ts` is a port of the pre-rewrite
  `features/connection-settings/settings-provider-copy.ts` (already three locales in the
  `UiCatalog` shape), trimmed to what ships plus the gateway's endpoint vocabulary;
  `locales/modules-copy.ts` is new and small. `settings-subagents-copy.ts` needed nothing,
  `settings-memory-copy.ts` gained a reset confirmation, `settings-web-search-copy.ts` gained
  `beta`. `mcp-copy.ts`, `@maka/ui`'s `skills-copy.ts` / `scheduled-task-copy.ts` and
  `settings-shared-copy.ts` are reused as they stand.

## Verification

| Gate | Result |
|---|---|
| `npm run build` | pass (renderer entry contract + third-party notices byte-identical) |
| `npm --workspace @maka/desktop run typecheck` | pass (preload + main + renderer) |
| `npm run lint` | pass, 2978 files |
| `npm run format:check` | pass, 2374 files |
| `npm run check:asf-headers` | pass, 3177 covered files |
| `npm run check:renderer-architecture` | pass, ledger regenerated (`--write`) |
| `npm run check:locale-hygiene` | pass |
| `npx knip` | no `apps/desktop` findings (the same pre-existing `.css` configuration hint) |
| `npm --workspace @maka/core run build && … test:dist` | 833 pass, no fixture changes needed |
| `npm --workspace @maka/desktop run test:renderer-state` | 159 pass (139 + 20 in `phase5b-state.test.ts`) |
| `npm --workspace @maka/desktop run build:test && … test:dist` | 1413 + 159 pass |
| `npm --workspace @maka/desktop run test:composer-prompts` | pass |
| `npm --workspace @maka/desktop run test:renderer-smoke` | 43 checks pass, no renderer errors |

`store/__tests__/phase5b-state.test.ts` (registered in `run.mjs`) pins the decisions a
screenshot cannot check: the gateway's registry shape and its place at the head of
`CATALOG_PROVIDER_TYPES`, its three-locale display copy, the add-connection field gate
(identity → endpoint → credential, one issue at a time), which writer verifies before it
writes, the enabled-model ordering the Host reads a default out of, the connection chip's
priority order, the subagent availability order, memory's blocked-reason order, the MCP draft
round trip and its per-line map errors, the schedule form's wire shapes, and that both stores
re-read after every mutation.

The Electron smoke (real preload, Runtime Host, SQLite and FakeBackend) grew eight Phase 5b
checks and lost the one that asserted a page was not built: Models lists the seeded `E2E`
connection and opens its detail; the add-connection catalog offers **RELX Gateway** and its
setup form refuses to submit without the endpoint an operator hands out (a named `role="alert"`,
not a network failure); Subagents creates a preset through the settings IPC, sees it come back
in the list, and deletes it again; Memory's agent-read switch is written to the Host and read
back after leaving the page and returning; Web Search renders its probe on the default source
and its credential test once the source is Tavily; the sidebar's Skills, MCP and Automations
rows each open a `module-main` page with its own `module-actions` slot; and the Automations page
creates a scheduled task through its dialog and deletes it again. Every one of them also asserts
that the window titlebar still carries the sidebar toggle — a page that swallowed the way back
would pass every functional assertion and still be broken.

Screenshots: `.maka-shots/enterprise/phase5b-{models,connection-detail,provider-catalog,provider-setup,subagents,memory,web-search,skills,mcp,scheduled,scheduled-task}-light.png`
and `phase5b-scheduled-dark.png`.

## Deviations from the brief

- **Subagent presets have no permission mode and no system prompt.** The brief asked for both.
  `SubagentPreset` is `{id, name, description, profile, connectionSlug, model, thinkingLevel?,
  enabled}` — the `profile` (`local_read` / `web_research` / `implementation`) *is* the
  capability boundary, and there is no prompt field. Adding either is a `packages/core` change
  outside this phase's allow-list, so the editor covers what the data model stores.
- **The copy catalogs are named for their siblings, not for the brief.** The brief listed
  `models-copy.ts`, `subagents-copy.ts`, `memory-copy.ts`, `web-search-copy.ts`; three of those
  already existed as `settings-{subagents,memory,web-search}-copy.ts` with the pre-rewrite
  vocabulary intact, so they were reused and the new one is `settings-models-copy.ts`.
- **The MCP directory has no "coming soon" rows.** The brief said to show them "as the old app
  did"; the pre-rewrite page (`49ae5e395:apps/desktop/src/renderer/mcp-page.tsx`) installs every
  catalog entry, and no such string exists in `mcp-copy.ts`. An entry flagged `setupRequired`
  installs as a disabled template and says its credentials are still owed. Every card carries
  `mcp-market-row`.
- **No "write a skill" dialog.** The reference design has one; no preload method writes a skill
  from text, and the renderer cannot hand a `File` across the bridge either, so import is a
  single button calling `skills.sources.importLocalFile`, which opens main's own picker.
- **The endpoint is validated before the API key.** A key is obviously required; an address an
  operator hands out is not, so the field a user is least likely to know they owe is the one
  reported first. The pre-rewrite form also ran its gate only on the legacy create path, which
  is exactly how an empty gateway endpoint would have gone out as a request to nowhere.
- **Endpoint-less providers now go through Host onboarding.** The pre-rewrite route sent them to
  the create-then-discover writer, so the provider class most likely to be misconfigured was the
  one class never verified. The wire has carried `baseUrl` since the custom relays joined
  onboarding.
- **Scheduled tasks are local reminders.** `ScheduledTaskEffect` supports bot delivery, but the
  target list belongs to the Bots settings page, which plan §3 defers. An agent-authored
  `agent_run` or interval schedule is preserved verbatim rather than re-authored; the delivery
  row says so.
- **A bug found and fixed while writing the smoke.** `SubagentsSettings` returned the editor
  early, above the removal `ConfirmDialog`, so the editor's own "Remove" set the pending preset
  and opened nothing — a delete that resolved successfully and did nothing. Both faces now
  render in one tree with the confirm mounted on both.

## Deferred / open

- **The relay-profile editor ships only its thinking levels.** Vision tri-state, context-window
  override and the OpenAI fast service tier are not editable; their copy is in the catalog under
  `detail.*`. Only the two custom relay providers have profiles at all, so the gateway is
  unaffected.
- **No request-body overlay editor.** Headers are editable on a connection; the extra top-level
  JSON is not. Copy exists (`detail.extraRequestBody`).
- **Advanced request settings are edited after a connection exists**, never at creation.
- **Memory has no manual entry add and no per-entry archive.** The document editor covers the
  same ground visibly; the copy keys remain. Only the latest backup is offered — `restoreBackup`
  and `openBackup` take a kind, and the backup list is not enumerated.
- **Scheduled-task due notifications are still unwired.** `subscribeScheduledTasksDue` has no
  subscriber anywhere in the renderer. It belongs to the shell's store lifetime, not to a page
  that may not be mounted; it is not this phase's page work and was left rather than bolted on.
- **MCP brand marks render monochrome.** The vendored marks were styled by the deleted
  `styles/module-pages/mcp.css`; they are wrapped in `[&_svg]:fill-current` so they are legible
  in both themes. Restoring brand colour needs a rule in `styles/globals.css`.
- **The xAI mark does not paint in the OAuth card.** Visible in
  `phase5b-provider-catalog-light.png`: OpenAI and GitHub Copilot show a glyph and xAI shows an
  empty slot. The mark is a CSS mask (`ProviderAssetMask`) that needs an explicit size the card
  does not give it. Cosmetic, pre-existing to this phase's components.
- **What the deterministic backend cannot exercise.** No OAuth provider can be signed into from
  a FakeBackend, no gateway endpoint answers `/models`, no Tavily key exists, and no MCP server
  is installable without credentials. Still owed by hand: a real RELX Gateway connection end to
  end (verify → choose models → send a turn), each of the three OAuth flows including sign-out,
  a connection test and a model-catalog refetch against a live provider, request headers against
  a real endpoint, a Tavily key saved and probed, an MCP server added from the directory and
  tested, a skill imported from a file, and a scheduled task actually firing.
- Carried forward: the archive-a-revision-family no-op (Phase 5a, outside the allow-list), the
  bottom workbar placement, PDF preview, multi-instance terminals.
