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

import type { AgentRunEvent, AgentRunStore, EmittedAgentRunEvent } from '@maka/core/agent-run';
import {
  isPartialRuntimeEvent,
  type RuntimeEvent,
  type RuntimeEventInvocationOpenedContent,
} from '@maka/core/runtime-event';
import {
  buildInvocationOpenedEvent,
  isSessionInlineInvocation,
} from '@maka/core/runtime-invocation';
import type { RuntimeInvocationRecord } from '@maka/core/runtime-invocation';
import type { RuntimeEventStore } from '@maka/core/runtime-event-store';
import { type StorageRef, type ToolResultContent } from '@maka/core/events';
import type { DurableToolResultProjection } from '@maka/core/durable-tool-result-projection';
import { parseAttachmentResourceRef } from '@maka/core/attachments';
import { markPersisted } from '@maka/core/persisted-value';
import type { StoredMessage } from '@maka/core/session';
import { decodePersistedToolResultContent } from '@maka/core/tool-result-record-schema';
import { TOOL_NAMES } from '@maka/core/tool-names';
import { isEmittedAgentRunEventType } from '@maka/core/agent-run';
import {
  decodeModelCallAttempt,
  MODEL_CALL_ATTEMPT_EVENT_TYPE,
} from '@maka/core/model-call-attempt';
import { TOOL_RECOVERY_DECISION_FACT_KIND } from '@maka/core/tool-recovery-fact';
import {
  buildHistoryCompactCheckpoint,
  matchHistoryCompactCheckpointPrefix,
  validateHistoryCompactCheckpointShape,
  type TextHistoryCompactCheckpoint,
} from './history-compact-checkpoint.js';
import { findCheckpointSummaryDefect } from './history-compact-summary-validation.js';
import { isHistoryCompactContentEvent } from './history-compaction.js';
import {
  classifyTerminalRuntimeLedger,
  commitTerminalRunWithRuntimeFact,
} from './terminal-run-commit.js';
import { buildToolOperationId } from './runtime-commit-sink.js';
import { isContinuationStartRuntimeEvent } from './runtime-event-read-model.js';
import { runtimeHandoffPause } from '@maka/core/runtime-handoff';
import {
  rewriteDurableToolResultProjectionSavedOutputPaths,
  rewriteOpaqueSavedOutputPaths,
  rewriteRuntimeEventSavedOutputPaths,
  rewriteToolResultContentSavedOutputPaths,
  savedOutputPathMapRewrite,
  savedOutputPathRecorder,
  type SavedOutputPathRewrite,
} from '@maka/core/saved-output-paths';
import { dirname } from 'node:path';
import {
  encodeDurableToolResultOutput,
  rewriteDurableToolResultProjectionArtifactRefs,
} from './durable-tool-result-projection.js';
import { sendUserFileModelText } from './send-user-file-tool.js';
import { taskOutputSessionFolder } from './shell-run-output-file.js';
import {
  collectConversationCopyChildNotifications,
  rewriteConversationCopyNotificationArtifacts,
} from './conversation-copy-notifications.js';
export {
  collectConversationCopyChildNotifications,
  type ConversationCopyChildNotification,
} from './conversation-copy-notifications.js';
import {
  linkSavedOutputFile,
  savedOutputFileIn,
  toolResultSessionFolder,
} from './tool-result-file.js';

export interface ConversationCopySlice {
  readonly messages: readonly StoredMessage[];
  readonly turnIds: readonly string[];
  readonly beforeTs?: number;
}

interface ConversationCopyIdentityMap {
  readonly sourceSessionId: string;
  readonly targetSessionId: string;
}

export interface ConversationCopyExternalChildReferences {
  readonly runIds: ReadonlySet<string>;
  readonly artifactIds: ReadonlySet<string>;
}

export interface ConversationCopyLinkedChildReference {
  readonly kind: 'subagent' | 'agent_swarm';
  readonly childSessionId: string;
  readonly runId?: string;
  readonly resumedFromRunId?: string;
  readonly turnId?: string;
  readonly artifactIds: readonly string[];
  readonly status: 'completed' | 'failed' | 'cancelled' | 'running' | 'waiting_for_user';
  readonly failureClass?: string;
}

export type ConversationCopyArtifactReferenceMap =
  | (ConversationCopyIdentityMap & {
      readonly mode: 'exact';
      readonly artifactIds: ReadonlyMap<string, string>;
      readonly relativePaths: ReadonlyMap<string, string>;
      readonly contextRefs?: ReadonlyMap<string, string>;
      /**
       * Saved tool output and task output files the copy put in the target's
       * own folders, by the source's absolute path. A path not here, such as
       * one whose file was already gone, is left as the source had it.
       */
      readonly savedOutputPaths?: ReadonlyMap<string, string>;
      readonly linkedChildren:
        | { readonly mode: 'reject' }
        | { readonly mode: 'snapshot' }
        | {
            readonly mode: 'preserve_validated';
            readonly references: ReadonlyMap<string, ConversationCopyExternalChildReferences>;
          };
    })
  | (ConversationCopyIdentityMap & {
      readonly mode: 'preserve_external';
    });

export type ConversationCopyMessageReferenceMap = ConversationCopyArtifactReferenceMap & {
  readonly runIds: ReadonlyMap<string, string>;
  readonly runtimeEventIds: ReadonlyMap<string, string>;
  readonly providerTraceIds: ReadonlyMap<string, string>;
};

export type ConversationCopyReferenceMap = ConversationCopyMessageReferenceMap & {
  readonly invocationIds: ReadonlyMap<string, string>;
  readonly operationIds: ReadonlyMap<string, string>;
  readonly agentRunEventIds: ReadonlyMap<string, string>;
};

export interface CloneConversationRuntimeLedgerInput {
  readonly plan: ConversationRuntimeLedgerCopyPlan;
  readonly copiedMessages: readonly StoredMessage[];
  readonly referenceMap: ConversationCopyArtifactReferenceMap;
  readonly runStore: AgentRunStore;
  readonly runtimeEventStore: RuntimeEventStore & {
    importConversationCopyRuntimeEvents(
      sessionId: string,
      batches: readonly {
        readonly runId: string;
        readonly events: readonly RuntimeEvent[];
      }[],
    ): Promise<void>;
  };
  readonly newId: () => string;
}

export interface ConversationRuntimeLedgerCopyPlan {
  readonly sourceSessionId: string;
  readonly copyTurnIds: readonly string[];
  readonly inlineRuntimeEvents: readonly RuntimeEvent[];
  readonly runs: readonly {
    readonly run: RuntimeInvocationRecord;
    readonly runtimeEvents: readonly RuntimeEvent[];
    readonly operationalEvents: readonly AgentRunEvent[];
  }[];
}

interface ConversationCopyStorageReferenceInput {
  readonly sourceSessionId: string;
  readonly messages: readonly StoredMessage[];
  readonly runtimeEvents: readonly RuntimeEvent[];
}

/** Walks every typed StorageRef site reached by conversation-copy rewriting. */
function collectConversationCopyStorageRefs(
  input: ConversationCopyStorageReferenceInput,
): readonly StorageRef[] {
  const refs: StorageRef[] = [];
  const addContent = (content: ToolResultContent): void => {
    if (content.kind === 'image') refs.push(content.ref);
    // Delivery cards carry a bare Artifact id, implicitly owned by this Session.
    if (content.kind === 'user_file_delivery') {
      for (const file of content.files) {
        refs.push({
          kind: 'session_file',
          sessionId: input.sourceSessionId,
          relativePath: file.artifactId,
        });
      }
    }
  };
  const addSerialized = (value: unknown): void => {
    try {
      addContent(decodePersistedToolResultContent(markPersisted<ToolResultContent>(value)));
    } catch {
      // Opaque tool results carry no typed StorageRef.
    }
  };
  for (const message of input.messages) {
    if (message.type === 'user' && message.attachments) {
      for (const attachment of message.attachments) refs.push(attachment.ref);
    } else if (message.type === 'tool_result') {
      addContent(message.content);
    }
  }
  for (const event of input.runtimeEvents) {
    if (event.content?.kind === 'text' && event.content.attachments) {
      for (const attachment of event.content.attachments) refs.push(attachment.ref);
    } else if (event.content?.kind === 'function_response') {
      addSerialized(event.content.result);
    }
  }
  return refs;
}

/** Finds durable Session context references that the exact copy will rewrite. */
export function collectConversationCopySessionContextRefIds(input: {
  readonly sourceSessionId: string;
  readonly messages: readonly StoredMessage[];
  readonly runtimeEvents: readonly RuntimeEvent[];
}): readonly string[] {
  const refIds = new Set<string>();
  for (const ref of collectConversationCopyStorageRefs(input)) {
    if (ref.kind === 'session_context' && ref.sessionId === input.sourceSessionId) {
      refIds.add(ref.refId);
    }
  }
  return [...refIds].sort();
}

/**
 * The saved tool outputs and task outputs the copied slice names, in the
 * source Session's own folders (`folders`): where a tool result names its
 * saved file, and the text of a result, message or retained checkpoint that
 * names one. A path into any other folder is not the source's to copy.
 */
export function collectConversationCopySavedOutputPaths(input: {
  readonly folders: readonly string[];
  readonly messages: readonly StoredMessage[];
  readonly plan: ConversationRuntimeLedgerCopyPlan;
}): readonly string[] {
  const found = new Set<string>();
  const record = savedOutputPathRecorder(input.folders, found);
  for (const message of input.messages) {
    if (message.type === 'tool_result') {
      rewriteToolResultContentSavedOutputPaths(message.content, record);
    } else if (message.type === 'assistant') {
      record(message.text);
    }
  }
  const plans = input.plan.runs.map(({ run, runtimeEvents }) => ({ run, events: runtimeEvents }));
  const compactableByRun = sourceCompactableEventsByRunId(plans, input.plan.inlineRuntimeEvents);
  const includedEventIds = new Set(plans.flatMap(({ events }) => events.map((event) => event.id)));
  for (const { run, runtimeEvents, operationalEvents } of input.plan.runs) {
    for (const event of runtimeEvents) rewriteRuntimeEventSavedOutputPaths(event, record);
    for (const event of operationalEvents) {
      const selected = selectConversationCopyCheckpoint(
        event,
        compactableByRun.get(run.runId) ?? [],
        includedEventIds,
      );
      if (selected) record(selected.checkpoint.summary);
    }
  }
  return [...found].sort();
}

/** Where a Host keeps saved output: tool results and background task output. */
export interface ConversationCopySavedOutputRoots {
  readonly toolResults: string;
  readonly taskOutputs: string;
}

/** A Session's own folders of saved output, under `roots`. */
export function conversationCopySavedOutputFolders(
  roots: ConversationCopySavedOutputRoots,
  sessionId: string,
): { readonly toolResults: string; readonly taskOutputs: string } {
  return {
    toolResults: toolResultSessionFolder(roots.toolResults, sessionId),
    taskOutputs: taskOutputSessionFolder(roots.taskOutputs, sessionId),
  };
}

/**
 * Put every saved output in `paths` into the target Session's own folders,
 * under the same name, and answer where each went. A file that is no longer
 * there is left out, so its path stays as the source had it; the copy goes
 * on without it. `ticket` is the one the copy took when it started: a target
 * retired since then gets no file.
 */
export async function copyConversationSavedOutputs(input: {
  readonly roots: ConversationCopySavedOutputRoots;
  readonly sourceSessionId: string;
  readonly targetSessionId: string;
  readonly paths: readonly string[];
  readonly ticket: number;
}): Promise<ReadonlyMap<string, string>> {
  const source = conversationCopySavedOutputFolders(input.roots, input.sourceSessionId);
  const target = conversationCopySavedOutputFolders(input.roots, input.targetSessionId);
  const copied = new Map<string, string>();
  for (const path of input.paths) {
    const folder =
      dirname(path) === source.toolResults
        ? target.toolResults
        : dirname(path) === source.taskOutputs
          ? target.taskOutputs
          : undefined;
    if (folder === undefined) continue;
    const destination = savedOutputFileIn(folder, path);
    if (await linkSavedOutputFile(path, destination, input.ticket)) {
      copied.set(path, destination);
    }
  }
  return copied;
}

export interface CloneConversationRuntimeLedgerResult {
  readonly copiedMessages: readonly StoredMessage[];
  readonly runIdMap: readonly {
    readonly sourceRunId: string;
    readonly targetRunId: string;
  }[];
}

export function createConversationCopySlice(
  messages: readonly StoredMessage[],
  sourceTurnId: string,
  boundary: 'through' | 'before',
): ConversationCopySlice | null {
  const turnOrder: string[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const turnId = messageTurnId(message);
    if (turnId && !seen.has(turnId)) {
      seen.add(turnId);
      turnOrder.push(turnId);
    }
  }
  const sourceIndex = turnOrder.indexOf(sourceTurnId);
  if (sourceIndex < 0) return null;
  const retainedTurnIds =
    boundary === 'through' ? turnOrder.slice(0, sourceIndex + 1) : turnOrder.slice(0, sourceIndex);
  const retained = new Set(retainedTurnIds);
  const firstExcludedTurnId =
    boundary === 'through' ? turnOrder[sourceIndex + 1] : turnOrder[sourceIndex];
  const firstExcludedTimestamps =
    firstExcludedTurnId === undefined
      ? []
      : messages
          .filter((message) => messageTurnId(message) === firstExcludedTurnId)
          .map((message) => message.ts);
  return {
    messages: messages.filter((message) => {
      if (message.type === 'turn_state') return false;
      const turnId = messageTurnId(message);
      return turnId !== undefined && retained.has(turnId);
    }),
    turnIds: retainedTurnIds,
    ...(firstExcludedTimestamps.length > 0
      ? { beforeTs: Math.min(...firstExcludedTimestamps) }
      : {}),
  };
}

export function rewriteConversationCopyMessage(
  message: StoredMessage,
  references: ConversationCopyMessageReferenceMap,
): StoredMessage {
  if (message.type === 'assistant' && references.mode === 'exact') {
    return {
      ...message,
      text: savedOutputRewrite(references)(
        rewriteAttachmentResourceRefs(message.text, references.artifactIds),
      ),
    };
  }
  if (
    message.type === 'user' &&
    (message.attachments || message.origin?.kind === 'background_task')
  ) {
    return {
      ...message,
      ...(references.mode === 'exact' && message.origin?.kind === 'background_task'
        ? {
            text: rewriteConversationCopyNotificationArtifacts(
              rewriteAttachmentResourceRefs(message.text, references.artifactIds),
              references.artifactIds,
            ),
          }
        : {}),
      ...(message.attachments
        ? {
            attachments: message.attachments.map((attachment) => ({
              ...attachment,
              ref: rewriteStorageRef(attachment.ref, references),
            })),
          }
        : {}),
    };
  }
  if (message.type === 'tool_result') {
    return {
      ...message,
      content: rewriteToolResultContent(message.content, references),
    };
  }
  if (message.type === 'token_usage' && message.providerRequestTraceId) {
    return {
      ...message,
      providerRequestTraceId: rewriteOwnedId(
        message.providerRequestTraceId,
        references.providerTraceIds,
        'provider trace',
      ),
    };
  }
  return message;
}

/** The rewrite that moves a saved output's path to the target's copy of it. */
function savedOutputRewrite(
  references: ConversationCopyArtifactReferenceMap,
): SavedOutputPathRewrite {
  if (references.mode !== 'exact' || !references.savedOutputPaths) return (text) => text;
  let rewrite = savedOutputRewrites.get(references.savedOutputPaths);
  if (!rewrite) {
    rewrite = savedOutputPathMapRewrite(references.savedOutputPaths);
    savedOutputRewrites.set(references.savedOutputPaths, rewrite);
  }
  return rewrite;
}

const savedOutputRewrites = new WeakMap<ReadonlyMap<string, string>, SavedOutputPathRewrite>();

function rewriteAttachmentResourceRefs(
  text: string,
  artifactIds: ReadonlyMap<string, string>,
): string {
  return text.replace(/maka:\/\/runtime\/attachments\/[^\s)\]}>`'",;:!]+/g, (candidate) => {
    const parsed = parseAttachmentResourceRef(candidate);
    const artifactId = parsed ? artifactIds.get(parsed.artifactId) : undefined;
    return artifactId ? `maka://runtime/attachments/${artifactId}` : candidate;
  });
}

export async function prepareConversationRuntimeLedgerCopy(input: {
  readonly sourceSessionId: string;
  readonly sourceEvents: readonly RuntimeEvent[];
  readonly copiedMessages: readonly StoredMessage[];
  readonly runStore: Pick<AgentRunStore, 'readEvents'>;
  readonly runtimeEventStore: Pick<
    RuntimeEventStore,
    'readRuntimeEvents' | 'listSessionInvocations'
  >;
}): Promise<ConversationRuntimeLedgerCopyPlan> {
  const sourceRuns = await input.runtimeEventStore.listSessionInvocations(input.sourceSessionId);
  const transcriptTurnIds = [
    ...new Set(
      input.copiedMessages.map(messageTurnId).filter((turnId): turnId is string => !!turnId),
    ),
  ];
  const copyTurnIds = conversationCopyTurnClosure(sourceRuns, transcriptTurnIds);
  const selectedRunEvents = await loadConversationCopyRunEvents(
    sourceRuns,
    input.sourceEvents,
    copyTurnIds,
    input.runtimeEventStore,
  );
  const runs = await Promise.all(
    selectedRunEvents.map(async ({ run, events }) => {
      const operationalEvents = await input.runStore.readEvents(run.sessionId, run.runId);
      assertConversationRuntimeLedgerCopySupported(run, events);
      const terminal = classifyTerminalRuntimeLedger(run, events);
      if (run.terminalEvent && terminal.kind !== 'fact') {
        throw new Error(`Cannot copy terminal AgentRun ${run.runId} without one terminal fact`);
      }
      return { run, runtimeEvents: events, operationalEvents };
    }),
  );
  // A restored opening takes the place the migration could not give it: right
  // before the first event of its run in the Session's order.
  const restoredOpenings = new Map(
    selectedRunEvents.flatMap(({ run, restoredOpening }) =>
      restoredOpening ? [[run.runId, restoredOpening] as const] : [],
    ),
  );
  const inlineRuntimeEvents = input.sourceEvents.flatMap((event) => {
    // A copy carries settled facts; the importer refuses presentation state.
    if (isPartialRuntimeEvent(event)) return [];
    const opening = restoredOpenings.get(event.runId);
    if (!opening) return [event];
    restoredOpenings.delete(event.runId);
    return [opening, event];
  });
  const plan = {
    sourceSessionId: input.sourceSessionId,
    copyTurnIds,
    inlineRuntimeEvents,
    runs,
  };
  return plan;
}

function assertConversationRuntimeLedgerCopySupported(
  run: RuntimeInvocationRecord,
  runtimeEvents: readonly RuntimeEvent[],
): void {
  const unsupported =
    run.opening.source.kind !== 'fresh' ||
    runtimeEvents.some(
      (event) => isContinuationStartRuntimeEvent(event) || runtimeHandoffPause(event),
    );
  if (!unsupported) return;

  const error = new Error(
    'Conversation copy contains durable runtime authority facts that require typed identity rewriting',
  ) as Error & { code: string };
  error.code = 'branch_runtime_fact_rewrite_unsupported';
  throw error;
}

export async function cloneConversationRuntimeLedger(
  input: CloneConversationRuntimeLedgerInput,
): Promise<CloneConversationRuntimeLedgerResult> {
  if (input.plan.sourceSessionId !== input.referenceMap.sourceSessionId) {
    throw new Error('Conversation copy plan does not belong to the source Session');
  }
  const flattenedPlans = input.plan.runs.map(({ run, runtimeEvents, operationalEvents }) => ({
    run,
    events: runtimeEvents,
    operationalEvents,
    terminal: classifyTerminalRuntimeLedger(run, runtimeEvents),
  }));
  const sourceCompactableEvents = sourceCompactableEventsByRunId(
    flattenedPlans,
    input.plan.inlineRuntimeEvents,
  );
  // One physical execution attempt, one identity: a copied run and its copied
  // invocation get the same fresh value rather than two independent ones.
  const runIds = new Map(flattenedPlans.map(({ run }) => [run.runId, input.newId()]));
  const targetInvocationIds = new Map(
    flattenedPlans.map(({ run }) => [run.runId, runIds.get(run.runId)!]),
  );
  const invocationIds = new Map(
    flattenedPlans.flatMap(({ run }) =>
      run.invocationId ? [[run.invocationId, targetInvocationIds.get(run.runId)!] as const] : [],
    ),
  );
  const runtimeEventIds = new Map(
    flattenedPlans.flatMap(({ events }) =>
      events.map((event) => [event.id, input.newId()] as const),
    ),
  );
  const operationalEventIds = new Map(
    flattenedPlans.flatMap(({ operationalEvents }) =>
      operationalEvents.flatMap((event) =>
        isCopiedAgentRunEvent(event) ? [[event.id, input.newId()] as const] : [],
      ),
    ),
  );
  const providerTraceIds = providerTraceIdMap(flattenedPlans, input.newId);
  const logicalCallIds = logicalModelCallIdMap(flattenedPlans, input.newId);
  const operationIds = toolOperationIdMap(flattenedPlans, targetInvocationIds);
  const references: ConversationCopyReferenceMap = {
    ...input.referenceMap,
    runIds,
    invocationIds,
    operationIds,
    runtimeEventIds,
    providerTraceIds,
    agentRunEventIds: operationalEventIds,
  };
  const clonedEventBySourceId = new Map<string, RuntimeEvent>();
  for (const plan of flattenedPlans) {
    const runId = runIds.get(plan.run.runId)!;
    const invocationId = targetInvocationIds.get(plan.run.runId)!;
    for (const event of plan.events) {
      clonedEventBySourceId.set(
        event.id,
        cloneRuntimeEvent(
          event,
          {
            sessionId: input.referenceMap.targetSessionId,
            runId,
            eventId: runtimeEventIds.get(event.id)!,
            invocationId,
          },
          references,
        ),
      );
    }
  }
  const checkpointIds = new Map<string, string>();
  const preparedPlans = flattenedPlans.map((plan) => {
    const runId = runIds.get(plan.run.runId)!;
    const clonedOperationalEvents = plan.operationalEvents.flatMap((event) => {
      const clonedEvent = cloneAgentRunEvent(
        event,
        {
          sessionId: input.referenceMap.targetSessionId,
          runId,
          eventId: operationalEventIds.get(event.id),
        },
        references,
        sourceCompactableEvents.get(plan.run.runId) ?? [],
        clonedEventBySourceId,
        checkpointIds,
        providerTraceIds,
        logicalCallIds,
      );
      return clonedEvent ? [clonedEvent] : [];
    });
    const terminalEvent =
      plan.terminal.kind === 'fact'
        ? clonedEventBySourceId.get(plan.terminal.fact.terminalEvent.id)
        : undefined;
    if (plan.terminal.kind === 'fact' && !terminalEvent) {
      throw new Error(`Copied AgentRun ${plan.run.runId} lost its terminal RuntimeEvent`);
    }
    return {
      plan,
      runId,
      clonedOperationalEvents,
      terminalEvent,
    };
  });
  const copiedMessages = input.copiedMessages.map((message) =>
    rewriteConversationCopyMessage(message, references),
  );

  const importedSourceEventIds = new Set<string>();
  const orderedBatches = input.plan.inlineRuntimeEvents.flatMap((event) => {
    const cloned = clonedEventBySourceId.get(event.id);
    const runId = runIds.get(event.runId);
    if (!cloned || !runId) return [];
    importedSourceEventIds.add(event.id);
    return [{ runId, events: [cloned] }];
  });
  for (const { plan, runId } of preparedPlans) {
    const remaining = plan.events.filter((event) => !importedSourceEventIds.has(event.id));
    if (remaining.length === 0) continue;
    orderedBatches.push({
      runId,
      events: remaining.map((event) => clonedEventBySourceId.get(event.id)!),
    });
  }
  await input.runtimeEventStore.importConversationCopyRuntimeEvents(
    input.referenceMap.targetSessionId,
    orderedBatches,
  );

  for (const { plan, runId, clonedOperationalEvents, terminalEvent } of preparedPlans) {
    for (const clonedEvent of clonedOperationalEvents) {
      await input.runStore.appendEvent(input.referenceMap.targetSessionId, runId, clonedEvent);
    }

    if (plan.terminal.kind === 'fact' && terminalEvent) {
      await commitTerminalRunWithRuntimeFact({
        runtimeEventStore: input.runtimeEventStore,
        newId: input.newId,
        sessionId: input.referenceMap.targetSessionId,
        runId,
        turnId: plan.run.turnId,
        status: plan.terminal.fact.runStatus,
        ts: terminalEvent.ts,
        terminalEvent,
        ...(plan.terminal.fact.failureClass
          ? { failureClass: plan.terminal.fact.failureClass }
          : {}),
        ...(plan.terminal.fact.abortSource ? { abortSource: plan.terminal.fact.abortSource } : {}),
      });
    }
  }

  return {
    copiedMessages,
    runIdMap: [...runIds].map(([sourceRunId, targetRunId]) => ({
      sourceRunId,
      targetRunId,
    })),
  };
}

interface ConversationCopyRunEvents {
  readonly run: RuntimeInvocationRecord;
  /** The run's events, beginning with its opening. */
  readonly events: readonly RuntimeEvent[];
  /**
   * The opening as an event, when the run's own events did not carry one:
   * the migration shelved openings of runs that already owned an immutable
   * sequence, and a copy is where such a run gets its opening back as event
   * one, because the copy is a fresh sequence.
   */
  readonly restoredOpening?: RuntimeEvent;
}

async function loadConversationCopyRunEvents(
  sourceRuns: readonly RuntimeInvocationRecord[],
  sourceEvents: readonly RuntimeEvent[],
  copyTurnIds: readonly string[],
  runtimeEventStore: Pick<RuntimeEventStore, 'readRuntimeEvents'>,
): Promise<ConversationCopyRunEvents[]> {
  const copiedTurnIds = new Set(copyTurnIds);
  return Promise.all(
    sourceRuns.flatMap((run) => {
      if (!copiedTurnIds.has(run.turnId)) return [];
      const projectedEvents = sourceEvents.filter(
        (event) => event.runId === run.runId && copiedTurnIds.has(event.turnId),
      );
      return [
        Promise.resolve(
          projectedEvents.length > 0
            ? projectedEvents
            : runtimeEventStore.readRuntimeEvents(run.sessionId, run.runId),
        ).then((sourceRunEvents) => {
          // A run read back includes its live presentation snapshots; the copy
          // carries settled facts only.
          const events = sourceRunEvents.filter((event) => !isPartialRuntimeEvent(event));
          if (events.some((event) => event.content?.kind === 'invocation_opened')) {
            return { run, events };
          }
          const restoredOpening = buildInvocationOpenedEvent({
            id: `invocation_opened:${run.runId}`,
            run,
            openedAt: run.openedAt,
            opening: run.opening,
          });
          return { run, events: [restoredOpening, ...events], restoredOpening };
        }),
      ];
    }),
  );
}

export function conversationCopyLinkedChildReferences(
  content: ToolResultContent,
): readonly ConversationCopyLinkedChildReference[] {
  if (content.kind === 'subagent') {
    if (!content.childSessionId) return [];
    return [
      {
        kind: 'subagent',
        childSessionId: content.childSessionId,
        ...(content.runId ? { runId: content.runId } : {}),
        turnId: content.turnId,
        artifactIds: content.artifactIds,
        status: content.status,
        ...(content.failureClass ? { failureClass: content.failureClass } : {}),
      },
    ];
  }
  if (content.kind !== 'agent_swarm') return [];
  return content.items.flatMap((item) =>
    item.childSessionId
      ? [
          {
            kind: 'agent_swarm' as const,
            childSessionId: item.childSessionId,
            ...(item.runId ? { runId: item.runId } : {}),
            ...(item.resumedFromRunId ? { resumedFromRunId: item.resumedFromRunId } : {}),
            ...(item.turnId ? { turnId: item.turnId } : {}),
            artifactIds: item.artifactIds,
            status: item.status,
            ...(item.failureClass ? { failureClass: item.failureClass } : {}),
          },
        ]
      : [],
  );
}

export function collectConversationCopyLinkedChildReferences(input: {
  readonly messages: readonly StoredMessage[];
  readonly runtimeEvents: readonly RuntimeEvent[];
}): readonly ConversationCopyLinkedChildReference[] {
  const references: ConversationCopyLinkedChildReference[] = [];
  const add = (value: unknown): void => {
    try {
      references.push(
        ...conversationCopyLinkedChildReferences(
          decodePersistedToolResultContent(markPersisted<ToolResultContent>(value)),
        ),
      );
    } catch {
      // Opaque tool results have no typed linked-child references.
    }
  };
  for (const message of input.messages) {
    if (message.type === 'tool_result') {
      references.push(...conversationCopyLinkedChildReferences(message.content));
    }
  }
  for (const event of input.runtimeEvents) {
    if (event.content?.kind === 'function_response') add(event.content.result);
  }
  return references;
}

/**
 * Collects the `relativePath` of every `session_file` StorageRef that the copied
 * slice references and that belongs to the source Session. User-uploaded
 * attachments carry `turnId === uploadId` (a sentinel, not a conversation turn),
 * so the turn-scoped artifact copy never selects them; the coordinator feeds this
 * set to `copyConversationArtifacts` as an explicit same-Session include list so
 * their refs resolve in `rewriteStorageRef`. Walks exactly the ref sites reached
 * by `rewriteStorageRef`: user-message attachments, tool_result image refs, text
 * runtime-event attachments, function_response images, and delivered file handles.
 */
export function collectConversationCopySessionFileRefs(input: {
  readonly sourceSessionId: string;
  readonly messages: readonly StoredMessage[];
  readonly runtimeEvents: readonly RuntimeEvent[];
}): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const ref of collectConversationCopyStorageRefs(input)) {
    if (ref.kind === 'session_file' && ref.sessionId === input.sourceSessionId) {
      refs.add(ref.relativePath);
    }
  }
  return refs;
}

function cloneAgentRunEvent(
  event: AgentRunEvent,
  ids: {
    readonly sessionId: string;
    readonly runId: string;
    readonly eventId?: string;
  },
  references: ConversationCopyReferenceMap,
  sourceCompactableEvents: readonly RuntimeEvent[],
  clonedRuntimeEvents: ReadonlyMap<string, RuntimeEvent>,
  checkpointIds: Map<string, string>,
  providerTraceIds: ReadonlyMap<string, string>,
  logicalCallIds: ReadonlyMap<string, string>,
): EmittedAgentRunEvent | null {
  if (event.type === 'event_corrupt') {
    throw new Error(`Cannot copy corrupt AgentRun event ${event.id}`);
  }
  if (!isCopiedAgentRunEvent(event)) return null;
  if (!ids.eventId) {
    throw new Error(`Cannot copy AgentRun event ${event.id} without a target identity`);
  }

  let data = event.data;
  if (event.type === MODEL_CALL_ATTEMPT_EVENT_TYPE) {
    data = rewriteModelCallAttempt(
      event,
      { sessionId: ids.sessionId, runId: ids.runId, attemptId: ids.eventId },
      references,
      providerTraceIds,
      logicalCallIds,
    );
  } else if (event.type === 'history_compact_checkpoint_recorded') {
    const selected = selectConversationCopyCheckpoint(
      event,
      sourceCompactableEvents,
      clonedRuntimeEvents,
    );
    if (!selected) return null;
    // A summary may spell an old delivery or notification Artifact id in arbitrary prose.
    // Keep its canonical events and let the target compact again instead of
    // re-authenticating that stale summary against rewritten notifications.
    if (
      references.mode === 'exact' &&
      (selected.coveredRuntimeEvents.some(
        (event) =>
          event.content?.kind === 'function_response' && readFileDelivery(event.content.result),
      ) ||
        collectConversationCopyChildNotifications(selected.coveredRuntimeEvents).some(
          (notification) => notification.artifactIds.some((id) => references.artifactIds.has(id)),
        ))
    )
      return null;
    const sourceCheckpoint = selected.checkpoint;
    const coveredRuntimeEvents = selected.coveredRuntimeEvents.map(
      (sourceEvent) => clonedRuntimeEvents.get(sourceEvent.id)!,
    );
    const headAnchor =
      sourceCheckpoint.phase === 'mid_turn'
        ? {
            runtimeEventId:
              clonedRuntimeEvents.get(sourceCheckpoint.headAnchor!.runtimeEventId)?.id ??
              sourceCheckpoint.headAnchor!.runtimeEventId,
            turnId: sourceCheckpoint.headAnchor!.turnId,
          }
        : undefined;
    const checkpoint = buildHistoryCompactCheckpoint({
      sessionId: references.targetSessionId,
      coveredRuntimeEvents,
      summary: savedOutputRewrite(references)(sourceCheckpoint.summary),
      highWaterName: sourceCheckpoint.highWaterName,
      highWaterSeq: sourceCheckpoint.highWaterSeq,
      now: sourceCheckpoint.createdAt,
      ...(sourceCheckpoint.phase ? { phase: sourceCheckpoint.phase } : {}),
      ...(headAnchor ? { headAnchor } : {}),
      ...(sourceCheckpoint.previousCheckpointId &&
      checkpointIds.has(sourceCheckpoint.previousCheckpointId)
        ? {
            previousCheckpointId: checkpointIds.get(sourceCheckpoint.previousCheckpointId)!,
          }
        : {}),
    });
    checkpointIds.set(sourceCheckpoint.checkpointId, checkpoint.checkpointId);
    data = {
      ...event.data,
      checkpointId: checkpoint.checkpointId,
      checkpoint,
    };
  }

  return {
    ...event,
    id: ids.eventId,
    sessionId: ids.sessionId,
    runId: ids.runId,
    ...(data ? { data } : {}),
  };
}

/** The same checkpoint admission governs both its file references and its copied record. */
function selectConversationCopyCheckpoint(
  event: AgentRunEvent,
  sourceCompactableEvents: readonly RuntimeEvent[],
  includedEventIds: { has(eventId: string): boolean },
):
  | {
      readonly checkpoint: TextHistoryCompactCheckpoint;
      readonly coveredRuntimeEvents: readonly RuntimeEvent[];
    }
  | undefined {
  if (event.type !== 'history_compact_checkpoint_recorded') return undefined;
  const checkpoint = event.data?.checkpoint;
  // Copies retain the raw events and can compact again. Opaque provider state,
  // superseded source policies and unmatched prefixes do not cross sessions.
  if (!validateHistoryCompactCheckpointShape(checkpoint, event.sessionId)) return undefined;
  if (checkpoint.version === 3) return undefined;
  const match = matchHistoryCompactCheckpointPrefix(checkpoint, sourceCompactableEvents);
  if (match.reason) return undefined;
  // A matching, marked summary still has to satisfy the current format. Its
  // size floor needs the summarizer's usage, which a copy does not have.
  if (findCheckpointSummaryDefect(checkpoint.summary) !== undefined) {
    throw new Error(`Cannot copy invalid history compact checkpoint ${event.id}`);
  }
  if (match.coveredRuntimeEvents.some((sourceEvent) => !includedEventIds.has(sourceEvent.id))) {
    throw new Error(
      `History compact checkpoint ${event.id} crosses the conversation copy boundary`,
    );
  }
  return { checkpoint, coveredRuntimeEvents: match.coveredRuntimeEvents };
}

function rewriteModelCallAttempt(
  event: AgentRunEvent,
  ids: {
    readonly sessionId: string;
    readonly runId: string;
    readonly attemptId: string;
  },
  references: ConversationCopyReferenceMap,
  providerTraceIds: ReadonlyMap<string, string>,
  logicalCallIds: ReadonlyMap<string, string>,
): Record<string, unknown> {
  // A ModelCallAttempt is an accounting authority whose payload identity is its
  // portable source of truth and must agree with the rewritten envelope. Leaving
  // the source `sessionId`/`runId` in place makes the model-call projection
  // reject the attempt as unreadable (its envelope now disagrees), and reusing
  // the source `attemptId` — the ledger's global primary key — lets the copy
  // overwrite the source session's own row. Rewrite the owned identity the same
  // way the sibling provider-request rewriters do.
  //
  // Unlike those siblings, do NOT require `attempt.attemptId === event.id`. A
  // well-formed writer emits them equal, but the pre-fix copy path had no
  // rewriter for this event, so it rewrote the envelope id while leaving the
  // nested payload at the source identity. Sessions copied before that fix carry
  // attempts whose nested `attemptId` disagrees with their envelope; asserting
  // the writer contract on the *source* would strand them — they could never be
  // copied again. The rewrite below reassigns the identity wholesale, so a stale
  // nested identity is repaired rather than trusted and the *output* still
  // satisfies the `event.id === attemptId` contract. `decodeModelCallAttempt`
  // still rejects a schema-invalid payload.
  // The join key is dropped by leaving it out of the spread: a conditional
  // spread of `{}` cannot remove a key the spread above already placed.
  const { captureArtifactId, ...attempt } = decodeModelCallAttempt(event.data);
  return {
    ...attempt,
    sessionId: ids.sessionId,
    runId: ids.runId,
    attemptId: ids.attemptId,
    logicalCallId: requiredMappedId(logicalCallIds, attempt.logicalCallId, 'logical model call'),
    traceId: requiredMappedId(providerTraceIds, attempt.traceId, 'provider trace'),
    ...(captureArtifactId !== undefined ? capturedArtifactJoin(captureArtifactId, references) : {}),
  };
}

function requiredMappedId(
  ids: ReadonlyMap<string, string>,
  sourceId: string,
  kind: string,
): string {
  const targetId = ids.get(sourceId);
  if (!targetId) throw new Error(`Conversation copy is missing ${kind} ${sourceId}`);
  return targetId;
}

function rewriteOwnedArtifactId(
  sourceArtifactId: string,
  references: ConversationCopyArtifactReferenceMap,
): string {
  if (references.mode === 'preserve_external') return sourceArtifactId;
  return rewriteOwnedId(sourceArtifactId, references.artifactIds, 'Artifact');
}

/**
 * A reference whose target may have been reclaimed, mapped or dropped.
 *
 * An Artifact reference normally throws on a missing target, because the bytes
 * and the record naming them are removed together and a copy that lost one has
 * lost something a reader will ask for. These references are the exception:
 * they live in an append-only ledger that outlives what it names, and the
 * retired provider-request captures are reclaimed from disk on their own. A
 * copy carries what is still there and drops the rest, because failing would
 * make a whole Session uncopyable over a byte nothing reads.
 */
function reclaimableArtifactReference(
  sourceArtifactId: string,
  references: ConversationCopyArtifactReferenceMap,
): string | undefined {
  if (references.mode === 'preserve_external') return sourceArtifactId;
  return references.artifactIds.get(sourceArtifactId);
}

/** The `captureArtifactId` join, or nothing when its Artifact is gone. */
function capturedArtifactJoin(
  sourceArtifactId: string,
  references: ConversationCopyArtifactReferenceMap,
): { captureArtifactId?: string } {
  const targetArtifactId = reclaimableArtifactReference(sourceArtifactId, references);
  return targetArtifactId === undefined ? {} : { captureArtifactId: targetArtifactId };
}

function rewriteOwnedId(sourceId: string, ids: ReadonlyMap<string, string>, kind: string): string {
  return requiredMappedId(ids, sourceId, kind);
}

const PROVIDER_TRACE_BEARING_EVENT_TYPES: ReadonlySet<string> = new Set([
  MODEL_CALL_ATTEMPT_EVENT_TYPE,
  'provider_request_captured',
  'provider_request_attempt_recorded',
]);

function isProviderTraceBearingEventType(type: string): boolean {
  return PROVIDER_TRACE_BEARING_EVENT_TYPES.has(type);
}

function providerTraceIdMap(
  plans: readonly { readonly operationalEvents: readonly AgentRunEvent[] }[],
  newId: () => string,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const { operationalEvents } of plans) {
    for (const event of operationalEvents) {
      // Harvest from retired writers too. Their rows are not copied, but a
      // copied RuntimeEvent may still point at a trace only they recorded, and
      // carrying the source's trace id into the target would be worse than
      // pointing at a fresh one nothing describes.
      if (!isProviderTraceBearingEventType(event.type)) continue;
      const traceId = event.data?.traceId;
      if (typeof traceId === 'string' && !result.has(traceId)) result.set(traceId, newId());
    }
  }
  return result;
}

function logicalModelCallIdMap(
  plans: readonly { readonly operationalEvents: readonly AgentRunEvent[] }[],
  newId: () => string,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const { operationalEvents } of plans) {
    for (const event of operationalEvents) {
      // Harvest from retired writers too. Their rows are not copied, but a
      // copied RuntimeEvent may still point at a trace only they recorded, and
      // carrying the source's trace id into the target would be worse than
      // pointing at a fresh one nothing describes.
      if (!isProviderTraceBearingEventType(event.type)) continue;
      const logicalCallId = event.data?.logicalCallId;
      if (typeof logicalCallId === 'string' && !result.has(logicalCallId)) {
        result.set(logicalCallId, newId());
      }
    }
  }
  return result;
}

function toolOperationIdMap(
  plans: readonly {
    readonly run: RuntimeInvocationRecord;
    readonly events: readonly RuntimeEvent[];
  }[],
  targetInvocationIds: ReadonlyMap<string, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const { run, events } of plans) {
    const invocationId = requiredMappedId(targetInvocationIds, run.runId, 'target invocation');
    for (const event of events) {
      const dispatch = event.actions?.toolDispatch;
      if (!dispatch) continue;
      const targetOperationId = buildToolOperationId({
        invocationId,
        providerToolCallId: dispatch.providerToolCallId,
      });
      const existing = result.get(dispatch.operationId);
      if (existing && existing !== targetOperationId) {
        throw new Error(`Tool operation ${dispatch.operationId} crosses copied AgentRuns`);
      }
      result.set(dispatch.operationId, targetOperationId);
    }
  }
  return result;
}

function isCopiedAgentRunEvent(event: AgentRunEvent): event is EmittedAgentRunEvent {
  // The rewriters below know which of this build's payloads carry source-owned references. A type
  // this build does not emit cannot even be checked for them, so it is dropped rather than carried
  // into the target with source identities intact. The ledger's `type` is open, so such an event
  // may predate a retired writer or postdate this build entirely (#1942).
  if (!isEmittedAgentRunEventType(event.type)) return false;
  return event.type !== 'event_corrupt';
}

function cloneRuntimeEvent(
  event: RuntimeEvent,
  ids: {
    readonly sessionId: string;
    readonly runId: string;
    readonly eventId: string;
    readonly invocationId: string;
  },
  references: ConversationCopyReferenceMap,
): RuntimeEvent {
  return {
    ...rewriteRuntimeEventReferences(event, references),
    id: ids.eventId,
    invocationId: ids.invocationId,
    sessionId: ids.sessionId,
    runId: ids.runId,
  };
}

/**
 * Rewrite the lineage a copied invocation's opening fact carries.
 *
 * The opening is an ordinary RuntimeEvent, so the copy rewrites its owned ids
 * the way it rewrites every other reference. Its `source` needs no rewriting:
 * a copy that contains a continuation is refused before it gets this far.
 */
function rewriteInvocationOpening(
  opening: RuntimeEventInvocationOpenedContent,
  references: ConversationCopyReferenceMap,
): RuntimeEventInvocationOpenedContent {
  const lineage = opening.lineage;
  return {
    ...opening,
    ...(lineage
      ? {
          lineage: {
            ...lineage,
            ...(lineage.parentRunId
              ? { parentRunId: rewriteOwnedId(lineage.parentRunId, references.runIds, 'AgentRun') }
              : {}),
            ...(lineage.resumedFromRunId
              ? {
                  resumedFromRunId: rewriteOwnedId(
                    lineage.resumedFromRunId,
                    references.runIds,
                    'AgentRun',
                  ),
                }
              : {}),
            ...(lineage.retriedFromRunId
              ? {
                  retriedFromRunId: rewriteOwnedId(
                    lineage.retriedFromRunId,
                    references.runIds,
                    'AgentRun',
                  ),
                }
              : {}),
            ...(lineage.parentSessionId === references.sourceSessionId
              ? { parentSessionId: references.targetSessionId }
              : {}),
          },
        }
      : {}),
  };
}

function rewriteRuntimeEventReferences(
  event: RuntimeEvent,
  references: ConversationCopyReferenceMap,
): RuntimeEvent {
  const savedOutputs = savedOutputRewrite(references);
  const content =
    event.content?.kind === 'text'
      ? {
          ...event.content,
          ...(references.mode === 'exact'
            ? {
                text: savedOutputs(
                  event.content.origin?.kind === 'background_task'
                    ? rewriteConversationCopyNotificationArtifacts(
                        rewriteAttachmentResourceRefs(event.content.text, references.artifactIds),
                        references.artifactIds,
                      )
                    : rewriteAttachmentResourceRefs(event.content.text, references.artifactIds),
                ),
              }
            : {}),
          ...(event.content.attachments
            ? {
                attachments: event.content.attachments.map((attachment) => ({
                  ...attachment,
                  ref: rewriteStorageRef(attachment.ref, references),
                })),
              }
            : {}),
        }
      : event.content?.kind === 'function_response'
        ? {
            ...event.content,
            result: rewriteRuntimeToolResult(event.content.result, references),
            ...(event.content.modelProjection
              ? {
                  modelProjection: rewriteDurableToolResultProjectionSavedOutputPaths(
                    rewriteDurableToolResultProjectionArtifactRefs(
                      rewriteDeliveryModelProjection(
                        event.content.modelProjection,
                        event.content.result,
                        event.content.name,
                        references,
                      ),
                      (ref) => rewriteProjectionArtifactRef(ref, references),
                    ),
                    savedOutputs,
                  ),
                }
              : {}),
          }
        : event.content?.kind === 'invocation_opened'
          ? rewriteInvocationOpening(event.content, references)
          : event.content;
  const refs = event.refs
    ? (() => {
        const {
          operationId: _operationId,
          parentOperationId: _parentOperationId,
          traceEventId: _traceEventId,
          ...preserved
        } = event.refs;
        const traceEventId = event.refs.traceEventId
          ? references.agentRunEventIds.get(event.refs.traceEventId)
          : undefined;
        return {
          ...preserved,
          ...(traceEventId ? { traceEventId } : {}),
          ...(event.refs.operationId
            ? {
                operationId: rewriteOwnedId(
                  event.refs.operationId,
                  references.operationIds,
                  'tool operation',
                ),
              }
            : {}),
          ...(event.refs.parentOperationId
            ? {
                parentOperationId: rewriteOwnedId(
                  event.refs.parentOperationId,
                  references.operationIds,
                  'tool operation',
                ),
              }
            : {}),
          ...(event.refs.artifactId
            ? { artifactId: rewriteOwnedArtifactId(event.refs.artifactId, references) }
            : {}),
          ...(event.refs.sourceInvocationId
            ? {
                sourceInvocationId: rewriteOwnedId(
                  event.refs.sourceInvocationId,
                  references.invocationIds,
                  'invocation',
                ),
              }
            : {}),
          ...(event.refs.sourceRunId
            ? {
                sourceRunId: rewriteOwnedId(event.refs.sourceRunId, references.runIds, 'AgentRun'),
              }
            : {}),
          ...(event.refs.providerRequestTraceId
            ? {
                providerRequestTraceId: rewriteOwnedId(
                  event.refs.providerRequestTraceId,
                  references.providerTraceIds,
                  'provider trace',
                ),
              }
            : {}),
        };
      })()
    : undefined;
  const actions = rewriteRuntimeEventActions(event.actions, references);
  return {
    ...event,
    ...(content ? { content } : {}),
    ...(actions ? { actions } : {}),
    ...(refs ? { refs } : {}),
  };
}

function rewriteRuntimeEventActions(
  actions: RuntimeEvent['actions'],
  references: ConversationCopyReferenceMap,
): RuntimeEvent['actions'] {
  const dispatch = actions?.toolDispatch;
  const recovery = actions?.toolRecovery;
  if (!dispatch && !recovery) return actions;
  const operationId = dispatch?.operationId ?? recovery?.payload.operationId;
  const targetOperationId = operationId
    ? rewriteOwnedId(operationId, references.operationIds, 'tool operation')
    : undefined;
  return {
    ...actions,
    ...(dispatch && targetOperationId
      ? { toolDispatch: { ...dispatch, operationId: targetOperationId } }
      : {}),
    ...(recovery && targetOperationId
      ? {
          toolRecovery: rewriteToolRecoveryFact(recovery, targetOperationId, references),
        }
      : {}),
  };
}

function rewriteToolRecoveryFact(
  recovery: NonNullable<RuntimeEvent['actions']>['toolRecovery'],
  operationId: string,
  references: ConversationCopyReferenceMap,
): NonNullable<RuntimeEvent['actions']>['toolRecovery'] {
  if (!recovery || recovery.kind !== TOOL_RECOVERY_DECISION_FACT_KIND) {
    return recovery ? { ...recovery, payload: { ...recovery.payload, operationId } } : recovery;
  }
  const payload = recovery.payload;
  return {
    ...recovery,
    payload: {
      ...payload,
      operationId,
      evidenceEventIds: payload.evidenceEventIds.map((eventId) =>
        requiredMappedId(references.runtimeEventIds, eventId, 'RuntimeEvent'),
      ),
      ...(payload.disposition === 'completed'
        ? {
            outcomeEventId: requiredMappedId(
              references.runtimeEventIds,
              payload.outcomeEventId,
              'RuntimeEvent',
            ),
          }
        : {}),
    },
  };
}

function rewriteToolResultContent(
  content: ToolResultContent,
  references: ConversationCopyMessageReferenceMap,
): ToolResultContent {
  if (content.kind === 'image') {
    return { ...content, ref: rewriteStorageRef(content.ref, references) };
  }
  if (content.kind === 'user_file_delivery') {
    if (references.mode === 'preserve_external') return content;
    // Delivered files are user-deletable, while their historical receipt is immutable.
    const files = content.files.flatMap((file) => {
      const artifactId = reclaimableArtifactReference(file.artifactId, references);
      return artifactId ? [{ ...file, artifactId }] : [];
    });
    // A delivery must contain at least one file. Keep a readable notice when
    // every target is gone instead of persisting an invalid empty delivery.
    if (files.length === 0) {
      return {
        kind: 'text',
        text: 'The files from this earlier delivery are no longer available in this conversation.',
      };
    }
    return rewriteToolResultContentSavedOutputPaths(
      { ...content, files },
      savedOutputRewrite(references),
    );
  }
  if (content.kind === 'subagent') {
    if (linkedChildrenAreSnapshots(references) && content.childSessionId) {
      const { childSessionId: _childSessionId, runId: _runId, ...snapshot } = content;
      return {
        ...snapshot,
        artifactIds: rewriteSnapshotArtifactIds(content.artifactIds, references),
      };
    }
    return {
      ...content,
      ...(content.runId
        ? {
            runId: rewriteLinkedRunId(
              content.runId,
              content.childSessionId,
              references,
              'AgentRun',
            ),
          }
        : {}),
      artifactIds: rewriteLinkedArtifactIds(
        content.artifactIds,
        content.childSessionId,
        references,
      ),
    };
  }
  if (content.kind === 'agent_swarm') {
    return {
      ...content,
      items: content.items.map((item) => {
        if (linkedChildrenAreSnapshots(references) && item.childSessionId) {
          const {
            childSessionId: _childSessionId,
            runId: _runId,
            resumedFromRunId: _resumedFromRunId,
            ...snapshot
          } = item;
          return {
            ...snapshot,
            artifactIds: rewriteSnapshotArtifactIds(item.artifactIds, references),
          };
        }
        return {
          ...item,
          ...(item.runId
            ? {
                runId: rewriteLinkedRunId(item.runId, item.childSessionId, references, 'AgentRun'),
              }
            : {}),
          ...(item.resumedFromRunId
            ? {
                resumedFromRunId: rewriteLinkedRunId(
                  item.resumedFromRunId,
                  item.childSessionId,
                  references,
                  'resumed AgentRun',
                ),
              }
            : {}),
          artifactIds: rewriteLinkedArtifactIds(item.artifactIds, item.childSessionId, references),
        };
      }),
    };
  }
  return rewriteToolResultContentSavedOutputPaths(content, savedOutputRewrite(references));
}

/** Keep the producer's model receipt consistent with the copied delivery cards. */
function rewriteDeliveryModelProjection(
  projection: DurableToolResultProjection,
  result: unknown,
  toolName: string,
  references: ConversationCopyMessageReferenceMap,
): DurableToolResultProjection {
  if (
    references.mode !== 'exact' ||
    toolName !== TOOL_NAMES.sendUserFile ||
    projection.kind !== 'text' ||
    projection.isError
  )
    return projection;
  const content = readFileDelivery(result);
  if (!content) return projection;
  // The builtin receipt is derived from its typed delivery, never matched
  // against historical text whose saved-output paths may already have moved.
  // Other tools and failure/error projections keep their own model contract.
  const rewritten = rewriteToolResultContent(content, references);
  return encodeDurableToolResultOutput(
    {
      type: 'text',
      value: rewritten.kind === 'text' ? rewritten.text : sendUserFileModelText(rewritten),
    },
    references.targetSessionId,
  );
}

function readFileDelivery(
  value: unknown,
): Extract<ToolResultContent, { kind: 'user_file_delivery' }> | undefined {
  try {
    const content = decodePersistedToolResultContent(markPersisted<ToolResultContent>(value));
    return content.kind === 'user_file_delivery' ? content : undefined;
  } catch {
    return undefined;
  }
}

function rewriteRuntimeToolResult(
  value: unknown,
  references: ConversationCopyMessageReferenceMap,
): unknown {
  let content: ToolResultContent;
  try {
    content = decodePersistedToolResultContent(markPersisted<ToolResultContent>(value));
  } catch {
    // An opaque result names a saved output only in its text.
    return rewriteOpaqueSavedOutputPaths(value, savedOutputRewrite(references));
  }
  return rewriteToolResultContent(content, references);
}

function rewriteArtifactIds(
  artifactIds: readonly string[],
  references: ConversationCopyArtifactReferenceMap,
): readonly string[] {
  return artifactIds.flatMap((artifactId) => {
    const targetArtifactId = reclaimableArtifactReference(artifactId, references);
    return targetArtifactId === undefined ? [] : [targetArtifactId];
  });
}

function validatedExternalChildReferences(
  childSessionId: string,
  references: ConversationCopyMessageReferenceMap,
): ConversationCopyExternalChildReferences | undefined {
  if (references.mode === 'preserve_external') return undefined;
  if (references.linkedChildren.mode === 'snapshot') return undefined;
  if (references.linkedChildren.mode === 'reject') {
    throw new Error(`Conversation copy cannot retain linked child Session ${childSessionId}`);
  }
  const external = references.linkedChildren.references.get(childSessionId);
  if (!external) {
    throw new Error(`Conversation copy is missing linked child Session ${childSessionId}`);
  }
  return external;
}

function linkedChildrenAreSnapshots(references: ConversationCopyMessageReferenceMap): boolean {
  return references.mode === 'exact' && references.linkedChildren.mode === 'snapshot';
}

function rewriteSnapshotArtifactIds(
  artifactIds: readonly string[],
  references: ConversationCopyMessageReferenceMap,
): readonly string[] {
  if (references.mode !== 'exact' || references.linkedChildren.mode !== 'snapshot') {
    return artifactIds;
  }
  return artifactIds.flatMap((artifactId) => {
    const targetArtifactId = references.artifactIds.get(artifactId);
    return targetArtifactId === undefined ? [] : [targetArtifactId];
  });
}

function rewriteLinkedRunId(
  sourceId: string,
  childSessionId: string | undefined,
  references: ConversationCopyMessageReferenceMap,
  kind: string,
): string {
  if (!childSessionId) return rewriteOwnedId(sourceId, references.runIds, kind);
  const external = validatedExternalChildReferences(childSessionId, references);
  return external ? preserveExternalId(sourceId, external.runIds, kind) : sourceId;
}

function rewriteLinkedArtifactIds(
  sourceIds: readonly string[],
  childSessionId: string | undefined,
  references: ConversationCopyMessageReferenceMap,
): readonly string[] {
  if (!childSessionId) return rewriteArtifactIds(sourceIds, references);
  const external = validatedExternalChildReferences(childSessionId, references);
  return external ? preserveExternalIds(sourceIds, external.artifactIds, 'Artifact') : sourceIds;
}

function preserveExternalIds(
  sourceIds: readonly string[],
  externalIds: ReadonlySet<string>,
  kind: string,
): readonly string[] {
  return sourceIds.map((sourceId) => preserveExternalId(sourceId, externalIds, kind));
}

function preserveExternalId(
  sourceId: string,
  externalIds: ReadonlySet<string>,
  kind: string,
): string {
  if (!externalIds.has(sourceId)) {
    throw new Error(`Conversation copy is missing external ${kind} ${sourceId}`);
  }
  return sourceId;
}

function rewriteStorageRef(
  ref: StorageRef,
  references: ConversationCopyArtifactReferenceMap,
): StorageRef {
  if (
    (ref.kind !== 'session_file' && ref.kind !== 'session_context') ||
    ref.sessionId !== references.sourceSessionId
  ) {
    return ref;
  }
  if (references.mode === 'preserve_external') return ref;
  if (ref.kind === 'session_context') {
    const refId = references.contextRefs?.get(ref.refId);
    if (!refId) throw new Error(`Conversation copy is missing Session context ${ref.refId}`);
    return {
      ...ref,
      sessionId: references.targetSessionId,
      refId,
    };
  }
  const artifactId = references.artifactIds.get(ref.relativePath);
  if (artifactId) {
    return {
      ...ref,
      sessionId: references.targetSessionId,
      relativePath: artifactId,
    };
  }
  const relativePath = references.relativePaths.get(ref.relativePath);
  if (!relativePath) {
    throw new Error(`Conversation copy is missing Session file ${ref.relativePath}`);
  }
  return {
    ...ref,
    sessionId: references.targetSessionId,
    relativePath,
  };
}

function rewriteProjectionArtifactRef(
  ref: Extract<StorageRef, { kind: 'session_context' | 'session_file' }>,
  references: ConversationCopyArtifactReferenceMap,
): Extract<StorageRef, { kind: 'session_context' | 'session_file' }> {
  const rewritten = rewriteStorageRef(ref, references);
  if (rewritten.kind !== 'session_context' && rewritten.kind !== 'session_file') {
    throw new Error('Conversation copy produced an invalid projection Artifact reference');
  }
  return rewritten;
}

function messageTurnId(message: StoredMessage): string | undefined {
  return 'turnId' in message && typeof message.turnId === 'string' ? message.turnId : undefined;
}

function conversationCopyTurnClosure(
  runs: readonly RuntimeInvocationRecord[],
  retainedTurnIds: readonly string[],
): string[] {
  const result = [...new Set(retainedTurnIds)];
  const includedTurnIds = new Set(result);
  const includedRunIds = new Set(
    runs.filter((run) => includedTurnIds.has(run.turnId)).map((run) => run.runId),
  );
  for (let changed = true; changed; ) {
    changed = false;
    for (const run of runs) {
      if (
        isSessionInlineInvocation(run.opening) ||
        !run.opening.lineage?.parentRunId ||
        !includedRunIds.has(run.opening.lineage.parentRunId) ||
        includedRunIds.has(run.runId)
      ) {
        continue;
      }
      includedRunIds.add(run.runId);
      if (!includedTurnIds.has(run.turnId)) {
        includedTurnIds.add(run.turnId);
        result.push(run.turnId);
      }
      changed = true;
    }
  }
  return result;
}

function sourceCompactableEventsByRunId(
  plans: readonly {
    readonly run: RuntimeInvocationRecord;
    readonly events: readonly RuntimeEvent[];
  }[],
  sessionEvents: readonly RuntimeEvent[],
): ReadonlyMap<string, readonly RuntimeEvent[]> {
  const plansByRunId = new Map(plans.map((plan) => [plan.run.runId, plan]));
  const inlineEvents = sessionEvents.filter(isHistoryCompactContentEvent);
  const result = new Map<string, readonly RuntimeEvent[]>();

  for (const plan of plans) {
    if (isSessionInlineInvocation(plan.run.opening)) {
      result.set(plan.run.runId, inlineEvents);
      continue;
    }

    const reverseChain = [];
    const visited = new Set<string>();
    let cursor: (typeof plans)[number] | undefined = plan;
    while (cursor) {
      if (visited.has(cursor.run.runId)) {
        throw new Error(
          `Conversation copy child resume lineage contains a cycle at ${cursor.run.runId}`,
        );
      }
      visited.add(cursor.run.runId);
      reverseChain.push(cursor);
      const sourceRunId = cursor.run.opening.lineage?.resumedFromRunId;
      if (!sourceRunId) break;
      cursor = plansByRunId.get(sourceRunId);
      if (!cursor) {
        throw new Error(
          `Conversation copy child resume source ${sourceRunId} crosses the copy boundary`,
        );
      }
    }
    result.set(
      plan.run.runId,
      reverseChain
        .reverse()
        .flatMap((item) => item.events)
        .filter(isHistoryCompactContentEvent),
    );
  }

  return result;
}
