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

import type { ScheduledTask, ScheduledTaskRunOutcome, ScheduledTaskStatus } from '@maka/core/scheduled-task';
import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';
import type { ScheduledTaskFrequency } from './scheduled-task-helpers.js';

type RunStatus = ScheduledTaskRunOutcome;

export interface ScheduledTaskCopy {
  validation: {
    title: string;
    note: string;
    /** No folder chosen: a run has to happen somewhere on this machine. */
    workspace: string;
    timeInvalid: string;
    timePast: string;
  };
  /**
   * What a task's own status is called, as the DETAIL page's chip says it.
   *
   * `active` reads "Active" rather than "Scheduled" because it sits beside the
   * switch that turns the task on and off — it names the switch's state, not
   * the page. The list card never uses this word for a live task: it shows the
   * cadence there instead, which says more.
   */
  status: Record<ScheduledTaskStatus, string>;
  duplicateSuffix: string;
  /**
   * A moment this task ran or will run, as the reference writes it: the two
   * days that have names get them, everything else gets its date.
   *
   * `today` / `yesterday` are lowercase on purpose — the same string leads a
   * history row ("Yesterday at 9:10 AM", capitalized by CSS) and sits mid
   * sentence in "Next run: today at 9:00 AM".
   */
  dayTime: {
    today: (time: string) => string;
    yesterday: (time: string) => string;
    on: (day: string, time: string) => string;
  };
  countdown: {
    overdue: string;
    soon: string;
    minutes: (count: number) => string;
    hours: (count: number) => string;
    tomorrow: string;
    days: (count: number) => string;
    weeks: (count: number) => string;
    months: (count: number) => string;
  };
  recurrence: {
    once: string;
    /** A task with no cadence, which runs only when it is asked to. */
    manual: string;
    cron: (expression: string) => string;
    recurring: Record<'daily' | 'weekly' | 'monthly', string>;
    interval: (seconds: number) => string;
  };
  /**
   * The cadence WITH its time of day, as one phrase — the reference design's
   * `describeSchedule` ("Every day at 09:00"). `recurrence` above is the
   * cadence alone, which is what the form's dropdown and the inspector's own
   * row want; the list card carries nothing but its title and this, so half a
   * sentence there would not say when anything runs.
   *
   * Each locale writes the whole phrase, ordinal and measure word included:
   * "15th of every month" and "每月 15 日" do not decompose the same way.
   */
  cadence: {
    once: (dateTime: string) => string;
    daily: (time: string) => string;
    weekdays: (time: string) => string;
    weekly: (weekday: string, time: string) => string;
    monthly: (day: number, time: string) => string;
  };
  runStatus: Record<RunStatus, string>;
  /**
   * The create/edit dialog, laid out as the reference draws it: Name and
   * Instructions as free text, the workspace and model on a strip fused to the
   * instructions box, then Frequency and Permissions as labelled rows.
   */
  form: {
    editTitle: string;
    createTitle: string;
    field: {
      title: string;
      note: string;
      frequency: string;
      permissions: string;
      time: string;
      date: string;
      weekday: string;
      dayOfMonth: string;
    };
    titlePlaceholder: string;
    notePlaceholder: string;
    /** The workspace chip on the fused strip, when nothing is chosen. */
    workspacePlaceholder: string;
    /** The model chip, when the task follows whatever the default is. */
    defaultModel: string;
    frequencyOptions: ReadonlyArray<readonly [ScheduledTaskFrequency, string]>;
    /** A cadence the form cannot author, shown read-only. */
    fixedCadence: (description: string) => string;
    permissionOptions: ReadonlyArray<readonly ['ask' | 'auto', string]>;
    /** One line under Permissions saying what the choice costs. */
    permissionHelp: string;
    /** The awake row at the foot of the dialog: label and its two lines. */
    keepAwakeTitle: string;
    keepAwakeHelp: string;
    weekdayNames: readonly string[];
    /** "Next run: …" under the cadence row, before anything is saved. */
    nextRunPreview: (when: string) => string;
    nextRunPast: string;
    /** A manual task has no next run to preview. */
    nextRunManual: string;
    saving: string;
    creating: string;
    save: string;
    create: string;
  };
  page: {
    title: string;
    refreshing: string;
    refresh: string;
    create: string;
    keepAwakeErrorTitle: string;
    keepAwakeErrorFallback: string;
    runs: string;
    sort: string;
    sortOptions: ReadonlyArray<readonly ['created-desc' | 'next-run-asc' | 'updated-desc', string]>;
    searchLabel: string;
    searchPlaceholder: string;
    state: string;
    active: string;
    all: string;
    range: string;
    clearSearch: string;
    noSearchTitle: string;
    noSearchBody: string;
    emptyTitle: string;
    emptyBody: string;
    /**
     * Announced when selecting a row opens the inspector. Names no placement:
     * the same content is a side panel on a wide window and a sheet below the
     * breakpoint, and the announcement is shared by both.
     */
    edit: string;
    duplicate: string;
    triggering: string;
    triggerNow: string;
    snoozing: string;
    snooze: string;
    clearing: string;
    deleting: string;
    delete: string;
    nextRun: (time: string) => string;
    /** The run-range no-match's widen action: back to all time. */
    runsAriaLabel: string;
  };
  /** The inspector panel: one selected task, its facts and its actions. */
  detail: {
    label: string;
    enabled: string;
    recurrence: string;
    nextRun: string;
    lastRun: string;
    delivery: string;
    created: string;
    runs: string;
    noRuns: string;
    /** The detail page's own section headings. */
    instructions: string;
    project: string;
    model: string;
    history: string;
    /** Badge for tasks whose effect starts an agent session. */
    agentSource: string;
    agentSourceHint: string;
    /** Where a firing lands: a fresh session of its own. */
    agentDelivery: string;
    /** Where a SendLater reminder lands: back in the session that asked. */
    resumeDelivery: string;
    /** The run-history row's link into the session a run produced. */
    openRun: string;
  };
}

/**
 * "1st / 2nd / 3rd / 4th" for the English monthly cadence, ported from the
 * reference's `ordinalSuffix`. It lives beside the string that uses it rather
 * than in the helpers: it is English grammar, and the other two locales say
 * the day with a measure word instead.
 */
function englishOrdinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';
  if (day % 10 === 1) return 'st';
  if (day % 10 === 2) return 'nd';
  if (day % 10 === 3) return 'rd';
  return 'th';
}

const SCHEDULED_TASK_COPY = {
  'zh-CN': {
    validation: { title: '填写名称后才能保存。', note: '填写指令后才能保存 —— 到点运行的就是它。', workspace: '选择运行的项目或文件夹 —— 定时任务是在这台机器上跑的，得有个去处。', timeInvalid: '选择有效的时间。', timePast: '这个时刻已经过去了，选一个更晚的。' },
    status: { active: '已启用', paused: '已暂停', completed: '已完成', expired: '已过期' },
    dayTime: { today: (time) => `今天 ${time}`, yesterday: (time) => `昨天 ${time}`, on: (day, time) => `${day} ${time}` },
    duplicateSuffix: ' 副本',
    countdown: { overdue: '已过期', soon: '马上', minutes: (count) => `${count} 分钟后`, hours: (count) => `${count} 小时后`, tomorrow: '明天', days: (count) => `${count} 天后`, weeks: (count) => `${count} 周后`, months: (count) => `${count} 个月后` },
    recurrence: { once: '仅一次', manual: '手动运行', cron: (expression) => `Cron：${expression}`, recurring: { daily: '每天', weekly: '每周', monthly: '每月' }, interval: (seconds) => `每 ${seconds} 秒` },
    cadence: { once: (dateTime) => `仅一次 ${dateTime}`, daily: (time) => `每天 ${time}`, weekdays: (time) => `工作日 ${time}`, weekly: (weekday, time) => `每${weekday} ${time}`, monthly: (day, time) => `每月 ${day} 日 ${time}` },
    runStatus: { ok: '已触发', blocked: '已阻止', failed: '失败' },
    form: {
      editTitle: '编辑定时任务',
      createTitle: '新建定时任务',
      field: { title: '名称', note: '指令', frequency: '频率', permissions: '权限', time: '时间', date: '日期', weekday: '星期', dayOfMonth: '日' },
      titlePlaceholder: '每日简报',
      notePlaceholder: '把今天值得我知道的 AI 新闻整理成五条。',
      workspacePlaceholder: '在项目或文件夹中运行',
      defaultModel: '默认模型',
      frequencyOptions: [['manual', '手动'], ['daily', '每天'], ['weekdays', '工作日'], ['weekly', '每周'], ['monthly', '每月']],
      fixedCadence: (description) => `${description}（由 Agent 创建，无法在此修改）`,
      permissionOptions: [['auto', '自动批准'], ['ask', '逐步确认']],
      permissionHelp: '定时运行时通常没人在场：选「逐步确认」的任务会停在第一个需要批准的动作上。',
      keepAwakeTitle: '保持这台电脑唤醒',
      keepAwakeHelp: '定时任务由本机的定时器驱动，机器睡着时它会被冻住，到点的任务会静默地不触发。这是个全局开关，对所有定时任务生效。',
      weekdayNames: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
      nextRunPreview: (when) => `下次运行：${when}`,
      nextRunPast: '这个时刻已经过去了，选一个更晚的。',
      nextRunManual: '只在你手动运行时才会跑。',
      saving: '保存中…',
      creating: '创建中…',
      save: '保存',
      create: '创建',
    },
    page: {
      title: '定时任务', refreshing: '正在刷新定时任务', refresh: '刷新定时任务', create: '新建定时任务', keepAwakeErrorTitle: '无法更新保持系统唤醒', keepAwakeErrorFallback: '更新保持系统唤醒设置失败，请稍后重试。', runs: '执行记录', sort: '排序', sortOptions: [['created-desc', '按创建时间倒序'], ['next-run-asc', '按下次触发升序'], ['updated-desc', '按更新时间倒序']], searchLabel: '搜索定时任务', searchPlaceholder: '搜索名称、指令或运行记录…', state: '状态', active: '进行中', all: '全部', range: '范围', clearSearch: '清除搜索', noSearchTitle: '没有匹配的提醒', noSearchBody: '调整搜索词，或切换状态筛选查看其他提醒。', emptyTitle: '还没有定时任务', emptyBody: '创建一个提醒，让 Maka 在指定时间继续这项工作。', edit: '编辑', duplicate: '复制', triggering: '运行中…', triggerNow: '立即运行', snoozing: '延后中…', snooze: '延后 10 分钟', clearing: '清空中…', deleting: '删除中…', delete: '删除', nextRun: (time) => `下次触发：${time}`, runsAriaLabel: '定时任务执行记录',
    },
    detail: {
      label: '任务详情',
      enabled: '启用',
      recurrence: '重复',
      nextRun: '下次触发',
      lastRun: '最近触发',
      delivery: '投递',
      created: '创建于',
      runs: '执行记录',
      noRuns: '这个任务还没有运行过。',
      instructions: '指令',
      project: '项目',
      model: '模型',
      history: '运行历史',
      agentSource: 'Agent 定时任务',
      agentSourceHint: '到点后，Maka 会使用创建时的执行设置启动新任务。',
      agentDelivery: '每次运行开一个新任务',
      resumeDelivery: '投回创建它的那个任务',
      openRun: '打开这次运行',
    },
  },
  'zh-TW': {
    validation: { title: '填寫名稱後才能儲存。', note: '填寫指令後才能儲存 —— 到點執行的就是它。', workspace: '選擇執行的專案或資料夾 —— 定時任務是在這台機器上跑的，得有個去處。', timeInvalid: '選擇有效的時間。', timePast: '這個時刻已經過去了，選一個更晚的。' },
    status: { active: '已啟用', paused: '已暫停', completed: '已完成', expired: '已過期' },
    dayTime: { today: (time) => `今天 ${time}`, yesterday: (time) => `昨天 ${time}`, on: (day, time) => `${day} ${time}` },
    duplicateSuffix: ' 副本',
    countdown: { overdue: '已過期', soon: '馬上', minutes: (count) => `${count} 分鐘後`, hours: (count) => `${count} 小時後`, tomorrow: '明天', days: (count) => `${count} 天後`, weeks: (count) => `${count} 週後`, months: (count) => `${count} 個月後` },
    recurrence: { once: '僅一次', manual: '手動執行', cron: (expression) => `Cron：${expression}`, recurring: { daily: '每天', weekly: '每週', monthly: '每月' }, interval: (seconds) => `每 ${seconds} 秒` },
    cadence: { once: (dateTime) => `僅一次 ${dateTime}`, daily: (time) => `每天 ${time}`, weekdays: (time) => `工作日 ${time}`, weekly: (weekday, time) => `每${weekday} ${time}`, monthly: (day, time) => `每月 ${day} 日 ${time}` },
    runStatus: { ok: '已觸發', blocked: '已阻止', failed: '失敗' },
    form: {
      editTitle: '編輯定時任務',
      createTitle: '新建定時任務',
      field: { title: '名稱', note: '指令', frequency: '頻率', permissions: '權限', time: '時間', date: '日期', weekday: '星期', dayOfMonth: '日' },
      titlePlaceholder: '每日簡報',
      notePlaceholder: '把今天值得我知道的 AI 新聞整理成五條。',
      workspacePlaceholder: '在專案或資料夾中執行',
      defaultModel: '預設模型',
      frequencyOptions: [['manual', '手動'], ['daily', '每天'], ['weekdays', '工作日'], ['weekly', '每週'], ['monthly', '每月']],
      fixedCadence: (description) => `${description}（由 Agent 建立，無法在此修改）`,
      permissionOptions: [['auto', '自動批准'], ['ask', '逐步確認']],
      permissionHelp: '定時執行時通常沒人在場：選「逐步確認」的任務會停在第一個需要批准的動作上。',
      keepAwakeTitle: '保持這台電腦喚醒',
      keepAwakeHelp: '定時任務由本機的定時器驅動，機器睡著時它會被凍住，到點的任務會靜默地不觸發。這是個全域開關，對所有定時任務生效。',
      weekdayNames: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
      nextRunPreview: (when) => `下次執行：${when}`,
      nextRunPast: '這個時刻已經過去了，選一個更晚的。',
      nextRunManual: '只在你手動執行時才會跑。',
      saving: '儲存中…',
      creating: '建立中…',
      save: '儲存',
      create: '建立',
    },
    page: {
      title: '定時任務', refreshing: '正在重新整理定時任務', refresh: '重新整理定時任務', create: '建立定時任務', keepAwakeErrorTitle: '無法更新保持系統喚醒', keepAwakeErrorFallback: '更新保持系統喚醒設定失敗，請稍後重試。', runs: '執行記錄', sort: '排序', sortOptions: [['created-desc', '按建立時間倒序'], ['next-run-asc', '按下次觸發升序'], ['updated-desc', '按更新時間倒序']], searchLabel: '搜尋定時任務', searchPlaceholder: '搜尋名稱、指令或執行記錄…', state: '狀態', active: '進行中', all: '全部', range: '範圍', clearSearch: '清除搜尋', noSearchTitle: '沒有符合的提醒', noSearchBody: '調整搜尋詞，或切換狀態篩選檢視其他提醒。', emptyTitle: '還沒有定時任務', emptyBody: '建立一個提醒，讓 Maka 在指定時間繼續這項工作。', edit: '編輯', duplicate: '複製', triggering: '執行中…', triggerNow: '立即執行', snoozing: '延後中…', snooze: '延後 10 分鐘', clearing: '清空中…', deleting: '刪除中…', delete: '刪除', nextRun: (time) => `下次觸發：${time}`, runsAriaLabel: '定時任務執行記錄',
    },
    detail: {
      label: '任務詳情',
      enabled: '啟用',
      recurrence: '重複',
      nextRun: '下次觸發',
      lastRun: '最近觸發',
      delivery: '投遞',
      created: '建立於',
      runs: '執行紀錄',
      noRuns: '這個任務還沒有執行過。',
      instructions: '指令',
      project: '專案',
      model: '模型',
      history: '執行歷史',
      agentSource: 'Agent 定時任務',
      agentSourceHint: '到點後，Maka 會使用建立時的執行設定啟動新任務。',
      agentDelivery: '每次執行開一個新任務',
      resumeDelivery: '投回建立它的那個任務',
      openRun: '開啟這次執行',
    },
  },
  en: {
    validation: { title: 'Add a name before saving.', note: 'Add the instructions before saving — they are what runs.', workspace: 'Choose the project or folder to run in — a scheduled run happens on this machine, so it needs somewhere to happen.', timeInvalid: 'Choose a valid time.', timePast: 'That time has already passed — pick a later one.' },
    status: { active: 'Active', paused: 'Paused', completed: 'Completed', expired: 'Expired' },
    dayTime: { today: (time) => `today at ${time}`, yesterday: (time) => `yesterday at ${time}`, on: (day, time) => `${day} at ${time}` },
    duplicateSuffix: ' copy',
    countdown: { overdue: 'Overdue', soon: 'Soon', minutes: (count) => `in ${count} ${count === 1 ? 'minute' : 'minutes'}`, hours: (count) => `in ${count} ${count === 1 ? 'hour' : 'hours'}`, tomorrow: 'Tomorrow', days: (count) => `in ${count} days`, weeks: (count) => `in ${count} ${count === 1 ? 'week' : 'weeks'}`, months: (count) => `in ${count} ${count === 1 ? 'month' : 'months'}` },
    recurrence: { once: 'Once', manual: 'Manual', cron: (expression) => `Cron: ${expression}`, recurring: { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }, interval: (seconds) => `Every ${seconds} seconds` },
    cadence: { once: (dateTime) => `Once ${dateTime}`, daily: (time) => `Every day at ${time}`, weekdays: (time) => `Every weekday at ${time}`, weekly: (weekday, time) => `Every ${weekday} at ${time}`, monthly: (day, time) => `${day}${englishOrdinalSuffix(day)} of every month at ${time}` },
    runStatus: { ok: 'Triggered', blocked: 'Blocked', failed: 'Failed' },
    form: {
      editTitle: 'Edit scheduled task',
      createTitle: 'Create scheduled task',
      field: { title: 'Name', note: 'Instructions', frequency: 'Frequency', permissions: 'Permissions', time: 'Time', date: 'Date', weekday: 'Day', dayOfMonth: 'Day of month' },
      titlePlaceholder: 'Daily briefing',
      notePlaceholder: 'Round up the AI news I should know about, in five bullets.',
      workspacePlaceholder: 'Work in a project or folder',
      defaultModel: 'Default model',
      frequencyOptions: [['manual', 'Manual'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly']],
      fixedCadence: (description) => `${description} (set by an agent, not editable here)`,
      permissionOptions: [['auto', 'Automatically approve'], ['ask', 'Manually approve']],
      permissionHelp: 'A scheduled run usually has nobody there: a task set to ask stops at the first action that needs approval.',
      keepAwakeTitle: 'Keep this computer awake',
      keepAwakeHelp: 'Scheduled tasks run on this machine’s own timer, and a sleeping machine freezes it — the task silently never fires. This is one switch for every scheduled task, not just this one.',
      weekdayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      nextRunPreview: (when) => `Next run: ${when}`,
      nextRunPast: 'That time has already passed — pick a later one.',
      nextRunManual: 'Runs only when you run it.',
      saving: 'Saving…',
      creating: 'Creating…',
      save: 'Save',
      create: 'Create',
    },
    page: {
      title: 'Scheduled tasks', refreshing: 'Refreshing scheduled tasks', refresh: 'Refresh scheduled tasks', create: 'New scheduled task', keepAwakeErrorTitle: 'Could not update Keep system awake', keepAwakeErrorFallback: 'Could not update the Keep system awake setting. Try again later.', runs: 'Run history', sort: 'Sort', sortOptions: [['created-desc', 'Newest created first'], ['next-run-asc', 'Next run first'], ['updated-desc', 'Recently updated first']], searchLabel: 'Search scheduled tasks', searchPlaceholder: 'Search names, instructions, or run history…', state: 'Status', active: 'Active', all: 'All', range: 'Range', clearSearch: 'Clear search', noSearchTitle: 'No matching tasks', noSearchBody: 'Change the search terms or status filter to find other tasks.', emptyTitle: 'No scheduled tasks yet', emptyBody: 'Create a task so Maka can continue this work at the right time.', edit: 'Edit', duplicate: 'Duplicate', triggering: 'Running…', triggerNow: 'Run now', snoozing: 'Snoozing…', snooze: 'Snooze 10 minutes', clearing: 'Clearing…', deleting: 'Deleting…', delete: 'Delete', nextRun: (time) => `Next run: ${time}`, runsAriaLabel: 'Scheduled task run history',
    },
    detail: {
      label: 'Task detail',
      enabled: 'Enabled',
      recurrence: 'Repeats',
      nextRun: 'Next run',
      lastRun: 'Last run',
      delivery: 'Delivery',
      created: 'Created',
      runs: 'Runs',
      noRuns: 'This task has not run yet.',
      instructions: 'Instructions',
      project: 'Project',
      model: 'Model',
      history: 'History',
      agentSource: 'Agent scheduled task',
      agentSourceHint: 'When it is due, Maka starts a new task with the settings frozen at creation.',
      agentDelivery: 'Opens a new task on every run',
      resumeDelivery: 'Comes back to the task that asked for it',
      openRun: 'Open this run',
    },
  },
} satisfies UiCatalog<ScheduledTaskCopy>;

export function getScheduledTaskCopy(locale: UiLocale): ScheduledTaskCopy {
  return SCHEDULED_TASK_COPY[locale];
}
