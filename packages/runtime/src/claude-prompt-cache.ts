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

// Where a Claude request asks for its prompt to be cached. Claude writes the
// cache only at a breakpoint and reads only what an earlier request wrote; a
// request may carry four breakpoints. Three are placed, all five-minute
// entries:
//
//  1. the end of the system prompt. With the tools before it, that prefix is
//     the same for every conversation on the account until the prompt or the
//     tools change, so a new conversation, a sub-agent or a background call
//     reads it instead of writing it again;
//  2. the end of the previous request: the message before the latest answer,
//     where that request's last breakpoint wrote. The read then does not hang
//     on the 20-block lookback when one step adds many blocks (parallel tool
//     calls);
//  3. the last block, for the next request to read: the request's top-level
//     `cache_control` (automatic caching), asked for through provider options
//     (`buildProviderOptions`).
//
// This file places 1 and 2, on the body as the provider receives it.

const EPHEMERAL = { type: 'ephemeral' } as const;
const MAX_BREAKPOINTS = 4;

type Body = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** OpenRouter caches a Claude prompt only when asked; its other models cache on their own. */
export function isOpenRouterClaude(providerType: string, modelId: string): boolean {
  return providerType === 'openrouter' && /^~?anthropic\//.test(modelId);
}

/** Anthropic Messages, as the Anthropic API, Vertex AI and the organisation gateway take it. */
export function placeAnthropicCacheBreakpoints(body: Body): Body {
  return place(body, {
    system: (next) => {
      const marked = markLastBlock(next.system, anthropicCacheable);
      if (marked) next.system = marked;
      return marked !== undefined;
    },
    // Tool results ride in user messages there, and may carry a breakpoint.
    previousRequestEnd: (message) => markLastBlock(message.content, anthropicCacheable),
  });
}

/**
 * OpenRouter's Chat Completions body for a Claude model. Its documented
 * breakpoints are text parts of system and user messages, so a previous
 * request that ended on a tool message keeps only the lookback.
 */
export function placeOpenRouterCacheBreakpoints(body: Body): Body {
  return place(body, {
    system: (next) => {
      if (!Array.isArray(next.messages)) return false;
      const messages = next.messages;
      let index = -1;
      while (isRecord(messages[index + 1]) && messages[index + 1].role === 'system') index += 1;
      const message = messages[index];
      if (!isRecord(message)) return false;
      const marked = markLastBlock(message.content, chatCacheable);
      if (marked) next.messages = replaced(messages, index, { ...message, content: marked });
      return marked !== undefined;
    },
    previousRequestEnd: (message) =>
      message.role === 'user' ? markLastBlock(message.content, chatCacheable) : undefined,
  });
}

interface Placement {
  /** Marks the end of the system prompt on `next`; false when it cannot. */
  system: (next: Body) => boolean;
  /** The message's content with its last block marked, or undefined when it cannot be. */
  previousRequestEnd: (message: Record<string, unknown>) => unknown[] | undefined;
}

function place(body: Body, placement: Placement): Body {
  const next: Body = { ...body };
  let budget = MAX_BREAKPOINTS - countBreakpoints(body);
  if (budget > 0 && placement.system(next)) budget -= 1;
  if (budget < 1 || !Array.isArray(next.messages)) return next;
  const messages = next.messages;
  const end = previousRequestEndIndex(messages);
  const message = end === undefined ? undefined : messages[end];
  if (end === undefined || !isRecord(message)) return next;
  const marked = placement.previousRequestEnd(message);
  if (marked) next.messages = replaced(messages, end, { ...message, content: marked });
  return next;
}

/** The message before the latest answer: where the request that produced it ended. */
function previousRequestEndIndex(messages: readonly unknown[]): number | undefined {
  for (let index = messages.length - 1; index > 0; index -= 1) {
    const message = messages[index];
    if (isRecord(message) && message.role === 'assistant') return index - 1;
  }
  return undefined;
}

function countBreakpoints(body: Body): number {
  let count = isRecord(body.cache_control) ? 1 : 0;
  const countBlocks = (blocks: unknown) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) if (isRecord(block) && block.cache_control) count += 1;
  };
  countBlocks(body.tools);
  countBlocks(body.system);
  if (Array.isArray(body.messages)) {
    for (const message of body.messages) if (isRecord(message)) countBlocks(message.content);
  }
  return count;
}

/** Thinking blocks cannot carry a breakpoint, nor can empty text. */
function anthropicCacheable(block: Record<string, unknown>): boolean {
  if (block.type === 'thinking' || block.type === 'redacted_thinking') return false;
  return block.type !== 'text' || (typeof block.text === 'string' && block.text.length > 0);
}

function chatCacheable(block: Record<string, unknown>): boolean {
  return block.type === 'text' && typeof block.text === 'string' && block.text.length > 0;
}

/** `content` with its last block marked; a string becomes one text block. */
function markLastBlock(
  content: unknown,
  cacheable: (block: Record<string, unknown>) => boolean,
): unknown[] | undefined {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content, cache_control: EPHEMERAL }] : undefined;
  }
  if (!Array.isArray(content)) return undefined;
  const last = content[content.length - 1];
  if (!isRecord(last) || last.cache_control || !cacheable(last)) return undefined;
  return replaced(content, content.length - 1, { ...last, cache_control: EPHEMERAL });
}

function replaced(values: readonly unknown[], index: number, value: unknown): unknown[] {
  const copy = [...values];
  copy[index] = value;
  return copy;
}
