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

// AskUserQuestion is the one tool whose "result" is the user's own words, so
// the transcript draws it as a question-and-answer record (AskUserQuestionRecord)
// standing on its own in the flow, never as a row inside a work group — the
// reference design keeps it out of the tool renderers for the same reason: a
// settled group folds away, and the answers the user gave must not.

import { createStore } from 'zustand/vanilla';
import type { UserQuestionRequest, UserQuestionResponse } from '@maka/core/user-question';
import type { ToolActivityItem } from '@maka/ui';

/**
 * Known by name, or by the call the Host asked the question for. The Host's
 * live events carry no tool name — the projection fills in "Tool" — and that
 * live copy wins over the persisted one for as long as the turn runs, so for
 * the whole turn the name alone cannot say what this item is. The
 * `user_question_request` names the toolUseId, and that is remembered.
 */
export function isAskUserQuestionTool(
  item: Pick<ToolActivityItem, 'toolName' | 'toolUseId'>,
  known: Readonly<Record<string, unknown>> = knownUserQuestionCalls.getState().byToolUseId,
): boolean {
  return item.toolName === 'AskUserQuestion' || known[item.toolUseId] !== undefined;
}

export interface AskUserQuestionPair {
  readonly question: string;
  /** `null` when the user skipped it, stopped, or the turn ended first. */
  readonly answer: string | null;
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function questionTexts(args: unknown): string[] {
  const questions = recordOf(args)?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((entry) => {
    const text = recordOf(entry)?.question;
    return typeof text === 'string' && text.trim() ? [text] : [];
  });
}

/**
 * The questions from the call, each with the answer the result carries for it,
 * or `undefined` while the call has no result to read. The Host returns
 * `{ answers: [{ question, answer }] }` as JSON (or as text that is JSON);
 * answers are matched by position, so an unreadable result leaves every
 * question unanswered rather than dropping it.
 *
 * "No result" is a real state, not an empty one: the Host's live events carry
 * neither arguments nor results, so between the tool settling and the
 * transcript refresh the item has a status and nothing else. Drawing "No
 * answer" for that moment would be a lie; `rememberedUserQuestionRecord`
 * covers it instead.
 */
export function askUserQuestionRecord(item: ToolActivityItem): AskUserQuestionPair[] | undefined {
  const result = item.result;
  if (result === undefined) return undefined;
  const questions = questionTexts(item.args);
  let payload: unknown;
  if (result.kind === 'json') payload = result.value;
  else if (result.kind === 'text') {
    try {
      payload = JSON.parse(result.text);
    } catch {
      payload = undefined;
    }
  }
  const answers = recordOf(payload)?.answers;
  const answered = Array.isArray(answers)
    ? answers.map((entry) => {
        const answer = recordOf(entry)?.answer;
        return typeof answer === 'string' && answer.trim() ? answer : null;
      })
    : [];
  return questions.map((question, index) => ({ question, answer: answered[index] ?? null }));
}

// ── The calls the Host asked questions for, and what the user answered ──────
//
// Recorded when the request reaches the prompt (questions) and again when it
// is answered (answers). The timeline uses the ids to tell the item apart from
// any other tool, and the record card reads the answers from here until the
// transcript carries the persisted result — the Host's live events carry
// neither arguments nor results, only a status.

export interface KnownUserQuestionCall {
  readonly questions: readonly string[];
  /** Undefined while the question is still open. */
  readonly answers?: readonly (string | null)[];
}

export const knownUserQuestionCalls = createStore<{
  readonly byToolUseId: Readonly<Record<string, KnownUserQuestionCall>>;
}>(() => ({ byToolUseId: {} }));

export function rememberUserQuestionRequest(request: UserQuestionRequest): void {
  knownUserQuestionCalls.setState((state) => {
    if (state.byToolUseId[request.toolUseId]) return state;
    return {
      byToolUseId: {
        ...state.byToolUseId,
        [request.toolUseId]: { questions: request.questions.map((q) => q.question) },
      },
    };
  });
}

/** The remembered call as record pairs, or undefined while it is still open. */
export function rememberedUserQuestionRecord(
  call: KnownUserQuestionCall | undefined,
): AskUserQuestionPair[] | undefined {
  if (!call?.answers) return undefined;
  const answers = call.answers;
  return call.questions.map((question, index) => ({ question, answer: answers[index] ?? null }));
}

/** Sends the response and remembers what it said, keyed by the call it answers. */
export async function answerUserQuestion(
  request: UserQuestionRequest,
  response: UserQuestionResponse,
  send: (response: UserQuestionResponse) => Promise<void>,
): Promise<void> {
  await send(response);
  knownUserQuestionCalls.setState((state) => ({
    byToolUseId: {
      ...state.byToolUseId,
      [request.toolUseId]: {
        questions: request.questions.map((q) => q.question),
        answers: response.answers,
      },
    },
  }));
}
