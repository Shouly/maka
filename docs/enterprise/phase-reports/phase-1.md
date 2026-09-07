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

# Phase 1 handoff

Phase 1 implements the bridge/state contract in
[`frontend-rewrite-plan.md`](../frontend-rewrite-plan.md#phase-1--bridge-and-state).
The working tree is ready for review; no commit was created by this task.

## Implemented

- Completed the inherited typed Bridge wrappers. `bridge/bridge.ts` is the only
  production accessor of the preload object. The last direct legacy consumer,
  message settlement, now goes through `bridge/transcripts.ts`.
- Added a Zustand session catalog with request generations, active selection,
  mutation helpers, and authoritative preload snapshots. Preload owns offline-Host
  retention and removed-profile/Guest-access cleanup; the renderer does not merge
  its stale rows back into that result.
- Added the active-session controller. It owns the bounded transcript handle,
  observation/reseed/retry lifecycle, live-turn projection, interaction queues,
  submitted-message queues, transient queue rows, execution boundary, stream
  health and context-compaction outcome.
- Reused the original event handlers and `@maka/ui` projection/reconciliation:
  display deltas batch to animation frames with the original fallback; lifecycle
  events flush first; assistant handoff waits for durable messages; terminal
  interactions clear synchronously; observations retry from 100 ms up to 2 s.
- Reused bounded shell hydration and the canonical shell-result merge, including
  inherited shell ownership and same-revision output preservation.
- Added turn actions for send/submit/stop, regenerate, branch/revise, resume,
  compact, queue operations, interaction responses and session modes. Operations
  retain their captured Session; uncertain send results are retained without
  automatic resubmission. Overlapping operations of the same kind are rejected
  rather than silently dropping a different user intent.
- Added separately scoped projects, connection and settings stores. Default-Host
  and active-session project information have separate ownership. Stopping a
  scope invalidates pending reads and clears its display data. Settings patches
  are serialized; client appearance/locale updates are applied to the app.
- Added UI/workbar state using the existing layout reducers and persistence keys,
  and carried the bootstrap fixture's selection/layout state into those stores.
- Added `useRendererStores`, `useActiveTurns`, `useLiveTurnSnapshot` and
  `useProjectContext`. Selection changes reset observation before paint;
  transcript projection also checks the selected Session identity.
- Added `RuntimeDebug.tsx`, a temporary page with real session selection,
  sending/stopping, history controls, projected turns, interaction response JSON,
  queue/submission inspection, and a theme control. Copy has English, Simplified
  Chinese and Traditional Chinese catalogs. The existing design preview is
  accessible from its header.

Existing pure modules stay in `lib/ported/` because main-process contract tests
also import these paths. No backend, main-process, preload, shared-contract or
native source was changed.

## How Phase 2 connects

Mount `useRendererStores()` once under the locale provider in the final shell.
Select the catalog from `sessionsStore`; use `sessionsStore.select(id)` for
navigation. Render conversation content from `useActiveTurns()` rather than
accumulating raw events. Shell controls can use `useLiveTurnSnapshot()` to avoid
subscribing to every text delta. Read active interaction and message-queue state
from `activeSessionStore`, and call `turnActionsStore` with the captured Session
ID. Projects, model connections, Host settings and client settings are distinct
stores exposed by `store/index.ts`.

Replace the temporary debug page with the Phase 2 shell. It is intentionally a
JSON inspection surface, not the Phase 3 conversation/composer design. Keep the
`.appFrame`, titlebar, locale/theme bootstrap and reveal handshake in place.

## Verification

Commands run from the repository root:

```sh
npm run build
npm --workspace @maka/desktop run typecheck
npm run lint
npm run format:check
npm run check:asf-headers
npm run check:renderer-architecture
npm run check:locale-hygiene
npm --workspace @maka/ui run test:dist
npm --workspace @maka/desktop run test:dist
npm --workspace @maka/desktop run test:renderer-smoke
```

The desktop test command now includes `test:renderer-state`, which can also be
run independently. It bundles the TypeScript tests into a temporary Node test
entry; test-only dependencies never enter the shipped renderer.

Results: 30 state and presentation tests, 1,397 existing desktop tests, 200 UI logic tests and
112 architecture-checker tests pass. Build, desktop typecheck, lint, formatting,
ASF headers, architecture and locale checks pass. Vite retains a large-chunk
warning because the temporary design preview and UI logic are bundled together.

The Electron smoke test uses a temporary data root and the repository's test
backend through the **real Electron preload, Runtime Host and SQLite**. It
verifies:

1. New session, send, streamed reply and terminal `TurnViewModel`.
2. Switching to another session without inherited messages or draft text.
3. Tool request, active interaction, response acknowledgement and completion.
4. Steering admission and updated projection while a turn is running.
5. Stopping a streaming turn.
6. Reloading the window and reading persisted history.
7. Updating appearance through the UI, settings IPC, subscription and dark theme.

Renderer runtime errors: zero. Screenshots and the machine-readable result are
under `.maka-shots/enterprise/phase1-{light,dark}.png` and
`.maka-shots/enterprise/phase1-smoke-result.json` (ignored local artifacts).

## Verification limits

The model in the smoke test is deterministic `FakeBackend`; this does not prove
a real cloud-provider round-trip. Actual remote-Host handoffs, native sandbox
permission grants, and each branch/revise/model/project mutation have not been
individually exercised in the desktop smoke test. Request/scope races, stream
retries, interaction acknowledgements, shell ownership and transcript handoff
are covered by the new state tests. The full Phase 2 shell and Phase 3 user-facing
conversation/permission components are not implemented here.

## Review fixes

The follow-up review corrected removed-Host session resurrection, the display
owner of queued settings writes, Radix-modal/native-titlebar synchronization,
Node/Electron import checks for every renderer directory, and single-line
Markdown code blocks. These changes have targeted regression coverage.

`globals.css` comments were reduced from 443 lines to 81 while preserving all
378 custom-property declarations. The keyboard-focus fallback and debug-page
color classes were corrected. See the plan (§2.6) for the
current design constraints; the embedded preview uses the app's theme control.
