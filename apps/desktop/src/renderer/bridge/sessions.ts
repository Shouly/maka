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

// The `sessions` namespace of the preload bridge, wrapped.
//
// This is the turn protocol (contract doc §1 "sessions namespace"): the
// catalog, the send/submit/stop admission path, the queue, the copy actions
// (regenerate / branch / revise), the interaction responses, the mode setters
// and the two subscriptions the active-session pipeline is built on.
//
// Session ids here are Desktop-projected keys (`shared/runtime-host-identity`),
// opaque to every caller — see `./session-keys.js`.

import type { SessionListFilter } from '@maka/core/runtime-inputs';
import type { CreateSessionRequestInput } from '@maka/core/runtime-inputs';
import type { ActiveInteractionRequestEvent, SessionEvent } from '@maka/core/events';
import type { SessionChangedEvent, TurnRecord } from '@maka/core/session';
import type { PermissionMode } from '@maka/core/permission';
import type { CollaborationMode } from '@maka/core/collaboration';
import type { OrchestrationMode } from '@maka/core/orchestration';
import type { ThinkingLevel } from '@maka/core/model-thinking';
import type { SandboxBoundaryResponse } from '@maka/core/sandbox-boundary';
import type { ClientCapabilityResponse } from '@maka/core/client-capability-grant';
import type { UserQuestionResponse } from '@maka/core/user-question';
import type { InteractionFormResponse } from '@maka/core/interaction';
import type { ExecutionBoundaryReadModel } from '@maka/core/sandbox-boundary';
import type {
  DesktopBranchFromTurnInput,
  DesktopReviseBeforeTurnInput,
  DesktopSessionStopResult,
  DesktopSessionSummary,
  DesktopSideConversationBranchResult,
  MakaBridge,
} from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type Sessions = MakaBridge['sessions'];

export type {
  DesktopSessionSummary,
  DesktopSessionStopResult,
  DesktopBranchFromTurnInput,
  DesktopReviseBeforeTurnInput,
};
export type SessionSendCommand = Parameters<Sessions['send']>[1];
export type SessionSendResult = Awaited<ReturnType<Sessions['send']>>;
export type SessionSubmitCommand = Parameters<Sessions['submitMessage']>[2];
export type SessionSubmitPlacement = Parameters<Sessions['submitMessage']>[1];
export type SessionSubmitResult = Awaited<ReturnType<Sessions['submitMessage']>>;
export type SessionStopInput = NonNullable<Parameters<Sessions['stop']>[1]>;
export type SessionRemovalResult = Awaited<ReturnType<Sessions['remove']>>;
export type SessionResumeResult = Awaited<ReturnType<Sessions['resumeLatest']>>;
export type SessionCompactResult = Awaited<ReturnType<Sessions['compact']>>;
export type SessionModelConfiguration = Parameters<Sessions['setModelConfiguration']>[1];
export type SessionRevisionFamilyOptions = { revisionFamily?: boolean };

const sessions = (): Sessions => requireNamespace('sessions');

// ── catalog ────────────────────────────────────────────────────────────────

export function listSessions(filter?: SessionListFilter): Promise<DesktopSessionSummary[]> {
  return sessions().list(filter);
}

export function listSessionsWithCoverage(): Promise<{
  sessions: DesktopSessionSummary[];
  completeHostIds: string[];
}> {
  return sessions().listWithCoverage();
}

export function createSession(input?: CreateSessionRequestInput): Promise<DesktopSessionSummary> {
  return sessions().create(input);
}

export function archiveSession(
  sessionId: string,
  options?: SessionRevisionFamilyOptions,
): Promise<void> {
  return sessions().archive(sessionId, options);
}

export function unarchiveSession(
  sessionId: string,
  options?: SessionRevisionFamilyOptions,
): Promise<void> {
  return sessions().unarchive(sessionId, options);
}

export function setSessionFlagged(
  sessionId: string,
  isFlagged: boolean,
  options?: SessionRevisionFamilyOptions,
): Promise<void> {
  return sessions().setFlagged(sessionId, isFlagged, options);
}

export function renameSession(
  sessionId: string,
  name: string,
  options?: SessionRevisionFamilyOptions,
): Promise<void> {
  return sessions().rename(sessionId, name, options);
}

export function removeSession(
  sessionId: string,
  options?: SessionRevisionFamilyOptions & { requireArchived?: boolean },
): Promise<SessionRemovalResult> {
  return sessions().remove(sessionId, options);
}

/** How many linked subtasks a delete would archive, per the Host's own plan. */
export function previewSessionRemoval(sessionId: string): Promise<number> {
  return sessions().previewRemoval(sessionId);
}

// ── admission ──────────────────────────────────────────────────────────────

export function sendMessage(
  sessionId: string,
  command: SessionSendCommand,
): Promise<SessionSendResult> {
  return sessions().send(sessionId, command);
}

export type SessionSubmitOptions = Parameters<Sessions['submitMessage']>[3];

export function submitMessage(
  sessionId: string,
  placement: SessionSubmitPlacement,
  command: SessionSubmitCommand,
  options?: SessionSubmitOptions,
): Promise<SessionSubmitResult> {
  return sessions().submitMessage(sessionId, placement, command, options);
}

export function stopSession(
  sessionId: string,
  input?: SessionStopInput,
): Promise<DesktopSessionStopResult> {
  return sessions().stop(sessionId, input);
}

// ── message queue ──────────────────────────────────────────────────────────

export function retractQueueEntry(sessionId: string, entryId: string): Promise<void> {
  return sessions().retractQueueEntry(sessionId, entryId);
}

/** Which of these local messages the Host has cancelled — the proof that retires a transient row. */
export function queryCancelledMessages(
  sessionId: string,
  messageIds: readonly string[],
): ReturnType<Sessions['queryCancelledMessages']> {
  return sessions().queryCancelledMessages(sessionId, messageIds);
}

export function promoteQueueEntry(sessionId: string, entryId: string): Promise<void> {
  return sessions().promoteQueueEntry(sessionId, entryId);
}

export function updateQueueEntry(
  sessionId: string,
  entryId: string,
  expectedQueueRevision: number,
  text: string,
): Promise<void> {
  return sessions().updateQueueEntry(sessionId, entryId, expectedQueueRevision, text);
}

export function reorderQueueEntries(sessionId: string, entryIds: readonly string[]): Promise<void> {
  return sessions().reorderQueueEntries(sessionId, entryIds);
}

// ── turn copies ────────────────────────────────────────────────────────────

export function regenerateTurn(sessionId: string, sourceTurnId: string): Promise<void> {
  return sessions().regenerateTurn(sessionId, { sourceTurnId });
}

export function branchFromTurn(
  sessionId: string,
  input: DesktopBranchFromTurnInput,
): Promise<DesktopSessionSummary> {
  return sessions().branchFromTurn(sessionId, { ...input, sideConversation: false });
}

export function branchSideConversation(
  sessionId: string,
  input: DesktopBranchFromTurnInput,
): Promise<DesktopSideConversationBranchResult> {
  return sessions().branchFromTurn(sessionId, { ...input, sideConversation: true });
}

export function reviseBeforeTurn(
  sessionId: string,
  input: DesktopReviseBeforeTurnInput,
): Promise<DesktopSessionSummary> {
  return sessions().reviseBeforeTurn(sessionId, input);
}

export function cleanupSessionCopy(sessionId: string): Promise<void> {
  return sessions().cleanupSessionCopy(sessionId);
}

export function abandonSessionCopy(sourceSessionId: string, copyId: string): Promise<void> {
  return sessions().abandonSessionCopy(sourceSessionId, copyId);
}

// ── context / lifecycle ────────────────────────────────────────────────────

export function compactSession(sessionId: string): Promise<SessionCompactResult> {
  return sessions().compact(sessionId);
}

export function resumeLatestTurn(sessionId: string): Promise<SessionResumeResult> {
  return sessions().resumeLatest(sessionId);
}

export function listTurns(sessionId: string): Promise<TurnRecord[]> {
  return sessions().listTurns(sessionId);
}

export function listTurnLandmarks(sessionId: string): ReturnType<Sessions['listTurnLandmarks']> {
  return sessions().listTurnLandmarks(sessionId);
}

// ── interactions ───────────────────────────────────────────────────────────

export function listActiveInteractions(
  sessionId: string,
): Promise<ActiveInteractionRequestEvent[]> {
  return sessions().listActiveInteractions(sessionId);
}

export function readExecutionBoundary(sessionId: string): Promise<ExecutionBoundaryReadModel> {
  return sessions().readExecutionBoundary(sessionId);
}

export function respondToSandboxBoundary(
  sessionId: string,
  response: SandboxBoundaryResponse,
): Promise<void> {
  return sessions().respondToSandboxBoundary(sessionId, response);
}

export function respondToClientCapability(
  sessionId: string,
  response: ClientCapabilityResponse,
): Promise<void> {
  return sessions().respondToClientCapability(sessionId, response);
}

export function respondToUserQuestion(
  sessionId: string,
  response: UserQuestionResponse,
): Promise<void> {
  return sessions().respondToUserQuestion(sessionId, response);
}

export function respondToUserForm(
  sessionId: string,
  response: InteractionFormResponse,
): Promise<void> {
  return sessions().respondToUserForm(sessionId, response);
}

// ── modes ──────────────────────────────────────────────────────────────────

export function setPermissionMode(
  sessionId: string,
  mode: PermissionMode,
): Promise<DesktopSessionSummary> {
  return sessions().setPermissionMode(sessionId, mode);
}

export function setCollaborationMode(
  sessionId: string,
  mode: CollaborationMode,
): Promise<DesktopSessionSummary> {
  return sessions().setCollaborationMode(sessionId, mode);
}

export function setOrchestrationMode(
  sessionId: string,
  mode: OrchestrationMode,
): Promise<DesktopSessionSummary> {
  return sessions().setOrchestrationMode(sessionId, mode);
}

export function setModelConfiguration(
  sessionId: string,
  input: SessionModelConfiguration,
): Promise<DesktopSessionSummary> {
  return sessions().setModelConfiguration(sessionId, input);
}

export function setThinkingLevel(
  sessionId: string,
  level: ThinkingLevel | null | undefined,
): Promise<DesktopSessionSummary> {
  return sessions().setThinkingLevel(sessionId, level);
}

// ── export ─────────────────────────────────────────────────────────────────

export function saveConversationToFile(input: {
  markdown: string;
  defaultName: string;
}): ReturnType<Sessions['saveConversationToFile']> {
  return sessions().saveConversationToFile(input);
}

// ── streams ────────────────────────────────────────────────────────────────

/**
 * The active-session event stream. `onSeedError` is what the resubscribe
 * backoff in `store/active-session-store.ts` rides on.
 */
export function subscribeSessionEvents(
  sessionId: string,
  handler: (event: SessionEvent) => void,
  onSeeded?: () => void,
  onObservationSeed?: (phase: 'pending' | 'ready') => void,
  onSeedError?: (error: unknown) => void,
): () => void {
  return toUnsubscribe(
    tryNamespace('sessions')?.subscribeEvents(
      sessionId,
      handler,
      onSeeded,
      onObservationSeed,
      onSeedError,
    ),
  );
}

export function subscribeSessionChanges(handler: (event: SessionChangedEvent) => void): () => void {
  return toUnsubscribe(tryNamespace('sessions')?.subscribeChanges(handler));
}

export function subscribeActiveInteractions(
  handler: (event: { sessionId: string; interactions: ActiveInteractionRequestEvent[] }) => void,
): () => void {
  return toUnsubscribe(tryNamespace('sessions')?.subscribeActiveInteractions(handler));
}
