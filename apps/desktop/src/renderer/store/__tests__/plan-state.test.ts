/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { LocaleProvider } from '@maka/ui';
import type { PlanProposal, PlanSessionState } from '@maka/core/plan';
import type { SessionChangedEvent } from '@maka/core/session';
import type { PlanControlIpcResult } from '../../../shared/plan-mode-ipc.js';
import { createPlanStore, reportedExecution, reviewableProposal } from '../plan-store.js';
import { PlanProposalCardView } from '../../components/session/PlanProposalCard.js';
import { PlanExecutionStrip } from '../../components/session/notices/PlanExecutionBanner.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function proposal(overrides: Partial<PlanProposal> = {}): PlanProposal {
  return {
    planId: 'plan-1',
    proposalId: 'p1',
    sessionId: 'S1',
    turnId: 'T1',
    revision: 1,
    title: 'Rename the login handler',
    overview: 'Two files, one rename.',
    steps: [
      { id: 's1', title: 'Rename', description: 'Rename the export.' },
      { id: 's2', title: 'Update callers', description: 'Fix the three imports.' },
    ],
    risks: ['A stale import breaks the build.'],
    status: 'pending_approval',
    submittedAt: 1,
    ...overrides,
  };
}

function planState(overrides: Partial<PlanSessionState> = {}): PlanSessionState {
  return {
    schemaVersion: 1,
    sessionId: 'S1',
    storeVersion: 3,
    proposals: [proposal()],
    executions: [],
    latestProposalId: 'p1',
    ...overrides,
  };
}

const ok = <T>(value: T): PlanControlIpcResult<T> => ({ ok: true, value });
const refused = <T>(code: string): PlanControlIpcResult<T> => ({
  ok: false,
  error: { code, message: code },
});

function harness(initial: PlanSessionState) {
  let state = initial;
  let planListener: (() => void) | undefined;
  let catalogListener: ((event: SessionChangedEvent) => void) | undefined;
  const calls: string[] = [];
  let reads = 0;
  let approvals: Array<{ proposalId: string; turnId: string; expectedRevision: number }> = [];
  let approveAnswer: () => PlanControlIpcResult<{ turnId: string; executionId: string }> = () =>
    ok({ turnId: 'x', executionId: 'e1' });
  let turnIds = 0;
  const store = createPlanStore({
    subscribeChanges: (handler) => {
      catalogListener = handler;
      return () => {
        catalogListener = undefined;
      };
    },
    newTurnId: () => `turn-${++turnIds}`,
    bridge: {
      getPlanState: async () => {
        reads += 1;
        return state;
      },
      subscribePlanChanges: (_sessionId, handler) => {
        planListener = handler;
        return () => {
          planListener = undefined;
        };
      },
      requestPlanRevision: async (_sessionId, proposalId) => {
        calls.push(`revise:${proposalId}`);
        state = planState({ proposals: [proposal({ status: 'stale' })] });
        return ok(state);
      },
      approvePlan: async (_sessionId, input) => {
        approvals.push({
          proposalId: input.proposalId,
          turnId: input.turnId,
          expectedRevision: input.expectedRevision,
        });
        return approveAnswer();
      },
      resumePlan: async (_sessionId, executionId, turnId) => {
        calls.push(`resume:${executionId}:${turnId}`);
        return ok({ turnId, executionId });
      },
      abandonPlanExecution: async (_sessionId, executionId) => {
        calls.push(`abandon:${executionId}`);
        return ok(state);
      },
    },
  });
  return {
    store,
    calls,
    approvals: () => approvals,
    resetApprovals: () => {
      approvals = [];
    },
    reads: () => reads,
    setState: (next: PlanSessionState) => {
      state = next;
    },
    setApproveAnswer: (answer: typeof approveAnswer) => {
      approveAnswer = answer;
    },
    plan: () => planListener,
    catalog: () => catalogListener,
  };
}

test('the plan is read on observe and re-read on its own channel and on turn transitions', async () => {
  const h = harness(planState());
  const stop = h.store.observe('S1');
  await tick();
  assert.equal(h.store.getState().data?.latestProposalId, 'p1');
  const before = h.reads();
  h.plan()?.();
  await tick();
  assert.equal(h.reads(), before + 1);
  // Another Session's turn is not this plan's business; this one's is.
  h.catalog()?.({ reason: 'turn-status-change', sessionId: 'S2', ts: 1 });
  h.catalog()?.({ reason: 'message-appended', sessionId: 'S1', ts: 2 });
  await tick();
  assert.equal(h.reads(), before + 1);
  h.catalog()?.({ reason: 'turn-status-change', sessionId: 'S1', ts: 3 });
  await tick();
  assert.equal(h.reads(), before + 2);
  stop();
  assert.equal(h.plan(), undefined);
  assert.equal(h.catalog(), undefined);
  assert.equal(h.store.getState().data, undefined);
});

test('a refused approval is shown, and its retry re-sends the same turn id', async () => {
  const h = harness(planState());
  h.store.observe('S1');
  await tick();
  h.setApproveAnswer(() => refused('session_busy'));
  await h.store.approve('S1', proposal());
  assert.equal(h.store.control.getState().failure?.code, 'session_busy');
  assert.equal(h.store.control.getState().pending, false);
  h.setApproveAnswer(() => ok({ turnId: 'turn-1', executionId: 'e1' }));
  await h.store.approve('S1', proposal());
  assert.deepEqual(
    h.approvals().map((item) => item.turnId),
    ['turn-1', 'turn-1'],
  );
  assert.equal(h.store.control.getState().failure, undefined);
  // Once accepted, the next approval is a new request with a new turn.
  h.setState(
    planState({ proposals: [proposal({ proposalId: 'p2', revision: 2 })], latestProposalId: 'p2' }),
  );
  await h.store.approve('S1', proposal({ proposalId: 'p2', revision: 2 }));
  assert.equal(h.approvals()[2]?.turnId, 'turn-2');
  assert.equal(h.approvals()[2]?.expectedRevision, 2);
});

test('a revised proposal is re-read; a transport failure reads as an internal failure', async () => {
  const h = harness(planState());
  h.store.observe('S1');
  await tick();
  await h.store.requestRevision('S1', 'p1');
  assert.deepEqual(h.calls, ['revise:p1']);
  assert.equal(h.store.getState().data?.proposals[0]?.status, 'stale');
  assert.equal(reviewableProposal(h.store.getState().data), undefined);
  h.setApproveAnswer(() => {
    throw new Error('bridge gone');
  });
  await h.store.approve('S1', proposal());
  assert.equal(h.store.control.getState().failure?.code, 'internal_failure');
  assert.equal(h.store.control.getState().pending, false);
});

test('resume keeps its turn id across a refusal; abandon goes straight through', async () => {
  const interrupted = planState({
    proposals: [proposal({ status: 'approved' })],
    executions: [
      {
        executionId: 'e1',
        planId: 'plan-1',
        proposalId: 'p1',
        sessionId: 'S1',
        status: 'interrupted',
        steps: [
          { id: 's1', title: 'Rename', description: '', status: 'completed', updatedAt: 2 },
          { id: 's2', title: 'Update callers', description: '', status: 'pending', updatedAt: 2 },
        ],
        startedAt: 1,
        updatedAt: 2,
        interruptedAt: 2,
      },
    ],
  });
  const h = harness(interrupted);
  h.store.observe('S1');
  await tick();
  assert.equal(reportedExecution(h.store.getState().data)?.executionId, 'e1');
  await h.store.resume('S1', 'e1');
  await h.store.abandonExecution('S1', 'e1');
  assert.deepEqual(h.calls, ['resume:e1:turn-1', 'abandon:e1']);
});

test('reportedExecution prefers the active execution over an older interrupted one', () => {
  const base = {
    planId: 'plan-1',
    proposalId: 'p1',
    sessionId: 'S1',
    steps: [],
    startedAt: 1,
    updatedAt: 1,
  };
  const state = planState({
    executions: [
      { ...base, executionId: 'old', status: 'interrupted', interruptedAt: 1 },
      { ...base, executionId: 'now', status: 'active' },
    ],
    activeExecutionId: 'now',
  });
  assert.equal(reportedExecution(state)?.executionId, 'now');
  assert.equal(reportedExecution(planState({ executions: [] })), undefined);
});

function render(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return parseHTML(
    renderToStaticMarkup(createElement(LocaleProvider, { locale: 'en', children: node })),
  ).document;
}

test('the proposal card lists the steps and offers both decisions only while reviewable', () => {
  const noop = () => {};
  const reviewable = render(
    createElement(PlanProposalCardView, {
      proposal: proposal(),
      reviewable: true,
      pending: false,
      onRevise: noop,
      onExecute: noop,
    }),
  );
  const card = reviewable.querySelector('[data-maka-plan-proposal="p1"]');
  assert.ok(card);
  assert.equal(card.querySelectorAll('ol li').length, 2);
  assert.ok(card.textContent?.includes('A stale import breaks the build.'));
  assert.deepEqual(
    Array.from(card.querySelectorAll('button')).map((button) => button.textContent),
    ['Request changes', 'Execute plan'],
  );
  const refusedCard = render(
    createElement(PlanProposalCardView, {
      proposal: proposal(),
      reviewable: true,
      pending: true,
      failureText: 'A task is running in this Session.',
      onRevise: noop,
      onExecute: noop,
    }),
  ).querySelector('[data-maka-plan-proposal="p1"]');
  assert.ok(refusedCard);
  assert.ok(
    refusedCard.querySelector('[role="alert"]')?.textContent?.includes('A task is running'),
  );
  assert.ok(
    Array.from(refusedCard.querySelectorAll('button')).every((button) =>
      button.hasAttribute('disabled'),
    ),
  );
  const approved = render(
    createElement(PlanProposalCardView, {
      proposal: proposal({ status: 'approved' }),
      reviewable: false,
      pending: false,
      onRevise: noop,
      onExecute: noop,
    }),
  ).querySelector('[data-maka-plan-proposal="p1"]');
  assert.ok(approved);
  assert.equal(approved.querySelectorAll('button').length, 0);
  assert.ok(approved.textContent?.includes('Approved'));
});

test('the execution strip reports progress, and only an interrupted one offers a way back', () => {
  const noop = () => {};
  const execution = {
    executionId: 'e1',
    planId: 'plan-1',
    proposalId: 'p1',
    sessionId: 'S1',
    status: 'active' as const,
    steps: [
      { id: 's1', title: 'Rename', description: '', status: 'completed' as const, updatedAt: 2 },
      {
        id: 's2',
        title: 'Update callers',
        description: '',
        status: 'in_progress' as const,
        updatedAt: 2,
      },
    ],
    startedAt: 1,
    updatedAt: 2,
  };
  const running = render(
    createElement(PlanExecutionStrip, {
      execution,
      title: 'Rename the login handler',
      pending: false,
      onResume: noop,
      onAbandon: noop,
    }),
  ).querySelector('[data-maka-contract="plan-execution-banner"]');
  assert.ok(running);
  assert.equal(running.getAttribute('data-status'), 'active');
  assert.ok(running.textContent?.includes('1/2 steps'));
  assert.ok(running.textContent?.includes('Rename the login handler'));
  const runningLabels = Array.from(running.querySelectorAll('button')).map((b) => b.textContent);
  assert.ok(!runningLabels.includes('Resume'));
  assert.ok(!runningLabels.includes('Abandon plan'));
  const interrupted = render(
    createElement(PlanExecutionStrip, {
      execution: { ...execution, status: 'interrupted' as const, interruptedAt: 3 },
      title: 'Rename the login handler',
      pending: false,
      onResume: noop,
      onAbandon: noop,
    }),
  ).querySelector('[data-maka-contract="plan-execution-banner"]');
  assert.ok(interrupted);
  assert.equal(interrupted.getAttribute('data-status'), 'interrupted');
  const labels = Array.from(interrupted.querySelectorAll('button')).map((b) => b.textContent);
  assert.ok(labels.includes('Resume'));
  assert.ok(labels.includes('Abandon plan'));
});
