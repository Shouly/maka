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

// The launch's words, shown inside the main window while the Runtime Host
// connects and when a handoff (an upgrade, a repair) needs a decision.

import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';
import type { DesktopStartupPhase } from '../../shared/desktop-startup.js';

export type StartupCopy = {
  /** What each step of the launch is doing, as the spinner's label. */
  phases: Record<DesktopStartupPhase, string>;
  slow: string;
  elapsed(time: string): string;
  copyDiagnostics: string;
  copied: string;
  copyFailed: string;
};

const STARTUP_COPY = {
  'zh-CN': {
    phases: {
      prepare: '正在准备 Maka',
      storage: '正在检查本地数据',
      connect: '正在连接 Runtime Host',
      package: '正在准备 Runtime Host 安装包',
      checking: '正在检查托管服务',
      staging: '正在安装更新',
      retiring: '正在安全停止旧服务',
      replacing: '正在替换托管服务',
      restart: '正在重启 Runtime Host',
      attention: '等待你的确认',
      renderer: '正在打开工作区',
    },
    slow: '此次启动耗时较长。更新可能需要下载或构建安装包，Maka 会继续处理。',
    elapsed: (time) => `已用时 ${time}`,
    copyDiagnostics: '复制诊断信息',
    copied: '已复制诊断信息',
    copyFailed: '无法复制诊断信息',
  },
  'zh-TW': {
    phases: {
      prepare: '正在準備 Maka',
      storage: '正在檢查本機資料',
      connect: '正在連線至 Runtime Host',
      package: '正在準備 Runtime Host 安裝套件',
      checking: '正在檢查託管服務',
      staging: '正在安裝更新',
      retiring: '正在安全停止舊服務',
      replacing: '正在替換託管服務',
      restart: '正在重新啟動 Runtime Host',
      attention: '等待你的確認',
      renderer: '正在開啟工作區',
    },
    slow: '此次啟動耗時較長。更新可能需要下載或建置安裝套件，Maka 會繼續處理。',
    elapsed: (time) => `已用時 ${time}`,
    copyDiagnostics: '複製診斷資訊',
    copied: '已複製診斷資訊',
    copyFailed: '無法複製診斷資訊',
  },
  en: {
    phases: {
      prepare: 'Preparing Maka',
      storage: 'Checking local data',
      connect: 'Connecting to Runtime Host',
      package: 'Preparing the Runtime Host package',
      checking: 'Checking the managed service',
      staging: 'Installing the update',
      retiring: 'Safely stopping the previous service',
      replacing: 'Replacing the managed service',
      restart: 'Restarting Runtime Host',
      attention: 'Waiting for your confirmation',
      renderer: 'Opening your workspace',
    },
    slow: 'This is taking longer than usual. Updates may need to download or build a package; Maka keeps going in the meantime.',
    elapsed: (time) => `Elapsed ${time}`,
    copyDiagnostics: 'Copy diagnostics',
    copied: 'Diagnostics copied',
    copyFailed: 'Could not copy diagnostics',
  },
} satisfies UiCatalog<StartupCopy>;

export function getStartupCopy(locale: UiLocale): StartupCopy {
  return STARTUP_COPY[locale];
}
