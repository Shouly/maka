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

import { finitePositive, stableJsonLength } from './context-budget-helpers.js';
import { HistoryCompactSummarizerError } from './history-compact-error.js';
import type { ModelMessage } from './model-protocol.js';

const COMPACTION_TOOL_OUTPUT_PLACEHOLDER =
  '[Tool output omitted because it exceeded the compaction input budget.]';

function placeholderToolResult<T extends { output: { type: string } }>(part: T): T {
  const output =
    part.output.type === 'error-text' || part.output.type === 'error-json'
      ? { type: 'error-text' as const, value: COMPACTION_TOOL_OUTPUT_PLACEHOLDER }
      : { type: 'text' as const, value: COMPACTION_TOOL_OUTPUT_PLACEHOLDER };
  return { ...part, output };
}

function utf8JsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
  } catch {
    return Buffer.byteLength(String(value), 'utf8');
  }
}

/**
 * Bound a compaction request without breaking tool-call chronology. Old tool
 * outputs are the only lossy candidates: replacing their payload keeps every
 * call/result pair valid and preserves more recent evidence.
 */
export function fitHistoryCompactMessages(
  messages: readonly ModelMessage[],
  options: {
    maxInputEstimatedTokens?: number;
    charsPerToken?: number;
    fixedInputChars?: number;
  },
): ModelMessage[] {
  const maxEstimatedTokens = finitePositive(options.maxInputEstimatedTokens);
  if (maxEstimatedTokens === undefined) return [...messages];
  const charsPerToken = finitePositive(options.charsPerToken) ?? 4;
  const maxEstimatedChars = maxEstimatedTokens * charsPerToken;
  let estimatedChars = (finitePositive(options.fixedInputChars) ?? 0) + stableJsonLength(messages);
  if (estimatedChars <= maxEstimatedChars) return [...messages];

  let bounded = [...messages];
  for (let messageIndex = 0; messageIndex < bounded.length; messageIndex += 1) {
    const message = bounded[messageIndex]!;
    if (message.role !== 'tool') continue;
    // Accumulate replacements across the parts of this one tool message. A
    // message that batches several tool results (one per parallel tool call)
    // must keep every earlier placeholder, not just the last one — otherwise
    // the returned history still carries full-size payloads even though the
    // budget accounting already credited their removal.
    let content = message.content;
    for (let partIndex = 0; partIndex < message.content.length; partIndex += 1) {
      const part = message.content[partIndex]!;
      if (part.type !== 'tool-result') continue;
      const replacement = placeholderToolResult(part);
      const originalChars = stableJsonLength(part);
      const replacementChars = stableJsonLength(replacement);
      if (replacementChars >= originalChars) continue;
      content = [...content];
      content[partIndex] = replacement;
      bounded = [...bounded];
      bounded[messageIndex] = { ...message, content };
      estimatedChars -= originalChars - replacementChars;
      if (estimatedChars <= maxEstimatedChars) return bounded;
    }
  }

  throw new HistoryCompactSummarizerError('input_too_large');
}

/**
 * Refit a summarizer request its provider rejected as too long. The largest
 * tool outputs are replaced first, so the smaller ones the summary can still
 * use survive, until the request is estimated within
 * `maxInputEstimatedTokens`, the input the model last accepted. The rejection
 * is evidence that the estimate runs low, so the largest output is replaced
 * even when the estimate already fits, or when no size is known. Unlike
 * `fitHistoryCompactMessages` nothing is thrown: whether the refit request
 * fits is the provider's answer.
 *
 * The estimate is UTF-8 bytes, four to a token: a CJK character is three
 * bytes and about one token, where a UTF-16 length would count it as a
 * quarter of one. `omittedToolOutputs` is zero when there was nothing to
 * replace.
 */
export function refitRejectedHistoryCompactMessages(
  messages: readonly ModelMessage[],
  options: { maxInputEstimatedTokens?: number; fixedInputBytes?: number },
): { messages: ModelMessage[]; omittedToolOutputs: number } {
  const candidates: Array<{ messageIndex: number; partIndex: number; savedBytes: number }> = [];
  for (const [messageIndex, message] of messages.entries()) {
    if (message.role !== 'tool') continue;
    for (const [partIndex, part] of message.content.entries()) {
      if (part.type !== 'tool-result') continue;
      const savedBytes = utf8JsonBytes(part) - utf8JsonBytes(placeholderToolResult(part));
      if (savedBytes > 0) candidates.push({ messageIndex, partIndex, savedBytes });
    }
  }
  // Largest first; the earlier of two equal outputs goes first.
  candidates.sort((left, right) => right.savedBytes - left.savedBytes);

  const maxTokens = finitePositive(options.maxInputEstimatedTokens);
  const maxBytes = maxTokens === undefined ? undefined : maxTokens * 4;
  let estimatedBytes = (finitePositive(options.fixedInputBytes) ?? 0) + utf8JsonBytes(messages);
  const chosen: typeof candidates = [];
  for (const candidate of candidates) {
    if (chosen.length > 0 && (maxBytes === undefined || estimatedBytes <= maxBytes)) break;
    chosen.push(candidate);
    estimatedBytes -= candidate.savedBytes;
  }
  if (chosen.length === 0) return { messages: [...messages], omittedToolOutputs: 0 };

  const refit = [...messages];
  for (const { messageIndex, partIndex } of chosen) {
    const message = refit[messageIndex]!;
    if (message.role !== 'tool') continue;
    const content = [...message.content];
    const part = content[partIndex]!;
    if (part.type !== 'tool-result') continue;
    content[partIndex] = placeholderToolResult(part);
    refit[messageIndex] = { ...message, content };
  }
  return { messages: refit, omittedToolOutputs: chosen.length };
}
