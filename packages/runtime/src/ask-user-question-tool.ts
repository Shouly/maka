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

import { TOOL_NAMES } from '@maka/core/tool-names';
import { z } from 'zod';
import {
  USER_QUESTION_HEADER_MAX_CHARS,
  USER_QUESTION_MAX_OPTIONS,
  USER_QUESTION_MAX_QUESTIONS,
  USER_QUESTION_MIN_OPTIONS,
  USER_QUESTION_MIN_QUESTIONS,
  formatUserQuestionResultText,
  type UserQuestion,
  type UserQuestionResult,
} from '@maka/core/user-question';

import type { MakaTool } from './tool-runtime.js';

const optionSchema = z.object({
  label: z.string().min(1).describe('1-5 words.'),
  description: z.string().min(1),
});

const questionSchema = z.object({
  question: z.string().min(1),
  header: z
    .string()
    .min(1)
    .transform((value) => value.trim())
    .refine((value) => value.length > 0 && value.length <= USER_QUESTION_HEADER_MAX_CHARS, {
      message: `header must be at most ${USER_QUESTION_HEADER_MAX_CHARS} characters`,
    })
    .describe(
      `A short chip label like "Auth method", at most ${USER_QUESTION_HEADER_MAX_CHARS} characters.`,
    ),
  options: z.array(optionSchema).min(USER_QUESTION_MIN_OPTIONS).max(USER_QUESTION_MAX_OPTIONS),
  multiSelect: z.boolean().describe('Allow more than one answer to this question.'),
});

export function buildAskUserQuestionTool(): MakaTool<
  { questions: UserQuestion[] },
  UserQuestionResult
> {
  return {
    name: TOOL_NAMES.askUserQuestion,
    description: [
      "Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.",
      '',
      'Usage notes:',
      '- Users will always be able to select "Other" to provide custom text input',
      '- Use multiSelect: true to allow multiple answers to be selected for a question',
      '- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label',
      '',
      // The closing paragraph the reference ends on, and the one that does the
      // work: "blocked" at the top says WHEN, this says what to do instead the
      // rest of the time. `<starting>` turns on the same judgement — ask only
      // when a wrong guess is expensive — so leaving it out left the tool
      // sounding stricter than the rule it serves.
      //
      // NOT ported: the reference's plan-mode note. It names EnterPlanMode and
      // ExitPlanMode, which are not how plan mode is entered here, and Maka's
      // own plan-mode prompt already carries the rule for that mode ("use
      // AskUserQuestion only when a bounded answer is required") where it
      // applies rather than in a description that is always present.
      "Reserve this for decisions where the user's answer changes what you do next — not for choices with a conventional default or facts you can verify in the codebase yourself. In those cases pick the obvious option, mention it in your response, and proceed.",
    ].join('\n'),
    parameters: z.object({
      questions: z
        .array(questionSchema)
        .min(USER_QUESTION_MIN_QUESTIONS)
        .max(USER_QUESTION_MAX_QUESTIONS),
    }),
    impl: ({ questions }, context) => {
      // Unreachable from any ToolRuntime-driven call: ToolRuntime injects
      // `askUserQuestion` into every tool context unconditionally, so this
      // guard answers only an embedder that assembles its own MakaToolContext.
      // It is kept, and worded for a model, because that embedder exists and
      // its caller is still a model.
      if (!context.askUserQuestion)
        throw new Error(
          'AskUserQuestion is not available on this surface, so the user was not asked anything. ' +
            'Retrying will fail the same way — write the question and its options as ordinary reply text and wait for the user to answer.',
        );
      return context.askUserQuestion(questions);
    },
    // The durable result keeps the structured answers; the provider sees the
    // one-line pair list.
    toModelOutput: ({ output }) => ({
      type: 'text',
      value: formatUserQuestionResultText(output as UserQuestionResult),
    }),
  };
}
