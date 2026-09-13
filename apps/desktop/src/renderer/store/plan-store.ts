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

// The active Session's Plan, and the four controls over it.
//
// One Session at a time, read whole from the Host and refreshed on its own
// change channel (`plan-mode:changed`, which the main process raises for
// every plan-domain change) plus the Session catalog's turn transitions — a
// proposal is submitted by a turn and an execution is interrupted by one, so
// a turn ending is as good a reason to re-read as the plan channel itself.
//
// The controls answer with a structured outcome rather than a rejection
// (`PlanControlIpcResult`): the Host refuses an approval it cannot honour —
// the proposal went stale, a turn is running, someone else moved first — and
// that refusal is shown beside the buttons, not toasted. Only a transport
// failure is an error.
//
// Approve and resume START A TURN, so their turn id is minted here and kept
// until the Host accepts it: a retry after a refusal re-sends the same id,
// which the Host reconciles as the same request instead of a second turn.

import { createStore } from 'zustand/vanilla';
import type { PlanExecution, PlanProposal, PlanSessionState } from '@maka/core/plan';
import type { SessionChangedEvent } from '@maka/core/session';
import * as api from '../bridge/plan.js';
import { createResourceStore, errorMessage } from './resource-store.js';

export type PlanBridge = Pick<
  typeof api,
  | 'getPlanState'
  | 'subscribePlanChanges'
  | 'requestPlanRevision'
  | 'approvePlan'
  | 'resumePlan'
  | 'abandonPlanExecution'
>;

/** A refusal the Host phrased, or a transport failure phrased like one. */
export interface PlanControlFailure {
  readonly code: string;
  readonly message: string;
}

export interface PlanControlState {
  /** One control at a time: a second press before the Host answered asks twice. */
  readonly pending: boolean;
  readonly failure: PlanControlFailure | undefined;
}

/** The proposal the card offers to approve: the latest, and still waiting. */
export function reviewableProposal(state: PlanSessionState | undefined): PlanProposal | undefined {
  if (!state?.latestProposalId) return undefined;
  const proposal = state.proposals.find((item) => item.proposalId === state.latestProposalId);
  return proposal?.status === 'pending_approval' ? proposal : undefined;
}

/** The execution the strip reports: the active one, else the last interrupted. */
export function reportedExecution(state: PlanSessionState | undefined): PlanExecution | undefined {
  if (!state) return undefined;
  const active = state.activeExecutionId
    ? state.executions.find((item) => item.executionId === state.activeExecutionId)
    : undefined;
  if (active) return active;
  for (let index = state.executions.length - 1; index >= 0; index -= 1) {
    const execution = state.executions[index];
    if (execution?.status === 'interrupted') return execution;
  }
  return undefined;
}

export function createPlanStore(deps: {
  /** Every Session catalog change, before the refresh it triggers. */
  subscribeChanges(listener: (event: SessionChangedEvent) => void): () => void;
  bridge?: PlanBridge;
  newTurnId?: () => string;
}) {
  const bridge = deps.bridge ?? api;
  const newTurnId = deps.newTurnId ?? (() => crypto.randomUUID());
  const store = createResourceStore<PlanSessionState>();
  const control = createStore<PlanControlState>(() => ({ pending: false, failure: undefined }));
  let approvalRetry:
    | {
        sessionId: string;
        proposalId: string;
        expectedRevision: number;
        expectedStoreVersion: number;
        turnId: string;
      }
    | undefined;
  let resumeRetry: { sessionId: string; executionId: string; turnId: string } | undefined;

  const run = async <T>(
    action: () => Promise<api.PlanControlIpcResult<T>>,
  ): Promise<T | undefined> => {
    if (control.getState().pending) return undefined;
    control.setState({ pending: true, failure: undefined });
    try {
      const result = await store.mutate(action);
      if (!result.ok) {
        control.setState({ pending: false, failure: result.error });
        return undefined;
      }
      control.setState({ pending: false, failure: undefined });
      return result.value;
    } catch (error) {
      control.setState({
        pending: false,
        failure: { code: 'internal_failure', message: errorMessage(error) },
      });
      return undefined;
    }
  };

  return {
    ...store,
    control,
    observe(sessionId: string): () => void {
      control.setState({ pending: false, failure: undefined });
      if (approvalRetry?.sessionId !== sessionId) approvalRetry = undefined;
      if (resumeRetry?.sessionId !== sessionId) resumeRetry = undefined;
      return store.connect(
        () => bridge.getPlanState(sessionId),
        (refresh) => {
          const stopPlan = bridge.subscribePlanChanges(sessionId, refresh);
          const stopCatalog = deps.subscribeChanges((event) => {
            if (event.sessionId !== undefined && event.sessionId !== sessionId) return;
            if (
              event.reason === 'turn-status-change' ||
              event.reason === 'status-change' ||
              event.reason === 'mode-change'
            )
              refresh();
          });
          return () => {
            stopPlan();
            stopCatalog();
          };
        },
      );
    },
    /** Clears the inline refusal, e.g. when the card it was shown on is gone. */
    dismissFailure(): void {
      if (control.getState().failure) control.setState({ failure: undefined });
    },
    requestRevision(sessionId: string, proposalId: string) {
      return run(() => bridge.requestPlanRevision(sessionId, proposalId));
    },
    approve(sessionId: string, proposal: PlanProposal) {
      const state = store.getState().data;
      if (!state) return Promise.resolve(undefined);
      const reuse =
        approvalRetry &&
        approvalRetry.sessionId === sessionId &&
        approvalRetry.proposalId === proposal.proposalId &&
        approvalRetry.expectedRevision === proposal.revision;
      const input =
        reuse && approvalRetry
          ? approvalRetry
          : {
              sessionId,
              proposalId: proposal.proposalId,
              expectedRevision: proposal.revision,
              expectedStoreVersion: state.storeVersion,
              turnId: newTurnId(),
            };
      approvalRetry = input;
      return run(async () => {
        const result = await bridge.approvePlan(sessionId, {
          proposalId: input.proposalId,
          expectedRevision: input.expectedRevision,
          expectedStoreVersion: input.expectedStoreVersion,
          turnId: input.turnId,
        });
        if (result.ok) approvalRetry = undefined;
        return result;
      });
    },
    resume(sessionId: string, executionId: string) {
      const reuse =
        resumeRetry &&
        resumeRetry.sessionId === sessionId &&
        resumeRetry.executionId === executionId;
      const input =
        reuse && resumeRetry ? resumeRetry : { sessionId, executionId, turnId: newTurnId() };
      resumeRetry = input;
      return run(async () => {
        const result = await bridge.resumePlan(sessionId, executionId, input.turnId);
        if (result.ok) resumeRetry = undefined;
        return result;
      });
    },
    abandonExecution(sessionId: string, executionId: string) {
      return run(() => bridge.abandonPlanExecution(sessionId, executionId));
    },
  };
}
