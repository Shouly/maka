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

// The sidebar's own copy. Everything the reference design system carried in
// its `sidebar` message namespace, translated into the typed catalog shape the
// rest of the renderer uses. Strings the shell already owns are NOT duplicated
// here: sidebar/workbar toggles come from `shell-copy.ts`'s `chrome`, row
// status words from `@maka/ui`'s `conversation-copy.ts`.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export type SidebarGroupKey = 'flagged' | 'today' | 'yesterday' | 'week' | 'older' | 'none';

export interface SidebarCopy {
  readonly panelLabel: string;
  readonly brandLabel: string;
  readonly newTask: string;
  readonly newTaskShortcut: string;
  readonly search: string;
  readonly filterLabel: string;
  readonly filterPlaceholder: string;
  readonly filterClear: string;
  readonly listLabel: string;
  readonly loading: string;
  readonly empty: string;
  readonly emptyFiltered: string;
  readonly error: string;
  readonly retry: string;
  readonly resize: string;
  readonly groupBy: string;
  readonly groupModes: Record<'time' | 'project', string>;
  readonly groups: Record<SidebarGroupKey, string>;
  readonly noProject: string;
  readonly projectsSection: string;
  readonly untitled: string;
  readonly running: string;
  readonly turnStatus: Record<'running' | 'completed' | 'aborted' | 'failed', string>;
  readonly stale: string;
  readonly flaggedBadge: string;
  readonly branchBadge: string;
  readonly revisionBadge: (count: number) => string;
  readonly expandSection: (section: string) => string;
  readonly collapseSection: (section: string) => string;
  readonly sessionActions: (name: string) => string;
  readonly projectActions: (name: string) => string;
  readonly rowActions: {
    readonly open: string;
    readonly rename: string;
    readonly flag: string;
    readonly unflag: string;
    readonly archive: string;
    readonly unarchive: string;
    readonly remove: string;
    readonly retryOpen: string;
  };
  readonly projectRowActions: {
    readonly newTask: string;
    readonly rename: string;
    readonly archive: string;
    readonly restore: string;
    readonly relink: string;
    readonly reveal: string;
  };
  readonly rename: {
    readonly label: string;
    readonly save: string;
    readonly cancel: string;
  };
  readonly nav: {
    readonly extensions: string;
    readonly skills: string;
    readonly mcp: string;
    readonly automations: string;
    readonly pending: (count: number) => string;
    readonly settings: string;
  };
  readonly update: {
    readonly downloaded: (version: string) => string;
    readonly install: string;
    readonly failed: string;
    readonly retry: string;
  };
}

const SIDEBAR_COPY = {
  'zh-CN': {
    panelLabel: '任务列表',
    brandLabel: 'RELX',
    newTask: '新建任务',
    newTaskShortcut: '⌘N',
    search: '搜索任务',
    filterLabel: '筛选任务',
    filterPlaceholder: '筛选…',
    filterClear: '清除筛选',
    listLabel: '任务',
    loading: '正在载入任务…',
    empty: '还没有任务。新建一个开始。',
    emptyFiltered: '没有匹配的任务。',
    error: '任务列表读取失败。',
    retry: '重试',
    resize: '调整侧边栏宽度',
    groupBy: '分组方式',
    groupModes: { time: '按时间', project: '按项目' },
    groups: {
      flagged: '已标记',
      today: '今天',
      yesterday: '昨天',
      week: '本周内',
      older: '更早',
      none: '任务',
    },
    noProject: '未归入项目',
    projectsSection: '项目',
    untitled: '未命名任务',
    running: '进行中',
    turnStatus: { running: '进行中', completed: '已完成', aborted: '已中止', failed: '失败' },
    stale: '需要处理',
    flaggedBadge: '已标记',
    branchBadge: '分支',
    revisionBadge: (count) => `${count} 个版本`,
    expandSection: (section) => `展开「${section}」`,
    collapseSection: (section) => `收起「${section}」`,
    sessionActions: (name) => `「${name}」的操作`,
    projectActions: (name) => `项目「${name}」的操作`,
    rowActions: {
      open: '打开',
      rename: '重命名',
      flag: '标记',
      unflag: '取消标记',
      archive: '归档',
      unarchive: '取消归档',
      remove: '删除',
      retryOpen: '重新打开',
    },
    projectRowActions: {
      newTask: '在此项目新建任务',
      rename: '重命名项目',
      archive: '归档项目',
      restore: '恢复项目',
      relink: '重新关联目录',
      reveal: '在文件管理器中显示',
    },
    rename: { label: '任务名称', save: '保存', cancel: '取消' },
    nav: {
      extensions: '扩展',
      skills: '技能',
      mcp: 'MCP',
      automations: '自动化',
      pending: (count) => `${count} 个待执行`,
      settings: '设置',
    },
    update: {
      downloaded: (version) => `已下载 ${version}`,
      install: '重启并更新',
      failed: '更新失败',
      retry: '重试更新',
    },
  },
  'zh-TW': {
    panelLabel: '任務列表',
    brandLabel: 'RELX',
    newTask: '新增任務',
    newTaskShortcut: '⌘N',
    search: '搜尋任務',
    filterLabel: '篩選任務',
    filterPlaceholder: '篩選…',
    filterClear: '清除篩選',
    listLabel: '任務',
    loading: '正在載入任務…',
    empty: '還沒有任務。新增一個開始。',
    emptyFiltered: '沒有符合的任務。',
    error: '任務列表讀取失敗。',
    retry: '重試',
    resize: '調整側邊欄寬度',
    groupBy: '分組方式',
    groupModes: { time: '依時間', project: '依專案' },
    groups: {
      flagged: '已標記',
      today: '今天',
      yesterday: '昨天',
      week: '本週內',
      older: '更早',
      none: '任務',
    },
    noProject: '未歸入專案',
    projectsSection: '專案',
    untitled: '未命名任務',
    running: '進行中',
    turnStatus: { running: '進行中', completed: '已完成', aborted: '已中止', failed: '失敗' },
    stale: '需要處理',
    flaggedBadge: '已標記',
    branchBadge: '分支',
    revisionBadge: (count) => `${count} 個版本`,
    expandSection: (section) => `展開「${section}」`,
    collapseSection: (section) => `收起「${section}」`,
    sessionActions: (name) => `「${name}」的操作`,
    projectActions: (name) => `專案「${name}」的操作`,
    rowActions: {
      open: '開啟',
      rename: '重新命名',
      flag: '標記',
      unflag: '取消標記',
      archive: '封存',
      unarchive: '取消封存',
      remove: '刪除',
      retryOpen: '重新開啟',
    },
    projectRowActions: {
      newTask: '在此專案新增任務',
      rename: '重新命名專案',
      archive: '封存專案',
      restore: '還原專案',
      relink: '重新連結資料夾',
      reveal: '在檔案管理員中顯示',
    },
    rename: { label: '任務名稱', save: '儲存', cancel: '取消' },
    nav: {
      extensions: '擴充',
      skills: '技能',
      mcp: 'MCP',
      automations: '自動化',
      pending: (count) => `${count} 個待執行`,
      settings: '設定',
    },
    update: {
      downloaded: (version) => `已下載 ${version}`,
      install: '重新啟動並更新',
      failed: '更新失敗',
      retry: '重試更新',
    },
  },
  en: {
    panelLabel: 'Task list',
    brandLabel: 'RELX',
    newTask: 'New task',
    newTaskShortcut: '⌘N',
    search: 'Search tasks',
    filterLabel: 'Filter tasks',
    filterPlaceholder: 'Filter…',
    filterClear: 'Clear filter',
    listLabel: 'Tasks',
    loading: 'Loading tasks…',
    empty: 'No tasks yet. Start one.',
    emptyFiltered: 'No matching tasks.',
    error: 'The task list could not be read.',
    retry: 'Retry',
    resize: 'Resize sidebar',
    groupBy: 'Group by',
    groupModes: { time: 'By time', project: 'By project' },
    groups: {
      flagged: 'Flagged',
      today: 'Today',
      yesterday: 'Yesterday',
      week: 'Earlier this week',
      older: 'Older',
      none: 'Tasks',
    },
    noProject: 'No project',
    projectsSection: 'Projects',
    untitled: 'Untitled task',
    running: 'Running',
    turnStatus: {
      running: 'Running',
      completed: 'Completed',
      aborted: 'Stopped',
      failed: 'Failed',
    },
    stale: 'Needs attention',
    flaggedBadge: 'Flagged',
    branchBadge: 'Branch',
    revisionBadge: (count) => `${count} versions`,
    expandSection: (section) => `Expand ${section}`,
    collapseSection: (section) => `Collapse ${section}`,
    sessionActions: (name) => `Actions for ${name}`,
    projectActions: (name) => `Actions for project ${name}`,
    rowActions: {
      open: 'Open',
      rename: 'Rename',
      flag: 'Flag',
      unflag: 'Unflag',
      archive: 'Archive',
      unarchive: 'Unarchive',
      remove: 'Delete',
      retryOpen: 'Open again',
    },
    projectRowActions: {
      newTask: 'New task in this project',
      rename: 'Rename project',
      archive: 'Archive project',
      restore: 'Restore project',
      relink: 'Relink folder',
      reveal: 'Reveal in file manager',
    },
    rename: { label: 'Task name', save: 'Save', cancel: 'Cancel' },
    nav: {
      extensions: 'Extensions',
      skills: 'Skills',
      mcp: 'MCP',
      automations: 'Automations',
      pending: (count) => `${count} pending`,
      settings: 'Settings',
    },
    update: {
      downloaded: (version) => `${version} downloaded`,
      install: 'Restart to update',
      failed: 'Update failed',
      retry: 'Retry update',
    },
  },
} satisfies UiCatalog<SidebarCopy>;

export function getSidebarCopy(locale: UiLocale): SidebarCopy {
  return SIDEBAR_COPY[locale];
}
