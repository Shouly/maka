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

// Copy for the pages that exist as frames before they exist as pages.
//
// Small on purpose: the settings and module surfaces already have their own
// catalogs (`settings-navigation-copy.ts`, `mcp-copy.ts`, `@maka/ui`'s
// `skills-copy.ts`), so the only strings that belong here are the ones that
// say a page is not built yet.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export interface SharedPlaceholderCopy {
  readonly settingsTitle: string;
  readonly comingInPhase: string;
  readonly skills: string;
  readonly skillsDescription: string;
  readonly mcp: string;
  readonly mcpDescription: string;
  readonly automations: string;
  readonly automationsDescription: string;
}

const PLACEHOLDER_COPY = {
  'zh-CN': {
    settingsTitle: '设置',
    comingInPhase: '这个页面还在建设中，功能会在后续版本里补齐。',
    skills: '技能',
    skillsDescription: '管理 Agent 可以调用的技能，以及它们的来源与启用状态。',
    mcp: 'MCP',
    mcpDescription: '连接 MCP 服务器，把外部工具接入 Agent。',
    automations: '自动化',
    automationsDescription: '按计划自动运行的任务，以及它们的执行记录。',
  },
  'zh-TW': {
    settingsTitle: '設定',
    comingInPhase: '這個頁面還在建置中，功能會在後續版本裡補齊。',
    skills: '技能',
    skillsDescription: '管理 Agent 可以呼叫的技能，以及它們的來源與啟用狀態。',
    mcp: 'MCP',
    mcpDescription: '連線 MCP 伺服器，把外部工具接入 Agent。',
    automations: '自動化',
    automationsDescription: '按計畫自動執行的任務，以及它們的執行紀錄。',
  },
  en: {
    settingsTitle: 'Settings',
    comingInPhase: 'This page is still being built; its controls arrive in a later release.',
    skills: 'Skills',
    skillsDescription: 'The skills the agent can invoke, where they come from, and which are on.',
    mcp: 'MCP',
    mcpDescription: 'Connect MCP servers to give the agent external tools.',
    automations: 'Automations',
    automationsDescription: 'Tasks that run on a schedule, and what happened when they did.',
  },
} satisfies UiCatalog<SharedPlaceholderCopy>;

export function getSharedPlaceholderCopy(locale: UiLocale): SharedPlaceholderCopy {
  return PLACEHOLDER_COPY[locale];
}
