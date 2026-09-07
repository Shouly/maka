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
const copy = {
  en: {
    title: 'Runtime connection check',
    description: 'Phase 1 · Live sessions and turn projection',
    sessions: 'Sessions',
    create: 'New session',
    refresh: 'Refresh',
    empty: 'No sessions yet',
    select: 'Select a session to inspect its turns.',
    prompt: 'Message',
    send: 'Send',
    stop: 'Stop',
    before: 'Earlier messages',
    after: 'Later messages',
    latest: 'Latest messages',
    ready: 'Event stream connected',
    pending: 'Connecting event stream…',
    turns: 'Turn projection',
    interactions: 'Pending interactions',
    queue: 'Message queue',
    design: 'Design system',
    runtime: 'Runtime',
    state: 'Connection and loading state',
    outcome: 'Submission result',
    working: 'Working…',
    error: 'Operation failed',
    noSession: 'Create or select a session first',
    response: 'Response JSON',
    respond: 'Submit response',
    resume: 'Resume',
    compact: 'Compact',
    model: 'Model connection',
    chooseModel: 'Use default model',
    noModel: 'No model connections available',
    theme: 'Theme',
    light: 'Light',
    dark: 'Dark',
    auto: 'Follow system',
  },
  'zh-CN': {
    title: '运行数据验证',
    description: 'Phase 1 · 真实会话与消息投影',
    sessions: '会话',
    create: '新建会话',
    refresh: '刷新',
    empty: '暂无会话',
    select: '选择会话查看消息投影。',
    prompt: '消息',
    send: '发送',
    stop: '停止',
    before: '更早消息',
    after: '更新消息',
    latest: '最新消息',
    ready: '事件流已连接',
    pending: '正在连接事件流…',
    turns: '消息投影',
    interactions: '待处理交互',
    queue: '消息队列',
    design: '设计系统',
    runtime: '运行数据',
    state: '连接与加载状态',
    outcome: '提交结果',
    working: '处理中…',
    error: '操作失败',
    noSession: '请先新建或选择会话',
    response: '响应 JSON',
    respond: '提交响应',
    resume: '恢复',
    compact: '压缩上下文',
    model: '模型连接',
    chooseModel: '使用默认模型',
    noModel: '暂无模型连接',
    theme: '主题',
    light: '浅色',
    dark: '深色',
    auto: '跟随系统',
  },
  'zh-TW': {
    title: '執行資料驗證',
    description: 'Phase 1 · 真實工作階段與訊息投影',
    sessions: '工作階段',
    create: '新增工作階段',
    refresh: '重新整理',
    empty: '尚無工作階段',
    select: '選擇工作階段以查看訊息投影。',
    prompt: '訊息',
    send: '傳送',
    stop: '停止',
    before: '更早訊息',
    after: '較新訊息',
    latest: '最新訊息',
    ready: '事件串流已連線',
    pending: '正在連接事件串流…',
    turns: '訊息投影',
    interactions: '待處理互動',
    queue: '訊息佇列',
    design: '設計系統',
    runtime: '執行資料',
    state: '連線與載入狀態',
    outcome: '提交結果',
    working: '處理中…',
    error: '操作失敗',
    noSession: '請先新增或選擇工作階段',
    response: '回應 JSON',
    respond: '提交回應',
    resume: '恢復',
    compact: '壓縮上下文',
    model: '模型連線',
    chooseModel: '使用預設模型',
    noModel: '尚無模型連線',
    theme: '主題',
    light: '淺色',
    dark: '深色',
    auto: '跟隨系統',
  },
} satisfies UiCatalog<Record<string, string>>;
export function getRuntimeDebugCopy(locale: UiLocale) {
  return copy[locale];
}
