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

import type { RuntimeHostServiceErrorCode } from '@maka/runtime-host/operator';
import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export type SettingsProjectsCopy = {
  foldersSection: string;
  section: string;
  sectionHelp: string;
  addProject: string;
  defaultDirectory: string;
  defaultDirectoryHelp: string;
  changeFolder: string;
  resetFolder: string;
  changeFolderFailed: string;
  defaultBadge: string;
  setDefault: string;
  clearDefault: string;
  setDefaultFailed: string;
  rename: string;
  renameLabel: string;
  renameFailed: string;
  openFolder: string;
  openFolderFailed: string;
  save: string;
  cancel: string;
  remove: string;
  removeConfirmTitle: string;
  removeConfirmBody: string;
  removeConfirm: string;
  removeCancel: string;
  actionFailed: string;
  unavailable: string;
  /** Shown when the configured default no longer names a usable project. */
  defaultUnavailable: string;
  emptyTitle: string;
  emptyBody: string;
  /**
   * Names the row it belongs to. Four buttons all called 更多操作 are one
   * button as far as assistive tech is concerned — and they were equally
   * ambiguous to a test, which is how the ambiguity was noticed.
   */
  moreActions(projectName: string): string;
};

const SETTINGS_PROJECTS_COPY_BY_LOCALE = {
  'zh-CN': {
    foldersSection: '工作目录',
    section: '项目',
    // Says all three layers of the rule in one sentence, because a help line
    // that only mentions the default would leave the user guessing what
    // happens before they set one.
    sectionHelp:
      '你登记的文件夹。新任务可以在输入框旁选在哪个项目里工作，侧边栏也会按项目给任务分组。',
    addProject: '添加项目',
    defaultDirectory: '默认工作目录',
    defaultDirectoryHelp: '没选项目的任务，会在这里为每个任务新建一个文件夹。',
    changeFolder: '更改…',
    resetFolder: '恢复默认',
    changeFolderFailed: '更改工作目录失败',
    defaultBadge: '默认',
    setDefault: '设为默认',
    clearDefault: '取消默认',
    setDefaultFailed: '设置默认项目失败',
    rename: '重命名',
    renameLabel: '项目名称',
    renameFailed: '重命名失败',
    openFolder: '打开项目文件夹',
    // Says which of the two things went wrong, because the fix differs: a
    // missing folder is the user's to restore, a refusal to open is not.
    openFolderFailed: '打不开这个目录，它可能已被移动或删除',
    save: '保存',
    cancel: '取消',
    remove: '从列表移除',
    removeConfirmTitle: '从列表移除这个项目？',
    // The one thing a user actually fears here, stated first and plainly.
    removeConfirmBody:
      '只是从项目列表里移除，磁盘上的文件不受影响。这个项目下已有的任务会移到“未归属”分组，不会被删除。',
    removeConfirm: '移除',
    removeCancel: '取消',
    actionFailed: '操作失败',
    unavailable: '目录不可用',
    defaultUnavailable: '原来的默认项目已不可用，新任务暂时沿用上次使用的项目。',
    emptyTitle: '还没有项目',
    emptyBody: '添加一个项目文件夹后，新任务就能在它里面工作，侧边栏也会按项目给任务分组。',
    moreActions: (projectName: string) => `更多操作：${projectName}`,
  },
  'zh-TW': {
    foldersSection: '工作目錄',
    section: '專案',
    // Says all three layers of the rule in one sentence, because a help line
    // that only mentions the default would leave the user guessing what
    // happens before they set one.
    sectionHelp:
      '你登記的資料夾。新任務可以在輸入框旁選在哪個專案裡工作，側邊欄也會按專案替任務分組。',
    addProject: '新增專案',
    defaultDirectory: '預設工作目錄',
    defaultDirectoryHelp: '沒選專案的任務，會在這裡為每個任務新建一個資料夾。',
    changeFolder: '更改…',
    resetFolder: '恢復預設',
    changeFolderFailed: '更改工作目錄失敗',
    defaultBadge: '預設',
    setDefault: '設為預設',
    clearDefault: '取消預設',
    setDefaultFailed: '設定預設專案失敗',
    rename: '重新命名',
    renameLabel: '專案名稱',
    renameFailed: '重新命名失敗',
    openFolder: '開啟專案資料夾',
    // Says which of the two things went wrong, because the fix differs: a
    // missing folder is the user's to restore, a refusal to open is not.
    openFolderFailed: '打不開這個目錄，它可能已被移動或刪除',
    save: '儲存',
    cancel: '取消',
    remove: '從列表移除',
    removeConfirmTitle: '從列表移除這個專案？',
    // The one thing a user actually fears here, stated first and plainly.
    removeConfirmBody:
      '只是從專案列表裡移除，磁碟上的檔案不受影響。這個專案下已有的任務會移到「未歸屬」分組，不會被刪除。',
    removeConfirm: '移除',
    removeCancel: '取消',
    actionFailed: '操作失敗',
    unavailable: '目錄不可用',
    defaultUnavailable: '原來的預設專案已不可用，新任務暫時沿用上次使用的專案。',
    emptyTitle: '還沒有專案',
    emptyBody: '新增一個專案資料夾後，新任務就能在它裡面工作，側邊欄也會按專案替任務分組。',
    moreActions: (projectName: string) => `更多操作：${projectName}`,
  },
  en: {
    foldersSection: 'Working folders',
    section: 'Projects',
    sectionHelp:
      'Folders you have added. A new task can pick one next to the input box, and the sidebar groups tasks by project.',
    addProject: 'Add project',
    defaultDirectory: 'Default working folder',
    defaultDirectoryHelp: 'A task with no project gets a new folder of its own in here.',
    changeFolder: 'Change…',
    resetFolder: 'Use default',
    changeFolderFailed: 'Could not change the working folder',
    defaultBadge: 'Default',
    setDefault: 'Set as default',
    clearDefault: 'Clear default',
    setDefaultFailed: 'Could not set the default project',
    rename: 'Rename',
    renameLabel: 'Project name',
    renameFailed: 'Could not rename the project',
    openFolder: 'Open project folder',
    openFolderFailed: 'Could not open this folder — it may have been moved or deleted',
    save: 'Save',
    cancel: 'Cancel',
    remove: 'Remove from list',
    removeConfirmTitle: 'Remove this project from the list?',
    removeConfirmBody:
      'This only removes it from the project list; the files on disk are untouched. Tasks under this project move to “Ungrouped” and are not deleted.',
    removeConfirm: 'Remove',
    removeCancel: 'Cancel',
    actionFailed: 'Action failed',
    unavailable: 'Folder unavailable',
    defaultUnavailable:
      'The default project is no longer available, so new tasks reuse the project you last used.',
    emptyTitle: 'No projects yet',
    emptyBody:
      'Add a project folder and new tasks can work in it, with the sidebar grouping tasks by project.',
    moreActions: (projectName: string) => `More actions for ${projectName}`,
  },
} satisfies UiCatalog<SettingsProjectsCopy>;

export function getSettingsProjectsCopy(locale: UiLocale): SettingsProjectsCopy {
  return SETTINGS_PROJECTS_COPY_BY_LOCALE[locale];
}
