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

// The Plan half of the `sessions` namespace, wrapped.
//
// Plan is a collaboration excursion: the model proposes, the user approves,
// revises or abandons, and an approved proposal becomes an execution the
// Host walks step by step. The seven methods below are the whole of what the
// renderer can say about it; the state itself is the Host's and is only ever
// read back whole (`getPlanState`), never patched here.

import type { PlanSessionState } from '@maka/core/plan';
import type { PlanControlIpcResult } from '../../shared/plan-mode-ipc.js';
import type { MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type Sessions = MakaBridge['sessions'];

export type { PlanControlIpcResult, PlanSessionState };
export type PlanApprovalInput = Parameters<Sessions['approvePlan']>[1];
/** What an approval or a resume hands back: the Turn it started. */
export type PlanTurnStart = { turnId: string; executionId: string };

const sessions = () => requireNamespace('sessions');

export function getPlanState(sessionId: string): Promise<PlanSessionState> {
  return sessions().getPlanState(sessionId);
}

export function subscribePlanChanges(sessionId: string, handler: () => void): () => void {
  return toUnsubscribe(tryNamespace('sessions')?.subscribePlanChanges(sessionId, handler));
}

export function requestPlanRevision(
  sessionId: string,
  proposalId: string,
): Promise<PlanControlIpcResult<PlanSessionState>> {
  return sessions().requestPlanRevision(sessionId, proposalId);
}

export function abandonPlanProposal(
  sessionId: string,
  proposalId: string,
): Promise<PlanSessionState> {
  return sessions().abandonPlanProposal(sessionId, proposalId);
}

export function approvePlan(
  sessionId: string,
  input: PlanApprovalInput,
): Promise<PlanControlIpcResult<PlanTurnStart>> {
  return sessions().approvePlan(sessionId, input);
}

export function resumePlan(
  sessionId: string,
  executionId: string,
  turnId: string,
): Promise<PlanControlIpcResult<PlanTurnStart>> {
  return sessions().resumePlan(sessionId, executionId, turnId);
}

export function abandonPlanExecution(
  sessionId: string,
  executionId: string,
): Promise<PlanControlIpcResult<PlanSessionState>> {
  return sessions().abandonPlanExecution(sessionId, executionId);
}
