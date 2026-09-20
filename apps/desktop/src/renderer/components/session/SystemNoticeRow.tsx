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

// A background task ended and the model was told. Neither the reader nor the
// model said anything, so the transcript gets neither a bubble nor a tool
// row: it gets one plain sentence, in the muted register of a note, that
// says what happened and why the answer below it exists — "the task
// finished; Copilot was told and went on". A task the reader stopped
// themselves just says it stopped.

import { memo } from 'react';
import { useUiLocale } from '@maka/ui';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';

export interface SystemNoticeRowProps {
  messageId: string;
  text: string;
}

export type TaskOutcome = 'completed' | 'failed' | 'killed';

export interface TaskNotice {
  /** The model's description of the command, or the command itself. */
  readonly title: string;
  readonly outcome: TaskOutcome;
  /** `exit code 1`, `timed out after 5000ms`, … — absent for a kill. */
  readonly detail?: string;
}

const SUMMARY = /^Background command "([\s\S]*)" (completed|failed|killed)(?: \(([\s\S]*)\))?$/;

/** Every `<task-notification>` summary in the text, taken apart. */
export function taskNotices(text: string): TaskNotice[] {
  const notices: TaskNotice[] = [];
  for (const match of text.matchAll(/<summary>([\s\S]*?)<\/summary>/g)) {
    const summary = match[1]!.trim();
    const parsed = SUMMARY.exec(summary);
    if (!parsed) {
      notices.push({ title: summary, outcome: 'completed' });
      continue;
    }
    notices.push({
      title: parsed[1]!,
      outcome: parsed[2] as TaskOutcome,
      ...(parsed[3] ? { detail: parsed[3] } : {}),
    });
  }
  return notices;
}

export const SystemNoticeRow = memo(function SystemNoticeRow(props: SystemNoticeRowProps) {
  const copy = getTranscriptCopy(useUiLocale()).taskFinished;
  const notices = taskNotices(props.text);
  if (notices.length === 0) return null;
  return (
    <div
      className="my-2 flex flex-col gap-1 pl-2"
      data-role="system"
      data-message-id={props.messageId}
    >
      {notices.map((notice, index) => (
        <p
          key={`${index}-${notice.title}`}
          className="flex items-start gap-2 text-sm leading-5 text-text-muted"
        >
          {/* A 20px cell, the line's height, so the dot sits on the first line's middle. */}
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            <span className="size-2 rounded-full bg-border-strong" />
          </span>
          <span className="min-w-0 [word-break:break-word]">{copy[notice.outcome](notice)}</span>
        </p>
      ))}
    </div>
  );
});
