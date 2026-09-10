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

import type { UiLocale } from '@maka/core/ui-locale';
import type { MessageBoxOptions } from 'electron';

export interface RuntimeHostQuitDialog<Decision extends string> {
  readonly options: MessageBoxOptions;
  readonly decisions: readonly Decision[];
}

export type RuntimeHostActiveQuitDecision = 'quit' | 'cancel';

export function buildRuntimeHostActiveQuitDialog(
  locale: UiLocale,
): RuntimeHostQuitDialog<RuntimeHostActiveQuitDecision> {
  const copy = COPY[locale];
  return {
    options: {
      type: 'warning',
      title: copy.activeTitle,
      // Same string on purpose. The native fallback shows `message` as its
      // headline and ignores `title` on macOS, while the browser card leads
      // with `title` — so both paths lead with the same sentence, and the card
      // drops the repeat rather than printing it twice.
      message: copy.activeTitle,
      detail: copy.activeDetail,
      buttons: [copy.stopAndQuit, copy.keepRunning],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    },
    decisions: ['quit', 'cancel'],
  };
}

const COPY = {
  en: {
    activeTitle: 'Background work is still running',
    activeDetail:
      'Quitting now interrupts everything running or queued. It resumes automatically the next time Maka starts.',
    stopAndQuit: 'Stop Work and Quit',
    keepRunning: 'Keep Maka Running',
  },
  'zh-CN': {
    activeTitle: '仍有后台任务在运行',
    activeDetail:
      '现在退出会中断正在执行和排队的任务。它们会在下次启动 Maka 时自动恢复。',
    stopAndQuit: '停止任务并退出',
    keepRunning: '继续运行 Maka',
  },
  'zh-TW': {
    activeTitle: '仍有背景工作正在執行',
    activeDetail:
      '現在結束會中斷正在執行和排隊的工作。它們會在下次啟動 Maka 時自動恢復。',
    stopAndQuit: '停止工作並結束',
    keepRunning: '繼續執行 Maka',
  },
} as const;
