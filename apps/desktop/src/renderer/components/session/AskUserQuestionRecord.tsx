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

// The transcript's record of an AskUserQuestion call, once it is answered.
//
// The reference design's AskUserSummary, one to one: a bordered card in the
// flow — never inside a work group, which folds when the run ends — with each
// question in muted text and the user's answer in body text, "No answer"
// where there was none. While the question is open nothing stands here; the
// prompt above the composer and the status line carry it. The Host's own
// result phrasing is written for the model and never shown.

import { useUiLocale, type ToolActivityItem } from '@maka/ui';
import { cn } from '../../lib/cn.js';
import { askUserQuestionRecord } from '../../lib/ask-user-question.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';

export function AskUserQuestionRecord(props: { item: ToolActivityItem }) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).tools;
  const record = askUserQuestionRecord(props.item);
  if (record.length === 0) return null;

  return (
    <dl
      className="my-3 flex min-w-0 flex-col gap-3 rounded-xl border border-hairline p-4"
      data-maka-ask-user-record={props.item.toolUseId}
    >
      {record.map((pair, index) => (
        <div key={`${index}-${pair.question}`} className="flex min-w-0 flex-col gap-1">
          <dt className="text-sm leading-5 text-text-muted">{pair.question}</dt>
          <dd
            className={cn(
              'text-sm leading-5',
              pair.answer === null ? 'text-text-muted' : 'text-text-primary',
            )}
          >
            {pair.answer ?? copy.noAnswer}
          </dd>
        </div>
      ))}
    </dl>
  );
}
