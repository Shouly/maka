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

// Metering (design §5.2): read token usage out of the upstream answer as it
// passes through, weigh it, and record one usage event per request.
//
// Anthropic streams carry usage in two events: `message_start` holds the
// input and cache tokens, `message_delta` the cumulative output count (and,
// on newer models, updated input and cache counts). A non-streaming answer
// has it all in `usage`.

import type { GatewayProtocol } from '@maka/platform-protocol';
import type { ServerContext } from '../context.js';

export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export const emptyUsage = (): TokenUsage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });

/** Input ×1, output ×5, cache write ×1.25, cache read ×0.1, times the model's weight (from relx-copilot). */
export function weightedUnits(usage: TokenUsage, costWeight: number): number {
  return (
    (usage.input + usage.output * 5 + usage.cacheWrite * 1.25 + usage.cacheRead * 0.1) * costWeight
  );
}

const count = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Fold an Anthropic `usage` object into the running totals; absent fields keep their value. */
export function applyAnthropicUsage(total: TokenUsage, usage: unknown): void {
  if (typeof usage !== 'object' || usage === null) return;
  const record = usage as Record<string, unknown>;
  total.input = count(record.input_tokens) ?? total.input;
  total.output = count(record.output_tokens) ?? total.output;
  total.cacheWrite = count(record.cache_creation_input_tokens) ?? total.cacheWrite;
  total.cacheRead = count(record.cache_read_input_tokens) ?? total.cacheRead;
}

/** Rough tokens for streamed text: ~4 ASCII characters a token, one per other character (CJK). */
function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const char of text) {
    if (char.charCodeAt(0) < 0x80) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 4) + other;
}

/**
 * Watches an Anthropic SSE byte stream for usage without altering it. Events
 * may be separated by CRLF as well as LF (the SSE spec allows both). The
 * output count only arrives at the end, in `message_delta`; a stream that
 * stops before it — the client hung up, the upstream dropped — is charged
 * for what it had already streamed, estimated from the text (§5.2).
 */
export class AnthropicStreamMeter {
  readonly usage = emptyUsage();
  #pending = '';
  #carriageReturn = false;
  #finalUsage = false;
  #estimatedOutput = 0;
  readonly #decoder = new TextDecoder();

  push(chunk: Uint8Array): void {
    let text = this.#decoder.decode(chunk, { stream: true });
    // A CRLF split across two chunks must stay one line break.
    if (this.#carriageReturn) text = `\r${text}`;
    this.#carriageReturn = text.endsWith('\r');
    if (this.#carriageReturn) text = text.slice(0, -1);
    this.#pending += text.replace(/\r\n?/g, '\n');
    let boundary = this.#pending.indexOf('\n\n');
    while (boundary !== -1) {
      this.#event(this.#pending.slice(0, boundary));
      this.#pending = this.#pending.slice(boundary + 2);
      boundary = this.#pending.indexOf('\n\n');
    }
    // A single event larger than this is not usage; stop holding it.
    if (this.#pending.length > 1024 * 1024) this.#pending = '';
  }

  /** What to charge: the stream's own count, or an estimate when it stopped before giving one. */
  charge(): TokenUsage {
    if (this.#finalUsage) return { ...this.usage };
    return { ...this.usage, output: Math.max(this.usage.output, this.#estimatedOutput) };
  }

  #event(block: string): void {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    const delta = data.includes('"content_block_delta"');
    if (!delta && !data.includes('usage')) return;
    try {
      const event = JSON.parse(data) as {
        type?: unknown;
        message?: { usage?: unknown };
        usage?: unknown;
        delta?: { text?: unknown; thinking?: unknown; partial_json?: unknown };
      };
      if (event.type === 'message_start') applyAnthropicUsage(this.usage, event.message?.usage);
      else if (event.type === 'message_delta') {
        applyAnthropicUsage(this.usage, event.usage);
        if (event.usage) this.#finalUsage = true;
      } else if (event.type === 'content_block_delta') {
        const piece = event.delta?.text ?? event.delta?.thinking ?? event.delta?.partial_json;
        if (typeof piece === 'string') this.#estimatedOutput += estimateTokens(piece);
      }
    } catch {
      // Not JSON: nothing to meter.
    }
  }
}

export interface UsageRecord {
  readonly userId: string;
  readonly sessionId: string;
  readonly modelId: string;
  readonly upstreamId: string | null;
  readonly protocol: GatewayProtocol;
  readonly usage: TokenUsage;
  readonly costWeight: number;
  readonly status: 'ok' | 'error' | 'cancelled';
  readonly httpStatus: number | null;
  readonly latencyMs: number;
  readonly clientVersion: string | null;
  readonly upstreamRequestId: string | null;
}

export async function recordUsage(ctx: ServerContext, record: UsageRecord): Promise<void> {
  await ctx.db
    .insertInto('usage_events')
    .values({
      at: ctx.now(),
      user_id: record.userId,
      session_id: record.sessionId,
      model_id: record.modelId,
      upstream_id: record.upstreamId,
      protocol: record.protocol,
      input_tokens: record.usage.input,
      output_tokens: record.usage.output,
      cache_write_tokens: record.usage.cacheWrite,
      cache_read_tokens: record.usage.cacheRead,
      weighted_units: weightedUnits(record.usage, record.costWeight),
      status: record.status,
      http_status: record.httpStatus,
      latency_ms: Math.round(record.latencyMs),
      client_version: record.clientVersion,
      upstream_request_id: record.upstreamRequestId,
    })
    .execute();
}
