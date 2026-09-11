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

// What the three module pages say that no existing catalog already says.
//
// Deliberately thin. `@maka/ui`'s `skills-copy.ts` and `scheduled-task-copy.ts`
// and this tree's `mcp-copy.ts` are the pre-rewrite vocabulary for these
// surfaces and they survived the rewrite intact, so the pages read from them.
// What is left over is of two kinds:
//
//   - page chrome the old surfaces did not have, because they were panels
//     inside a module hub rather than pages in the content column;
//   - the CLOSED FAILURE REASONS. `skills.*` and `mcp.add` answer with
//     `{ ok: false, reason }` VALUES rather than rejecting, and a page that
//     collapses six distinct reasons into "something went wrong" throws away
//     the only part of the answer the user can act on.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

/**
 * Every reason the `skills` namespace can answer with, across install,
 * enable, delete, open and import. One table rather than six: the unions
 * overlap heavily, and six tables is how `blocked_path` ends up worded three
 * different ways in one page.
 */
export type SkillFailureReason =
  | 'not_found'
  | 'already_exists'
  | 'blocked_path'
  | 'blocked_scope'
  | 'write_failed'
  | 'delete_failed'
  | 'state_error'
  | 'metadata_error'
  | 'not_managed'
  | 'source_missing'
  | 'local_modified'
  | 'invalid_id'
  | 'missing'
  | 'not_file'
  | 'not_directory'
  | 'open_failed'
  | 'cancelled'
  | 'invalid_skill';

export type ModulesCopy = {
  /**
   * What a page says above rows it is still showing after a refresh failed.
   * Distinct from each page's `loadFailed`, which is the case where the read
   * never landed and there is nothing behind the message.
   */
  readonly refreshFailed: string;
  /** The Extensions page chrome: one title, two faces (Skills | MCP). */
  readonly extensions: {
    readonly title: string;
    readonly tabsLabel: string;
    readonly skills: string;
    readonly mcp: string;
    /** The second tab group: what is installed, and what could be. */
    readonly viewLabel: string;
    readonly yours: string;
    readonly discover: string;
  };
  skills: {
    description: string;
    installedTitle: string;
    installedDescription: string;
    catalogTitle: string;
    catalogDescription: string;
    sourcesTitle: string;
    sourcesDescription: string;
    catalogEmpty: string;
    sourcesEmpty: string;
    install: string;
    installing: string;
    installed: string;
    importSkill: string;
    importing: string;
    imported(name: string): string;
    openFile: string;
    openDirectory: string;
    rowActions(name: string): string;
    enableSkill(name: string): string;
    declaredTools(count: number): string;
    loadFailed: string;
    enableFailed: string;
    deleteFailed: string;
    installFailed: string;
    importFailed: string;
    openFailed: string;
    deleteTitle(name: string): string;
    reasons: Record<SkillFailureReason, string>;
  };
  mcp: {
    title: string;
    description: string;
    installedTitle: string;
    marketTitle: string;
    marketDescription: string;
    serverActions(id: string): string;
    enableServer(id: string): string;
    duplicateId: string;
    needsAuth: string;
    signIn: string;
    signingIn: string;
    cancelSignIn: string;
    signOut: string;
    signInFailed: string;
    signOutFailed: string;
    enableFailed: string;
  };
  scheduled: {
    description: string;
    enableTask(title: string): string;
    rowActions(title: string): string;
    triggered(title: string): string;
    saveFailed: string;
    enableFailed: string;
    triggerFailed: string;
    deleteFailed: string;
    loadFailed: string;
    deleteTitle(title: string): string;
    deleteDescription: string;
    /** Bot delivery needs the deferred Bots settings page; say so once. */
    deliveryLocalOnly: string;
  };
};

const MODULES_COPY = {
  'zh-CN': {
    refreshFailed: '刷新失败，下面还是上一次的结果。',
    extensions: {
      title: '自定义',
      tabsLabel: '扩展分类',
      skills: '技能',
      mcp: '连接器',
      viewLabel: '查看范围',
      yours: '我的',
      discover: '发现',
    },
    skills: {
      description: 'Agent 可以调用的技能，以及它们的来源与启用状态。',
      installedTitle: '已安装',
      installedDescription: '这些技能会出现在任务的技能上下文里。',
      catalogTitle: '内置技能',
      catalogDescription: '应用自带的技能，安装后进入当前工作区。',
      sourcesTitle: '本地来源库',
      sourcesDescription: '从本机导入的 Skill 文件，可随时安装到工作区。',
      catalogEmpty: '这个版本没有内置技能。',
      sourcesEmpty: '来源库还是空的。导入一个含 SKILL.md 的文件后会出现在这里。',
      install: '安装',
      installing: '安装中…',
      installed: '已安装',
      importSkill: '导入 Skill',
      importing: '导入中…',
      imported: (name) => `已导入 ${name}`,
      openFile: '打开 SKILL.md',
      openDirectory: '打开所在目录',
      rowActions: (name) => `${name} 的更多操作`,
      enableSkill: (name) => `启用 ${name}`,
      declaredTools: (count) => `声明 ${count} 个工具`,
      loadFailed: '载入技能失败',
      enableFailed: '切换技能启用状态失败',
      deleteFailed: '删除技能失败',
      installFailed: '安装技能失败',
      importFailed: '导入技能失败',
      openFailed: '打开技能失败',
      deleteTitle: (name) => `删除技能「${name}」？`,
      reasons: {
        not_found: '找不到这个技能，它可能已经被删除。',
        already_exists: '工作区里已经有同名技能。',
        blocked_path: '目标路径被安全策略阻止。',
        blocked_scope: '这个范围的技能不允许从这里删除。',
        write_failed: '写入技能文件失败。',
        delete_failed: '删除技能文件失败。',
        state_error: '技能状态文件损坏，无法更新。',
        metadata_error: 'SKILL.md 的元数据无法解析。',
        not_managed: '这个技能不是从来源库安装的。',
        source_missing: '来源库里已经没有这个技能了。',
        local_modified: '工作区副本有本地修改。',
        invalid_id: '技能标识无效。',
        missing: '技能文件不存在。',
        not_file: '目标不是一个文件。',
        not_directory: '目标不是一个目录。',
        open_failed: '系统没能打开它。',
        cancelled: '已取消。',
        invalid_skill: '这个文件不是有效的 Skill。',
      },
    },
    mcp: {
      title: '连接器',
      description: '通过 MCP 接入外部工具和服务。',
      installedTitle: '已配置的连接器',
      marketTitle: '目录',
      marketDescription: '常用的连接器，添加后按各自的说明补齐凭据。',
      serverActions: (id) => `${id} 的更多操作`,
      enableServer: (id) => `启用 ${id}`,
      duplicateId: '这个 ID 已经在用了。',
      needsAuth: '需要登录',
      signIn: '登录',
      signingIn: '登录中…',
      cancelSignIn: '取消登录',
      signOut: '退出登录',
      signInFailed: '连接器登录失败',
      signOutFailed: '连接器退出登录失败',
      enableFailed: '切换连接器启用状态失败',
    },
    scheduled: {
      description: '按计划自动运行的任务，以及它们的执行记录。',
      enableTask: (title) => `启用「${title}」`,
      rowActions: (title) => `「${title}」的更多操作`,
      triggered: (title) => `已触发「${title}」`,
      saveFailed: '保存定时任务失败',
      enableFailed: '切换定时任务状态失败',
      triggerFailed: '触发定时任务失败',
      deleteFailed: '删除定时任务失败',
      loadFailed: '载入定时任务失败',
      deleteTitle: (title) => `删除「${title}」？`,
      deleteDescription: '这个定时任务会被移除，已有的执行记录也会一并删除。',
      deliveryLocalOnly: '目前只支持本地提醒；机器人投递需要「机器人」设置页，该页尚未提供。',
    },
  },
  'zh-TW': {
    refreshFailed: '重新整理失敗，下面仍是上一次的結果。',
    extensions: {
      title: '自訂',
      tabsLabel: '擴充分類',
      skills: '技能',
      mcp: '連接器',
      viewLabel: '檢視範圍',
      yours: '我的',
      discover: '探索',
    },
    skills: {
      description: 'Agent 可以呼叫的技能，以及它們的來源與啟用狀態。',
      installedTitle: '已安裝',
      installedDescription: '這些技能會出現在任務的技能上下文裡。',
      catalogTitle: '內建技能',
      catalogDescription: '應用自帶的技能，安裝後進入目前工作區。',
      sourcesTitle: '本地來源庫',
      sourcesDescription: '從本機匯入的 Skill 檔案，可隨時安裝到工作區。',
      catalogEmpty: '這個版本沒有內建技能。',
      sourcesEmpty: '來源庫還是空的。匯入一個含 SKILL.md 的檔案後會出現在這裡。',
      install: '安裝',
      installing: '安裝中…',
      installed: '已安裝',
      importSkill: '匯入 Skill',
      importing: '匯入中…',
      imported: (name) => `已匯入 ${name}`,
      openFile: '開啟 SKILL.md',
      openDirectory: '開啟所在目錄',
      rowActions: (name) => `${name} 的更多操作`,
      enableSkill: (name) => `啟用 ${name}`,
      declaredTools: (count) => `宣告 ${count} 個工具`,
      loadFailed: '載入技能失敗',
      enableFailed: '切換技能啟用狀態失敗',
      deleteFailed: '刪除技能失敗',
      installFailed: '安裝技能失敗',
      importFailed: '匯入技能失敗',
      openFailed: '開啟技能失敗',
      deleteTitle: (name) => `刪除技能「${name}」？`,
      reasons: {
        not_found: '找不到這個技能，它可能已經被刪除。',
        already_exists: '工作區裡已經有同名技能。',
        blocked_path: '目標路徑被安全策略阻止。',
        blocked_scope: '這個範圍的技能不允許從這裡刪除。',
        write_failed: '寫入技能檔案失敗。',
        delete_failed: '刪除技能檔案失敗。',
        state_error: '技能狀態檔案損壞，無法更新。',
        metadata_error: 'SKILL.md 的後設資料無法解析。',
        not_managed: '這個技能不是從來源庫安裝的。',
        source_missing: '來源庫裡已經沒有這個技能了。',
        local_modified: '工作區副本有本地修改。',
        invalid_id: '技能標識無效。',
        missing: '技能檔案不存在。',
        not_file: '目標不是一個檔案。',
        not_directory: '目標不是一個目錄。',
        open_failed: '系統沒能開啟它。',
        cancelled: '已取消。',
        invalid_skill: '這個檔案不是有效的 Skill。',
      },
    },
    mcp: {
      title: '連接器',
      description: '透過 MCP 接入外部工具和服務。',
      installedTitle: '已設定的連接器',
      marketTitle: '目錄',
      marketDescription: '常用的連接器，新增後按各自的說明補齊憑據。',
      serverActions: (id) => `${id} 的更多操作`,
      enableServer: (id) => `啟用 ${id}`,
      duplicateId: '這個 ID 已經在用了。',
      needsAuth: '需要登入',
      signIn: '登入',
      signingIn: '登入中…',
      cancelSignIn: '取消登入',
      signOut: '登出',
      signInFailed: '連接器登入失敗',
      signOutFailed: '連接器登出失敗',
      enableFailed: '切換連接器啟用狀態失敗',
    },
    scheduled: {
      description: '按計畫自動執行的任務，以及它們的執行紀錄。',
      enableTask: (title) => `啟用「${title}」`,
      rowActions: (title) => `「${title}」的更多操作`,
      triggered: (title) => `已觸發「${title}」`,
      saveFailed: '儲存定時任務失敗',
      enableFailed: '切換定時任務狀態失敗',
      triggerFailed: '觸發定時任務失敗',
      deleteFailed: '刪除定時任務失敗',
      loadFailed: '載入定時任務失敗',
      deleteTitle: (title) => `刪除「${title}」？`,
      deleteDescription: '這個定時任務會被移除，已有的執行紀錄也會一併刪除。',
      deliveryLocalOnly: '目前只支援本地提醒；機器人投遞需要「機器人」設定頁，該頁尚未提供。',
    },
  },
  en: {
    refreshFailed: 'Could not refresh. These are the last results.',
    extensions: {
      title: 'Customize',
      tabsLabel: 'Extension kind',
      skills: 'Skills',
      mcp: 'Connectors',
      viewLabel: 'View',
      yours: 'Yours',
      discover: 'Discover',
    },
    skills: {
      description: 'The skills the agent can invoke, where they come from, and which are on.',
      installedTitle: 'Installed',
      installedDescription: 'These skills appear in the skill context of every task.',
      catalogTitle: 'Built in',
      catalogDescription:
        'Skills shipped with the app. Installing one copies it into this workspace.',
      sourcesTitle: 'Local source library',
      sourcesDescription:
        'Skill files imported from this machine, ready to install into the workspace.',
      catalogEmpty: 'This build ships no built-in skills.',
      sourcesEmpty: 'The source library is empty. Import a file containing SKILL.md to fill it.',
      install: 'Install',
      installing: 'Installing…',
      installed: 'Installed',
      importSkill: 'Import Skill',
      importing: 'Importing…',
      imported: (name) => `Imported ${name}`,
      openFile: 'Open SKILL.md',
      openDirectory: 'Open containing folder',
      rowActions: (name) => `More actions for ${name}`,
      enableSkill: (name) => `Enable ${name}`,
      declaredTools: (count) => (count === 1 ? 'Declares 1 tool' : `Declares ${count} tools`),
      loadFailed: 'Could not load skills',
      enableFailed: 'Could not change whether the skill is enabled',
      deleteFailed: 'Could not delete the skill',
      installFailed: 'Could not install the skill',
      importFailed: 'Could not import the skill',
      openFailed: 'Could not open the skill',
      deleteTitle: (name) => `Delete the skill ${name}?`,
      reasons: {
        not_found: 'That skill no longer exists; it may already have been deleted.',
        already_exists: 'The workspace already has a skill with that name.',
        blocked_path: 'The safety policy blocked the target path.',
        blocked_scope: 'Skills in this scope cannot be deleted from here.',
        write_failed: 'Writing the skill files failed.',
        delete_failed: 'Deleting the skill files failed.',
        state_error: 'The skill state file is damaged and could not be updated.',
        metadata_error: 'The metadata in SKILL.md could not be read.',
        not_managed: 'This skill was not installed from the source library.',
        source_missing: 'The source library no longer carries this skill.',
        local_modified: 'The workspace copy has local changes.',
        invalid_id: 'That skill identifier is not valid.',
        missing: 'The skill files are not there.',
        not_file: 'The target is not a file.',
        not_directory: 'The target is not a directory.',
        open_failed: 'The system could not open it.',
        cancelled: 'Cancelled.',
        invalid_skill: 'That file is not a valid Skill.',
      },
    },
    mcp: {
      title: 'Connectors',
      description: 'External tools and services, connected over MCP.',
      installedTitle: 'Configured connectors',
      marketTitle: 'Directory',
      marketDescription: 'Common connectors. Adding one still needs the credentials it names.',
      serverActions: (id) => `More actions for ${id}`,
      enableServer: (id) => `Enable ${id}`,
      duplicateId: 'That ID is already taken.',
      needsAuth: 'Sign-in needed',
      signIn: 'Sign in',
      signingIn: 'Signing in…',
      cancelSignIn: 'Cancel sign-in',
      signOut: 'Sign out',
      signInFailed: 'Connector sign-in failed',
      signOutFailed: 'Connector sign-out failed',
      enableFailed: 'Could not change whether the connector is enabled',
    },
    scheduled: {
      description: 'Tasks that run on a schedule, and what happened when they did.',
      enableTask: (title) => `Enable ${title}`,
      rowActions: (title) => `More actions for ${title}`,
      triggered: (title) => `Triggered ${title}`,
      saveFailed: 'Could not save the scheduled task',
      enableFailed: 'Could not change whether the task is active',
      triggerFailed: 'Could not trigger the task',
      deleteFailed: 'Could not delete the task',
      loadFailed: 'Could not load scheduled tasks',
      deleteTitle: (title) => `Delete ${title}?`,
      deleteDescription: 'The task is removed, and its run history goes with it.',
      deliveryLocalOnly:
        'Local reminders only for now: bot delivery needs the Bots settings page, which this build does not ship.',
    },
  },
} satisfies UiCatalog<ModulesCopy>;

export function getModulesCopy(locale: UiLocale): ModulesCopy {
  return MODULES_COPY[locale];
}
