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

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export type McpCopy = {
  errors: {
    load: string;
    install(name: string): string;
    cancelInstall(name: string): string;
    save: string;
    import: string;
    update: string;
    test: string;
    remove: string;
    unavailableStatus: string;
    mapLine(line: number): string;
    importJson: string;
    importObject: string;
    importVersion(version: string): string;
    importServersObject: string;
    importProtocolVersion: string;
    /** Upstream #4505: an atomic write whose survival could not be confirmed. */
    writeDurabilityUnknown: string;
    /** The same, plus MCP runtime state that no longer matches the config. */
    writeOutOfSync: string;
  };
  toast: {
    templateInstalled(name: string): string;
    templateInstalledDetail: string;
    installed(name: string): string;
    installedDetail: string;
    installCancelled(name: string): string;
    saved: string;
    savedDetail: string;
    imported: string;
    importedDetail(count: number): string;
    connectionOk: string;
    toolLatency(count: number, latencyMs: number): string;
    connectionFailed: string;
    removed: string;
  };
  remove: { title(id: string): string; description: string; confirm: string; cancel: string };
  page: {
    actionsAria: string;
    refreshing: string;
    refresh: string;
    add: string;
    metaInstalled(count: number): string;
    metaErrors(count: number): string;
    searchMatches(count: number): string;
    workspaceAria: string;
    toolbarAria: string;
    setupTitle: string;
    setupDescription: string;
    localStdio: string;
    categoriesAria: string;
    market: string;
    installed: string;
    searchPlaceholder: string;
    searchAria: string;
    noMarket: string;
    noMarketDetail(query: string): string;
    clearSearch: string;
    loading: string;
    noInstalled: string;
    noInstalledDetail: string;
    browseMarket: string;
    noInstalledMatch: string;
    noInstalledMatchDetail(query: string): string;
  };
  detail: {
    label: string;
    enabled: string;
    transport: string;
    endpoint: string;
    toolsLabel: string;
    statusLabel: string;
    protocolLabel: string;
    negotiatedProtocol(era: 'legacy' | 'modern', revision: string): string;
    inspectorOpened(id: string): string;
  };
  card: {
    macOnly: string;
    manage: string;
    cancellingAria(name: string): string;
    cancelAria(name: string): string;
    installAria(name: string): string;
    cancelling: string;
    cancel: string;
    install: string;
  };
  row: {
    testing: string;
    test: string;
    edit: string;
    delete: string;
    tools(count: number): string;
    disabled: string;
    disconnected: string;
    connecting: string;
    connected(count: number): string;
    failed: string;
  };
  editor: {
    importTitle: string;
    editTitle(id: string): string;
    addTitle: string;
    modeAria: string;
    manual: string;
    pasteJson: string;
    jsonConfig: string;
    jsonHelp: string;
    cancel: string;
    importConnect: string;
    transportAria: string;
    localStdio: string;
    remoteUrl: string;
    serverId: string;
    /** Under the name field: what the id is for. */
    serverIdHelp: string;
    command: string;
    commandPlaceholder: string;
    commandHelp: string;
    workingDirectory: string;
    workingDirectoryPlaceholder: string;
    environment: string;
    environmentHelp: string;
    url: string;
    urlHelp: string;
    headers: string;
    headersHelp: string;
    saveConnect: string;
    required: string;
    invalidUrl: string;
    unbalancedQuote: string;
    transportLabel: string;
    transportAuto: string;
    transportStreamableHttp: string;
    transportLegacySse: string;
    protocolLabel: string;
    protocolLegacy: string;
    protocolAuto: string;
    protocolModern: string;
    protocolHelp: string;
    sseProtocolHelp: string;
    expandAdvanced: string;
    collapseAdvanced: string;
    stdioProtocolHelp: string;
  };
};

const MCP_COPY = {
  'zh-CN': {
    errors: {
      load: '载入连接器失败',
      install: (name) => `安装 ${name} 失败`,
      cancelInstall: (name) => `取消安装 ${name} 失败`,
      save: '保存连接器失败',
      import: '导入连接器失败',
      update: '更新连接器失败',
      test: '连接器测试失败',
      remove: '删除连接器失败',
      unavailableStatus: '连接器没有返回可用状态。',
      mapLine: (line) => `第 ${line} 行应为 KEY=value`,
      importJson: '配置必须是有效的 JSON',
      importObject: 'JSON 必须是 object',
      importVersion: (version) => `不支持配置版本 ${version}，当前支持 version 1、2 和 3`,
      importServersObject: 'mcpServers 必须是 object',
      importProtocolVersion:
        'remote 的 protocol 需要 version 2 或 3；stdio 的 protocol 需要 version 3',
      writeDurabilityUnknown:
        '写入已发布，但无法确认断电后是否保留。请检查刷新后的配置再决定是否重试。',
      writeOutOfSync:
        '写入的持久性尚未确认，连接器运行状态也未能与配置同步。请检查配置并重新同步后再重试。',
    },
    toast: {
      templateInstalled: (name) => `${name} 模板已安装`,
      templateInstalledDetail: '请在「已安装」中完成凭据配置，再启用连接。',
      installed: (name) => `${name} 已安装`,
      installedDetail: '发现的工具会从下一次 agent turn 开始生效。',
      installCancelled: (name) => `已取消安装 ${name}`,
      saved: '连接器已保存',
      savedDetail: '新工具会从下一次 agent turn 开始生效。',
      imported: '已导入连接器',
      importedDetail: (count) => `本次导入 ${count} 个连接器。`,
      connectionOk: '连接正常',
      toolLatency: (count, latencyMs) => `${count} 个工具 · ${latencyMs} ms`,
      connectionFailed: '连接失败',
      removed: '连接器已删除',
    },
    remove: {
      title: (id) => `删除连接器「${id}」？`,
      description: '它提供的工具会从下一次 agent turn 中移除，配置无法自动恢复。',
      confirm: '删除',
      cancel: '取消',
    },
    page: {
      actionsAria: '连接器操作',
      refreshing: '刷新中…',
      refresh: '刷新',
      add: '添加',
      metaInstalled: (count) => `${count} 个已安装`,
      metaErrors: (count) => `${count} 个连接异常`,
      searchMatches: (count) => `${count} 个匹配`,
      workspaceAria: '连接器目录与已安装项',
      toolbarAria: '连接器浏览操作',
      setupTitle: '把 Maka 连接到你的工作环境',
      setupDescription: '从精选模板开始，或添加任意 stdio、Streamable HTTP 与 SSE server。',
      localStdio: '本地 stdio',
      categoriesAria: '连接器分类',
      market: '市场',
      installed: '已安装',
      searchPlaceholder: '搜索连接器…',
      searchAria: '搜索连接器',
      noMarket: '没有找到匹配的连接器',
      noMarketDetail: (query) => `换一个关键词，或清空「${query}」查看全部模板。`,
      clearSearch: '清空搜索',
      loading: '正在读取连接器配置…',
      noInstalled: '还没有连接器',
      noInstalledDetail: '从目录里选一个，或手动添加你自己的连接器。',
      browseMarket: '浏览市场',
      noInstalledMatch: '没有匹配的连接器',
      noInstalledMatchDetail: (query) => `换一个关键词，或清空「${query}」查看全部已安装项。`,
    },
    detail: {
      label: '服务器详情',
      enabled: '启用',
      transport: '传输方式',
      endpoint: '端点',
      toolsLabel: '工具',
      statusLabel: '状态',
      protocolLabel: 'MCP 协议',
      negotiatedProtocol: (era, revision) => `${era === 'modern' ? '现代' : '传统'} · ${revision}`,
      inspectorOpened: (id) => `已打开 ${id} 的详情`,
    },
    card: {
      macOnly: '仅 macOS',
      manage: '管理',
      cancellingAria: (name) => `正在取消安装 ${name}`,
      cancelAria: (name) => `取消安装 ${name}`,
      installAria: (name) => `安装 ${name}`,
      cancelling: '正在取消…',
      cancel: '取消安装',
      install: '安装',
    },
    row: {
      testing: '测试中…',
      test: '测试',
      edit: '编辑',
      delete: '删除',
      tools: (count) => `${count} 个工具`,
      disabled: '已停用',
      disconnected: '未连接',
      connecting: '连接中',
      connected: (count) => `${count} 个工具`,
      failed: '连接失败',
    },
    editor: {
      importTitle: '通过 JSON 导入',
      editTitle: (id) => `编辑 ${id}`,
      addTitle: '添加自定义连接器',
      modeAria: '连接器添加方式',
      manual: '手动配置',
      pasteJson: '粘贴 JSON',
      jsonConfig: 'JSON 配置',
      jsonHelp:
        '支持完整 mcpServers 配置或直接的 server map。未在本次导入中出现的已有连接器会保留。',
      cancel: '取消',
      importConnect: '导入并连接',
      transportAria: '连接方式',
      localStdio: '本地 stdio',
      remoteUrl: '远程 URL',
      serverId: '名称',
      serverIdHelp: '用作 mcp.json 里的键，也是列表里显示的名字。',
      command: '命令',
      commandPlaceholder: 'npx -y @modelcontextprotocol/server-filesystem /path/to/folder',
      commandHelp: '完整命令行；含空格的参数用引号包裹，不经过 shell 解析。',
      workingDirectory: '工作目录',
      workingDirectoryPlaceholder: '可选，例如 /path/to/project',
      environment: '环境变量',
      environmentHelp: '每行一个 KEY=value；按连接器要求填写。',
      url: '远程 MCP 服务器 URL',
      urlHelp: '接受 MCP 请求的 HTTPS 地址，例如 https://mcp.example.com/mcp。',
      headers: 'HTTP 请求头',
      headersHelp: '每行一个 Header=value。',
      saveConnect: '保存并连接',
      required: '此字段为必填项。',
      invalidUrl: '请输入有效的 HTTP 或 HTTPS URL。',
      unbalancedQuote: '引号未闭合。',
      transportLabel: '传输协议',
      transportAuto: '自动回退',
      transportStreamableHttp: 'Streamable HTTP',
      transportLegacySse: '旧版 SSE',
      protocolLabel: '协议偏好',
      protocolLegacy: '传统',
      protocolAuto: '自动协商',
      protocolModern: '仅 2026-07-28',
      protocolHelp: '旧配置默认使用传统协议；自动协商会根据 server 能力选择协议。',
      sseProtocolHelp: '旧版 SSE 仅支持传统协议。',
      expandAdvanced: '高级设置',
      collapseAdvanced: '隐藏高级设置',
      stdioProtocolHelp:
        '自动协商和“仅 2026-07-28”会先启动一个使用相同命令、参数、目录和环境的短期探测进程；探测结束后才启动实际连接。旧配置默认使用传统协议，只启动一个进程。',
    },
  },
  'zh-TW': {
    errors: {
      load: '載入連接器失敗',
      install: (name) => `安裝 ${name} 失敗`,
      cancelInstall: (name) => `取消安裝 ${name} 失敗`,
      save: '儲存連接器失敗',
      import: '匯入連接器失敗',
      update: '更新連接器失敗',
      test: '連接器測試失敗',
      remove: '刪除連接器失敗',
      unavailableStatus: '連接器沒有返回可用狀態。',
      mapLine: (line) => `第 ${line} 行應為 KEY=value`,
      importJson: '設定必須是有效的 JSON',
      importObject: 'JSON 必須是 object',
      importVersion: (version) => `不支援設定版本 ${version}，目前支援 version 1、2 和 3`,
      importServersObject: 'mcpServers 必須是 object',
      importProtocolVersion:
        'remote 的 protocol 需要 version 2 或 3；stdio 的 protocol 需要 version 3',
      writeDurabilityUnknown:
        '寫入已發布，但無法確認斷電後是否保留。請檢查重新整理後的設定再決定是否重試。',
      writeOutOfSync:
        '寫入的持久性尚未確認，連接器執行狀態也未能與設定同步。請檢查設定並重新同步後再重試。',
    },
    toast: {
      templateInstalled: (name) => `${name} 模板已安裝`,
      templateInstalledDetail: '請在「已安裝」中完成憑據設定，再啟用連線。',
      installed: (name) => `${name} 已安裝`,
      installedDetail: '發現的工具會從下一次 agent turn 開始生效。',
      installCancelled: (name) => `已取消安裝 ${name}`,
      saved: '連接器已儲存',
      savedDetail: '新工具會從下一次 agent turn 開始生效。',
      imported: '已匯入連接器',
      importedDetail: (count) => `本次匯入 ${count} 個連接器。`,
      connectionOk: '連線正常',
      toolLatency: (count, latencyMs) => `${count} 個工具 · ${latencyMs} ms`,
      connectionFailed: '連線失敗',
      removed: '連接器已刪除',
    },
    remove: {
      title: (id) => `刪除連接器「${id}」？`,
      description: '它提供的工具會從下一次 agent turn 中移除，設定無法自動恢復。',
      confirm: '刪除',
      cancel: '取消',
    },
    page: {
      actionsAria: '连接器操作',
      refreshing: '重新整理中…',
      refresh: '重新整理',
      add: '新增',
      metaInstalled: (count) => `${count} 個已安裝`,
      metaErrors: (count) => `${count} 個連線異常`,
      searchMatches: (count) => `${count} 個符合`,
      workspaceAria: '連接器目錄與已安裝項',
      toolbarAria: '連接器瀏覽操作',
      setupTitle: '把 Maka 連線到你的工作環境',
      setupDescription: '從精選模板開始，或新增任意 stdio、Streamable HTTP 與 SSE server。',
      localStdio: '本地 stdio',
      categoriesAria: '連接器分類',
      market: '市場',
      installed: '已安裝',
      searchPlaceholder: '搜尋連接器…',
      searchAria: '搜尋連接器',
      noMarket: '沒有找到符合的連接器',
      noMarketDetail: (query) => `換一個關鍵詞，或清空「${query}」檢視全部模板。`,
      clearSearch: '清空搜尋',
      loading: '正在讀取連接器設定…',
      noInstalled: '還沒有連接器',
      noInstalledDetail: '從目錄裡選一個，或手動新增你自己的連接器。',
      browseMarket: '瀏覽市場',
      noInstalledMatch: '沒有符合的連接器',
      noInstalledMatchDetail: (query) => `換一個關鍵詞，或清空「${query}」檢視全部已安裝項。`,
    },
    detail: {
      label: '伺服器詳情',
      enabled: '啟用',
      transport: '傳輸方式',
      endpoint: '端點',
      toolsLabel: '工具',
      statusLabel: '狀態',
      protocolLabel: 'MCP 協議',
      negotiatedProtocol: (era, revision) => `${era === 'modern' ? '現代' : '傳統'} · ${revision}`,
      inspectorOpened: (id) => `已開啟 ${id} 的詳情`,
    },
    card: {
      macOnly: '僅 macOS',
      manage: '管理',
      cancellingAria: (name) => `正在取消安裝 ${name}`,
      cancelAria: (name) => `取消安裝 ${name}`,
      installAria: (name) => `安裝 ${name}`,
      cancelling: '正在取消…',
      cancel: '取消安裝',
      install: '安裝',
    },
    row: {
      testing: '測試中…',
      test: '測試',
      edit: '編輯',
      delete: '刪除',
      tools: (count) => `${count} 個工具`,
      disabled: '已停用',
      disconnected: '未連線',
      connecting: '連線中',
      connected: (count) => `${count} 個工具`,
      failed: '連線失敗',
    },
    editor: {
      importTitle: '透過 JSON 匯入',
      editTitle: (id) => `編輯 ${id}`,
      addTitle: '新增自訂連接器',
      modeAria: '連接器新增方式',
      manual: '手動設定',
      pasteJson: '貼上 JSON',
      jsonConfig: 'JSON 設定',
      jsonHelp:
        '支援完整 mcpServers 設定或直接的 server map。未在本次匯入中出現的已有連接器會保留。',
      cancel: '取消',
      importConnect: '匯入並連線',
      transportAria: '連線方式',
      localStdio: '本地 stdio',
      remoteUrl: '遠端 URL',
      serverId: '名稱',
      serverIdHelp: '用作 mcp.json 裡的鍵，也是清單裡顯示的名稱。',
      command: '命令',
      commandPlaceholder: 'npx -y @modelcontextprotocol/server-filesystem /path/to/folder',
      commandHelp: '完整命令列；含空格的引數用引號包裹，不經過 shell 解析。',
      workingDirectory: '工作目錄',
      workingDirectoryPlaceholder: '可選，例如 /path/to/project',
      environment: '環境變數',
      environmentHelp: '每行一個 KEY=value；按連接器要求填寫。',
      url: '遠端 MCP 伺服器 URL',
      urlHelp: '接受 MCP 請求的 HTTPS 位址，例如 https://mcp.example.com/mcp。',
      headers: 'HTTP 請求頭',
      headersHelp: '每行一個 Header=value。',
      saveConnect: '儲存並連線',
      required: '此欄位為必填項。',
      invalidUrl: '請輸入有效的 HTTP 或 HTTPS URL。',
      unbalancedQuote: '引號未閉合。',
      transportLabel: '傳輸協議',
      transportAuto: '自動回退',
      transportStreamableHttp: 'Streamable HTTP',
      transportLegacySse: '舊版 SSE',
      protocolLabel: '協議偏好',
      protocolLegacy: '傳統',
      protocolAuto: '自動協商',
      protocolModern: '僅 2026-07-28',
      protocolHelp: '舊設定預設使用傳統協議；自動協商會根據 server 能力選擇協議。',
      sseProtocolHelp: '舊版 SSE 僅支援傳統協議。',
      expandAdvanced: '進階設定',
      collapseAdvanced: '隱藏進階設定',
      stdioProtocolHelp:
        '自動協商和“僅 2026-07-28”會先啟動一個使用相同命令、引數、目錄和環境的短期探測程序；探測結束後才啟動實際連線。舊設定預設使用傳統協議，只啟動一個程序。',
    },
  },
  en: {
    errors: {
      load: 'Failed to load connectors',
      install: (name) => `Failed to install ${name}`,
      cancelInstall: (name) => `Failed to cancel installation of ${name}`,
      save: 'Failed to save connector',
      import: 'Failed to import connectors',
      update: 'Failed to update connector',
      test: 'Connector test failed',
      remove: 'Failed to delete connector',
      unavailableStatus: 'The connector did not return an available status.',
      mapLine: (line) => `Line ${line} must use KEY=value`,
      importJson: 'The configuration must be valid JSON',
      importObject: 'The JSON must be an object',
      importVersion: (version) =>
        `Unsupported config version ${version}; versions 1, 2, and 3 are supported`,
      importServersObject: 'mcpServers must be an object',
      importProtocolVersion:
        'Remote protocol preferences require version 2 or 3; stdio protocol preferences require version 3',
      writeDurabilityUnknown:
        'The write was published, but survival after power loss could not be confirmed. Check the refreshed configuration before retrying.',
      writeOutOfSync:
        'The write durability is unconfirmed and the connector runtime state did not follow the configuration. Check the configuration and resynchronize before retrying.',
    },
    toast: {
      templateInstalled: (name) => `${name} template installed`,
      templateInstalledDetail:
        'Finish configuring credentials under Installed before enabling the connection.',
      installed: (name) => `${name} installed`,
      installedDetail: 'Discovered tools take effect from the next agent turn.',
      installCancelled: (name) => `Cancelled installation of ${name}`,
      saved: 'Connector saved',
      savedDetail: 'New tools take effect from the next agent turn.',
      imported: 'Connectors imported',
      importedDetail: (count) => `Imported ${count} ${count === 1 ? 'connector' : 'connectors'}.`,
      connectionOk: 'Connection healthy',
      toolLatency: (count, latencyMs) =>
        `${count} ${count === 1 ? 'tool' : 'tools'} · ${latencyMs} ms`,
      connectionFailed: 'Connection failed',
      removed: 'Connector deleted',
    },
    remove: {
      title: (id) => `Delete connector “${id}”?`,
      description:
        'Its tools will be removed from the next agent turn, and the configuration cannot be restored automatically.',
      confirm: 'Delete',
      cancel: 'Cancel',
    },
    page: {
      actionsAria: 'Connector actions',
      refreshing: 'Refreshing…',
      refresh: 'Refresh',
      add: 'Add',
      metaInstalled: (count) => `${count} installed`,
      metaErrors: (count) => `${count} ${count === 1 ? 'connection error' : 'connection errors'}`,
      searchMatches: (count) => `${count} ${count === 1 ? 'match' : 'matches'}`,
      workspaceAria: 'Connector directory and installed connectors',
      toolbarAria: 'Connector browser controls',
      setupTitle: 'Connect Maka to your work environment',
      setupDescription:
        'Start with a curated template, or add any stdio, Streamable HTTP, or SSE server.',
      localStdio: 'Local stdio',
      categoriesAria: 'Connector categories',
      market: 'Marketplace',
      installed: 'Installed',
      searchPlaceholder: 'Search connectors…',
      searchAria: 'Search connectors',
      noMarket: 'No matching connectors',
      noMarketDetail: (query) => `Try another keyword, or clear “${query}” to view every template.`,
      clearSearch: 'Clear search',
      loading: 'Reading connector configuration…',
      noInstalled: 'No connectors yet',
      noInstalledDetail: 'Pick one from the directory, or add your own.',
      browseMarket: 'Browse marketplace',
      noInstalledMatch: 'No matching connectors',
      noInstalledMatchDetail: (query) =>
        `Try another keyword, or clear “${query}” to view every connector.`,
    },
    detail: {
      label: 'Connector details',
      enabled: 'Enabled',
      transport: 'Transport',
      endpoint: 'Endpoint',
      toolsLabel: 'Tools',
      statusLabel: 'Status',
      protocolLabel: 'MCP protocol',
      negotiatedProtocol: (era, revision) =>
        `${era === 'modern' ? 'Modern' : 'Legacy'} · ${revision}`,
      inspectorOpened: (id) => `${id} details opened`,
    },
    card: {
      macOnly: 'macOS only',
      manage: 'Manage',
      cancellingAria: (name) => `Cancelling installation of ${name}`,
      cancelAria: (name) => `Cancel installation of ${name}`,
      installAria: (name) => `Install ${name}`,
      cancelling: 'Cancelling…',
      cancel: 'Cancel installation',
      install: 'Install',
    },
    row: {
      testing: 'Testing…',
      test: 'Test',
      edit: 'Edit',
      delete: 'Delete',
      tools: (count) => `${count} ${count === 1 ? 'tool' : 'tools'}`,
      disabled: 'Disabled',
      disconnected: 'Disconnected',
      connecting: 'Connecting',
      connected: (count) => `${count} ${count === 1 ? 'tool' : 'tools'}`,
      failed: 'Connection failed',
    },
    editor: {
      importTitle: 'Import from JSON',
      editTitle: (id) => `Edit ${id}`,
      addTitle: 'Add custom connector',
      modeAria: 'How to add the connector',
      manual: 'Manual configuration',
      pasteJson: 'Paste JSON',
      jsonConfig: 'JSON configuration',
      jsonHelp:
        'Supports a complete mcpServers configuration or a server map. Existing connectors omitted from this import are preserved.',
      cancel: 'Cancel',
      importConnect: 'Import and connect',
      transportAria: 'Connection method',
      localStdio: 'Local stdio',
      remoteUrl: 'Remote URL',
      serverId: 'Name',
      serverIdHelp: 'The key in mcp.json, and the name shown in the connectors list.',
      command: 'Command',
      commandPlaceholder: 'npx -y @modelcontextprotocol/server-filesystem /path/to/folder',
      commandHelp:
        'Full command line; quote arguments containing spaces. Not interpreted by a shell.',
      workingDirectory: 'Working directory',
      workingDirectoryPlaceholder: 'Optional, for example /path/to/project',
      environment: 'Environment',
      environmentHelp:
        'One KEY=value entry per line; complete the variables required by this connector.',
      url: 'Remote MCP server URL',
      urlHelp:
        'The HTTPS address that accepts MCP requests, for example https://mcp.example.com/mcp.',
      headers: 'HTTP headers',
      headersHelp: 'One Header=value entry per line.',
      saveConnect: 'Save and connect',
      required: 'This field is required.',
      invalidUrl: 'Enter a valid HTTP or HTTPS URL.',
      unbalancedQuote: 'Unclosed quote.',
      transportLabel: 'Transport',
      transportAuto: 'Auto fallback',
      transportStreamableHttp: 'Streamable HTTP',
      transportLegacySse: 'Legacy SSE',
      protocolLabel: 'Protocol preference',
      protocolLegacy: 'Legacy',
      protocolAuto: 'Auto-negotiate',
      protocolModern: '2026-07-28 only',
      protocolHelp:
        'Existing configurations default to legacy; auto-negotiation selects an era from the server response.',
      sseProtocolHelp: 'Legacy SSE supports only the legacy protocol era.',
      expandAdvanced: 'Advanced',
      collapseAdvanced: 'Hide advanced settings',
      stdioProtocolHelp:
        'Auto-negotiate and “2026-07-28 only” first start a short-lived probe with the same command, arguments, working directory, and environment. The session process starts only after the probe exits. Existing configurations default to Legacy and start one process.',
    },
  },
} satisfies UiCatalog<McpCopy>;

export function getMcpCopy(locale: UiLocale): McpCopy {
  return MCP_COPY[locale];
}
