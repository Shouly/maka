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

// Copy for the session panel. Small enough to live in one file; it follows the
// locale catalog's shape so the hygiene gate sees three complete tables.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export interface SessionPanelCopy {
  readonly label: string;
  readonly progress: string;
  readonly empty: string;
  readonly unavailable: string;
  readonly count: (done: number, total: number) => string;
  /** The reference's own word for the files a task produced. */
  readonly outputs: string;
  readonly outputsEmpty: string;
  readonly outputsUnavailable: string;
  readonly openFile: (name: string) => string;
}

const COPY = {
  'zh-CN': {
    label: '会话面板',
    progress: '任务进度',
    empty: '这个会话还没有任务。',
    unavailable: '暂时读不到任务列表。',
    count: (done, total) => `${done} / ${total}`,
    outputs: '产出文件',
    outputsEmpty: '这个会话还没有产出文件。',
    outputsUnavailable: '暂时读不到文件列表。',
    openFile: (name) => `打开 ${name}`,
  },
  'zh-TW': {
    label: '工作階段面板',
    progress: '任務進度',
    empty: '這個工作階段還沒有任務。',
    unavailable: '暫時讀不到任務清單。',
    count: (done, total) => `${done} / ${total}`,
    outputs: '產出檔案',
    outputsEmpty: '這個工作階段還沒有產出檔案。',
    outputsUnavailable: '暫時讀不到檔案清單。',
    openFile: (name) => `開啟 ${name}`,
  },
  en: {
    label: 'Session panel',
    progress: 'Progress',
    empty: 'No tasks in this session yet.',
    unavailable: 'The task list is unavailable.',
    count: (done, total) => `${done} of ${total}`,
    outputs: 'Outputs',
    outputsEmpty: 'No files produced yet.',
    outputsUnavailable: 'The file list is unavailable.',
    openFile: (name) => `Open ${name}`,
  },
} satisfies UiCatalog<SessionPanelCopy>;

export function getSessionPanelCopy(locale: UiLocale): SessionPanelCopy {
  return COPY[locale];
}
