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

import {
  TOOL_BOUNDARY_PROTOCOL_V1,
  isTerminalRuntimeEvent,
  type RuntimeEvent,
  type ToolBoundaryProtocol,
} from '@maka/core/runtime-event';
import type { ToolResultContent } from '@maka/core/events';
import { TOOL_NAMES } from '@maka/core/tool-names';
import {
  scanToolLedger,
  type ToolLedgerIssueCode,
  type ToolLedgerScanOperation,
} from '@maka/core/tool-ledger-scanner';
import { interpretScannedToolRecovery } from '@maka/core/tool-recovery-bundle';
import type { ToolOutcomeCommit } from './runtime-commit-sink.js';
import type { ToolMode } from '@maka/core/tool-mode';
import { compatibilityToolResultProjection } from './durable-tool-result-projection.js';

export type ToolRecoveryDecisionStatus =
  | 'completed'
  | 'parked'
  | 'definitely_not_dispatched'
  | 'indeterminate'
  | 'corruption';

export type ToolRecoveryDecisionReason =
  | 'matching_response'
  | 'recovery_bundle_completed'
  | 'dispatch_without_response'
  | 'new_protocol_before_dispatch'
  | 'legacy_dispatch_unknown'
  | 'orphan_dispatch'
  | 'orphan_response'
  | 'duplicate_call'
  | 'duplicate_operation'
  | 'duplicate_dispatch'
  | 'duplicate_response'
  | 'canonical_args_hash_conflict'
  | 'identity_conflict'
  | 'event_order_conflict'
  | 'protocol_marker_invalid'
  | 'recovery_fact_corruption'
  | 'reconcile_matches_prior_state'
  | 'reconcile_diverged'
  | 'reconcile_unreadable';

export type ToolSettlementOrigin = 'normal_t2' | 'pre_t1_synthetic' | 'recovery_bundle';

export interface ToolRecoveryDecision {
  toolCallId: string;
  toolName?: string;
  operationId?: string;
  status: ToolRecoveryDecisionStatus;
  reason: ToolRecoveryDecisionReason;
  settlementOrigin?: ToolSettlementOrigin;
  callRuntimeEventId?: string;
  dispatchRuntimeEventId?: string;
  responseRuntimeEventId?: string;
  responseIsError?: boolean;
}

export type RuntimeRecoveryIssueCode = 'protocol_marker_invalid' | ToolLedgerIssueCode;

export interface RuntimeRecoveryResolution {
  toolBoundaryProtocol?: ToolBoundaryProtocol;
  decisions: ToolRecoveryDecision[];
  issues: Array<{
    code: RuntimeRecoveryIssueCode;
    eventId: string;
  }>;
  hasCorruption: boolean;
  requiresReconciliation: boolean;
}

export function resolveRuntimeRecovery(events: readonly RuntimeEvent[]): RuntimeRecoveryResolution {
  const firstProtocol = events[0]?.actions?.runtimeProtocol;
  const toolBoundaryProtocol =
    firstProtocol?.toolBoundary === TOOL_BOUNDARY_PROTOCOL_V1
      ? TOOL_BOUNDARY_PROTOCOL_V1
      : undefined;
  const issues: RuntimeRecoveryResolution['issues'] = [];
  if (firstProtocol !== undefined && toolBoundaryProtocol === undefined && events[0]) {
    issues.push({ code: 'protocol_marker_invalid', eventId: events[0].id });
  }
  issues.push(
    ...events
      .slice(1)
      .filter((event) => event.actions?.runtimeProtocol !== undefined)
      .map((event) => ({ code: 'protocol_marker_invalid' as const, eventId: event.id })),
  );

  const scan = scanToolLedger(events);
  issues.push(...scan.issues.map(({ code, eventId }) => ({ code, eventId })));
  const eventOrder = new Map(events.map((event, index) => [event.id, index] as const));
  const decisions = scan.operations.map((operation) =>
    decisionFromOperation(operation, toolBoundaryProtocol, eventOrder),
  );

  const hasCorruption =
    issues.length > 0 || decisions.some((decision) => decision.status === 'corruption');
  return {
    ...(toolBoundaryProtocol ? { toolBoundaryProtocol } : {}),
    decisions,
    issues,
    hasCorruption,
    requiresReconciliation:
      !hasCorruption && decisions.some((decision) => decision.status === 'indeterminate'),
  };
}

/**
 * Settle every tool the interrupted invocation dispatched and never answered,
 * before recovery seals it.
 *
 * An operation left unsettled stays `prepared` for good once its invocation is
 * terminal: nothing else answers an ordinary tool, the model never learns the
 * call may have run (replay drops an unanswered call), and a Session holding
 * one can never be exported ("unsettled tool operation"). The result says the
 * outcome is unknown, so the model inspects before it runs the call again.
 * Code Mode's `exec` keeps its own interrupted record.
 */
export function buildInterruptedToolOutcomeCommits(
  events: readonly RuntimeEvent[],
  now: number,
  toolMode: ToolMode,
): ToolOutcomeCommit[] {
  const eventsById = new Map(events.map((event) => [event.id, event] as const));
  // A sealed invocation takes no new events; leave it as it was.
  const sealedInvocations = new Set(
    events.filter(isTerminalRuntimeEvent).map((event) => event.invocationId),
  );
  const recovery = resolveRuntimeRecovery(events);
  // Never write into a ledger that does not scan clean.
  if (recovery.hasCorruption) return [];
  return recovery.decisions.flatMap((decision) => {
    if (
      decision.status !== 'indeterminate' ||
      decision.reason !== 'dispatch_without_response' ||
      !decision.operationId ||
      !decision.callRuntimeEventId
    ) {
      return [];
    }
    const callEvent = eventsById.get(decision.callRuntimeEventId);
    const call = callEvent?.content;
    if (!callEvent || call?.kind !== 'function_call') return [];
    if (sealedInvocations.has(callEvent.invocationId)) return [];
    const codeModeExec =
      toolMode === 'code_mode' &&
      call.name === 'exec' &&
      callEvent.origin !== 'code_mode' &&
      callEvent.modelVisibility !== 'hidden';
    const result: ToolResultContent = codeModeExec
      ? {
          kind: 'json',
          value: {
            kind: 'code_mode',
            status: 'interrupted',
            message: 'Code Mode execution was interrupted by runtime recovery.',
          },
        }
      : call.name === TOOL_NAMES.askUserQuestion
        ? {
            kind: 'text',
            text: 'This question was interrupted before an answer was submitted.',
          }
        : {
            kind: 'text',
            text: `${call.name} was interrupted before its result was recorded. It may or may not have run, in part or in full: check the current state before running it again.`,
            uncertainOutcome: { code: 'outcome_unknown', retrySafe: false },
          };
    const responseContent = {
      kind: 'function_response' as const,
      id: call.id,
      name: call.name,
      result,
      isError: true as const,
    };
    const modelProjection = compatibilityToolResultProjection(responseContent, callEvent.sessionId);
    const runtimeEvent: RuntimeEvent = {
      id: `${decision.operationId}_response`,
      invocationId: callEvent.invocationId,
      runId: callEvent.runId,
      sessionId: callEvent.sessionId,
      turnId: callEvent.turnId,
      ts: now,
      partial: false,
      role: 'tool',
      author: 'tool',
      // A nested Code Mode call keeps its own origin and visibility.
      origin: callEvent.origin ?? 'provider',
      modelVisibility: callEvent.modelVisibility ?? 'visible',
      content: { ...responseContent, ...(modelProjection ? { modelProjection } : {}) },
      refs: {
        operationId: decision.operationId,
        toolCallId: call.id,
        ...(callEvent.refs?.parentToolCallId
          ? { parentToolCallId: callEvent.refs.parentToolCallId }
          : {}),
        ...(callEvent.refs?.parentOperationId
          ? { parentOperationId: callEvent.refs.parentOperationId }
          : {}),
      },
    };
    return [
      {
        operationId: decision.operationId,
        journalEventId: `${decision.operationId}_outcome`,
        runtimeEvent,
        committedAt: now,
      },
    ];
  });
}

function decisionFromOperation(
  operation: ToolLedgerScanOperation,
  toolBoundaryProtocol: ToolBoundaryProtocol | undefined,
  eventOrder: ReadonlyMap<string, number>,
): ToolRecoveryDecision {
  const decision: ToolRecoveryDecision = {
    toolCallId: operation.toolCallId,
    ...(operation.toolName ? { toolName: operation.toolName } : {}),
    ...(operation.operationId ? { operationId: operation.operationId } : {}),
    status: toolBoundaryProtocol ? 'definitely_not_dispatched' : 'indeterminate',
    reason: toolBoundaryProtocol ? 'new_protocol_before_dispatch' : 'legacy_dispatch_unknown',
    ...(operation.callEvent ? { callRuntimeEventId: operation.callEvent.id } : {}),
    ...(operation.dispatchEvent ? { dispatchRuntimeEventId: operation.dispatchEvent.id } : {}),
    ...(operation.responseEvent
      ? {
          responseRuntimeEventId: operation.responseEvent.id,
          responseIsError:
            operation.responseEvent.content?.kind === 'function_response'
              ? operation.responseEvent.content.isError === true
              : false,
        }
      : {}),
  };

  if (!operation.callEvent && operation.dispatchEvent) {
    decision.status = 'corruption';
    decision.reason = 'orphan_dispatch';
    return decision;
  }
  if (!operation.callEvent && operation.responseEvent) {
    decision.status = 'corruption';
    decision.reason = 'orphan_response';
    return decision;
  }
  const corruption = operationCorruptionReason(operation);
  if (corruption) {
    decision.status = 'corruption';
    decision.reason = corruption;
    return decision;
  }

  if (operation.responseEvent) {
    decision.status = 'completed';
    decision.reason = 'matching_response';
    decision.settlementOrigin = operation.dispatchEvent ? 'normal_t2' : 'pre_t1_synthetic';
  } else if (operation.dispatchEvent) {
    decision.status = 'indeterminate';
    decision.reason = 'dispatch_without_response';
  }

  if (operation.reconcileEvents.length === 0 && operation.decisionEvents.length === 0) {
    return decision;
  }
  const recovery = interpretScannedToolRecovery(operation, eventOrder);
  if (recovery.kind !== 'valid') {
    decision.status = 'corruption';
    decision.reason = 'recovery_fact_corruption';
    delete decision.settlementOrigin;
    return decision;
  }

  decision.settlementOrigin = 'recovery_bundle';
  if (recovery.decision.disposition === 'completed') {
    decision.status = 'completed';
    decision.reason = 'recovery_bundle_completed';
  } else {
    decision.status = 'parked';
    decision.reason = recovery.decision.reasonCode;
  }
  return decision;
}

function operationCorruptionReason(
  operation: ToolLedgerScanOperation,
): ToolRecoveryDecisionReason | undefined {
  const priority: Array<[ToolLedgerIssueCode, ToolRecoveryDecisionReason]> = [
    ['duplicate_call', 'duplicate_call'],
    ['duplicate_operation', 'duplicate_operation'],
    ['duplicate_dispatch', 'duplicate_dispatch'],
    ['duplicate_response', 'duplicate_response'],
    ['orphan_response', 'orphan_response'],
    ['canonical_args_hash_conflict', 'canonical_args_hash_conflict'],
    ['identity_conflict', 'identity_conflict'],
    ['event_order_conflict', 'event_order_conflict'],
  ];
  for (const [code, reason] of priority) {
    if (operation.issues.some((issue) => issue.code === code)) return reason;
  }
  return undefined;
}
