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
//   - the TEMPLATES section. `@maka/ui`'s `templates` are the pre-rewrite
//     consumer-flavoured four (download-folder cleanup, a midday reset, a
//     weekend to-do sweep, a news digest). This page belongs to a local coding
//     agent, so it offers four that are about a repository instead. They are
//     `ScheduledTaskExampleTemplate` rows so `scheduledTaskTemplateSeed` can
//     turn them into a form seed unchanged.

import type { ScheduledTaskExampleTemplate } from '@maka/ui';
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
  /** The run-history dialog's title. */
  runHistoryTitle(title: string): string;
  /** The dialog's per-run link to the session that run started. */
  openSession: string;
  /** Reached from the ⋯ menu; names the task so the item is unambiguous. */
  viewRunHistory: string;
  templatesTitle: string;
  templatesDescription: string;
  useTemplate(title: string): string;
  templates: readonly ScheduledTaskExampleTemplate[];
};

const SCHEDULED_PAGE_COPY = {
  'zh-CN': {
    sortBy: '排序方式',
    sortOptions: [
      ['next-run', '下次触发'],
      ['name', '标题'],
      ['created', '创建时间'],
    ],
    runHistoryTitle: (title) => `“${title}”的执行记录`,
    openSession: '打开任务',
    viewRunHistory: '执行记录',
    templatesTitle: '从模板开始',
    templatesDescription: '选一个模板，创建表单会预填好它的内容和频率。',
    useTemplate: (title) => `使用模板：${title}`,
    templates: [
      {
        id: 'repo-morning-briefing',
        title: '每日仓库简报',
        note: '总结这个仓库昨天之后的变化：新提交、待合并的 PR、失败的检查，然后指出今天最该先处理的一件事。',
        scheduleLabel: '工作日 09:00',
        recurrence: 'cron',
        cronExpression: '0 9 * * 1-5',
        nextRun: { hour: 9, minute: 0 },
      },
      {
        id: 'repo-weekly-review',
        title: '每周复盘',
        note: '回顾本周的提交和已合并的 PR，列出交付了什么、什么被推迟了，并拟定下周的三个优先事项。',
        scheduleLabel: '每周五 17:00',
        recurrence: 'cron',
        cronExpression: '0 17 * * 5',
        nextRun: { weekday: 5, hour: 17, minute: 0 },
      },
      {
        id: 'repo-dependency-triage',
        title: '依赖巡检',
        note: '检查过期或存在漏洞的依赖，按风险分组，并给出这周值得做的升级建议。',
        scheduleLabel: '每周一 10:00',
        recurrence: 'cron',
        cronExpression: '0 10 * * 1',
        nextRun: { weekday: 1, hour: 10, minute: 0 },
      },
      {
        id: 'repo-inbox-triage',
        title: '待办收件箱整理',
        note: '过一遍上次运行之后新增的 issue 和代码评审意见，打好标签，并为只需要回复的那些起草答复。',
        scheduleLabel: '工作日 14:00',
        recurrence: 'cron',
        cronExpression: '0 14 * * 1-5',
        nextRun: { hour: 14, minute: 0 },
      },
    ],
  },
  'zh-TW': {
    sortBy: '排序方式',
    sortOptions: [
      ['next-run', '下次觸發'],
      ['name', '標題'],
      ['created', '建立時間'],
    ],
    runHistoryTitle: (title) => `「${title}」的執行記錄`,
    openSession: '開啟任務',
    viewRunHistory: '執行記錄',
    templatesTitle: '從模板開始',
    templatesDescription: '選一個模板，建立表單會預先填好它的內容和頻率。',
    useTemplate: (title) => `使用模板：${title}`,
    templates: [
      {
        id: 'repo-morning-briefing',
        title: '每日倉庫簡報',
        note: '總結這個倉庫昨天之後的變化：新提交、待合併的 PR、失敗的檢查，然後指出今天最該先處理的一件事。',
        scheduleLabel: '工作日 09:00',
        recurrence: 'cron',
        cronExpression: '0 9 * * 1-5',
        nextRun: { hour: 9, minute: 0 },
      },
      {
        id: 'repo-weekly-review',
        title: '每週復盤',
        note: '回顧本週的提交和已合併的 PR，列出交付了什麼、什麼被推遲了，並擬定下週的三個優先事項。',
        scheduleLabel: '每週五 17:00',
        recurrence: 'cron',
        cronExpression: '0 17 * * 5',
        nextRun: { weekday: 5, hour: 17, minute: 0 },
      },
      {
        id: 'repo-dependency-triage',
        title: '相依套件巡檢',
        note: '檢查過期或存在漏洞的相依套件，按風險分組，並給出這週值得做的升級建議。',
        scheduleLabel: '每週一 10:00',
        recurrence: 'cron',
        cronExpression: '0 10 * * 1',
        nextRun: { weekday: 1, hour: 10, minute: 0 },
      },
      {
        id: 'repo-inbox-triage',
        title: '待辦收件匣整理',
        note: '過一遍上次執行之後新增的 issue 和程式碼審查意見，打好標籤，並為只需要回覆的那些起草答覆。',
        scheduleLabel: '工作日 14:00',
        recurrence: 'cron',
        cronExpression: '0 14 * * 1-5',
        nextRun: { hour: 14, minute: 0 },
      },
    ],
  },
  en: {
    sortBy: 'Sort by',
    sortOptions: [
      ['next-run', 'Next run'],
      ['name', 'Name'],
      ['created', 'Created'],
    ],
    runHistoryTitle: (title) => `Run history for ${title}`,
    openSession: 'Open the task',
    viewRunHistory: 'Run history',
    templatesTitle: 'Start from a template',
    templatesDescription:
      'Pick one and the create form opens with its prompt and cadence filled in.',
    useTemplate: (title) => `Use template: ${title}`,
    templates: [
      {
        id: 'repo-morning-briefing',
        title: 'Morning repository briefing',
        note: 'Summarise what changed in this repository since yesterday: new commits, open pull requests, failing checks. Then name the one thing worth picking up first today.',
        scheduleLabel: 'Weekdays at 09:00',
        recurrence: 'cron',
        cronExpression: '0 9 * * 1-5',
        nextRun: { hour: 9, minute: 0 },
      },
      {
        id: 'repo-weekly-review',
        title: 'Weekly review',
        note: "Review this week's commits and merged pull requests. List what shipped, what slipped, and draft the three priorities for next week.",
        scheduleLabel: 'Fridays at 17:00',
        recurrence: 'cron',
        cronExpression: '0 17 * * 5',
        nextRun: { weekday: 5, hour: 17, minute: 0 },
      },
      {
        id: 'repo-dependency-triage',
        title: 'Dependency triage',
        note: 'Check for outdated or vulnerable dependencies, group them by risk, and propose the upgrades worth doing this week.',
        scheduleLabel: 'Mondays at 10:00',
        recurrence: 'cron',
        cronExpression: '0 10 * * 1',
        nextRun: { weekday: 1, hour: 10, minute: 0 },
      },
      {
        id: 'repo-inbox-triage',
        title: 'Issue inbox triage',
        note: 'Go through the issues and review comments opened since the last run, label them, and draft a reply for the ones that only need an answer.',
        scheduleLabel: 'Weekdays at 14:00',
        recurrence: 'cron',
        cronExpression: '0 14 * * 1-5',
        nextRun: { hour: 14, minute: 0 },
      },
    ],
  },
} satisfies UiCatalog<ScheduledPageCopy>;

export function getScheduledPageCopy(locale: UiLocale): ScheduledPageCopy {
  return SCHEDULED_PAGE_COPY[locale];
}
