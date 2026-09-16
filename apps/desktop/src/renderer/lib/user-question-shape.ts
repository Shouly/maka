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

// AskUserQuestion's Phase 8b shape, read structurally, and the draft model the
// panel edits.
//
// The shapes come from `@maka/core/user-question`; the readers here validate a
// wire payload against them, and the draft model is the panel's own.
//
// Everything in here is pure. The panel (`InteractionPrompts`), the composer's
// send-as-answer path (`ChatInput`) and the settled record
// (`AskUserQuestionRecord`) all read the same functions, which is what keeps
// the three from disagreeing about what the user chose.

import type {
  UserQuestion,
  UserQuestionOption,
  UserQuestionRequest,
  UserQuestionResponse,
} from '@maka/core/user-question';

/** An option as `@maka/core/user-question` declares it. */
export type UserQuestionOptionShape = UserQuestionOption;

/** A question as the panel reads it. */
export type UserQuestionShape = Omit<UserQuestion, 'options'> & {
  readonly options: readonly UserQuestionOptionShape[];
};

/** One question's answer: a label, several labels, or nothing. */
export type UserQuestionAnswer = string | readonly string[] | null;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textOf(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readOption(value: unknown): UserQuestionOptionShape | undefined {
  const record = asRecord(value);
  const label = textOf(record, 'label');
  if (!label) return undefined;
  const description = textOf(record, 'description');
  return {
    label,
    ...(description ? { description } : {}),
  };
}

/** One question, read from whatever the Host or the transcript carries. */
export function readUserQuestion(value: unknown): UserQuestionShape | undefined {
  const record = asRecord(value);
  const question = textOf(record, 'question');
  if (!question) return undefined;
  const header = textOf(record, 'header');
  if (!header) return undefined;
  const options = Array.isArray(record?.options)
    ? record.options.flatMap((entry) => {
        const option = readOption(entry);
        return option ? [option] : [];
      })
    : [];
  return {
    question,
    header,
    options,
    ...(record?.multiSelect === true ? { multiSelect: true } : {}),
  };
}

/** Every question of a live request or a recorded call's arguments. */
export function readUserQuestions(value: unknown): UserQuestionShape[] {
  const questions = asRecord(value)?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.flatMap((entry) => {
    const question = readUserQuestion(entry);
    return question ? [question] : [];
  });
}

// ── Drafts ─────────────────────────────────────────────────────────────────

/**
 * What the panel holds for one question before it is sent.
 *
 * `options` (plural) is the multi-select draft and is kept as indexes rather
 * than labels: the label is derived at submit time from the question, so a
 * draft can never name an option the question does not have.
 */
export type QuestionDraft =
  | { readonly kind: 'option'; readonly optionIndex: number }
  | { readonly kind: 'options'; readonly optionIndexes: readonly number[] }
  | { readonly kind: 'other'; readonly value: string }
  | null;

export function createQuestionDrafts(questions: readonly UserQuestionShape[]): QuestionDraft[] {
  return questions.map((): QuestionDraft => null);
}

/** Whether a draft is complete enough to page away from or submit. */
export function canLeaveQuestion(draft: QuestionDraft): boolean {
  if (draft?.kind === 'other') return draft.value.trim().length > 0;
  if (draft?.kind === 'options') return draft.optionIndexes.length > 0;
  return true;
}

/** Whether an option index is picked in a draft, single or multi. */
export function draftHasOption(draft: QuestionDraft, optionIndex: number): boolean {
  if (draft?.kind === 'option') return draft.optionIndex === optionIndex;
  if (draft?.kind === 'options') return draft.optionIndexes.includes(optionIndex);
  return false;
}

/**
 * Adds or removes one option from a multi-select draft.
 *
 * A draft that was free text is replaced rather than merged: the text row is
 * an answer of its own, and silently keeping it beside a tick would submit
 * something the user never saw selected.
 */
export function toggleDraftOption(draft: QuestionDraft, optionIndex: number): QuestionDraft {
  const picked = draft?.kind === 'options' ? draft.optionIndexes : [];
  const next = picked.includes(optionIndex)
    ? picked.filter((index) => index !== optionIndex)
    : [...picked, optionIndex].sort((left, right) => left - right);
  return next.length > 0 ? { kind: 'options', optionIndexes: next } : null;
}

/** One question's drafted answer, as the tool will read it. */
export function draftAnswer(
  question: UserQuestionShape | undefined,
  draft: QuestionDraft,
): UserQuestionAnswer {
  if (!draft || !question) return null;
  if (draft.kind === 'other') return draft.value.trim() || null;
  if (draft.kind === 'option') return question.options[draft.optionIndex]?.label ?? null;
  const labels = draft.optionIndexes.flatMap((index) => {
    const label = question.options[index]?.label;
    return label ? [label] : [];
  });
  return labels.length > 0 ? labels : null;
}

/** The response for a request, in request order; multi-select answers are copied out of the draft. */
export function buildUserQuestionResponse(
  request: Pick<UserQuestionRequest, 'requestId'>,
  questions: readonly UserQuestionShape[],
  drafts: readonly QuestionDraft[],
): UserQuestionResponse {
  const answers = questions.map((question, index) => {
    const answer = draftAnswer(question, drafts[index] ?? null);
    return typeof answer === 'string' || answer === null ? answer : [...answer];
  });
  return { requestId: request.requestId, answers };
}

/**
 * A recorded answer as the lines to draw for it — empty when unanswered.
 *
 * A multi-select answer stays several lines rather than one joined string:
 * the joiner would have to be a locale's, and a record card that has the
 * labels can lay them out itself.
 */
export function answerLines(answer: UserQuestionAnswer): readonly string[] {
  if (answer === null) return [];
  if (typeof answer === 'string') return answer.trim() ? [answer] : [];
  return answer.filter((label) => typeof label === 'string' && label.trim());
}
