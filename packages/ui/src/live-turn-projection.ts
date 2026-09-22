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
  decodeToolStepProgress,
  type MessageContent,
  type ProviderRetryEvent,
  type SessionEvent,
} from '@maka/core/events';
import type { StoredMessage, UserMessage } from '@maka/core/session';
import type { UiLocale } from '@maka/core/ui-locale';
import { materializeToolResultPreviewForActivity } from '@maka/core/tool-result-preview';
import { applyAssistantComplete, applyAssistantDelta } from './assistant-stream.js';
import { projectToolActivityArgs } from '@maka/core/tool-activity-args';
import { toolResultActivityStatus } from '@maka/core/tool-result-status';
import { isInFlightToolStatus } from '@maka/core/tool-result-status';
import type { ToolActivityItem } from './materialize.js';
import { applyThinkingComplete, applyThinkingDelta } from './thinking-stream.js';
import type { StreamingDisplayRedactionState } from './streaming-display-redaction.js';
import { applyToolInputFragment, openToolInput } from './tool-input-stream.js';
import { applyToolOutputChunk } from './tool-output-stream.js';

type LiveTurnContentEvent = Extract<SessionEvent, { type: 'thinking_delta' | 'thinking_complete' | 'text_delta' | 'text_complete' | 'tool_input_start' | 'tool_start' | 'tool_output_delta' | 'tool_progress' | 'tool_result_preview' | 'tool_result' }>;

/**
 * A provider retry event plus the CLIENT-local time it entered this
 * projection. Counting down from `receivedAtMs` keeps the whole countdown in
 * one clock domain — the event's `ts` is stamped on the (possibly remote)
 * Runtime Host clock, so subtracting it from a client clock would skew the
 * display by the clock offset between the two machines. The countdown length
 * itself comes from the skew-free `remainingMs` duration when the emitter
 * provided one.
 */
export interface LiveProviderRetry {
  event: ProviderRetryEvent;
  receivedAtMs: number;
}

export interface LiveThinkingProjection {
  text: string;
  truncated: boolean;
  complete: boolean;
  /** Raw source length, independent of redaction and display truncation. */
  sourceEndOffset?: number;
  /** Internal bounded state; removed when the stream becomes terminal. */
  redactionState?: StreamingDisplayRedactionState;
}

export interface LiveTurnStepProjection {
  stepId: string;
  contentOrder?: LiveTurnStepContentKind[];

  thinking?: LiveThinkingProjection;
  text?: LiveTextProjection;
  tools: ToolActivityItem[];
}

export type LiveTurnStepContentKind = 'thinking' | 'text' | 'tools';

export interface LiveTextProjection {
  text: string;
  truncated: boolean;
  complete: boolean;
  /** Raw source length, independent of redaction and display truncation. */
  sourceEndOffset?: number;
  /** Internal bounded state; removed when the stream becomes terminal. */
  redactionState?: StreamingDisplayRedactionState;
}

export interface LiveSteeringProjection {
  id: string;
  content: MessageContent;
  ts: number;
  /**
   * Arrival stamp: the interjection renders after everything already on screen
   * when it landed. Absent on a hand-built projection, which renders it last.
   */
  seq?: number;
  /**
   * Who interjected. A background task finishing speaks in the user's role
   * but is not the user, and a live Turn has to know that as surely as the
   * ledger does — otherwise the notification wears the reader's own bubble
   * until the Turn ends and the projection is rebuilt from the ledger.
   */
  author?: 'system';
  origin?: UserMessage['origin'];
}

export interface LiveTurnProjection {
  turnId: string;
  phase: 'waiting' | 'streamed';
  terminal?: true;
  /**
   * Set when this live Turn is a host-owned explicit context-compaction run.
   * A `context_compact` Turn emits no assistant content, so `overlayLiveTurn`
   * renders a single "compacting" system row from this flag while the Turn is in
   * flight; the row disappears when the Turn settles (no durable turn state).
   */
  rootExecutionKind?: 'context_compact';
  /** Event ts of the first authority word about this Turn; a stable ts for the
   *  synthesized "compacting" row so reprojection does not churn identity. */
  startedAt?: number;
  /**
   * Every interjection this Turn has seen, in arrival order. One flat list, not
   * a slot per step: an interjection can land between a step's answer and the
   * tool that same step goes on to call, and a slot only describes a boundary.
   */
  steering?: LiveSteeringProjection[];
  /**
   * Arrival stamp per content item, keyed by `liveContentKey`. Content renders in
   * STEP order, not arrival order, so these do not sort the content — they place
   * the interjections within it.
   */
  contentSeq?: Record<string, number>;
  /** Next value of the monotonic counter that stamps content and steering. */
  nextSeq?: number;
  /**
   * Set by `armLiveTurn` and cleared by the first word the authority says about
   * this turn (`confirmLiveTurn`, or any event carrying the same turnId).
   *
   * A client that just sent cannot tell "the authority has not reached my turn
   * yet" from "my turn is over" by reading session status: it reads the same
   * before a turn starts and after it ends. So a snapshot taken before the send
   * landed would retire the arm the send just placed. This bit says the arm is
   * still waiting for its answer, which is what keeps such a snapshot from
   * settling it. Dropped for good once the answer arrives.
   */
  unconfirmed?: true;
  providerRetry?: LiveProviderRetry;
  steps: LiveTurnStepProjection[];
}

function projectToolActivityIdentity(event: {
  origin?: ToolActivityItem['origin'];
  modelVisibility?: ToolActivityItem['modelVisibility'];
  parentToolCallId?: string;
  parentOperationId?: string;
}): Pick<
  ToolActivityItem,
  'origin' | 'modelVisibility' | 'parentToolCallId' | 'parentOperationId'
> {
  return {
    ...(event.origin !== undefined ? { origin: event.origin } : {}),
    ...(event.modelVisibility !== undefined ? { modelVisibility: event.modelVisibility } : {}),
    ...(event.parentToolCallId !== undefined ? { parentToolCallId: event.parentToolCallId } : {}),
    ...(event.parentOperationId !== undefined ? { parentOperationId: event.parentOperationId } : {}),
  };
}

function terminalizeLiveSteps(steps: readonly LiveTurnStepProjection[]): LiveTurnStepProjection[] {
  // A call whose arguments never finished arriving was never dispatched and left
  // no trace in the ledger. Interrupting it would pin a row the settled
  // transcript has no counterpart for; it simply did not happen.
  return withoutArrivingTools(steps).map((step) => ({
    ...step,
    ...(step.thinking ? { thinking: terminalThinking(step.thinking) } : {}),
    ...(step.text ? { text: terminalText(step.text) } : {}),
    tools: step.tools.map((tool) => (
      isInFlightToolStatus(tool.status) ? { ...tool, status: 'interrupted' as const } : tool
    )),
  }));
}

function terminalThinking(thinking: LiveThinkingProjection): LiveThinkingProjection {
  const { redactionState: _redactionState, ...safe } = thinking;
  return { ...safe, complete: true };
}

function terminalText(text: LiveTextProjection): LiveTextProjection {
  const { redactionState: _redactionState, ...safe } = text;
  return { ...safe, complete: true };
}

function inferredContentOrder(step: LiveTurnStepProjection): LiveTurnStepContentKind[] {
  return [
    ...(step.thinking ? ['thinking' as const] : []),
    ...(step.text ? ['text' as const] : []),
    ...(step.tools.length > 0 ? ['tools' as const] : []),
  ];
}

/**
 * Render identity of one live content item; the tool's is stable while an
 * output-first tool is re-homed. Shared with `timelineItemKey` so a stamp and
 * the row it stamps cannot key differently.
 */
export function liveContentKey(kind: LiveTurnStepContentKind, id: string): string {
  return kind === 'tools' ? `tool\0${id}` : `${kind}\0${id}`;
}

function appendContentKind(
  step: LiveTurnStepProjection,
  kind: LiveTurnStepContentKind,
): LiveTurnStepContentKind[] {
  const order = step.contentOrder ?? inferredContentOrder(step);
  return order.includes(kind) ? order : [...order, kind];
}

export function armLiveTurn(turnId: string): LiveTurnProjection {
  return { turnId, phase: 'waiting', steps: [], unconfirmed: true };
}

/** Drop the `unconfirmed` claim; identity-preserving when there is none. */
function confirmed(projection: LiveTurnProjection): LiveTurnProjection {
  if (!projection.unconfirmed) return projection;
  const { unconfirmed: _unconfirmed, ...rest } = projection;
  return rest;
}

/**
 * The authority answered about `turnId`: clear the arm's pending claim so a
 * later snapshot may retire it. A different turn's answer says nothing about
 * this one, so the projection is returned unchanged (same reference).
 */
export function confirmLiveTurn(
  current: LiveTurnProjection | undefined,
  turnId: string,
): LiveTurnProjection | undefined {
  if (!current || current.turnId !== turnId) return current;
  return confirmed(current);
}

export function applyLiveTurnEvent(
  current: LiveTurnProjection | undefined,
  event: LiveTurnContentEvent,
  locale: UiLocale,
): LiveTurnProjection;
export function applyLiveTurnEvent(
  current: LiveTurnProjection | undefined,
  event: SessionEvent,
  locale: UiLocale,
): LiveTurnProjection | undefined;
export function applyLiveTurnEvent(
  current: LiveTurnProjection | undefined,
  event: SessionEvent,
  locale: UiLocale,
): LiveTurnProjection | undefined {
  if (event.type === 'steering_message') {
    const prior = current?.turnId === event.turnId
      ? current
      : { turnId: event.turnId, phase: 'waiting' as const, steps: [] };
    if (liveSteeringMessages(prior).some((message) => message.id === event.messageId)) {
      return confirmed(prior);
    }
    const seq = prior.nextSeq ?? 0;
    return {
      ...confirmed(prior),
      nextSeq: seq + 1,
      steering: [
        ...(prior.steering ?? []),
        {
          id: event.messageId,
          content: structuredClone(event.content),
          ts: event.ts,
          seq,
          ...(event.author ? { author: event.author } : {}),
          ...(event.origin ? { origin: structuredClone(event.origin) } : {}),
        },
      ],
    };
  }
  if (event.type === 'provider_retry') {
    const prior = current?.turnId === event.turnId
      ? current
      : { turnId: event.turnId, phase: 'waiting' as const, steps: [] };
    // The attempt that was writing these calls is being taken from the top, so
    // a call it had half-written will never be dispatched and never reach the
    // ledger. Left alone the row shimmers as a running call, with arguments
    // that stop mid-word, for the rest of the Turn.
    return {
      ...confirmed(prior),
      steps: withoutArrivingTools(prior.steps),
      providerRetry: { event, receivedAtMs: Date.now() },
    };
  }
  if (event.type === 'error' || event.type === 'abort') {
    if (!current || current.turnId !== event.turnId) return current;
    const steps = terminalizeLiveSteps(current.steps);
    if (steps.length === 0 && liveSteeringMessages(current).length === 0) return undefined;
    const { providerRetry: _providerRetry, ...withoutRetry } = confirmed(current);
    return { ...withoutRetry, terminal: true, steps };
  }
  if (event.type === 'complete') {
    if (!current || current.turnId !== event.turnId) return current;
    // Decided on the terminalized steps, as abort and error are: terminalizing
    // drops a call whose arguments never finished arriving, so a Turn whose only
    // step was one of those has nothing left and must not linger as a husk.
    const steps = terminalizeLiveSteps(current.steps);
    if (steps.length === 0 && liveSteeringMessages(current).length === 0) return undefined;
    const { providerRetry: _providerRetry, ...withoutRetry } = confirmed(current);
    return { ...withoutRetry, terminal: true, steps };
  }
  if (event.type === 'context_compaction_started') {
    const prior =
      current?.turnId === event.turnId
        ? current
        : { turnId: event.turnId, phase: 'waiting' as const, steps: [] };
    return { ...confirmed(prior), rootExecutionKind: 'context_compact', startedAt: event.ts };
  }
  if (
    event.type !== 'thinking_delta'
    && event.type !== 'thinking_complete'
    && event.type !== 'text_delta'
    && event.type !== 'text_complete'
    && event.type !== 'tool_input_start'
    && event.type !== 'tool_input_delta'
    && event.type !== 'tool_start'
    && event.type !== 'tool_output_delta'
    && event.type !== 'tool_progress'
    && event.type !== 'tool_result_preview'
    && event.type !== 'tool_result'
  ) {
    return current;
  }
  // A fragment needs a stream still open to continue: a client that joined
  // mid-stream has no head for it, and a broken one has no way back. Answered
  // here so neither can conjure a step, or a Turn, and so a broken stream costs
  // nothing per fragment for the rest of the call.
  if (event.type === 'tool_input_delta') {
    const open = current?.turnId === event.turnId
      && current.steps.some((step) => step.tools.some((tool) =>
        tool.toolUseId === event.toolUseId && tool.input !== undefined && !tool.input.broken));
    if (!open) return current;
  }
  const prior = current?.turnId === event.turnId
    ? current
    : { turnId: event.turnId, phase: 'streamed' as const, steps: [] };
  const { providerRetry: _providerRetry, ...priorWithoutRetry } = confirmed(prior);
  const messageEvent = event.type === 'thinking_delta'
    || event.type === 'thinking_complete'
    || event.type === 'text_delta'
    || event.type === 'text_complete';
  const existingToolStep = event.type === 'tool_start'
    || event.type === 'tool_input_start'
    || event.type === 'tool_input_delta'
    || event.type === 'tool_output_delta'
    || event.type === 'tool_progress'
    || event.type === 'tool_result_preview'
    || event.type === 'tool_result'
    ? prior.steps.find((candidate) => candidate.tools.some((tool) => tool.toolUseId === event.toolUseId))
    : undefined;
  const stepId = messageEvent
    ? event.messageId
    : event.type === 'tool_start' || event.type === 'tool_input_start'
      ? event.stepId ?? existingToolStep?.stepId ?? `tool:${event.toolUseId}`
      : existingToolStep?.stepId ?? `tool:${event.toolUseId}`;
  const stepIndex = prior.steps.findIndex((step) => step.stepId === stepId);
  const isNewStep = stepIndex < 0;
  const step: LiveTurnStepProjection = isNewStep
    ? { stepId, tools: [] }
    : prior.steps[stepIndex]!;
  let nextStep: LiveTurnStepProjection;
  if (event.type === 'thinking_delta') {
    const delta = replaySafeDelta(step.thinking?.sourceEndOffset, event);
    const applied = applyThinkingDelta(step.thinking?.text ?? '', delta.text, {
      locale,
      ...(step.thinking?.redactionState === undefined
        ? {}
        : { redactionState: step.thinking.redactionState }),
    });
    nextStep = {
      ...step,
      thinking: {
        text: applied.text,
        truncated: (step.thinking?.truncated ?? false) || applied.truncated,
        complete: false,
        ...(delta.sourceEndOffset === undefined
          ? {}
          : { sourceEndOffset: delta.sourceEndOffset }),
        ...(applied.redactionState === undefined
          ? {}
          : { redactionState: applied.redactionState }),
      },
    };
  } else if (event.type === 'thinking_complete') {
    const applied = applyThinkingComplete(event.text, { locale });
    nextStep = {
      ...step,
      thinking: {
        text: applied.text,
        truncated: applied.truncated,
        complete: true,
        ...(step.thinking?.sourceEndOffset === undefined
          ? {}
          : { sourceEndOffset: event.text.length }),
      },
    };
  } else if (event.type === 'text_delta') {
    const delta = replaySafeDelta(step.text?.sourceEndOffset, event);
    const applied = applyAssistantDelta(step.text?.text ?? '', delta.text, {
      locale,
      ...(step.text?.redactionState === undefined
        ? {}
        : { redactionState: step.text.redactionState }),
    });
    nextStep = {
      ...step,
      text: {
        text: applied.text,
        truncated: (step.text?.truncated ?? false) || applied.truncated,
        complete: false,
        ...(delta.sourceEndOffset === undefined
          ? {}
          : { sourceEndOffset: delta.sourceEndOffset }),
        ...(applied.redactionState === undefined
          ? {}
          : { redactionState: applied.redactionState }),
      },
    };
  } else if (event.type === 'text_complete') {
    const applied = applyAssistantComplete(event.text, { locale });
    nextStep = {
      ...step,
      text: {
        text: applied.text,
        truncated: applied.truncated,
        complete: true,
        ...(step.text?.sourceEndOffset === undefined
          ? {}
          : { sourceEndOffset: event.text.length }),
      },
    };
  } else if (event.type === 'tool_input_start') {
    // Named, argument-less. `input` is what says so, and `tool_start` removes it.
    // It only ever OPENS a row: a second one for a call already on screen —
    // redelivered, or reordered behind its own dispatch — would reopen a stream
    // at offset zero and read every fragment after it as a hole.
    if (existingToolStep) return current;
    const arriving: ToolActivityItem = {
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      ...(event.activityKind !== undefined ? { activityKind: event.activityKind } : {}),
      ...(event.displayName !== undefined ? { displayName: event.displayName } : {}),
      ...projectToolActivityIdentity(event),
      ...(event.stepId !== undefined ? { stepId: event.stepId } : {}),
      status: 'running',
      args: undefined,
      input: openToolInput(),
    };
    nextStep = { ...step, tools: [...step.tools, arriving] };
  } else if (event.type === 'tool_input_delta') {
    const toolIndex = step.tools.findIndex((candidate) => candidate.toolUseId === event.toolUseId);
    const base = step.tools[toolIndex]!;
    const input = applyToolInputFragment(base.input!, event, base.toolName);
    const { argsPreview: _stale, ...withoutReading } = base;
    const tool: ToolActivityItem = {
      ...withoutReading,
      input,
      ...(input.preview === undefined ? {} : { argsPreview: input.preview }),
    };
    nextStep = {
      ...step,
      tools: step.tools.map((candidate, index) => index === toolIndex ? tool : candidate),
    };
  } else if (event.type === 'tool_start') {
    const startedTool: ToolActivityItem = {
      toolUseId: event.toolUseId,
      toolName: event.toolName,
      ...(event.activityKind !== undefined ? { activityKind: event.activityKind } : {}),
      ...(event.displayName !== undefined ? { displayName: event.displayName } : {}),
      ...(event.intent !== undefined ? { intent: event.intent } : {}),
      ...(event.argsPreview !== undefined ? { argsPreview: event.argsPreview } : {}),
      ...projectToolActivityIdentity(event),
      ...(event.stepId !== undefined ? { stepId: event.stepId } : {}),
      status: 'running',
      args: projectToolActivityArgs(event.toolName, event.args),
    };
    const existingTool = existingToolStep?.tools.find((candidate) => candidate.toolUseId === event.toolUseId);
    const tool: ToolActivityItem = existingTool
      ? { ...existingTool, ...startedTool, status: existingTool.status }
      : startedTool;
    const toolIndex = step.tools.findIndex((candidate) => candidate.toolUseId === event.toolUseId);
    // The arguments are here in full, so the partial reading goes with them.
    const settleArrival = (candidate: ToolActivityItem): ToolActivityItem => {
      const { input: _input, argsPreview: _argsPreview, ...settled } = candidate;
      return event.argsPreview === undefined
        ? settled
        : { ...settled, argsPreview: event.argsPreview };
    };
    nextStep = {
      ...step,
      tools: toolIndex >= 0
        ? step.tools.map((candidate, index) =>
          index === toolIndex ? settleArrival({ ...candidate, ...tool }) : candidate)
        : [...step.tools, settleArrival(tool)],
    };
  } else if (event.type === 'tool_output_delta') {
    const toolIndex = step.tools.findIndex((candidate) => candidate.toolUseId === event.toolUseId);
    const base: ToolActivityItem = toolIndex >= 0
      ? step.tools[toolIndex]!
      : { toolUseId: event.toolUseId, toolName: 'Tool', status: 'running', args: undefined };
    const applied = applyToolOutputChunk(base.outputChunks, {
      seq: event.seq,
      stream: event.stream,
      text: event.chunk,
      redacted: event.redacted,
      createdAt: event.createdAt,
    }, { locale });
    const tool: ToolActivityItem = {
      ...base,
      ...projectToolActivityIdentity(event),
      status: base.status,
      outputChunks: applied.chunks,
      outputTruncated: base.outputTruncated || applied.truncated,
    };
    nextStep = {
      ...step,
      tools: toolIndex >= 0
        ? step.tools.map((candidate, index) => index === toolIndex ? tool : candidate)
        : [...step.tools, tool],
    };
  } else if (event.type === 'tool_progress') {
    const toolIndex = step.tools.findIndex((candidate) => candidate.toolUseId === event.toolUseId);
    const base: ToolActivityItem = toolIndex >= 0
      ? step.tools[toolIndex]!
      : { toolUseId: event.toolUseId, toolName: 'Tool', status: 'running', args: undefined };
    const progress = decodeToolStepProgress(event.chunk);
    const tool: ToolActivityItem = {
      ...base,
      ...projectToolActivityIdentity(event),
      status: isInFlightToolStatus(base.status) ? 'running' : base.status,
      ...(progress ? { progress } : {}),
    };
    nextStep = {
      ...step,
      tools: toolIndex >= 0
        ? step.tools.map((candidate, index) => index === toolIndex ? tool : candidate)
        : [...step.tools, tool],
    };
  } else if (event.type === 'tool_result_preview') {
    // Live-only open-facts: materialize into activity.result with empty bulk
    // so ToolTrow can Open without dual storage.
    const toolIndex = step.tools.findIndex((candidate) => candidate.toolUseId === event.toolUseId);
    const base: ToolActivityItem = toolIndex >= 0
      ? step.tools[toolIndex]!
      : { toolUseId: event.toolUseId, toolName: 'Tool', status: 'running', args: undefined };
    const tool: ToolActivityItem = {
      ...base,
      ...projectToolActivityIdentity(event),
      status: isInFlightToolStatus(base.status) ? 'running' : base.status,
      result: materializeToolResultPreviewForActivity(event.content),
    };
    nextStep = {
      ...step,
      tools: toolIndex >= 0
        ? step.tools.map((candidate, index) => index === toolIndex ? tool : candidate)
        : [...step.tools, tool],
    };
  } else {
    const toolIndex = step.tools.findIndex((candidate) => candidate.toolUseId === event.toolUseId);
    const base: ToolActivityItem = toolIndex >= 0
      ? step.tools[toolIndex]!
      : { toolUseId: event.toolUseId, toolName: 'Tool', status: 'running', args: undefined };
    const tool: ToolActivityItem = {
      ...base,
      ...projectToolActivityIdentity(event),
      status: toolResultActivityStatus(event.isError, event.content),
      result: event.contentOmitted ? base.result : event.content,
      // Unconditional: the failure envelope is not the result body and an
      // omitted-content frame carries it in full. This is what lets a live row
      // say why it failed instead of only that it did.
      ...(event.failure ? { failure: event.failure } : {}),
      ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
    };
    nextStep = {
      ...step,
      tools: toolIndex >= 0
        ? step.tools.map((candidate, index) => index === toolIndex ? tool : candidate)
        : [...step.tools, tool],
    };
  }
  const contentKind: LiveTurnStepContentKind = messageEvent
    ? event.type === 'thinking_delta' || event.type === 'thinking_complete' ? 'thinking' : 'text'
    : 'tools';
  nextStep = {
    ...nextStep,
    contentOrder: appendContentKind(step, contentKind),
  };
  // Stamp the item the first time it is seen, and never again: what a reader
  // saw before an interjection landed does not change when more of it arrives,
  // and an output-first tool keeps the moment it appeared even after it is
  // re-homed into the step that finally claims it.
  const contentKey = liveContentKey(contentKind, messageEvent ? stepId : event.toolUseId);
  const alreadyStamped = priorWithoutRetry.contentSeq?.[contentKey] !== undefined;
  const arrivalSeq = priorWithoutRetry.nextSeq ?? 0;
  const arrival = alreadyStamped
    ? {}
    : {
        nextSeq: arrivalSeq + 1,
        contentSeq: { ...(priorWithoutRetry.contentSeq ?? {}), [contentKey]: arrivalSeq },
      };
  let steps: LiveTurnStepProjection[];
  if (existingToolStep && existingToolStep.stepId !== stepId && !messageEvent) {
    const sourceIndex = prior.steps.findIndex((candidate) => candidate.stepId === existingToolStep.stepId);
    const sourceWithoutTool = {
      ...existingToolStep,
      tools: existingToolStep.tools.filter((tool) => tool.toolUseId !== event.toolUseId),
    };
    if (sourceWithoutTool.tools.length === 0 && sourceWithoutTool.contentOrder) {
      sourceWithoutTool.contentOrder = sourceWithoutTool.contentOrder.filter((kind) => kind !== 'tools');
    }
    const sourceIsEmpty = !sourceWithoutTool.thinking
      && !sourceWithoutTool.text
      && sourceWithoutTool.tools.length === 0;
    steps = [];
    for (let index = 0; index < prior.steps.length; index += 1) {
      const candidate = prior.steps[index]!;
      if (index === sourceIndex) {
        if (!sourceIsEmpty) steps.push(sourceWithoutTool);
        if (stepIndex < 0 && sourceIsEmpty) steps.push(nextStep);
      } else if (index === stepIndex) {
        steps.push(nextStep);
      } else {
        steps.push(candidate);
      }
    }
    if (stepIndex < 0 && !sourceIsEmpty) steps.push(nextStep);
  } else {
    steps = stepIndex >= 0
      ? prior.steps.map((candidate, index) => index === stepIndex ? nextStep : candidate)
      : [...prior.steps, nextStep];
  }
  return {
    ...priorWithoutRetry,
    ...arrival,
    phase: 'streamed',
    steps,
  };
}

/**
 * Drop every call whose arguments were still arriving, and any step left with
 * nothing. Used where an attempt is abandoned: such a call was never dispatched
 * and has no counterpart in the transcript to hand over to.
 */
function withoutArrivingTools(
  steps: readonly LiveTurnStepProjection[],
): LiveTurnStepProjection[] {
  return steps.flatMap((step) => {
    // `input` alone does not say the call was never dispatched: only `tool_start`
    // clears it, and a client that missed that one frame — shed behind a
    // backlog, or evicted and resubscribed across it — still carries it on a
    // call that ran and returned. Evidence of running wins over its absence,
    // and a settled STATUS is the strongest of it: a live `tool_result` carries
    // status without a body (the Host omits the content and the client rebuilds
    // it as `contentOmitted`), so asking for the body instead threw away the
    // whole row — and with it the step, and with it the Turn.
    const tools = step.tools.filter((tool) =>
      tool.input === undefined ||
      !isInFlightToolStatus(tool.status) ||
      tool.result !== undefined ||
      (tool.outputChunks?.length ?? 0) > 0);
    if (tools.length === step.tools.length) return [step];
    const next: LiveTurnStepProjection = { ...step, tools };
    if (tools.length === 0 && next.contentOrder) {
      next.contentOrder = next.contentOrder.filter((kind) => kind !== 'tools');
    }
    return next.thinking || next.text || next.tools.length > 0 ? [next] : [];
  });
}

function liveSteeringMessages(current: LiveTurnProjection): LiveSteeringProjection[] {
  return current.steering ?? [];
}

function replaySafeDelta(
  currentEndOffset: number | undefined,
  event: Extract<SessionEvent, { type: 'text_delta' | 'thinking_delta' }>,
): { text: string; sourceEndOffset?: number } {
  if (event.startOffset === undefined) {
    return {
      text: event.text,
      ...(currentEndOffset === undefined
        ? {}
        : { sourceEndOffset: currentEndOffset + event.text.length }),
    };
  }
  const endOffset = event.startOffset + event.text.length;
  if (currentEndOffset === undefined || event.startOffset > currentEndOffset) {
    return { text: event.text, sourceEndOffset: endOffset };
  }
  const overlapLength = Math.min(currentEndOffset - event.startOffset, event.text.length);
  return {
    text: event.text.slice(overlapLength),
    sourceEndOffset: Math.max(currentEndOffset, endOffset),
  };
}

/**
 * Streaming display handoff: drop the committed text/thinking slots for `stepId`.
 * Tools that still carry live stream evidence (outputChunks) stay — empty
 * shell_run durable results do not cover them, and co-located Bash+answer
 * steps must not lose pre-handoff output when the answer settles.
 */
export function settleLiveTurnStep(
  current: LiveTurnProjection,
  stepId: string,
): LiveTurnProjection | undefined {
  const stepIndex = current.steps.findIndex((step) => step.stepId === stepId);
  if (stepIndex < 0) return current;
  const step = current.steps[stepIndex]!;
  const retainedTools = step.tools.filter((tool) => (tool.outputChunks?.length ?? 0) > 0);
  const steps = retainedTools.length > 0
    ? current.steps.map((candidate, index) => (
      index === stepIndex
        ? {
            stepId: candidate.stepId,
            tools: retainedTools,
            contentOrder: ['tools' as const],
          }
        : candidate
    ))
    : current.steps.filter((candidate) => candidate.stepId !== stepId);
  if (steps.length === current.steps.length && retainedTools.length === 0) return current;
  if (steps.length === 0 && current.terminal) return undefined;
  return { ...current, steps };
}

/**
 * True when a persisted tool_result can replace live stream evidence for the
 * same toolUseId. Empty shell_run/terminal bodies do not cover live chunks —
 * background Bash returns an empty shell_run while live output is the only
 * evidence the user already saw.
 */
function durableStreamEvidence(
  messages: readonly StoredMessage[],
  toolUseId: string,
): boolean {
  for (const message of messages) {
    if (message.type !== 'tool_result' || message.toolUseId !== toolUseId) continue;
    const content = message.content;
    if (!content || typeof content !== 'object') return true;
    if (content.kind === 'terminal' || content.kind === 'shell_run') {
      const output = content.output;
      if (!output) return false;
      return output.mode === 'pty'
        ? true
        : output.stdout.length > 0
          || output.stderr.length > 0
          || output.stdoutTruncated
          || output.stderrTruncated
          || output.redacted;
    }
    return true;
  }
  return false;
}

/**
 * Removes evidence-only steps once the persisted transcript can render the
 * same durable output, including while a later step is still running. Text
 * steps remain owned by the streaming renderer, whose completion callback performs
 * their handoff after the tail is visible.
 */
export function reconcileTerminalLiveTurn(
  current: LiveTurnProjection,
  messages: readonly StoredMessage[],
): LiveTurnProjection | undefined {
  const turnMessages = messages.filter((message) => message.turnId === current.turnId);
  const transcriptReachedTerminal = turnMessages.some(
    (message) => message.type === 'turn_state' && message.status !== 'running',
  );
  let projection = current;
  if (transcriptReachedTerminal && current.terminal !== true) {
    const { providerRetry: _providerRetry, ...withoutRetry } = confirmed(current);
    projection = {
      ...withoutRetry,
      terminal: true,
      steps: terminalizeLiveSteps(current.steps),
    };
  }
  if (
    projection.terminal === true
    && liveSteeringMessages(projection).length > 0
    && !transcriptReachedTerminal
  ) return projection;
  const assistantIds = new Set(turnMessages.flatMap((message) => message.type === 'assistant' ? [message.id] : []));
  const toolCallIds = new Set(turnMessages.flatMap((message) => message.type === 'tool_call' ? [message.id] : []));
  const toolResultIds = new Set(turnMessages.flatMap((message) => message.type === 'tool_result' ? [message.toolUseId] : []));
  let steps = projection.steps.filter((step) => {
    if (step.text?.text.length) return true;
    if (step.thinking && !assistantIds.has(step.stepId)) return true;
    const toolsCovered = step.tools.every((tool) => {
      if (!toolCallIds.has(tool.toolUseId)) return false;
      const hasResult = toolResultIds.has(tool.toolUseId);
      // Live stream evidence only hands off when durable result has streams/meta.
      if (tool.outputChunks?.length) {
        if (!hasResult) return false;
        if (!durableStreamEvidence(turnMessages, tool.toolUseId)) return false;
      }
      return tool.status === 'interrupted' || hasResult;
    });
    return !toolsCovered;
  });
  // Once persisted turn_state records the terminal handoff, the transcript is
  // authoritative for accepted steering; retaining the live copy would leave
  // a duplicate or a nacked ghost instruction on screen.
  const steeringSettled = projection.terminal === true
    && transcriptReachedTerminal
    && liveSteeringMessages(projection).length > 0;
  if (
    steps.length === 0
    && projection.terminal
    && (
      projection.rootExecutionKind === 'context_compact'
      || transcriptReachedTerminal
      || steps.length !== projection.steps.length
    )
  ) return undefined;
  if (steps.length === projection.steps.length && !steeringSettled) return projection;
  if (!steeringSettled) return { ...projection, steps };
  const { steering: _steering, ...withoutSteering } = projection;
  return { ...withoutSteering, steps };
}
