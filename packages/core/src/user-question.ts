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

/** Questions per AskUserQuestion call. */
export const USER_QUESTION_MIN_QUESTIONS = 1;
export const USER_QUESTION_MAX_QUESTIONS = 4;
/** Options per question. The UI always adds its own "Other" row on top of these. */
export const USER_QUESTION_MIN_OPTIONS = 2;
export const USER_QUESTION_MAX_OPTIONS = 4;
/** The header is a chip label above the question, so it stays short. */
export const USER_QUESTION_HEADER_MAX_CHARS = 12;

export interface UserQuestionOption {
  label: string;
  description?: string;
}

export interface UserQuestion {
  question: string;
  /** Chip label, at most {@link USER_QUESTION_HEADER_MAX_CHARS} characters. */
  header: string;
  options: UserQuestionOption[];
  /** When true the user may pick several options. Defaults to false. */
  multiSelect?: boolean;
}

export interface UserQuestionRequest {
  requestId: string;
  toolUseId: string;
  questions: UserQuestion[];
}

export interface UserQuestionResponse {
  requestId: string;
  /**
   * One answer per question, in request order. A string is one option label or
   * the user's own typed text; a string array is a multi-select selection;
   * `null` means skipped or dismissed.
   */
  answers: Array<string | string[] | null>;
}

export interface UserQuestionResultEntry {
  question: string;
  /** Joined display text for compatibility. `null` when the question was skipped. */
  answer: string | null;
  /** The option labels that were selected; empty for typed text or a skip. */
  selected: string[];
}

export interface UserQuestionResult {
  answers: UserQuestionResultEntry[];
}

/** Multi-select answers join with this separator wherever one string is needed. */
export const USER_QUESTION_ANSWER_SEPARATOR = ', ';

/**
 * Read one wire answer against the question it belongs to. Unknown entries are
 * the user's own text, so they join into `answer` but never into `selected`.
 */
export function resolveUserQuestionAnswer(
  question: UserQuestion,
  answer: string | string[] | null | undefined,
): UserQuestionResultEntry {
  const labels = new Set((question.options ?? []).map((option) => option.label));
  const entry = (values: readonly string[]): UserQuestionResultEntry => ({
    question: question.question,
    answer: values.length === 0 ? null : values.join(USER_QUESTION_ANSWER_SEPARATOR),
    selected: values.filter((value) => labels.has(value)),
  });
  if (answer === null || answer === undefined) return entry([]);
  if (Array.isArray(answer)) return entry(answer.filter((value) => value.length > 0));
  return entry(answer.length === 0 ? [] : [answer]);
}

/**
 * The provider-facing result text. One `"question"="answer"` pair per question,
 * in request order; a skipped question keeps its pair with an empty answer so
 * the model can see that it went unanswered.
 */
export function formatUserQuestionResultText(result: UserQuestionResult): string {
  const pairs = result.answers.map((entry) => `"${entry.question}"="${entry.answer ?? ''}"`);
  return `Your questions have been answered: ${pairs.join(USER_QUESTION_ANSWER_SEPARATOR)}`;
}

/** Whether one `UserQuestionResponse.answers` element is a shape the wire accepts. */
export function isUserQuestionAnswerValue(value: unknown): value is string | string[] | null {
  if (value === null) return true;
  if (typeof value === 'string') return value.length > 0;
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0)
  );
}
