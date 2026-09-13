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

# Phase 7a — Plan mode has a panel behind its switch

Closes the first "half-exposed" item on the release checklist (2026-09-12):
the ＋ menu could put a Session into Plan mode, but nothing showed the
proposal the model handed back and nothing could approve, revise, resume or
abandon it. The seven `sessions` plan methods were registered in main and
preload and never called.

## What landed

- `bridge/plan.ts` — the plan half of `sessions`, wrapped: `getPlanState`,
  `subscribePlanChanges`, `requestPlanRevision`, `abandonPlanProposal`,
  `approvePlan`, `resumePlan`, `abandonPlanExecution`.
- `store/plan-store.ts` — one Session's plan as a resource store, refreshed on
  `plan-mode:changed` and on the catalog's turn transitions for that Session.
  Controls return the Host's structured refusal (`PlanControlIpcResult`) into
  a `control` sub-store (`pending`, `failure`) instead of throwing; approve
  and resume mint their turn id here and re-send the same id on a retry after
  a refusal, so the Host reconciles instead of starting a second turn.
  `reviewableProposal` / `reportedExecution` are the two selectors the
  surfaces use.
- `components/session/PlanProposalCard.tsx` — the proposal, in the transcript
  after the turn that submitted it (upstream's placement). While it is the
  latest and still waiting it carries Request changes / Execute plan; the
  Host's refusal shows under the buttons. A stale or approved proposal keeps
  its card, marked by its status chip. When the proposing turn is outside the
  loaded window the waiting proposal stands at the tail instead.
- `components/session/notices/PlanExecutionBanner.tsx` — the approved plan
  being carried out, above the composer beside the Goal strip: title, running
  / interrupted chip, `n/m steps`, a fold for the step list; interrupted adds
  Resume and Abandon plan (confirmed).
- `SessionView.tsx` observes the plan store for the admitted Session (the
  same gate GoalBanner uses) and mounts both.
- `locales/plan-mode-copy.ts` (already ported) gains the fold's two labels.

Both surfaces are split into a pure view (`PlanProposalCardView`,
`PlanExecutionStrip`) and a thin connected wrapper. Not only for taste: a
server render of a component that reads a zustand store sees the store's
INITIAL state (`useStore` hands React `getInitialState` as the server
snapshot), so a presentation test of the connected component can never show
data. Render the view.

## Verification

- `npm --workspace @maka/desktop run typecheck` (renderer), `npx biome check
  apps/desktop/src/renderer`, `check:architecture` (ledger regenerated with
  `--write`), `check:asf-headers`, `check:locale-hygiene`, `knip`.
- `test:renderer-state`: 289 pass, including the seven new cases in
  `plan-state.test.ts` — observe/re-read cues, refused approval keeps its turn
  id on retry, revision re-read, transport failure as `internal_failure`,
  resume/abandon, execution selection, and the two rendered surfaces.

## Owed

- A live proposal. FakeBackend (`@maka/runtime-host/test-only`) has no plan
  support, so no e2e or smoke scenario can produce one; the surfaces were
  checked by rendering fixtures. Exercise against a real provider in Plan
  mode: propose → Request changes → propose again → Execute → interrupt (Stop)
  → Resume, and Abandon plan.
- The composer's Plan chip does not yet say that a proposal is waiting.
