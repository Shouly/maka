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

import type { ToolActivityItem } from '@maka/ui';

export function isAskUserQuestionTool(item: Pick<ToolActivityItem, 'toolName'>): boolean {
  return item.toolName === 'AskUserQuestion';
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
 * The questions from the call, each with the answer the result carries for it.
 * The Host returns `{ answers: [{ question, answer }] }` as JSON (or as text
 * that is JSON); answers are matched by position, so a result that is missing
 * or unreadable leaves every question unanswered rather than dropping it.
 */
export function askUserQuestionRecord(item: ToolActivityItem): AskUserQuestionPair[] {
  const questions = questionTexts(item.args);
  const result = item.result;
  let payload: unknown;
  if (result?.kind === 'json') payload = result.value;
  else if (result?.kind === 'text') {
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
