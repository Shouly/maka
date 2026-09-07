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

// What the right pane says that no existing catalog already says.
//
// The faces themselves keep the catalogs written for them before the rewrite:
// `conversation-copy.ts` (`workbar`, `reviewPanel`, `terminalPanel`,
// `inspector`), `artifact-copy.ts` (the Files face and every artifact preview
// failure) and `browser-copy.ts`. Duplicating those here would give the same
// sentence two translations that drift.
//
// What is left is the pane's own chrome — the frame the reference design adds
// around a face — plus the two affordances that reach it from a transcript row.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export type WorkbarCopy = {
  /** The 8px inset frame the faces live in. */
  pane: {
    ariaLabel: string;
    expand: string;
    collapse: string;
    openSidebar: string;
    close: string;
    resize: string;
    resizeValue(width: number): string;
    closeTab(name: string): string;
    noSession: string;
    noSessionHint: string;
  };
  /** Reaching a face from a transcript row. */
  handoff: {
    openInFiles: string;
    openInTerminal: string;
  };
  terminal: {
    selectRun: string;
    runLabel(command: string): string;
    unnamedRun: string;
  };
  preview: {
    /** The one preview the desktop bundle cannot render inline. */
    pdfUnavailable: string;
    pdfUnavailableHint: string;
    openExternally: string;
  };
};

const WORKBAR_COPY = {
  'zh-CN': {
    pane: {
      ariaLabel: '任务工作栏',
      expand: '全屏显示工作栏',
      collapse: '退出全屏',
      openSidebar: '展开侧边栏',
      close: '收起工作栏',
      resize: '调整工作栏宽度',
      resizeValue: (width) => `${width} 像素`,
      closeTab: (name) => `关闭${name}`,
      noSession: '没有打开的任务',
      noSessionHint: '选择一个任务后，这里会显示它的文件、改动、终端和追踪。',
    },
    handoff: {
      openInFiles: '在文件中查看',
      openInTerminal: '在终端中打开',
    },
    terminal: {
      selectRun: '选择终端会话',
      runLabel: (command) => `终端：${command}`,
      unnamedRun: '终端',
    },
    preview: {
      pdfUnavailable: '无法在应用内预览 PDF',
      pdfUnavailableHint: '当前版本不内置 PDF 渲染器，请用系统程序打开或另存为。',
      openExternally: '用系统程序打开',
    },
  },
  'zh-TW': {
    pane: {
      ariaLabel: '任務工作欄',
      expand: '全螢幕顯示工作欄',
      collapse: '退出全螢幕',
      openSidebar: '展開側邊欄',
      close: '收起工作欄',
      resize: '調整工作欄寬度',
      resizeValue: (width) => `${width} 像素`,
      closeTab: (name) => `關閉${name}`,
      noSession: '沒有開啟的任務',
      noSessionHint: '選擇一個任務後，這裡會顯示它的檔案、變更、終端機與追蹤。',
    },
    handoff: {
      openInFiles: '在檔案中查看',
      openInTerminal: '在終端機中開啟',
    },
    terminal: {
      selectRun: '選擇終端機工作階段',
      runLabel: (command) => `終端機：${command}`,
      unnamedRun: '終端機',
    },
    preview: {
      pdfUnavailable: '無法在應用內預覽 PDF',
      pdfUnavailableHint: '目前版本未內建 PDF 轉譯器，請用系統程式開啟或另存新檔。',
      openExternally: '用系統程式開啟',
    },
  },
  en: {
    pane: {
      ariaLabel: 'Task workbar',
      expand: 'Expand the workbar to full screen',
      collapse: 'Leave full screen',
      openSidebar: 'Open sidebar',
      close: 'Collapse the workbar',
      resize: 'Resize the workbar',
      resizeValue: (width) => `${width} pixels`,
      closeTab: (name) => `Close ${name}`,
      noSession: 'No task is open',
      noSessionHint: 'Open a task to see its files, changes, terminal and trace here.',
    },
    handoff: {
      openInFiles: 'Open in Files',
      openInTerminal: 'Open in Terminal',
    },
    terminal: {
      selectRun: 'Choose a terminal session',
      runLabel: (command) => `Terminal: ${command}`,
      unnamedRun: 'Terminal',
    },
    preview: {
      pdfUnavailable: 'PDFs cannot be previewed in the app',
      pdfUnavailableHint:
        'This build ships no PDF renderer. Open the file in your system viewer, or save a copy.',
      openExternally: 'Open in the system viewer',
    },
  },
} satisfies UiCatalog<WorkbarCopy>;

export function getWorkbarCopy(locale: UiLocale): WorkbarCopy {
  return WORKBAR_COPY[locale];
}
