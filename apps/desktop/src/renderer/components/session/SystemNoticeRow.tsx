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
  /** The model's description of the command or agent, or the command itself. */
  readonly title: string;
  readonly outcome: TaskOutcome;
  /** `exit code 1`, `timed out after 5000ms`, … — absent for a kill. */
  readonly detail?: string;
  /** Which kind of task ended; they read differently. */
  readonly kind: 'command' | 'agent';
}

/**
 * The notification escapes its own angle brackets so a task's words cannot
 * close the block and write the rest of it. Reading them back undoes that;
 * what reaches the screen is what the task was called.
 */
function decodeBlockText(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

const COMMAND_SUMMARY =
  /^Background command "([\s\S]*)" (completed|failed|killed)(?: \(([\s\S]*)\))?$/;
const AGENT_SUMMARY = /^Agent "([\s\S]*)" (finished|failed|killed)(?: \(([\s\S]*)\))?$/;

/** Every `<task-notification>` summary in the text, taken apart. */
export function taskNotices(text: string): TaskNotice[] {
  const notices: TaskNotice[] = [];
  for (const match of text.matchAll(/<summary>([\s\S]*?)<\/summary>/g)) {
    const summary = match[1]!.trim();
    const command = COMMAND_SUMMARY.exec(summary);
    if (command) {
      notices.push({
        kind: 'command',
        title: decodeBlockText(command[1]!),
        outcome: command[2] as TaskOutcome,
        ...(command[3] ? { detail: decodeBlockText(command[3]) } : {}),
      });
      continue;
    }
    const agent = AGENT_SUMMARY.exec(summary);
    if (agent) {
      notices.push({
        kind: 'agent',
        title: decodeBlockText(agent[1]!),
        // "finished" is the agent's word for completed.
        outcome: agent[2] === 'finished' ? 'completed' : (agent[2] as TaskOutcome),
        ...(agent[3] ? { detail: decodeBlockText(agent[3]) } : {}),
      });
      continue;
    }
    notices.push({ kind: 'command', title: decodeBlockText(summary), outcome: 'completed' });
  }
  return notices;
}

export const SystemNoticeRow = memo(function SystemNoticeRow(props: SystemNoticeRowProps) {
  const transcript = getTranscriptCopy(useUiLocale());
  const copy = transcript.taskFinished;
  const agentCopy = transcript.agentFinished;
  const notices = taskNotices(props.text);
  if (notices.length === 0) return null;
  return (
    // Flush left, like the prose and the tool group it sits between. It is a
    // peer of those, not a step inside one, and indenting it to a tool step's
    // column made it look nested under something that is not there.
    <div className="my-2" data-role="system" data-message-id={props.messageId}>
      {notices.map((notice, index) => (
        // The dot starts on the line the prose starts on: every paragraph in
        // `.standard-markdown` carries `padding-left: 0.5rem`, so the row takes
        // the same 8px and the marker, not the words, sits under the prose.
        // Nothing hangs further left than that, which matters because a settled
        // turn carries `content-visibility: auto`, whose paint containment
        // clips whatever is drawn outside the turn's own box.
        <p
          key={`${index}-${notice.title}`}
          className="flex items-start gap-2 py-1 pl-2 text-sm leading-5 text-text-muted [word-break:break-word]"
        >
          <span className="flex h-5 shrink-0 items-center">
            <span className="size-2 rounded-full bg-current" />
          </span>
          <span className="min-w-0">
            {(notice.kind === 'agent' ? agentCopy : copy)[notice.outcome](notice)}
          </span>
        </p>
      ))}
    </div>
  );
});
