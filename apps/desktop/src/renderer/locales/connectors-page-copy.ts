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

// What the Connectors page says that `mcp-copy.ts` does not already say.
//
// Deliberately thin, like `modules-copy.ts`: the pre-rewrite MCP page had an
// inspector, an import dialog and a cancellable install, so their vocabulary
// (titles, help text, failure reasons, `card.manage`, `card.cancel`) survived
// in `mcp-copy.ts` and is read from there. What is new here is what the
// pre-rewrite page did NOT have — the filter pills Claude's Connectors page
// puts under the toolbar, the expandable row detail that replaced the
// inspector pane, and the two summaries an import can now report.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export interface ConnectorsPageCopy {
  filters: {
    /** Names the pill group for a screen reader. */
    label: string;
    all: string;
    connected: string;
    notConnected: string;
    /** Nothing matched the pill — distinct from "no servers configured". */
    emptyConnected: string;
    emptyNotConnected: string;
    emptyDetail: string;
  };
  details: {
    show(id: string): string;
    hide(id: string): string;
    toolsEmpty: string;
    stderrLabel: string;
    stderrHint: string;
  };
  import: {
    placeholder: string;
    importing: string;
    /** An import that replaced existing ids says so; the count alone hides it. */
    replacedSummary(added: number, replaced: number): string;
    nothingImported: string;
  };
  install: {
    installing: string;
    /** The directory card's "Manage", named so one card's button is not every card's. */
    manageAria(name: string): string;
  };
}

/** The same JSON skeleton in every locale: it is code, not prose. */
const IMPORT_PLACEHOLDER = `{
  "mcpServers": {
    "files": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }
  }
}`;

const CONNECTORS_PAGE_COPY = {
  'zh-CN': {
    filters: {
      label: '按连接状态筛选',
      all: '全部',
      connected: '已连接',
      notConnected: '未连接',
      emptyConnected: '没有已连接的 Server',
      emptyNotConnected: '所有 Server 都已连接',
      emptyDetail: '切换到「全部」可以看到所有已配置的 Server。',
    },
    details: {
      show: (id) => `展开 ${id} 的详情`,
      hide: (id) => `收起 ${id} 的详情`,
      toolsEmpty: '连接成功后，这里会列出 Server 提供的工具。',
      stderrLabel: '标准错误输出',
      stderrHint: '这个进程最近写到 stderr 的几行。',
    },
    import: {
      placeholder: IMPORT_PLACEHOLDER,
      importing: '导入中…',
      replacedSummary: (added, replaced) => `新增 ${added} 个，覆盖 ${replaced} 个。`,
      nothingImported: '这份配置里没有可导入的 Server。',
    },
    install: {
      installing: '安装中…',
      manageAria: (name) => `管理 ${name}`,
    },
  },
  'zh-TW': {
    filters: {
      label: '依連線狀態篩選',
      all: '全部',
      connected: '已連線',
      notConnected: '未連線',
      emptyConnected: '沒有已連線的 Server',
      emptyNotConnected: '所有 Server 都已連線',
      emptyDetail: '切換到「全部」可以看到所有已設定的 Server。',
    },
    details: {
      show: (id) => `展開 ${id} 的詳情`,
      hide: (id) => `收合 ${id} 的詳情`,
      toolsEmpty: '連線成功後，這裡會列出 Server 提供的工具。',
      stderrLabel: '標準錯誤輸出',
      stderrHint: '這個行程最近寫到 stderr 的幾行。',
    },
    import: {
      placeholder: IMPORT_PLACEHOLDER,
      importing: '匯入中…',
      replacedSummary: (added, replaced) => `新增 ${added} 個，覆蓋 ${replaced} 個。`,
      nothingImported: '這份設定裡沒有可匯入的 Server。',
    },
    install: {
      installing: '安裝中…',
      manageAria: (name) => `管理 ${name}`,
    },
  },
  en: {
    filters: {
      label: 'Filter by connection state',
      all: 'All',
      connected: 'Connected',
      notConnected: 'Not connected',
      emptyConnected: 'No connected servers',
      emptyNotConnected: 'Every server is connected',
      emptyDetail: 'Switch the filter to All to see every configured server.',
    },
    details: {
      show: (id) => `Show details for ${id}`,
      hide: (id) => `Hide details for ${id}`,
      toolsEmpty: 'Tools appear here once the server connects.',
      stderrLabel: 'Standard error',
      stderrHint: 'The last lines this process wrote to stderr.',
    },
    import: {
      placeholder: IMPORT_PLACEHOLDER,
      importing: 'Importing…',
      replacedSummary: (added, replaced) => `${added} added · ${replaced} replaced.`,
      nothingImported: 'That configuration contained no servers to import.',
    },
    install: {
      installing: 'Installing…',
      manageAria: (name) => `Manage ${name}`,
    },
  },
} satisfies UiCatalog<ConnectorsPageCopy>;

export function getConnectorsPageCopy(locale: UiLocale): ConnectorsPageCopy {
  return CONNECTORS_PAGE_COPY[locale];
}
