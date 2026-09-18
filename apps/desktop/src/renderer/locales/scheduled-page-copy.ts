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

// What the Scheduled page says that no existing catalog already says.
//
// Deliberately thin, like `modules-copy.ts`. `@maka/ui`'s
// `scheduled-task-copy.ts` is the pre-rewrite vocabulary for this surface and
// it survived the rewrite intact — the status names, the run outcomes, the
// countdown, the form's fields, "Snooze 10 minutes", "Clear history",
// "Duplicate", "Keep system awake" and the page's empty and no-match states all
// come from there, and `shell-remaining-copy.ts` owns the toasts and the two
// confirm dialogs. What is left over is of three kinds:
//
//   - the toolbar's SORT menu, which the rewrite draws as a menu with its
//     choice in the trigger ("Sort by Next run") rather than a bare selector
//     with a separate label, so the labels are shorter than the old ones;
//   - the RUN HISTORY dialog, which the pre-rewrite surface did not have (its
//     runs lived in a side inspector), including the link out to the session a
//     run produced;
//   - PAUSE and RESUME, which used to be a switch on the card and are now two
//     names in the ⋯ menu.
//
// There is no "Start from a template" section, and so no template rows: the
// reference page offers a new task and nothing else, and four prefabricated
// cadences below the list read as filler under a list the user has already
// filled themselves.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

/**
 * The three orders the list offers. `next-run` is the page's own display order
 * (active first, then by next fire) and stays the default, so arriving at the
 * page shows the task that is about to fire — the only one anybody is looking
 * for.
 */
export type ScheduledPageSort = 'next-run' | 'name' | 'created';

export type ScheduledPageCopy = {
  /** The sort menu's trigger, which carries its own current choice. */
  /** The sort menu's heading, and the icon button's accessible name. */
  sortBy: string;
  sortOptions: ReadonlyArray<readonly [ScheduledPageSort, string]>;
  /** The card body and the ⋯ menu's first row: both open the task's page. */
  openTask(title: string): string;
  open: string;
  /** The ⋯ menu's two halves of what used to be the card's switch. */
  pause: string;
  resume: string;
  /** A run's session has been deleted since the run was recorded. */
  runSessionGone: string;
  unreadRun: string;
};

const SCHEDULED_PAGE_COPY = {
  'zh-CN': {
    sortBy: '排序方式',
    sortOptions: [
      ['next-run', '下次触发'],
      ['name', '标题'],
      ['created', '创建时间'],
    ],
    openTask: (title) => `打开「${title}」`,
    open: '打开',
    pause: '暂停',
    resume: '恢复',
    runSessionGone: '这次运行的任务已被删除。',
    unreadRun: '未读',
  },
  'zh-TW': {
    sortBy: '排序方式',
    sortOptions: [
      ['next-run', '下次觸發'],
      ['name', '標題'],
      ['created', '建立時間'],
    ],
    openTask: (title) => `開啟「${title}」`,
    open: '開啟',
    pause: '暫停',
    resume: '恢復',
    runSessionGone: '這次執行的任務已被刪除。',
    unreadRun: '未讀',
  },
  en: {
    sortBy: 'Sort by',
    sortOptions: [
      ['next-run', 'Next run'],
      ['name', 'Name'],
      ['created', 'Created'],
    ],
    openTask: (title) => `Open ${title}`,
    open: 'Open',
    pause: 'Pause',
    resume: 'Resume',
    runSessionGone: 'That run’s task has been deleted.',
    unreadRun: 'Unread',
  },
} satisfies UiCatalog<ScheduledPageCopy>;

export function getScheduledPageCopy(locale: UiLocale): ScheduledPageCopy {
  return SCHEDULED_PAGE_COPY[locale];
}
