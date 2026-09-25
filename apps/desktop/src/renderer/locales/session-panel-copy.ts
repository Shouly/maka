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
  readonly loading: string;
  readonly progress: string;
  readonly unavailable: string;
  /** The reference's own word for the files a task produced. */
  readonly outputs: string;
  readonly outputsUnavailable: string;
  /** The panel with nothing in any section: one empty state, not empty sections. */
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly close: string;
  readonly outputCount: (count: number) => string;
  /** The header switch while a task is under way: which step, of how many. */
  readonly stepOf: (current: number, total: number) => string;
  readonly earlierSteps: (count: number) => string;
  /** Said after a task's name to a screen reader; `stopped` is a running task whose turn ended. */
  readonly taskState: {
    readonly completed: string;
    readonly running: string;
    readonly stopped: string;
    readonly pending: string;
  };
  readonly hideEarlier: string;
  readonly closePreview: string;
  readonly usedInSession: string;
  readonly uploads: string;
  readonly downloadAll: string;
  readonly downloadFailed: string;
  readonly blockedBy: (ids: readonly string[]) => string;
  readonly openFile: (name: string) => string;
}

const COPY = {
  'zh-CN': {
    label: '会话面板',
    loading: '正在载入…',
    progress: '任务进度',
    unavailable: '暂时读不到任务列表。',
    outputs: '产出文件',
    outputsUnavailable: '暂时读不到文件列表。',
    emptyTitle: '这里还没有内容',
    emptyBody: '这个会话的任务和产出文件会显示在这里。',
    openFile: (name) => `打开 ${name}`,
    close: '关闭会话面板',
    outputCount: (count) => `${count} 份产出文件`,
    stepOf: (current, total) => `第 ${current} 步，共 ${total} 步`,
    earlierSteps: (count) => `${count} 个较早步骤`,
    taskState: { completed: '已完成', running: '进行中', stopped: '已停止', pending: '未开始' },
    hideEarlier: '收起较早步骤',
    closePreview: '关闭预览',
    usedInSession: '本会话使用',
    uploads: '上传文件',
    downloadAll: '全部下载',
    downloadFailed: '下载文件失败',
    blockedBy: (ids) => `受阻于 #${ids.join(', #')}`,
  },
  'zh-TW': {
    label: '工作階段面板',
    loading: '正在載入…',
    progress: '任務進度',
    unavailable: '暫時讀不到任務清單。',
    outputs: '產出檔案',
    outputsUnavailable: '暫時讀不到檔案清單。',
    emptyTitle: '這裡還沒有內容',
    emptyBody: '這個工作階段的任務和產出檔案會顯示在這裡。',
    openFile: (name) => `開啟 ${name}`,
    close: '關閉工作階段面板',
    outputCount: (count) => `${count} 份產出檔案`,
    stepOf: (current, total) => `第 ${current} 步，共 ${total} 步`,
    earlierSteps: (count) => `${count} 個較早步驟`,
    taskState: { completed: '已完成', running: '進行中', stopped: '已停止', pending: '未開始' },
    hideEarlier: '收起較早步驟',
    closePreview: '關閉預覽',
    usedInSession: '本工作階段使用',
    uploads: '上傳檔案',
    downloadAll: '全部下載',
    downloadFailed: '下載檔案失敗',
    blockedBy: (ids) => `受阻於 #${ids.join(', #')}`,
  },
  en: {
    label: 'Session panel',
    loading: 'Loading…',
    progress: 'Progress',
    unavailable: 'The task list is unavailable.',
    outputs: 'Outputs',
    outputsUnavailable: 'The file list is unavailable.',
    emptyTitle: 'Nothing here yet',
    emptyBody: 'Tasks and files from this session will show up here.',
    openFile: (name) => `Open ${name}`,
    close: 'Close session panel',
    outputCount: (count) => `${count} outputs`,
    stepOf: (current, total) => `Step ${current} of ${total}`,
    earlierSteps: (count) => `${count} earlier ${count === 1 ? 'step' : 'steps'}`,
    taskState: {
      completed: 'Done',
      running: 'In progress',
      stopped: 'Stopped',
      pending: 'Not started',
    },
    hideEarlier: 'Hide earlier steps',
    closePreview: 'Close preview',
    usedInSession: 'Used in this session',
    uploads: 'Uploads',
    downloadAll: 'Download all',
    downloadFailed: 'Could not download files',
    blockedBy: (ids) => `blocked by #${ids.join(', #')}`,
  },
} satisfies UiCatalog<SessionPanelCopy>;

export function getSessionPanelCopy(locale: UiLocale): SessionPanelCopy {
  return COPY[locale];
}
