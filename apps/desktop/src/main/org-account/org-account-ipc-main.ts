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

// IPC for the company account. App-level, not per Runtime Host: the account
// belongs to this desktop, whichever Host it is attached to.

import { join } from 'node:path';
import type { IpcMain } from 'electron';
import type { UiCatalog, UiLocale } from '@maka/core/ui-locale';
import type { OrgAccountSetServerResult, OrgAccountState } from '../../shared/org-account.js';
import { loopbackFontsLoader } from './loopback-fonts.js';
import type { LoopbackPage } from './loopback-listener.js';
import { OrgAccountService } from './org-account-service.js';
import { type KeychainCipher, OrgAccountStore } from './org-account-store.js';

export interface OrgAccountIpcDeps {
  readonly ipcMain: Pick<IpcMain, 'handle'>;
  readonly send: (channel: 'orgAccount:changed', state: OrgAccountState) => void;
  readonly openExternal: (url: string) => Promise<void>;
  readonly keychain: KeychainCipher;
  readonly userDataDir: string;
  readonly appVersion: string;
  readonly deviceName: string;
  readonly managedServerUrl?: string;
  /** The app's locale now; the browser page speaks it. */
  readonly uiLocale: () => UiLocale;
  /** The link that brings Maka to the front (`app-url-scheme.ts`). */
  readonly appUrl: string;
  /** The renderer bundle's `assets` directory, where the page's faces are. */
  readonly rendererAssetsDir: string;
}

/** The browser page's words, after the Claude desktop's "Finish sign-in in the Claude app". */
const LOOPBACK_PAGE_COPY: UiCatalog<Omit<LoopbackPage, 'appUrl'>> = {
  'zh-CN': {
    lang: 'zh-CN',
    successTitle: '在 Maka 应用中完成登录',
    successBody: 'Maka 应该会自动打开。如果没有，请选择“打开 Maka”。应用打开后即可关闭此窗口。',
    failureTitle: '登录没有完成',
    failureBody: '回到 Maka 查看原因，然后重试。',
    openApp: '打开 Maka',
  },
  'zh-TW': {
    lang: 'zh-TW',
    successTitle: '在 Maka 應用程式中完成登入',
    successBody: 'Maka 應該會自動開啟。如果沒有，請選擇「開啟 Maka」。應用程式開啟後即可關閉此視窗。',
    failureTitle: '登入沒有完成',
    failureBody: '回到 Maka 查看原因，然後重試。',
    openApp: '開啟 Maka',
  },
  en: {
    lang: 'en',
    successTitle: 'Finish sign-in in the Maka app',
    successBody:
      'Maka should open automatically. If it doesn’t, select Open Maka. You can close this window once the app has opened.',
    failureTitle: 'Sign-in didn’t finish',
    failureBody: 'Go back to Maka to see why, then try again.',
    openApp: 'Open Maka',
  },
};

export async function registerOrgAccountIpc(deps: OrgAccountIpcDeps): Promise<OrgAccountService> {
  const pageFonts = loopbackFontsLoader(deps.rendererAssetsDir);
  const service = new OrgAccountService({
    store: new OrgAccountStore(join(deps.userDataDir, 'org-account.json'), deps.keychain),
    openExternal: deps.openExternal,
    appVersion: deps.appVersion,
    deviceName: deps.deviceName,
    ...(deps.managedServerUrl ? { managedServerUrl: deps.managedServerUrl } : {}),
    loopbackPage: () => {
      const fonts = pageFonts();
      return { ...LOOPBACK_PAGE_COPY[deps.uiLocale()], appUrl: deps.appUrl, ...(fonts ? { fonts } : {}) };
    },
  });
  // Handlers exist from the first moment: a Settings page opened while the
  // stored sign-in is still loading waits for it instead of failing.
  const ready = service.initialize();
  service.subscribe((state) => deps.send('orgAccount:changed', state));
  deps.ipcMain.handle('orgAccount:state', async (): Promise<OrgAccountState> => {
    await ready;
    return service.state();
  });
  deps.ipcMain.handle('orgAccount:setServerUrl', async (_event, value: unknown): Promise<OrgAccountSetServerResult> => {
    await ready;
    if (typeof value !== 'string' || value.length > 2048) return { ok: false, reason: 'invalid_url' };
    return service.setServerUrl(value);
  });
  deps.ipcMain.handle('orgAccount:signIn', async (_event, provider: unknown): Promise<OrgAccountState> => {
    await ready;
    return service.signIn(typeof provider === 'string' && provider.length <= 64 ? provider : undefined);
  });
  deps.ipcMain.handle('orgAccount:refresh', async (): Promise<OrgAccountState> => {
    await ready;
    await service.refresh();
    return service.state();
  });
  deps.ipcMain.handle('orgAccount:cancelSignIn', async (): Promise<void> => {
    await ready;
    service.cancelSignIn();
  });
  deps.ipcMain.handle('orgAccount:signOut', async (): Promise<OrgAccountState> => {
    await ready;
    await service.signOut();
    return service.state();
  });
  await ready;
  return service;
}
