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

import { z } from 'zod';
import { TOOL_NAMES } from '@maka/core/tool-names';
import type { MakaTool } from './tool-runtime.js';
import type {
  AgentGraphClientOperator,
  AgentGraphClientSnapshot,
  AgentGraphClientScheduledWork,
} from './stream-graph-read-model.js';
import type { AgentGraphScheduleReconciliationResult } from './stream-graph-schedule-reconcile.js';

export const AGENT_SWARM_STATUS_TOOL_NAME = TOOL_NAMES.swarmStatus;

export type AgentSwarmItemStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'cancelled'
  | 'stopped'
  | 'superseded';

export interface AgentSwarmStatusItem {
  workId: string;
  status: AgentSwarmItemStatus;
  operatorId?: string;
  childSessionId?: string;
  runId?: string;
  failurePhase?: 'schedule' | 'topology' | 'stop' | 'render' | 'dispatch';
  failureReason?: string;
}

export interface AgentSwarmStatusResult {
  kind: 'swarm_status';
  swarmId: string;
  status: 'running' | 'needs_attention' | 'settled';
  counts: Record<AgentSwarmItemStatus, number>;
  items: AgentSwarmStatusItem[];
}

const terminalStatuses = new Set<AgentSwarmItemStatus>([
  'completed',
  'failed',
  'aborted',
  'cancelled',
  'stopped',
  'superseded',
]);

const attentionStatuses = new Set<AgentSwarmItemStatus>([
  'blocked',
  'failed',
  'aborted',
  'cancelled',
]);

export function projectAgentSwarmStatus(
  snapshot: AgentGraphClientSnapshot,
): AgentSwarmStatusResult {
  const operatorByWorkId = new Map<string, AgentGraphClientOperator>();
  for (const operator of snapshot.operators) {
    for (const workId of operator.scheduledWorkIds) operatorByWorkId.set(workId, operator);
  }
  const failureByWorkId = new Map(
    snapshot.reconciliationFailures.map((failure) => [failure.workId, failure]),
  );
  const items = snapshot.work.map((work) =>
    swarmItem(work, operatorByWorkId.get(work.workId), failureByWorkId.get(work.workId)),
  );
  const counts = emptyCounts();
  for (const item of items) counts[item.status] += 1;
  const status = items.some((item) => attentionStatuses.has(item.status))
    ? 'needs_attention'
    : items.length > 0 && items.every((item) => terminalStatuses.has(item.status))
      ? 'settled'
      : 'running';
  return {
    kind: 'swarm_status',
    swarmId: snapshot.graphId,
    status,
    counts,
    items,
  };
}

export function isAgentSwarmSupervisorCheckpoint(snapshot: AgentGraphClientSnapshot): boolean {
  return projectAgentSwarmStatus(snapshot).status !== 'running';
}

export function shouldWakeAgentSwarmSupervisor(
  _rootSessionId: string,
  _result: AgentGraphScheduleReconciliationResult | undefined,
  snapshot: AgentGraphClientSnapshot,
): boolean | undefined {
  if (snapshot.orchestrationMode !== 'swarm') return undefined;
  return snapshot.reconciliationFailures.length > 0 || isAgentSwarmSupervisorCheckpoint(snapshot);
}

export function renderAgentSwarmSupervisorWake(
  _rootSessionId: string,
  snapshot: AgentGraphClientSnapshot,
  result?: AgentGraphScheduleReconciliationResult,
):
  | {
      text: string;
      displayText: string;
      orchestrationMode: 'graph';
    }
  | undefined {
  if (snapshot.orchestrationMode !== 'swarm') return undefined;
  const status = projectAgentSwarmStatus(snapshot);
  const attentionWorkIds = status.items
    .filter((item) => attentionStatuses.has(item.status))
    .map((item) => item.workId);
  return {
    text: [
      '<agent-swarm-checkpoint>',
      `Asynchronous swarm ${status.swarmId} reached ${status.status}.`,
      `Reconciliation status: ${result?.status ?? 'checkpoint'}.`,
      ...(attentionWorkIds.length > 0
        ? [`Attention work ids: ${attentionWorkIds.join(', ')}.`]
        : []),
      'Call SwarmStatus for compact item statuses only. Do not inspect child logs, tool activity, reasoning, or partial output.',
      'For completed items, read only committed final results with AgentOutput view=result.',
      'Replace failed work with UpdateAgentGraph using replaces=<failed work id> and replacement_mode=replace. If work remains active after that decision, call YieldAgentGraph without polling.',
      'When all useful work is settled, finish the graph and report the synthesized result.',
      '</agent-swarm-checkpoint>',
    ].join('\n'),
    displayText: `Agent swarm ${status.status.replace('_', ' ')}.`,
    // Supervisor wake admission is always Graph orchestration; Swarm remains
    // the durable graph identity and presentation policy, not a second runtime.
    orchestrationMode: 'graph',
  };
}

export function buildAgentSwarmStatusTool(input: {
  readSnapshot(): Promise<AgentGraphClientSnapshot>;
}): MakaTool<Record<string, never>, AgentSwarmStatusResult> {
  return {
    name: AGENT_SWARM_STATUS_TOOL_NAME,
    displayName: 'Agent swarm status',
    activityKind: 'delegate',
    description: [
      'Read where the asynchronous swarm stands: one status per scheduled work item, the counts by status, and whether the swarm as a whole is running, needs_attention, or settled. Takes no arguments and changes nothing.',
      '',
      '- Status only. Child logs, tool activity, reasoning and partial output are deliberately absent. A completed item is read with AgentOutput view=result, using the child session and run ids returned here.',
      '- An item that failed carries the phase it failed in and the reason. Reschedule it with UpdateAgentGraph using replaces set to that work id and replacement_mode=replace.',
      '- needs_attention means at least one item is blocked, failed, aborted or cancelled; settled means every item reached a terminal status; running means work is still in flight.',
      '- Do not call it in a loop to watch for progress. The host starts a new supervisor turn at the next durable checkpoint, so when work is still running and nothing needs deciding, end the turn with YieldAgentGraph.',
    ].join('\n'),
    parameters: z.object({}).strip(),
    categoryHint: 'read',
    recoveryMode: 'replay_safe',
    impl: async () => projectAgentSwarmStatus(await input.readSnapshot()),
  };
}

function swarmItem(
  work: AgentGraphClientScheduledWork,
  operator: AgentGraphClientOperator | undefined,
  failure: AgentGraphClientSnapshot['reconciliationFailures'][number] | undefined,
): AgentSwarmStatusItem {
  if (work.status !== 'requested') {
    return { workId: work.workId, status: work.status };
  }
  if (failure) {
    return {
      workId: work.workId,
      status: 'failed',
      failurePhase: failure.phase,
      failureReason: failure.reason,
    };
  }
  const status = operatorStatus(operator);
  return {
    workId: work.workId,
    status,
    ...(operator
      ? {
          operatorId: operator.operatorId,
          childSessionId: operator.childSessionId,
          ...(operator.currentActivation
            ? { runId: operator.currentActivation.run.agentRunId }
            : {}),
        }
      : {}),
  };
}

function operatorStatus(operator: AgentGraphClientOperator | undefined): AgentSwarmItemStatus {
  if (!operator) return 'queued';
  const activationStatus = operator.currentActivation?.status;
  if (activationStatus) return activationStatus;
  if (operator.status === 'running') return 'running';
  if (operator.status === 'blocked') return 'blocked';
  if (
    operator.status === 'completed' ||
    operator.status === 'failed' ||
    operator.status === 'aborted' ||
    operator.status === 'cancelled'
  ) {
    return operator.status;
  }
  return 'queued';
}

function emptyCounts(): Record<AgentSwarmItemStatus, number> {
  return {
    queued: 0,
    running: 0,
    blocked: 0,
    completed: 0,
    failed: 0,
    aborted: 0,
    cancelled: 0,
    stopped: 0,
    superseded: 0,
  };
}
