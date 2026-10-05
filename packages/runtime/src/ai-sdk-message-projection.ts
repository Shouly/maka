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

import type { AttachmentRef, DirectoryReference, QuoteRef, StorageRef } from '@maka/core/events';
import type { AttachmentByteReader, AttachmentSizeReader } from '@maka/core/attachments';
import type { DurableToolResultProjection } from '@maka/core/durable-tool-result-projection';
import {
  applyPatchReplayFactText,
  normalizeApplyPatchReplayInput,
  type ApplyPatchProfile,
} from './apply-patch-profile.js';
import { durableProjectionToToolResultOutput } from './durable-tool-result-projection.js';
import { TOOL_SEARCH_NAME } from './tool-availability.js';
import {
  historyCompactCheckpointToModelMessage,
  isProviderHistoryCompactCheckpoint,
  type HistoryCompactCheckpoint,
} from './history-compact-checkpoint.js';
import {
  admitProviderReasoningReplayItems,
  buildRuntimeEventReplayTimeline,
  formatTextWithInlineRefs,
  steeringProviderOptions,
  type RuntimeEventModelReplayItem,
  type RuntimeEventModelReplayPlan,
  type RuntimeEventReplayToolExchange,
  type RuntimeEventReplayToolResultItem,
} from './model-history.js';
import type { ModelAdapter } from './model-adapter.js';
import type {
  FilePart,
  ModelMessage,
  ReasoningPart,
  TextPart,
  ToolResultContentPart,
  ToolResultOutput,
  UserContent,
} from './model-protocol.js';
import { openAiChatReasoningFieldFromProviderOptions } from './openai-chat-reasoning-transport.js';
import {
  countRemovedProviderRequestImages,
  deferredImagePart,
  deferredToolResultImagePart,
  dropDeferredImages,
  limitProviderRequestImages,
  providerImageAttachmentTooLargeMessage,
  providerImageRemovedMessage,
  providerImageRequestLimits,
  providerImageTooLargeMessage,
  resolveDeferredImages,
  type DeferredImageData,
  type ProviderImageRequestLimits,
} from './provider-image-limits.js';
import {
  decodePlaintextResponsesReasoningState,
  replayPlaintextResponsesProviderOptions,
} from './responses-reasoning-state.js';
import { toolResultOutput } from './tool-result-output.js';
import {
  appendUserMessageBlocks,
  prependUserMessageBlocks,
} from './injection/user-message-injections.js';

export interface AiSdkMessageProjectionInput {
  modelAdapter: ModelAdapter;
  applyPatchProfile: ApplyPatchProfile | null;
  /**
   * Native deferral only. A `ToolSearch` result is what holds a deferred tool
   * open for the rest of the conversation, and Runtime rebuilds the history
   * every turn — replayed as plain json the result says nothing to the
   * provider, and from the second turn on the model is blind to everything it
   * already found. Given what a past search activated, this answers with the
   * names that may be pointed at again; `undefined` means this wire has no
   * such notion and the result replays unchanged.
   *
   * Names are filtered, not trusted: a reference to a tool that is no longer
   * bound is a 400, not a stale row, and the tool set does change under a
   * conversation (a Plugin generation, a Profile switch).
   */
  replayToolSearchReferences?: (activated: readonly string[]) => readonly string[] | undefined;
  supportsVision?: boolean;
  readAttachmentBytes?: AttachmentByteReader;
  /**
   * Looks up a stored tool image's size without reading it, so the image is
   * read only if a request sends it. Without it, tool images are read when
   * their result is materialized.
   */
  readAttachmentSize?: AttachmentSizeReader;
  maxProviderImageRequestBytes?: number;
  maxProviderImageRequestCount?: number;
}

function isImageToolResult(
  value: unknown,
): value is { kind: 'image'; mimeType: string; ref: StorageRef } {
  if (!value || typeof value !== 'object') return false;
  const image = value as { kind?: unknown; mimeType?: unknown; ref?: unknown };
  return (
    image.kind === 'image' &&
    typeof image.mimeType === 'string' &&
    image.ref !== null &&
    typeof image.ref === 'object'
  );
}

function toolResultText(text: string): ToolResultOutput {
  return { type: 'content', value: [{ type: 'text', text }] };
}

/**
 * Replay a `ToolSearch` result as the references it was: the provider expands a
 * deferred tool from the reference in the transcript, so a replay that drops
 * them takes the tool away again.
 *
 * A search that activated nothing, or one whose tools have all since gone,
 * replays as it was — there is nothing to point at, and an empty content array
 * is not a result.
 */
export function replayToolSearchOutput(
  output: ToolResultOutput,
  resolve: AiSdkMessageProjectionInput['replayToolSearchReferences'],
): ToolResultOutput {
  if (!resolve || output.type !== 'json') return output;
  const value = output.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  const activated = (value as { activated?: unknown }).activated;
  if (!Array.isArray(activated)) return output;
  const names = resolve(activated.filter((name): name is string => typeof name === 'string'));
  if (names === undefined || names.length === 0) return output;
  return {
    type: 'content',
    value: names.map((toolName) => ({
      type: 'custom' as const,
      providerOptions: { anthropic: { type: 'tool-reference', toolName } },
    })),
  };
}

function nativeApplyPatchFailureOutput(output: ToolResultOutput): ToolResultOutput {
  const value = output.type === 'json' || output.type === 'error-json' ? output.value : undefined;
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  const message =
    output.type === 'text' || output.type === 'error-text'
      ? output.value
      : typeof record?.output === 'string'
        ? record.output
        : typeof record?.text === 'string'
          ? record.text
          : typeof record?.error === 'string'
            ? record.error
            : undefined;
  return {
    type: 'json',
    value: { status: 'failed', ...(message ? { output: message } : {}) },
  };
}

function durableApplyPatchReplayFactText(
  input: unknown,
  projection: DurableToolResultProjection,
  isError: boolean,
): string | null {
  if (projection.kind === 'json') {
    const fact = applyPatchReplayFactText(input, projection, isError);
    if (fact) return fact;
  }
  const output = durableProjectionToToolResultOutput(projection);
  switch (output.type) {
    case 'text':
    case 'error-text':
      return output.value;
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value);
    case 'content': {
      const text = output.value
        .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      return text || null;
    }
    case 'execution-denied':
      return output.reason
        ? `ApplyPatch execution denied: ${output.reason}`
        : 'ApplyPatch execution denied.';
  }
}

/**
 * Projects canonical Runtime history and current user input into provider
 * messages. It owns no execution state; its only mutable data is the weak
 * event index attached to the messages it creates.
 */
export class AiSdkMessageProjection {
  private readonly memoryReplayMessageEvents = new WeakMap<ModelMessage, readonly string[]>();
  private readonly imageLimits: ProviderImageRequestLimits;

  constructor(private readonly input: AiSdkMessageProjectionInput) {
    this.imageLimits = providerImageRequestLimits({
      maxImages: input.maxProviderImageRequestCount,
      maxBytes: input.maxProviderImageRequestBytes,
    });
  }

  /**
   * Keep a request within what it may carry in images by removing the oldest
   * ones, a batch at a time (see `providerImageWindowStart`). Applied to the
   * request before any stage shapes it, so every stage and every later step
   * works on the same images, and again as it goes out, by
   * `prepareRequestImages`.
   */
  limitRequestImages(messages: readonly ModelMessage[]): {
    messages: ModelMessage[];
    removedImages: number;
  } {
    return limitProviderRequestImages(messages, this.imageLimits);
  }

  /** How many images `limitRequestImages` would remove from these messages. */
  countRemovedRequestImages(messages: readonly ModelMessage[]): number {
    return countRemovedProviderRequestImages(messages, this.imageLimits);
  }

  /**
   * Read the stored images these messages would still send, leaving the ones
   * before their window deferred and counted by recorded size. Meant for the
   * prior history, the prefix every request of a send repeats: its images are
   * then read once per send, not once per request, and a later request's
   * window starts no earlier than this one.
   */
  async readWindowImages(messages: readonly ModelMessage[]): Promise<ModelMessage[]> {
    return await resolveDeferredImages(
      messages,
      (image, mediaType) => this.readDeferredImage(image, mediaType),
      countRemovedProviderRequestImages(messages, this.imageLimits),
    );
  }

  /**
   * The request as it goes out: limited once more, which changes nothing
   * already limited and limits a fold's replacement, materialized afresh; then
   * the stored images it still carries are read. Those were chosen by their
   * recorded size; a recorded size below the stored one is caught by a last
   * limit, on what was read. Nothing deferred goes out.
   */
  async prepareRequestImages(messages: readonly ModelMessage[]): Promise<{
    messages: ModelMessage[];
    removedImages: number;
  }> {
    const limited = limitProviderRequestImages(messages, this.imageLimits);
    const resolved = await resolveDeferredImages(limited.messages, (image, mediaType) =>
      this.readDeferredImage(image, mediaType),
    );
    const relimited = resolved.every((message, index) => message === limited.messages[index])
      ? { messages: resolved, removedImages: 0 }
      : limitProviderRequestImages(resolved, this.imageLimits);
    return {
      messages: dropDeferredImages(
        relimited.messages,
        providerImageRemovedMessage(this.imageLimits),
      ),
      removedImages: limited.removedImages + relimited.removedImages,
    };
  }

  /**
   * Read a stored image for the request that sends it. An attachment goes out
   * as bytes in the user's message; a tool's image as base64 in its result.
   */
  private async readDeferredImage(
    image: DeferredImageData,
    mediaType: string,
  ): Promise<TextPart | FilePart> {
    let read: Awaited<ReturnType<AttachmentByteReader>>;
    try {
      read = (await this.input.readAttachmentBytes?.(image.ref)) ?? {
        ok: false,
        reason: 'unavailable',
      };
    } catch {
      read = { ok: false, reason: 'read_failed' };
    }
    if (image.source === 'tool_result') {
      if (!read.ok) {
        return {
          type: 'text',
          text: `Image could not be loaded from artifact storage: ${read.reason}.`,
        };
      }
      if (read.bytes.length > this.imageLimits.maxBytes) {
        return { type: 'text', text: providerImageTooLargeMessage(this.imageLimits) };
      }
      return {
        type: 'file',
        data: { type: 'data', data: Buffer.from(read.bytes).toString('base64') },
        mediaType,
      };
    }
    if (!read.ok) {
      return {
        type: 'text',
        text: `Image attachment "${image.name}" could not be loaded: ${read.reason}.`,
      };
    }
    if (read.bytes.length > this.imageLimits.maxBytes) {
      return {
        type: 'text',
        text: providerImageAttachmentTooLargeMessage(image.name, this.imageLimits),
      };
    }
    return { type: 'file', data: { type: 'data', data: read.bytes }, mediaType };
  }

  /**
   * An image a tool returned, as its result carries it. With its stored size
   * known it is deferred like an attachment and read only by the request that
   * sends it; without a size lookup it is read now.
   */
  private async toolResultImagePart(
    ref: StorageRef,
    mediaType: string,
  ): Promise<TextPart | Extract<ToolResultContentPart, { type: 'file' }>> {
    if (this.input.readAttachmentSize) {
      let size: Awaited<ReturnType<AttachmentSizeReader>>;
      try {
        size = await this.input.readAttachmentSize(ref);
      } catch {
        size = { ok: false, reason: 'read_failed' };
      }
      if (!size.ok) {
        return {
          type: 'text',
          text: `Image could not be loaded from artifact storage: ${size.reason}.`,
        };
      }
      if (size.bytes > this.imageLimits.maxBytes) {
        return { type: 'text', text: providerImageTooLargeMessage(this.imageLimits) };
      }
      if (Number.isFinite(size.bytes) && size.bytes > 0) {
        return deferredToolResultImagePart(ref, mediaType, size.bytes);
      }
    }
    const read = await this.readDeferredImage(
      { type: 'deferred', source: 'tool_result', ref, bytes: 0 },
      mediaType,
    );
    return read as TextPart | Extract<ToolResultContentPart, { type: 'file' }>;
  }

  canReplayProviderNative(plan: RuntimeEventModelReplayPlan): boolean {
    const support = this.input.modelAdapter.runtimeEventReplaySupport();
    for (const item of plan.items) {
      if (item.kind === 'tool_call' && !support.toolCalls) return false;
      if (item.kind === 'tool_result' && !support.toolResults) return false;
      if (
        (item.kind === 'tool_call' || item.kind === 'tool_result') &&
        item.providerExecuted === true &&
        !support.providerExecutedTools
      ) {
        return false;
      }
      if (item.kind === 'thinking' && item.signature && !support.signedThinking) return false;
    }
    return true;
  }

  /**
   * Per-item counterpart to {@link canReplayProviderNative}: drop only the
   * items the adapter cannot represent so one unsupported provider-executed
   * pair does not cost unrelated client tool history (#2972). Call and result
   * items fall together — a call without its result is a dangling wire item,
   * and provider-executed pairs are flagged on both items by the plan.
   */
  dropUnsupportedReplayItems(plan: RuntimeEventModelReplayPlan): RuntimeEventModelReplayPlan {
    const support = this.input.modelAdapter.runtimeEventReplaySupport();
    return {
      ...plan,
      items: plan.items.filter((item) => {
        if (item.kind === 'tool_call' || item.kind === 'tool_result') {
          if (!support.toolCalls || !support.toolResults) return false;
          if (item.providerExecuted === true && !support.providerExecutedTools) return false;
        }
        return true;
      }),
    };
  }

  /**
   * Materialize a replay plan into provider messages, grouping each assistant
   * step's reasoning + text + tool calls into ONE assistant message (Anthropic
   * requires the signed thinking block to lead the tool-use assistant message).
   *
   * The ledger lands a step's parts as: tool_call(s), tool_result(s), thinking,
   * text (the per-step AssistantMessage flushes at `finish-step`, after the
   * step's tool events). Model text carries the step id and closes the step.
   * Client tools replay as `[reasoning, text, tool-call…]` followed by tool
   * messages; provider-executed tools replay as
   * `[reasoning, tool-call, tool-result, text]`, preserving provider chronology
   * for item references and grounded text. Steps with no text closer — a
   * thinking + tool step (its empty text closer is skipped from the plan as
   * `empty_text_skipped`) or a pure-tool step — flush grouped by stepId,
   * claiming any parked reasoning for that step. Legacy per-turn items (no step
   * id) keep the older shape: tool calls form a tool-only assistant,
   * text/thinking become standalone messages.
   */
  async materializeRuntimeReplayPlan(
    plan: RuntimeEventModelReplayPlan,
    historyCompactCheckpoint: HistoryCompactCheckpoint | undefined,
    providerReasoningReplayEventIds: ReadonlySet<string>,
  ): Promise<ModelMessage[]> {
    type ThinkingItem = Extract<RuntimeEventModelReplayItem, { kind: 'thinking' }>;
    type TextItem = Extract<RuntimeEventModelReplayItem, { kind: 'text' }>;
    type ReplayReasoning = {
      part?: ReasoningPart;
      providerOptions?: NonNullable<ModelMessage['providerOptions']>;
    };
    const out: ModelMessage[] = [];
    const push = (message: ModelMessage, eventIds: readonly string[]) => {
      out.push(message);
      this.memoryReplayMessageEvents.set(message, [...new Set(eventIds)]);
    };
    const replaySupport = this.input.modelAdapter.runtimeEventReplaySupport();
    const reasoningReplay = (item: ThinkingItem): ReplayReasoning | undefined => {
      if (item.signature) {
        return replaySupport.signedThinking
          ? {
              part: {
                type: 'reasoning' as const,
                text: item.text,
                providerOptions: { anthropic: { signature: item.signature } },
              },
            }
          : undefined;
      }
      const anthropic = item.providerOptions?.anthropic;
      if (
        anthropic &&
        typeof anthropic === 'object' &&
        !Array.isArray(anthropic) &&
        typeof (anthropic as { redactedData?: unknown }).redactedData === 'string'
      ) {
        return replaySupport.signedThinking
          ? {
              part: {
                type: 'reasoning' as const,
                text: item.text,
                providerOptions: item.providerOptions,
              },
            }
          : undefined;
      }
      if (
        typeof replaySupport.responsesReasoning === 'object' &&
        replaySupport.responsesReasoning.kind === 'plaintext-item'
      ) {
        const decoded = decodePlaintextResponsesReasoningState(item.providerOptions);
        if (decoded.kind === 'missing') return undefined;
        if (decoded.kind === 'unsupported-version') return undefined;
        if (decoded.kind === 'malformed') {
          if (
            decoded.profile !== undefined &&
            decoded.profile !== replaySupport.responsesReasoning.profile
          ) {
            return undefined;
          }
          throw new Error('Malformed durable plaintext Responses reasoning state');
        }
        const state = decoded.state;
        if (state.profile !== replaySupport.responsesReasoning.profile) {
          return undefined;
        }
        return {
          part: {
            type: 'reasoning' as const,
            text: item.text,
            providerOptions: replayPlaintextResponsesProviderOptions({
              providerOptionsKey: replaySupport.responsesReasoning.providerOptionsKey,
              state,
              text: item.text,
            }),
          },
        };
      }
      if (replaySupport.responsesReasoning === 'plaintext-content') {
        if (item.text.length === 0) return undefined;
        return { part: { type: 'reasoning' as const, text: item.text } };
      }
      if (replaySupport.responsesReasoning === 'encrypted-content') {
        const openai = item.providerOptions?.openai;
        if (openai && typeof openai === 'object' && !Array.isArray(openai)) {
          const { itemId, reasoningEncryptedContent } = openai as {
            itemId?: unknown;
            reasoningEncryptedContent?: unknown;
          };
          if (
            typeof itemId === 'string' &&
            itemId.length > 0 &&
            typeof reasoningEncryptedContent === 'string' &&
            reasoningEncryptedContent.length > 0
          ) {
            return {
              part: {
                type: 'reasoning' as const,
                text: item.text,
                providerOptions: {
                  openai: {
                    itemId,
                    reasoningEncryptedContent,
                  },
                },
              },
            };
          }
        }
      }
      if (!replaySupport.unsignedThinking) return undefined;
      const reasoningField = openAiChatReasoningFieldFromProviderOptions(item.providerOptions);
      if (!reasoningField) return undefined;
      return {
        providerOptions: {
          openaiCompatible: { [reasoningField]: item.text },
        } as NonNullable<ModelMessage['providerOptions']>,
      };
    };
    // Tool results are emitted only when their tool_call claims them here. A
    // result whose call never appears in the plan (sliced-away call, corrupt
    // ledger) is INTENTIONALLY dropped at the end: a standalone tool message
    // with no preceding tool_use in an assistant message is an Anthropic 400.
    // The old item-by-item materializer emitted such orphans; do not "fix" this
    // back — the plan flags them as `unmatched_tool_result` (a non-blocking
    // diagnostic precisely so this drop path is reachable; see
    // hasBlockingReplayDiagnostics).
    const materializeReplayToolResult = async (
      result: RuntimeEventReplayToolResultItem,
      toolName: string,
    ): Promise<ToolResultOutput> => {
      const output = result.modelProjection
        ? await this.materializeDurableToolResultProjection(result.modelProjection)
        : await this.materializeToolResultOutput(result.output, result.isError);
      if (toolName === TOOL_SEARCH_NAME && !result.isError) {
        return replayToolSearchOutput(output, this.input.replayToolSearchReferences);
      }
      if (toolName !== 'apply_patch') return output;
      return result.isError ? nativeApplyPatchFailureOutput(output) : output;
    };
    const pushClientToolResults = async (exchanges: readonly RuntimeEventReplayToolExchange[]) => {
      for (const { call, result } of exchanges) {
        if (!result || result.providerExecuted === true) continue;
        push(
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: result.toolCallId,
                toolName: result.toolName,
                output: await materializeReplayToolResult(result, call.toolName),
              },
            ],
          },
          [result.eventId],
        );
      }
    };
    // Emit one assistant message for a step, preserving the distinct client-
    // and provider-executed tool chronologies described above.
    const emitStep = async (
      reasoning: readonly ThinkingItem[] | undefined,
      text: TextItem | undefined,
      exchanges: readonly RuntimeEventReplayToolExchange[],
      replayFacts: ReadonlyArray<{ readonly text: string; readonly eventIds: readonly string[] }>,
    ) => {
      const calls = exchanges.map(({ call }) => call);
      const content: unknown[] = [];
      const eventIds = [
        ...(reasoning ?? []).map((item) => item.eventId),
        ...(text ? [text.eventId] : []),
        ...calls.map((call) => call.eventId),
        ...replayFacts.flatMap((fact) => fact.eventIds),
      ];
      const replayReasoning = reasoning
        ?.map(reasoningReplay)
        .filter((item): item is ReplayReasoning => item !== undefined);
      for (const item of replayReasoning ?? []) {
        if (item.part) content.push(item.part);
      }
      // Provider-owned tools execute before the grounded assistant text in the
      // same provider step. Preserve that chronology for Responses item
      // references and Anthropic server_tool_use/result replay. Client tools
      // stay after text because their execution begins only after this step.
      for (const { call, result } of exchanges) {
        if (call.providerExecuted !== true) continue;
        content.push({
          type: 'tool-call',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
          ...(call.providerOptions !== undefined ? { providerOptions: call.providerOptions } : {}),
          providerExecuted: true,
        });
        if (!result || result.providerExecuted !== true) continue;
        eventIds.push(result.eventId);
        content.push({
          type: 'tool-result',
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          output: await materializeReplayToolResult(result, call.toolName),
        });
      }
      if (text && text.content.length > 0) {
        content.push({
          type: 'text',
          text: text.content,
          ...(text.providerOptions !== undefined ? { providerOptions: text.providerOptions } : {}),
        });
      }
      for (const replayFact of replayFacts) {
        content.push({ type: 'text', text: replayFact.text });
      }
      for (const call of calls) {
        if (call.providerExecuted === true) continue;
        content.push({
          type: 'tool-call',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input,
          ...(call.providerOptions !== undefined ? { providerOptions: call.providerOptions } : {}),
          ...(call.providerExecuted !== undefined
            ? { providerExecuted: call.providerExecuted }
            : {}),
        });
      }
      const replayProviderOptions = replayReasoning?.find(
        (item) => item.providerOptions !== undefined,
      )?.providerOptions;
      if (content.length > 0 || replayProviderOptions) {
        push(
          {
            role: 'assistant',
            content,
            ...(replayProviderOptions ? { providerOptions: replayProviderOptions } : {}),
          } as ModelMessage,
          eventIds,
        );
      }
      await pushClientToolResults(exchanges);
    };
    const admittedItems = admitProviderReasoningReplayItems(
      plan.items,
      providerReasoningReplayEventIds,
    );
    for (const entry of buildRuntimeEventReplayTimeline(admittedItems)) {
      if (entry.kind === 'thinking') {
        const replayReasoning = reasoningReplay(entry.item);
        if (replayReasoning) {
          push(
            {
              role: 'assistant',
              content: replayReasoning.part ? [replayReasoning.part] : [],
              ...(replayReasoning.providerOptions
                ? { providerOptions: replayReasoning.providerOptions }
                : {}),
            } as ModelMessage,
            [entry.item.eventId],
          );
        }
        continue;
      }
      if (entry.kind === 'text') {
        push(await this.materializeRuntimeReplayItem(entry.item), [entry.item.eventId]);
        continue;
      }

      const exchanges: RuntimeEventReplayToolExchange[] = [];
      const replayFacts: Array<{ readonly text: string; readonly eventIds: readonly string[] }> =
        [];
      for (const { call, result } of entry.calls) {
        if (call.toolName !== 'apply_patch') {
          exchanges.push({ call, ...(result ? { result } : {}) });
          continue;
        }
        const replayInput = normalizeApplyPatchReplayInput(
          this.input.applyPatchProfile,
          call.toolCallId,
          call.input,
        );
        if (replayInput !== null) {
          exchanges.push({
            call: {
              ...call,
              input: replayInput,
              ...(replayInput !== call.input ? { providerOptions: undefined } : {}),
            },
            ...(result ? { result } : {}),
          });
          continue;
        }
        if (!result) continue;
        const replayFact = result.modelProjection
          ? durableApplyPatchReplayFactText(call.input, result.modelProjection, result.isError)
          : applyPatchReplayFactText(call.input, result.output, result.isError);
        if (!replayFact) continue;
        replayFacts.push({ text: replayFact, eventIds: [call.eventId, result.eventId] });
      }
      await emitStep(entry.reasoning, entry.text, exchanges, replayFacts);
    }
    return this.prependProviderHistoryCompactMessage(out, historyCompactCheckpoint);
  }

  async materializeRuntimeReplayTextOnly(
    plan: RuntimeEventModelReplayPlan,
    historyCompactCheckpoint?: HistoryCompactCheckpoint,
  ): Promise<ModelMessage[]> {
    const messages: ModelMessage[] = [];
    for (const item of plan.items) {
      if (item.kind === 'text')
        this.pushMemoryIndexedMessage(messages, await this.materializeRuntimeReplayItem(item), [
          item.eventId,
        ]);
    }
    return this.prependProviderHistoryCompactMessage(messages, historyCompactCheckpoint);
  }

  private prependProviderHistoryCompactMessage(
    messages: ModelMessage[],
    checkpoint: HistoryCompactCheckpoint | undefined,
  ): ModelMessage[] {
    if (!checkpoint || !isProviderHistoryCompactCheckpoint(checkpoint)) return messages;
    const providerMessage = historyCompactCheckpointToModelMessage(checkpoint);
    this.memoryReplayMessageEvents.set(providerMessage, [
      `history-compact:${checkpoint.checkpointId}`,
    ]);
    return [providerMessage, ...messages];
  }

  private pushMemoryIndexedMessage(
    messages: ModelMessage[],
    message: ModelMessage,
    eventIds: readonly string[],
  ): void {
    messages.push(message);
    this.memoryReplayMessageEvents.set(message, [...new Set(eventIds)]);
  }

  memoryEventMessagePositions(
    messages: readonly ModelMessage[],
  ): Readonly<Record<string, readonly number[]>> | undefined {
    const positions: Record<string, number[]> = {};
    for (const [position, message] of messages.entries()) {
      for (const eventId of this.memoryReplayMessageEvents.get(message) ?? []) {
        (positions[eventId] ??= []).push(position);
      }
    }
    return Object.keys(positions).length > 0 ? positions : undefined;
  }

  private async materializeRuntimeReplayItem(
    item: Extract<RuntimeEventModelReplayItem, { kind: 'text' }>,
  ): Promise<ModelMessage> {
    if (item.role === 'user') {
      // Both ordinary and steered replay materialize image attachments through
      // the same path the original request used — a steering replay that kept
      // only the envelope text would hand a recovery turn references without
      // the native images the first request received.
      const content = await this.appendImageParts(item.content, item.attachments);
      if (item.steering) {
        // Already envelope-wrapped by the plan; carry the structured identity
        // so injection dedupe recognizes the replayed message.
        return {
          role: 'user',
          content,
          providerOptions: steeringProviderOptions(item.steering.eventId),
        };
      }
      return {
        role: 'user',
        content: appendUserMessageBlocks(
          prependUserMessageBlocks(content, item.injections ?? []),
          item.trailingInjections ?? [],
        ),
      } as ModelMessage;
    }
    return {
      role: item.role,
      content: item.content,
      ...(item.providerOptions !== undefined ? { providerOptions: item.providerOptions } : {}),
    };
  }

  /**
   * Render provider-visible content for a user message: keep the given
   * (already-formatted) text, and append image attachments as provider image
   * parts only for explicitly vision-capable models. Non-image attachments stay
   * as placeholder refs in the text. Shared by the current turn and RuntimeEvent replay.
   *
   * An image with a recorded size is not read here: it stays deferred until
   * the request it goes out in is known to send it (`prepareRequestImages`).
   */
  async appendImageParts(textContent: string, attachments?: AttachmentRef[]): Promise<UserContent> {
    const images = attachments?.filter((a) => a.kind === 'image') ?? [];
    if (images.length === 0) {
      return textContent;
    }
    if (this.input.supportsVision !== true) {
      // `textContent` already carries each attachment's stable Read argument.
      // Native provider image delivery is unavailable here, but that does not
      // establish whether the model can process the image through a tool.
      return textContent;
    }
    if (!this.input.readAttachmentBytes) {
      return textContent;
    }
    const parts: Array<TextPart | FilePart> = [{ type: 'text', text: textContent }];
    for (const image of images) {
      if (Number.isFinite(image.bytes) && image.bytes > 0) {
        if (image.bytes > this.imageLimits.maxBytes) {
          parts.push({
            type: 'text',
            text: providerImageAttachmentTooLargeMessage(image.name, this.imageLimits),
          });
        } else {
          parts.push(deferredImagePart(image));
        }
        continue;
      }
      const read = await this.input.readAttachmentBytes(image.ref);
      if (!read.ok) {
        parts.push({
          type: 'text',
          text: `Image attachment "${image.name}" could not be loaded: ${read.reason}.`,
        });
        continue;
      }
      if (read.bytes.length > this.imageLimits.maxBytes) {
        parts.push({
          type: 'text',
          text: providerImageAttachmentTooLargeMessage(image.name, this.imageLimits),
        });
        continue;
      }
      parts.push({
        type: 'file',
        data: { type: 'data', data: read.bytes },
        mediaType: image.mimeType,
      });
    }
    return parts;
  }

  private async materializeToolResultOutput(
    output: unknown,
    isError: boolean,
  ): Promise<ToolResultOutput> {
    if (isError || !isImageToolResult(output)) return toolResultOutput(output, isError);
    if (this.input.supportsVision !== true) {
      return toolResultText('Image was read, but the selected model does not support image input.');
    }
    if (!this.input.readAttachmentBytes) {
      return toolResultText('Image was read, but its stored bytes are unavailable.');
    }
    const image = await this.toolResultImagePart(output.ref, output.mimeType);
    if (image.type === 'text') return toolResultText(image.text);
    return {
      type: 'content',
      value: [{ type: 'text', text: 'Image read successfully.' }, image],
    };
  }

  private async materializeDurableToolResultProjection(
    projection: DurableToolResultProjection,
  ): Promise<ToolResultOutput> {
    if (projection.kind !== 'content') return durableProjectionToToolResultOutput(projection);
    const value: Extract<ToolResultOutput, { type: 'content' }>['value'] = [];
    for (const part of projection.parts) {
      if (part.kind === 'text') {
        value.push({ type: 'text', text: part.text });
        continue;
      }
      if (this.input.supportsVision !== true) {
        value.push({
          type: 'text',
          text: 'Image was read, but the selected model does not support image input.',
        });
        continue;
      }
      if (!this.input.readAttachmentBytes) {
        value.push({
          type: 'text',
          text: 'Image was read, but its stored bytes are unavailable.',
        });
        continue;
      }
      value.push(await this.toolResultImagePart(part.ref, part.mediaType));
    }
    return { type: 'content', value };
  }

  async buildCurrentUserContent(
    text: string,
    attachments?: AttachmentRef[],
    directoryReferences?: DirectoryReference[],
    quotes?: QuoteRef[],
  ): Promise<UserContent> {
    return await this.appendImageParts(
      formatTextWithInlineRefs(text, {
        ...(attachments !== undefined ? { attachments } : {}),
        ...(directoryReferences !== undefined ? { directoryReferences } : {}),
        ...(quotes !== undefined ? { quotes } : {}),
      }),
      attachments,
    );
  }
}
