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

import type { ToolResultContent } from '@maka/core/events';
import { TOOL_NAMES } from '@maka/core/tool-names';
import { z } from 'zod';

import type { ToolResultOutput } from './model-protocol.js';
import type { MakaTool } from './tool-runtime.js';

export const SEND_USER_MESSAGE_MAX_CHARS = 20_000;

/** What the model is told once the message has reached the conversation. */
export const SEND_USER_MESSAGE_DELIVERED = 'Message delivered to user.';

export const SEND_USER_MESSAGE_DESCRIPTION = [
  'Send a message the user will read verbatim. Use this for content they need to see exactly as written between tool calls — a generated code snippet, a specific value, a direct reply to something they asked mid-task.',
  "Don't use it for routine narration of what you're about to do, or for your final answer — normal text reaches them for those.",
].join(' ');

type SendUserMessageResult = Extract<ToolResultContent, { kind: 'user_message' }>;

export function buildSendUserMessageTool(): MakaTool<{ message: string }, SendUserMessageResult> {
  return {
    name: TOOL_NAMES.sendUserMessage,
    description: SEND_USER_MESSAGE_DESCRIPTION,
    // Sending the same message twice is the same message on screen, so a
    // crash-recovery replay may repeat the call without the user losing or
    // double-reading anything.
    recoveryMode: 'idempotent',
    parameters: z
      .object({
        message: z
          .string()
          .min(1)
          .max(SEND_USER_MESSAGE_MAX_CHARS)
          .describe('The message for the user. Supports markdown formatting.'),
      })
      .strict(),
    impl: ({ message }): SendUserMessageResult => ({ kind: 'user_message', message }),
    // The message is already on the user's screen; echoing it back into the
    // model's context would pay for the same text twice.
    toModelOutput: (): ToolResultOutput => ({
      type: 'text',
      value: SEND_USER_MESSAGE_DELIVERED,
    }),
  };
}
