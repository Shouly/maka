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

// The welcome surface: greeting chrome, the placeholder composer, the
// workspace and model pickers, and the onboarding recovery hero's frame.
//
// The greeting itself and the prompt-suggestion chips are NOT here — those
// already exist as `@maka/ui`'s `conversation-copy` (`empty.greeting`) and
// `locale-helpers` (`getPromptSuggestions`), and the onboarding hero's own
// sentences stay in `onboarding-copy.ts`.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';

export interface WelcomeCopy {
  readonly surfaceLabel: string;
  readonly composer: {
    readonly label: string;
    readonly placeholder: string;
    readonly send: string;
    readonly sending: string;
    readonly blockedNoWorkspace: string;
    readonly blockedNoModel: string;
    readonly failedTitle: string;
  };
  readonly suggestionsLabel: string;
  readonly workspace: {
    readonly label: string;
    readonly none: string;
    readonly placeholder: string;
    readonly searchLabel: string;
    readonly empty: string;
    readonly noMatch: string;
    readonly add: string;
    readonly relink: string;
    readonly loading: string;
    readonly hostUnavailable: string;
  };
  readonly model: {
    readonly label: string;
    readonly none: string;
    readonly empty: string;
    readonly openSettings: string;
  };
  readonly onboarding: {
    readonly surfaceLabel: string;
    readonly dismiss: string;
  };
}

const WELCOME_COPY = {
  'zh-CN': {
    surfaceLabel: '开始新任务',
    composer: {
      label: '任务内容',
      placeholder: '描述你想完成的事…',
      send: '发送',
      sending: '正在创建任务…',
      blockedNoWorkspace: '先选择一个工作区。',
      blockedNoModel: '先在设置里配置一个模型连接。',
      failedTitle: '任务创建失败',
    },
    suggestionsLabel: '提示建议',
    workspace: {
      label: '工作区',
      none: '选择工作区',
      placeholder: '搜索项目…',
      searchLabel: '搜索项目',
      empty: '这台 Host 上还没有项目。',
      noMatch: '没有匹配的项目。',
      add: '添加项目…',
      relink: '重新关联目录',
      loading: '正在载入项目…',
      hostUnavailable: 'Host 暂时不可用。',
    },
    model: {
      label: '模型',
      none: '选择模型',
      empty: '还没有可用模型。',
      openSettings: '前往模型设置',
    },
    onboarding: { surfaceLabel: '开始配置', dismiss: '稍后再说' },
  },
  'zh-TW': {
    surfaceLabel: '開始新任務',
    composer: {
      label: '任務內容',
      placeholder: '描述你想完成的事…',
      send: '傳送',
      sending: '正在建立任務…',
      blockedNoWorkspace: '請先選擇一個工作區。',
      blockedNoModel: '請先在設定裡設定一個模型連線。',
      failedTitle: '任務建立失敗',
    },
    suggestionsLabel: '提示建議',
    workspace: {
      label: '工作區',
      none: '選擇工作區',
      placeholder: '搜尋專案…',
      searchLabel: '搜尋專案',
      empty: '這台 Host 上還沒有專案。',
      noMatch: '沒有符合的專案。',
      add: '新增專案…',
      relink: '重新連結資料夾',
      loading: '正在載入專案…',
      hostUnavailable: 'Host 暫時無法使用。',
    },
    model: {
      label: '模型',
      none: '選擇模型',
      empty: '還沒有可用模型。',
      openSettings: '前往模型設定',
    },
    onboarding: { surfaceLabel: '開始設定', dismiss: '稍後再說' },
  },
  en: {
    surfaceLabel: 'Start a task',
    composer: {
      label: 'Task',
      placeholder: 'Describe what you want done…',
      send: 'Send',
      sending: 'Creating the task…',
      blockedNoWorkspace: 'Choose a workspace first.',
      blockedNoModel: 'Set up a model connection in settings first.',
      failedTitle: 'The task could not be created',
    },
    suggestionsLabel: 'Prompt suggestions',
    workspace: {
      label: 'Workspace',
      none: 'Choose workspace',
      placeholder: 'Search projects…',
      searchLabel: 'Search projects',
      empty: 'No projects on this Host yet.',
      noMatch: 'No matching project.',
      add: 'Add project…',
      relink: 'Relink folder',
      loading: 'Loading projects…',
      hostUnavailable: 'The Host is unavailable.',
    },
    model: {
      label: 'Model',
      none: 'Choose model',
      empty: 'No models available yet.',
      openSettings: 'Open model settings',
    },
    onboarding: { surfaceLabel: 'Get set up', dismiss: 'Not now' },
  },
} satisfies UiCatalog<WelcomeCopy>;

export function getWelcomeCopy(locale: UiLocale): WelcomeCopy {
  return WELCOME_COPY[locale];
}
