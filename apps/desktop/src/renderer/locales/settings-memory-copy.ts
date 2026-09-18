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

import type { MemoryMutationRejectionReason } from '@maka/runtime-host/protocol';
import { type UiCatalog, type UiLocale, lookupCopy } from '@maka/core/ui-locale';

export type MemorySettingsCopy = {
  intlLocale: string;
  generate: string;
  generateHelp: string;
  incognito: string;
  incognitoHelp: string;
  files: string;
  filesHelp: string;
  folder: string;
  openFolder: string;
  opening: string;
  reload: string;
  newFile: string;
  emptyTitle: string;
  emptyHelp: string;
  noDescription: string;
  bytes(count: string): string;
  openFileAria(path: string): string;
  editor: {
    back: string;
    createTitle: string;
    path: string;
    pathHelp: string;
    pathPlaceholder: string;
    content: string;
    contentPlaceholder: string;
    save: string;
    saving: string;
    delete: string;
    deleting: string;
    saved: string;
    created: string;
    deleted: string;
    conflict: string;
    conflictHelp: string;
    missing: string;
  };
  remove: {
    title(path: string): string;
    description: string;
    confirm: string;
    cancel: string;
  };
  errors: {
    loadFailed: string;
    readFailed: string;
    saveFailed: string;
    deleteFailed: string;
    toggleFailed: string;
    openFailed: string;
  };
  rejections: Record<MemoryMutationRejectionReason, string>;
};

const SETTINGS_MEMORY_COPY = {
  'zh-CN': {
    intlLocale: 'zh-CN',
    generate: '从聊天生成记忆',
    generateHelp:
      '每次回复后，后台会复盘这轮对话，把持久的信息整理进记忆文件；你明确要求记住或忘掉的内容会当场处理。关闭后模型不再读取也不再写入记忆。',
    incognito: '隐身中',
    incognitoHelp: '隐身对话不使用记忆，也不会写入。',
    files: '记忆文件',
    filesHelp: '一个主题一个 Markdown 文件，保存在本机，可以直接编辑。',
    folder: '目录',
    openFolder: '在访达中显示',
    opening: '打开中…',
    reload: '刷新',
    newFile: '新建文件',
    emptyTitle: '还没有记忆文件',
    emptyHelp: '聊几轮之后，后台会把值得记住的内容整理到这里。',
    noDescription: '没有描述',
    bytes: (count) => `${count} 字节`,
    openFileAria: (path) => `打开 ${path}`,
    editor: {
      back: '返回记忆文件列表',
      createTitle: '新建记忆文件',
      path: '路径',
      pathHelp: '以 / 开头、以 .md 结尾，例如 /topics/food.md、/people/sam.md。',
      pathPlaceholder: '/topics/food.md',
      content: '内容',
      contentPlaceholder:
        '---\nname: food\ndescription: 一句话说明这个文件放什么\nsources: [chat]\n---\n\n- [stated] …',
      save: '保存',
      saving: '保存中…',
      delete: '删除文件',
      deleting: '删除中…',
      saved: '已保存',
      created: '已创建',
      deleted: '已删除',
      conflict: '文件在你编辑期间被修改了',
      conflictHelp: '已载入最新内容，请在此基础上重新修改后保存。',
      missing: '这个文件已不存在。',
    },
    remove: {
      title: (path) => `删除 ${path}？`,
      description: '此操作不可撤销。模型会忘掉这个文件里的全部内容。',
      confirm: '删除',
      cancel: '取消',
    },
    errors: {
      loadFailed: '载入记忆文件失败',
      readFailed: '读取记忆文件失败',
      saveFailed: '保存记忆文件失败',
      deleteFailed: '删除记忆文件失败',
      toggleFailed: '更新记忆开关失败',
      openFailed: '无法打开记忆目录',
    },
    rejections: {
      exists: '这个路径已经有文件了。',
      not_found: '文件不存在。',
      version_conflict: '文件在你编辑期间被修改了，请刷新后重试。',
      oversize: '文件超过大小上限，请精简后再保存。',
      empty: '内容不能为空。',
      invalid_path: '路径无效：需要以 / 开头、以 .md 结尾。',
      disabled: '记忆已关闭，无法写入。',
      incognito: '隐身对话中无法写入记忆。',
    },
  },
  'zh-TW': {
    intlLocale: 'zh-TW',
    generate: '從聊天產生記憶',
    generateHelp:
      '每次回覆後，背景會複盤這輪對話，把持久的資訊整理進記憶檔案；你明確要求記住或忘掉的內容會當場處理。關閉後模型不再讀取也不再寫入記憶。',
    incognito: '隱身中',
    incognitoHelp: '隱身對話不使用記憶，也不會寫入。',
    files: '記憶檔案',
    filesHelp: '一個主題一個 Markdown 檔案，儲存在本機，可以直接編輯。',
    folder: '目錄',
    openFolder: '在 Finder 中顯示',
    opening: '開啟中…',
    reload: '重新整理',
    newFile: '新增檔案',
    emptyTitle: '還沒有記憶檔案',
    emptyHelp: '聊幾輪之後，背景會把值得記住的內容整理到這裡。',
    noDescription: '沒有描述',
    bytes: (count) => `${count} 位元組`,
    openFileAria: (path) => `開啟 ${path}`,
    editor: {
      back: '返回記憶檔案列表',
      createTitle: '新增記憶檔案',
      path: '路徑',
      pathHelp: '以 / 開頭、以 .md 結尾，例如 /topics/food.md、/people/sam.md。',
      pathPlaceholder: '/topics/food.md',
      content: '內容',
      contentPlaceholder:
        '---\nname: food\ndescription: 一句話說明這個檔案放什麼\nsources: [chat]\n---\n\n- [stated] …',
      save: '儲存',
      saving: '儲存中…',
      delete: '刪除檔案',
      deleting: '刪除中…',
      saved: '已儲存',
      created: '已建立',
      deleted: '已刪除',
      conflict: '檔案在你編輯期間被修改了',
      conflictHelp: '已載入最新內容，請在此基礎上重新修改後儲存。',
      missing: '這個檔案已不存在。',
    },
    remove: {
      title: (path) => `刪除 ${path}？`,
      description: '此操作無法復原。模型會忘掉這個檔案裡的全部內容。',
      confirm: '刪除',
      cancel: '取消',
    },
    errors: {
      loadFailed: '載入記憶檔案失敗',
      readFailed: '讀取記憶檔案失敗',
      saveFailed: '儲存記憶檔案失敗',
      deleteFailed: '刪除記憶檔案失敗',
      toggleFailed: '更新記憶開關失敗',
      openFailed: '無法開啟記憶目錄',
    },
    rejections: {
      exists: '這個路徑已經有檔案了。',
      not_found: '檔案不存在。',
      version_conflict: '檔案在你編輯期間被修改了，請重新整理後再試。',
      oversize: '檔案超過大小上限，請精簡後再儲存。',
      empty: '內容不能為空。',
      invalid_path: '路徑無效：需要以 / 開頭、以 .md 結尾。',
      disabled: '記憶已關閉，無法寫入。',
      incognito: '隱身對話中無法寫入記憶。',
    },
  },
  en: {
    intlLocale: 'en',
    generate: 'Generate memory from chats',
    generateHelp:
      'After each reply, a background pass reviews the exchange and files what is durable into memory; anything you explicitly ask to remember or forget is handled right away. Off, the model neither reads nor writes memory.',
    incognito: 'Incognito',
    incognitoHelp: 'Incognito conversations run without memory and never write to it.',
    files: 'Memory files',
    filesHelp: 'One Markdown file per subject, kept on this machine, editable in place.',
    folder: 'Folder',
    openFolder: 'Show in Finder',
    opening: 'Opening…',
    reload: 'Reload',
    newFile: 'New file',
    emptyTitle: 'No memory files yet',
    emptyHelp: 'After a few conversations, the background pass files what is worth keeping here.',
    noDescription: 'No description',
    bytes: (count) => `${count} bytes`,
    openFileAria: (path) => `Open ${path}`,
    editor: {
      back: 'Back to memory files',
      createTitle: 'New memory file',
      path: 'Path',
      pathHelp: 'Starts with / and ends with .md — /topics/food.md, /people/sam.md.',
      pathPlaceholder: '/topics/food.md',
      content: 'Content',
      contentPlaceholder:
        '---\nname: food\ndescription: one line on what this file covers\nsources: [chat]\n---\n\n- [stated] …',
      save: 'Save',
      saving: 'Saving…',
      delete: 'Delete file',
      deleting: 'Deleting…',
      saved: 'Saved',
      created: 'Created',
      deleted: 'Deleted',
      conflict: 'The file changed while you were editing',
      conflictHelp: 'The latest content is loaded; make your change again on top of it and save.',
      missing: 'This file no longer exists.',
    },
    remove: {
      title: (path) => `Delete ${path}?`,
      description: 'This cannot be undone. The model forgets everything in this file.',
      confirm: 'Delete',
      cancel: 'Cancel',
    },
    errors: {
      loadFailed: 'Could not load memory files',
      readFailed: 'Could not read the memory file',
      saveFailed: 'Could not save the memory file',
      deleteFailed: 'Could not delete the memory file',
      toggleFailed: 'Could not update the memory switch',
      openFailed: 'Could not open the memory folder',
    },
    rejections: {
      exists: 'A file already exists at this path.',
      not_found: 'The file does not exist.',
      version_conflict: 'The file changed while you were editing; reload and try again.',
      oversize: 'The file is over the size limit; condense it before saving.',
      empty: 'Content cannot be empty.',
      invalid_path: 'Invalid path: it must start with / and end with .md.',
      disabled: 'Memory is off; nothing can be written.',
      incognito: 'Memory cannot be written during an incognito conversation.',
    },
  },
} satisfies UiCatalog<MemorySettingsCopy>;

export function getMemorySettingsCopy(locale: UiLocale): MemorySettingsCopy {
  return SETTINGS_MEMORY_COPY[locale];
}

export function memoryRejectionMessage(
  reason: string | undefined,
  copy: MemorySettingsCopy,
  fallback: string,
): string {
  return lookupCopy(copy.rejections, reason) || fallback;
}
