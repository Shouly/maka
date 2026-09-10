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

const COPY = {
  'zh-CN': {
    view: (name: string) => `查看 ${name} 项目`,
    tasks: (count: number) => `${count} 个任务`,
    partialTasks: (count: number) => `已载入 ${count} 个任务`,
    edit: '编辑项目',
    openDirectory: '打开工作目录',
    unavailable: '工作目录暂不可用',
    remoteDirectory: '远程工作目录',
    loading: '正在读取工作目录…',
    openFailed: '无法打开工作目录',
  },
  'zh-TW': {
    view: (name: string) => `查看 ${name} 專案`,
    tasks: (count: number) => `${count} 個任務`,
    partialTasks: (count: number) => `已載入 ${count} 個任務`,
    edit: '編輯專案',
    openDirectory: '開啟工作目錄',
    unavailable: '工作目錄暫時無法使用',
    remoteDirectory: '遠端工作目錄',
    loading: '正在讀取工作目錄…',
    openFailed: '無法開啟工作目錄',
  },
  en: {
    view: (name: string) => `View ${name} project`,
    tasks: (count: number) => `${count} ${count === 1 ? 'task' : 'tasks'}`,
    partialTasks: (count: number) => `${count} ${count === 1 ? 'task' : 'tasks'} loaded`,
    edit: 'Edit project',
    openDirectory: 'Open working directory',
    unavailable: 'Working directory unavailable',
    remoteDirectory: 'Remote working directory',
    loading: 'Loading working directory…',
    openFailed: 'Could not open working directory',
  },
} satisfies UiCatalog<Record<string, string | ((value: never) => string)>>;

export const getProjectDetailsCopy = (locale: UiLocale) => COPY[locale];
