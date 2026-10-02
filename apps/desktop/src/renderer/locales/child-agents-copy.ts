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

interface ChildAgentsCopy {
  /** How many agents are at work: the tray's name, a finished run's words. */
  status: (count: number) => string;
  /** A tray line's accessible name: it opens that agent's Session. */
  open: (name: string) => string;
  /** In place of a child agent's composer. */
  directedByParent: string;
  backToParent: string;
  stop: string;
  stopping: string;
  stopFailed: string;
}

const catalog = {
  en: {
    status: (count) => (count === 1 ? 'Agent running' : `${count} agents running`),
    open: (name) => `Open agent: ${name}`,
    directedByParent: 'This agent works for the main conversation; its results go back there.',
    backToParent: 'Back to the main conversation',
    stop: 'Stop',
    stopping: 'Stopping…',
    stopFailed: 'Could not stop the agent',
  },
  'zh-CN': {
    status: (count) => (count === 1 ? '子代理运行中' : `${count} 个子代理运行中`),
    open: (name) => `查看子代理：${name}`,
    directedByParent: '这个子代理为主对话工作，结果会交回主对话。',
    backToParent: '返回主对话',
    stop: '停止',
    stopping: '正在停止…',
    stopFailed: '无法停止子代理',
  },
  'zh-TW': {
    status: (count) => (count === 1 ? '子代理執行中' : `${count} 個子代理執行中`),
    open: (name) => `查看子代理：${name}`,
    directedByParent: '這個子代理為主對話工作，結果會交回主對話。',
    backToParent: '返回主對話',
    stop: '停止',
    stopping: '正在停止…',
    stopFailed: '無法停止子代理',
  },
} satisfies UiCatalog<ChildAgentsCopy>;

export function getChildAgentsCopy(locale: UiLocale): ChildAgentsCopy {
  return catalog[locale];
}
