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

// Copy for the overlays the shell owns that `shell-copy.ts` does not already
// carry: the full-text search modal, and the two palette commands Phase 2
// added (the runtime debug page and the connection group's empty state).
// The palette's own command labels, groups and keyboard-help sections stay in
// `shell-copy.ts` — they were written for exactly these surfaces.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export interface PaletteCopy {
  readonly search: {
    readonly title: string;
    readonly description: string;
    readonly inputLabel: string;
    readonly placeholder: string;
    readonly resultsLabel: string;
    readonly searching: string;
    readonly idle: string;
    readonly empty: string;
    readonly failed: string;
    readonly close: string;
    readonly openResult: (title: string) => string;
  };
  readonly commands: {
    readonly runtimeDebug: string;
    readonly runtimeDebugGroup: string;
    readonly runtimeDebugKeywords: readonly string[];
  };
}

const PALETTE_COPY = {
  'zh-CN': {
    search: {
      title: '搜索任务',
      description: '在所有 Host 的任务记录里全文搜索。',
      inputLabel: '搜索词',
      placeholder: '搜索任务与消息…',
      resultsLabel: '搜索结果',
      searching: '正在搜索…',
      idle: '输入关键词开始搜索。',
      empty: '没有找到匹配的内容。',
      failed: '搜索失败。',
      close: '关闭搜索',
      openResult: (title) => `打开「${title}」`,
    },
    commands: {
      runtimeDebug: '打开运行时调试页',
      runtimeDebugGroup: '诊断',
      runtimeDebugKeywords: ['debug', 'runtime', 'diagnostics', '调试', '运行时'],
    },
  },
  'zh-TW': {
    search: {
      title: '搜尋任務',
      description: '在所有 Host 的任務記錄裡全文搜尋。',
      inputLabel: '搜尋詞',
      placeholder: '搜尋任務與訊息…',
      resultsLabel: '搜尋結果',
      searching: '正在搜尋…',
      idle: '輸入關鍵字開始搜尋。',
      empty: '沒有找到符合的內容。',
      failed: '搜尋失敗。',
      close: '關閉搜尋',
      openResult: (title) => `開啟「${title}」`,
    },
    commands: {
      runtimeDebug: '開啟執行階段偵錯頁',
      runtimeDebugGroup: '診斷',
      runtimeDebugKeywords: ['debug', 'runtime', 'diagnostics', '偵錯', '執行階段'],
    },
  },
  en: {
    search: {
      title: 'Search tasks',
      description: 'Full-text search across every Host you have.',
      inputLabel: 'Search',
      placeholder: 'Search tasks and messages…',
      resultsLabel: 'Search results',
      searching: 'Searching…',
      idle: 'Type to search.',
      empty: 'Nothing matched.',
      failed: 'The search failed.',
      close: 'Close search',
      openResult: (title) => `Open ${title}`,
    },
    commands: {
      runtimeDebug: 'Open runtime debug',
      runtimeDebugGroup: 'Diagnostics',
      runtimeDebugKeywords: ['debug', 'runtime', 'diagnostics', 'inspect'],
    },
  },
} satisfies UiCatalog<PaletteCopy>;

export function getPaletteCopy(locale: UiLocale): PaletteCopy {
  return PALETTE_COPY[locale];
}
