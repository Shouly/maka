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

// Reading usage off an answer as it passes, in each protocol's own terms,
// without holding it back or changing it: the gateway only watches.

import type { ModelApiProtocol } from '@maka/core/model-gateway';

export interface TokenUsage {
  /** Input not read from or written to the cache. */
  input: number;
  /** Output including any reasoning the provider counts in it. */
  output: number;
  cacheWrite: number;
  cacheRead: number;
}
export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

/** Allowance units: output weighs five times input, cache reads a tenth. */
export function weightedUnits(u: TokenUsage, weight: number): number {
  return (u.input + 5 * u.output + 1.25 * u.cacheWrite + 0.1 * u.cacheRead) * weight;
}

/** About four characters a token, a CJK character one; only for text that was seen. */
export function estimateTokens(text: string): number {
  let units = 0;
  for (const c of text) units += c.charCodeAt(0) > 127 ? 1 : 0.25;
  return Math.ceil(units);
}

/**
 * An encoded image or file inside a request, bare or as a data URL (the
 * OpenAI wires): counted as one would cost, not by its characters.
 */
const ENCODED = /^(?:data:[\w.+-]+\/[\w.+-]+(?:;[^;,]*)*;base64,)?[A-Za-z0-9+/=_-]{1024,}$/;
const ENCODED_TOKENS = 1600;

/**
 * A request's input, estimated from its text, for when the provider never
 * said (the answer broke off before its usage). Encoded media counts as a
 * fixed amount rather than by the length of its base64.
 */
export function estimateRequestTokens(body: unknown): number {
  let tokens = 0;
  const walk = (value: unknown) => {
    if (typeof value === 'string') {
      tokens += ENCODED.test(value) ? ENCODED_TOKENS : estimateTokens(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item);
    } else if (value !== null && typeof value === 'object') {
      for (const item of Object.values(value)) walk(item);
    }
  };
  walk(body);
  return tokens;
}

const object = (v: unknown): Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {};
const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;

/** Past this, one streamed event is passed on without being read. */
const EVENT_LIMIT = 8 * 1024 * 1024;
/** Past this, a whole JSON answer is passed on without being read. */
const DOCUMENT_LIMIT = 64 * 1024 * 1024;

/**
 * Watches one answer: its usage, whether it reached its end, and whether the
 * provider reported an error inside it. Fed the bytes as they are forwarded.
 */
export class GatewayUsageMeter {
  usage = emptyUsage();
  #inputReported = false;
  #outputReported = false;
  /** The protocol's end-of-answer marker was seen. */
  complete = false;
  /** The provider reported an error inside a successful response. */
  failed = false;
  #estimatedOutput = 0;
  /** A JSON answer too large to read: forwarded, but its usage is estimated. */
  #overflow = false;
  #decoder = new TextDecoder();
  #buffer = '';
  /** Where in the buffer to look for the next event's end: earlier text has none. */
  #scanFrom = 0;
  /** Inside an event too large to read: passed on until it ends. */
  #skipping = false;
  readonly #chunks: Uint8Array[] = [];
  #size = 0;

  constructor(
    readonly protocol: ModelApiProtocol,
    /** Server-sent events, or one JSON document. */
    readonly stream: boolean,
    /** The request's input, estimated, for when the provider never says it. */
    readonly estimateInput: () => number = () => 0,
  ) {}

  feed(bytes: Uint8Array): void {
    if (this.#overflow) return;
    if (!this.stream) {
      this.#size += bytes.byteLength;
      if (this.#size > DOCUMENT_LIMIT) {
        this.#overflow = true;
        this.#chunks.length = 0;
        return;
      }
      this.#chunks.push(bytes);
      return;
    }
    this.#buffer += this.#decoder.decode(bytes, { stream: true });
    const end = /\r?\n\r?\n/g;
    for (;;) {
      // A separator may have begun at the end of the text already searched.
      end.lastIndex = Math.max(0, this.#scanFrom - 3);
      const match = end.exec(this.#buffer);
      if (!match) break;
      const frame = this.#buffer.slice(0, match.index);
      this.#buffer = this.#buffer.slice(match.index + match[0].length);
      this.#scanFrom = 0;
      if (this.#skipping) this.#skipping = false;
      else this.#frame(frame);
    }
    this.#scanFrom = this.#buffer.length;
    // One event too large to read (an inline image) is skipped; the events after it still count.
    if (this.#buffer.length > EVENT_LIMIT) {
      this.#skipping = true;
      this.#buffer = '';
      this.#scanFrom = 0;
    }
  }

  /** The answer ended (fully read): read what is left. */
  finish(): void {
    if (this.#overflow) return;
    if (!this.stream) {
      try {
        const text = new TextDecoder().decode(Buffer.concat(this.#chunks));
        this.#accept(JSON.parse(text), true);
        this.complete = true;
      } catch {
        // Not JSON: forwarded as it was; nothing to count.
      }
      return;
    }
    this.#buffer += this.#decoder.decode();
    if (this.#buffer.trim() && !this.#skipping) this.#frame(this.#buffer);
    this.#buffer = '';
  }

  /** What to record: the provider's own counts when it gave them, otherwise what was seen. */
  result(): { usage: TokenUsage; quality: 'reported' | 'estimated' } {
    // A stream that broke off has only running counts (Anthropic's opening output of 1).
    if (this.#inputReported && this.#outputReported && this.complete && !this.#overflow)
      return { usage: { ...this.usage }, quality: 'reported' };
    return {
      usage: {
        ...this.usage,
        input: this.#inputReported ? this.usage.input : this.estimateInput(),
        output: Math.max(this.usage.output, this.#estimatedOutput),
      },
      quality: 'estimated',
    };
  }

  #frame(frame: string): void {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      if (this.protocol === 'openai-chat') this.complete = true;
      return;
    }
    try {
      this.#accept(JSON.parse(data), false);
    } catch {
      // A frame that is not JSON is the client's to make sense of.
    }
  }

  #applyUsage(value: unknown): void {
    const u = object(value);
    let input: unknown, output: unknown, read: unknown, write: unknown;
    if (this.protocol === 'anthropic-messages') {
      input = u.input_tokens;
      output = u.output_tokens;
      read = u.cache_read_input_tokens;
      write = u.cache_creation_input_tokens;
    } else if (this.protocol === 'openai-chat') {
      input = u.prompt_tokens;
      output = u.completion_tokens;
      read = object(u.prompt_tokens_details).cached_tokens;
      // OpenRouter's, when it writes a Claude prompt to the cache; inside the input count.
      write = object(u.prompt_tokens_details).cache_write_tokens;
    } else if (this.protocol === 'openai-responses') {
      input = u.input_tokens;
      output = u.output_tokens;
      read = object(u.input_tokens_details).cached_tokens;
      // GPT-5.6 and later report what they wrote apart, inside the input count.
      write = object(u.input_tokens_details).cache_write_tokens;
    } else {
      input = u.promptTokenCount;
      read = u.cachedContentTokenCount;
      const candidates = count(u.candidatesTokenCount);
      const thoughts = count(u.thoughtsTokenCount);
      if (candidates !== undefined || thoughts !== undefined)
        output = (candidates ?? 0) + (thoughts ?? 0);
    }
    const r = count(read);
    const w = count(write);
    const i = count(input);
    const o = count(output);
    if (r !== undefined) this.usage.cacheRead = r;
    if (w !== undefined) this.usage.cacheWrite = w;
    if (i !== undefined) {
      this.#inputReported = true;
      // Anthropic counts the cache apart; the others include it in the input.
      this.usage.input =
        this.protocol === 'anthropic-messages'
          ? i
          : Math.max(0, i - this.usage.cacheRead - this.usage.cacheWrite);
    }
    if (o !== undefined) {
      this.#outputReported = true;
      this.usage.output = o;
    }
  }

  #accept(value: unknown, whole: boolean): void {
    const e = object(value);
    if (e.error || e.type === 'error' || e.type === 'response.failed') this.failed = true;
    if (this.protocol === 'anthropic-messages') {
      this.#applyUsage(e.type === 'message_start' ? object(e.message).usage : e.usage);
      if (e.type === 'message_stop') this.complete = true;
      if (e.type === 'content_block_delta') {
        const d = object(e.delta);
        this.#estimatedOutput += estimateTokens(
          String(d.text ?? d.thinking ?? d.partial_json ?? ''),
        );
      }
    } else if (this.protocol === 'openai-chat') {
      this.#applyUsage(e.usage);
      for (const choice of Array.isArray(e.choices) ? e.choices : []) {
        const d = object(whole ? choice.message : choice.delta);
        this.#estimatedOutput +=
          estimateTokens(String(d.content ?? d.reasoning ?? d.reasoning_content ?? '')) +
          (d.tool_calls ? estimateTokens(JSON.stringify(d.tool_calls)) : 0);
      }
    } else if (this.protocol === 'openai-responses') {
      const r = e.response ? object(e.response) : e;
      this.#applyUsage(r.usage);
      if (
        e.type === 'response.completed' ||
        e.type === 'response.incomplete' ||
        e.type === 'response.failed'
      )
        this.complete = true;
      if (typeof e.delta === 'string') this.#estimatedOutput += estimateTokens(e.delta);
    } else {
      this.#applyUsage(e.usageMetadata);
      for (const candidate of Array.isArray(e.candidates) ? e.candidates : []) {
        // Any finish reason ends the answer; which one is the client's to read.
        if (candidate.finishReason) this.complete = true;
        if (candidate.content)
          this.#estimatedOutput += estimateTokens(JSON.stringify(candidate.content));
      }
      if (object(e.promptFeedback).blockReason) this.complete = true;
      const usage = object(e.usageMetadata);
      // Gemini leaves zero counters out: a finished answer with only totals had no output.
      if (
        this.complete &&
        count(usage.candidatesTokenCount) === undefined &&
        count(usage.thoughtsTokenCount) === undefined
      ) {
        const prompt = count(usage.promptTokenCount);
        const total = count(usage.totalTokenCount);
        if (prompt !== undefined && total !== undefined && total >= prompt) {
          this.#outputReported = true;
          this.usage.output = total - prompt;
        }
      }
    }
  }
}
