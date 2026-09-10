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

// The strings the rebuilt Settings surface needs and no existing catalog has.
//
// Deliberately small. Nine of the eleven pages are rebuilt against copy that
// already exists — `settings-preferences-copy.ts` (general, appearance,
// about), `settings-projects-copy.ts` (workspace and Runtime Hosts),
// `settings-data-copy.ts`, `settings-tasks-copy.ts`, `settings-usage-copy.ts`,
// `permission-center-copy.ts`, `settings-health-copy.ts`,
// `settings-shared-copy.ts` and `shell-copy.ts`'s `projectActions` — so what
// is here is only what the rewrite genuinely introduced: the surface's own
// chrome, the Runtime Host readiness vocabulary the old page never spelled
// out, the two update actions About did not offer, and the draft-clearing row
// Data did not have.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export type SettingsCopy = {
  /** The window titlebar's identity and the page heading. */
  title: string;
  navLabel: string;
  contentLabel: string;
  /** Page frames Phase 5b fills. */
  comingSoonTitle: string;
  /** Announced while a page is reading its first snapshot. */
  loadingSection: string;
  workspace: {
    /** Runtime Host readiness, as the profile snapshot reports it. */
    readiness: Record<'disabled' | 'connecting' | 'ready' | 'reconnecting' | 'unavailable', string>;
    kinds: Record<'local' | 'environment' | 'remote', string>;
    enableProfile: (name: string) => string;
    setDefaultProfile: string;
    removeProfile: string;
    /** Why the SSH / WSL entry points are missing from this build. */
    wizardsDeferred: string;
    addRemote: string;
    addRemoteHelp: string;
    directoryBrowserOpen: string;
    archivedBadge: string;
    restoreProject: string;
    relinkProject: string;
  };
  usage: {
    /** The share one row holds of the largest row in the same table. */
    shareOf: (value: string, percent: number) => string;
    requests: string;
    tokens: string;
    cost: string;
    calls: string;
    averageDuration: string;
  };
  data: {
    drafts: string;
    draftsDetail: string;
    clearDrafts: string;
    clearingDrafts: string;
    draftsCleared: string;
    draftsClearedDetail: (count: number) => string;
  };
  about: {
    /** The group under the lead: what this build is, not which version. */
    buildTitle: string;
    build: Record<'dev' | 'packaged', string>;
    channel: string;
    platform: string;
    updates: string;
    updatesHelp: string;
    retryDownload: string;
    install: string;
    installing: string;
    installFailed: string;
    /** No bridge exposes the log directory; the report carries the logs. */
    logsNote: string;
  };
};

const SETTINGS_COPY = {
  'zh-CN': {
    title: '设置',
    navLabel: '设置导航',
    contentLabel: '设置内容',
    comingSoonTitle: '尚未构建',
    loadingSection: '正在读取设置…',
    workspace: {
      readiness: {
        disabled: '已停用',
        connecting: '连接中',
        ready: '就绪',
        reconnecting: '重新连接中',
        unavailable: '不可用',
      },
      kinds: { local: '本机', environment: '本机环境', remote: '远程' },
      enableProfile: (name: string) => `启用 ${name}`,
      setDefaultProfile: '设为默认',
      removeProfile: '移除',
      wizardsDeferred:
        'SSH 与 WSL 的引导式配置尚未在此版本提供；这里只能手动登记已经在运行的远程 Runtime Host。',
      addRemote: '添加远程 Runtime Host',
      addRemoteHelp: '填写这台 Host 的地址与访问凭据。凭据只保存在本机。',
      directoryBrowserOpen: '浏览 Host 上的文件夹',
      archivedBadge: '已移出',
      restoreProject: '恢复',
      relinkProject: '重新定位',
    },
    usage: {
      shareOf: (value: string, percent: number) => `${value}（占 ${percent}%）`,
      requests: '请求',
      tokens: 'token',
      cost: '费用',
      calls: '调用',
      averageDuration: '平均耗时',
    },
    data: {
      drafts: '未发送的草稿',
      draftsDetail: '各个任务输入框里还没发出去的内容。清空后无法恢复。',
      clearDrafts: '清空草稿',
      clearingDrafts: '正在清空…',
      draftsCleared: '草稿已清空',
      draftsClearedDetail: (count: number) => `已丢弃 ${count} 份草稿。`,
    },
    about: {
      buildTitle: '构建信息',
      build: { dev: '开发构建', packaged: '正式构建' },
      channel: '更新通道',
      platform: '运行环境',
      updates: '应用更新',
      updatesHelp: '检查、下载并安装新版本。',
      retryDownload: '重新下载',
      install: '安装并重启',
      installing: '正在安装…',
      installFailed: '安装更新失败',
      logsNote: '日志目录没有单独的入口；诊断报告里已经带上了最近的日志。',
    },
  },
  'zh-TW': {
    title: '設定',
    navLabel: '設定導覽',
    contentLabel: '設定內容',
    comingSoonTitle: '尚未建置',
    loadingSection: '正在讀取設定…',
    workspace: {
      readiness: {
        disabled: '已停用',
        connecting: '連線中',
        ready: '就緒',
        reconnecting: '重新連線中',
        unavailable: '無法使用',
      },
      kinds: { local: '本機', environment: '本機環境', remote: '遠端' },
      enableProfile: (name: string) => `啟用 ${name}`,
      setDefaultProfile: '設為預設',
      removeProfile: '移除',
      wizardsDeferred:
        'SSH 與 WSL 的引導式設定尚未在此版本提供；這裡只能手動登記已經在執行的遠端 Runtime Host。',
      addRemote: '新增遠端 Runtime Host',
      addRemoteHelp: '填寫這臺 Host 的位址與存取憑證。憑證只會保存在本機。',
      directoryBrowserOpen: '瀏覽 Host 上的資料夾',
      archivedBadge: '已移出',
      restoreProject: '恢復',
      relinkProject: '重新定位',
    },
    usage: {
      shareOf: (value: string, percent: number) => `${value}（佔 ${percent}%）`,
      requests: '請求',
      tokens: 'token',
      cost: '費用',
      calls: '呼叫',
      averageDuration: '平均耗時',
    },
    data: {
      drafts: '未送出的草稿',
      draftsDetail: '各個任務輸入框裡還沒送出的內容。清空後無法復原。',
      clearDrafts: '清空草稿',
      clearingDrafts: '正在清空…',
      draftsCleared: '草稿已清空',
      draftsClearedDetail: (count: number) => `已丟棄 ${count} 份草稿。`,
    },
    about: {
      buildTitle: '建置資訊',
      build: { dev: '開發建置', packaged: '正式建置' },
      channel: '更新通道',
      platform: '執行環境',
      updates: '應用程式更新',
      updatesHelp: '檢查、下載並安裝新版本。',
      retryDownload: '重新下載',
      install: '安裝並重新啟動',
      installing: '正在安裝…',
      installFailed: '安裝更新失敗',
      logsNote: '日誌目錄沒有獨立的入口；診斷報告裡已經帶上了最近的日誌。',
    },
  },
  en: {
    title: 'Settings',
    navLabel: 'Settings navigation',
    contentLabel: 'Settings content',
    comingSoonTitle: 'Not built yet',
    loadingSection: 'Reading settings…',
    workspace: {
      readiness: {
        disabled: 'Disabled',
        connecting: 'Connecting',
        ready: 'Ready',
        reconnecting: 'Reconnecting',
        unavailable: 'Unavailable',
      },
      kinds: { local: 'This computer', environment: 'Local environment', remote: 'Remote' },
      enableProfile: (name: string) => `Enable ${name}`,
      setDefaultProfile: 'Set as default',
      removeProfile: 'Remove',
      wizardsDeferred:
        'The guided SSH and WSL setups are not in this build; this form registers a remote Runtime Host that is already running.',
      addRemote: 'Add a remote Runtime Host',
      addRemoteHelp: 'Its address and an access credential. The credential stays on this machine.',
      directoryBrowserOpen: 'Browse folders on the Host',
      archivedBadge: 'Removed',
      restoreProject: 'Restore',
      relinkProject: 'Relink',
    },
    usage: {
      shareOf: (value: string, percent: number) => `${value} (${percent}% of the total)`,
      requests: 'Requests',
      tokens: 'Tokens',
      cost: 'Cost',
      calls: 'Calls',
      averageDuration: 'Average duration',
    },
    data: {
      drafts: 'Unsent drafts',
      draftsDetail: 'What is still typed into each task composer. Clearing cannot be undone.',
      clearDrafts: 'Clear drafts',
      clearingDrafts: 'Clearing…',
      draftsCleared: 'Drafts cleared',
      draftsClearedDetail: (count: number) => `Discarded ${count} drafts.`,
    },
    about: {
      buildTitle: 'Build',
      build: { dev: 'Development build', packaged: 'Packaged build' },
      channel: 'Update channel',
      platform: 'Runtime',
      updates: 'Application updates',
      updatesHelp: 'Check for, download and install a new version.',
      retryDownload: 'Download again',
      install: 'Install and restart',
      installing: 'Installing…',
      installFailed: 'Could not install the update',
      logsNote:
        'There is no separate entry point for the log folder; the diagnostic report already carries the recent logs.',
    },
  },
} satisfies UiCatalog<SettingsCopy>;

export function getSettingsCopy(locale: UiLocale): SettingsCopy {
  return SETTINGS_COPY[locale];
}
