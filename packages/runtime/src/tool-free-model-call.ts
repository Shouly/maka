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

import type { ModelMessage } from './model-protocol.js';
import { normalizeAiSdkUsage, type AiSdkUsageLike } from './model-adapter.js';
import { rawFinishReasonString, type NormalizedUsage } from './model-protocol.js';

export type ToolFreeModelCallContent =
  | { readonly prompt: string; readonly messages?: never }
  | { readonly prompt?: never; readonly messages: readonly ModelMessage[] };

export type ToolFreeModelCallInput = ToolFreeModelCallContent & {
  readonly model: unknown;
  /** Optional original Agent system prefix for cache-compatible auxiliary calls. */
  readonly system?: string;
  readonly providerOptions?: unknown;
  readonly abortSignal?: AbortSignal;
  readonly maxOutputTokens: number;
  readonly maxRetries?: number;
};

export interface ToolFreeModelCallResult {
  readonly text: string;
  readonly usage?: NormalizedUsage;
  readonly finishReason?: string;
}

export async function generateToolFreeModelCall(
  input: ToolFreeModelCallInput,
): Promise<ToolFreeModelCallResult> {
  const ai = (await import('ai')) as unknown as {
    generateText(options: Record<string, unknown>): Promise<{
      text: string;
      usage?: AiSdkUsageLike;
      finishReason?: unknown;
    }>;
  };
  const result = await ai.generateText({
    model: input.model,
    ...(input.system === undefined ? {} : { system: input.system }),
    ...(input.prompt === undefined ? { messages: input.messages } : { prompt: input.prompt }),
    ...(input.abortSignal === undefined ? {} : { abortSignal: input.abortSignal }),
    ...(input.providerOptions === undefined ? {} : { providerOptions: input.providerOptions }),
    maxOutputTokens: input.maxOutputTokens,
    ...(input.maxRetries === undefined ? {} : { maxRetries: input.maxRetries }),
  });
  const usage = normalizeAiSdkUsage(result.usage, { rawFinishReason: result.finishReason });
  const finishReason = rawFinishReasonString(result.finishReason);
  return {
    text: result.text,
    ...(usage ? { usage } : {}),
    ...(finishReason ? { finishReason } : {}),
  };
}
