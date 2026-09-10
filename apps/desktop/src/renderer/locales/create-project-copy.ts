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
    title: '创建项目',
    name: '项目名称',
    folder: '工作目录',
    choose: '选择 Maka 可以读取和编辑的文件夹',
    change: '更换文件夹',
    host: '运行环境',
    cancel: '取消',
    create: '创建项目',
    busy: '正在创建…',
    failed: '项目创建失败',
    noHost: '当前没有支持本机目录选择的运行环境。远程项目可在工作区设置中添加。',
    settings: '工作区设置',
    quickTask: (name: string) => `在「${name}」中新建任务`,
  },
  'zh-TW': {
    title: '建立專案',
    name: '專案名稱',
    folder: '工作目錄',
    choose: '選擇 Maka 可以讀取和編輯的資料夾',
    change: '更換資料夾',
    host: '執行環境',
    cancel: '取消',
    create: '建立專案',
    busy: '正在建立…',
    failed: '專案建立失敗',
    noHost: '目前沒有支援本機資料夾選擇的執行環境。遠端專案可在工作區設定中新增。',
    settings: '工作區設定',
    quickTask: (name: string) => `在「${name}」中新增任務`,
  },
  en: {
    title: 'Create project',
    name: 'Project name',
    folder: 'Working directory',
    choose: 'Choose a folder Maka can read and edit',
    change: 'Change folder',
    host: 'Runtime Host',
    cancel: 'Cancel',
    create: 'Create project',
    busy: 'Creating…',
    failed: 'Could not create project',
    noHost: 'No Host supports local folder selection. Add remote projects in Workspace settings.',
    settings: 'Workspace settings',
    quickTask: (name: string) => `New task in ${name}`,
  },
} satisfies UiCatalog<Record<string, string | ((name: string) => string)>>;
export const getCreateProjectCopy = (locale: UiLocale) => COPY[locale];
