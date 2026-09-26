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

// The company account's words: the login screen, the sidebar's account entry
// and Settings › Account. The sign-in buttons and the outcome lines are shared
// so the three surfaces say the same thing about the same state.

import { type UiCatalog, type UiLocale, lookupCopy } from '@maka/core/ui-locale';
import type { OrgAccountError } from '../../shared/org-account.js';
import type { MakaPlatform } from '../lib/platform.js';

export type OrgAccountCopy = {
  /** One button per identity provider the server offers. */
  continueWith(provider: string): string;
  /** The one button when the server names no provider: its own page offers the choice. */
  signIn: string;
  loadingOptions: string;
  finishInBrowser: string;
  finishInBrowserWith(provider: string): string;
  finishInBrowserHelp: string;
  cancel: string;
  tryAgain: string;
  admin: string;
  signOut: string;
  signingOut: string;
  /** Why the last sign-in did not happen, or why a sign-in ended. */
  lastErrors: Record<OrgAccountError, string>;
  /** Toast titles for a call that failed outright. */
  errors: {
    saveFailed: string;
    signInFailed: string;
    cancelFailed: string;
    signOutFailed: string;
    refreshFailed: string;
  };
  login: {
    title: string;
  };
  /** Between the Google button and the company one. */
  or: string;
  /** The first run's front page: "Maka *for* Mac", a line, "Get started". */
  welcome: {
    product: string;
    /** Set in italic between the product and the platform. */
    joiner: string;
    platforms: Record<MakaPlatform, string>;
    tagline: string;
    getStarted: string;
  };
  menu: {
    label(name: string): string;
    accountSettings: string;
  };
  settings: {
    title: string;
    description: string;
    server: string;
    serverHelp: string;
    serverLockedHelp: string;
    serverManagedHelp: string;
    serverPlaceholder: string;
    saving: string;
    serverRejections: Record<'invalid_url' | 'signed_in' | 'managed', string>;
    signedOut: string;
    signInHelp: string;
    needsServer: string;
    signedInUntil(date: string): string;
    notRemembered: string;
    loadFailed: string;
  };
};

const ORG_ACCOUNT_COPY = {
  'zh-CN': {
    continueWith: (provider) => `使用 ${provider} 登录`,
    signIn: '使用公司账号登录',
    loadingOptions: '正在加载登录方式…',
    finishInBrowser: '请在浏览器中完成登录…',
    finishInBrowserWith: (provider) => `请在浏览器中完成 ${provider} 登录…`,
    finishInBrowserHelp: '登录页已在浏览器中打开，完成后回到 Maka。',
    cancel: '取消',
    tryAgain: '重试',
    admin: '管理员',
    signOut: '退出登录',
    signingOut: '退出中…',
    lastErrors: {
      server_unreachable: '连不上服务器。请检查地址和网络后重试。',
      server_incompatible: '这个服务器与当前版本的 Maka 不兼容。请检查地址，或联系管理员。',
      upgrade_required: '当前 Maka 版本过旧，公司服务器已不再支持。请更新 Maka 后重新登录。',
      domain_not_allowed: '这个邮箱的域名不允许登录，请使用公司邮箱。',
      email_not_verified: '邮箱尚未验证。请先在登录服务中完成验证，然后重试。',
      account_deactivated: '账号已被停用，请联系管理员。',
      identity_conflict: '这个邮箱已属于另一个账号，请联系管理员处理。',
      provider_error: '登录服务出了问题，请稍后重试。',
      cancelled: '已取消登录。',
      timed_out: '登录超时。请重试，并在浏览器中完成登录。',
      sign_in_expired: '登录已失效，请重新登录。',
      unknown: '登录失败，请重试。',
    },
    errors: {
      saveFailed: '保存服务器地址失败',
      signInFailed: '登录失败',
      cancelFailed: '取消登录失败',
      signOutFailed: '退出登录失败',
      refreshFailed: '无法重新加载登录方式',
    },
    login: {
      title: '登录',
    },
    or: '或',
    welcome: {
      product: 'Maka',
      joiner: 'for',
      platforms: { darwin: 'Mac', win32: 'Windows', linux: 'Linux' },
      tagline: '与 Maka 对话的最快方式',
      getStarted: '开始使用',
    },
    menu: {
      label: (name) => `账号：${name}`,
      accountSettings: '账号设置',
    },
    settings: {
      title: '公司账号',
      description: '登录公司的 Maka 服务器后，Maka 使用公司提供的模型和服务。',
      server: '公司服务器',
      serverHelp: '公司 Maka 服务器的地址，以 https:// 开头。不清楚可以问管理员。',
      serverLockedHelp: '退出登录后才能更换服务器。',
      serverManagedHelp: '由这个版本的 Maka 指定，不能更改。',
      serverPlaceholder: 'https://maka.example.com',
      saving: '保存中…',
      serverRejections: {
        invalid_url: '地址无效：需要以 https:// 开头，且不带查询参数。',
        signed_in: '登录期间不能更换服务器，请先退出登录。',
        managed: '服务器由这个版本的 Maka 指定，不能更改。',
      },
      signedOut: '未登录',
      signInHelp: '在浏览器中用公司账号完成登录。',
      needsServer: '先填写并保存公司服务器地址。',
      signedInUntil: (date) => `登录有效至 ${date}，之后需要重新登录`,
      notRemembered: '系统钥匙串不可用，退出 Maka 后需要重新登录。',
      loadFailed: '无法读取账号状态',
    },
  },
  'zh-TW': {
    continueWith: (provider) => `使用 ${provider} 登入`,
    signIn: '使用公司帳號登入',
    loadingOptions: '正在載入登入方式…',
    finishInBrowser: '請在瀏覽器中完成登入…',
    finishInBrowserWith: (provider) => `請在瀏覽器中完成 ${provider} 登入…`,
    finishInBrowserHelp: '登入頁已在瀏覽器中開啟，完成後回到 Maka。',
    cancel: '取消',
    tryAgain: '重試',
    admin: '管理員',
    signOut: '登出',
    signingOut: '登出中…',
    lastErrors: {
      server_unreachable: '連不上伺服器。請檢查位址和網路後重試。',
      server_incompatible: '這個伺服器與目前版本的 Maka 不相容。請檢查位址，或聯絡管理員。',
      upgrade_required: '目前 Maka 版本過舊，公司伺服器已不再支援。請更新 Maka 後重新登入。',
      domain_not_allowed: '這個電子郵件的網域不允許登入，請使用公司電子郵件。',
      email_not_verified: '電子郵件尚未驗證。請先在登入服務中完成驗證，然後重試。',
      account_deactivated: '帳號已被停用，請聯絡管理員。',
      identity_conflict: '這個電子郵件已屬於另一個帳號，請聯絡管理員處理。',
      provider_error: '登入服務發生問題，請稍後重試。',
      cancelled: '已取消登入。',
      timed_out: '登入逾時。請重試，並在瀏覽器中完成登入。',
      sign_in_expired: '登入已失效，請重新登入。',
      unknown: '登入失敗，請重試。',
    },
    errors: {
      saveFailed: '儲存伺服器位址失敗',
      signInFailed: '登入失敗',
      cancelFailed: '取消登入失敗',
      signOutFailed: '登出失敗',
      refreshFailed: '無法重新載入登入方式',
    },
    login: {
      title: '登入',
    },
    or: '或',
    welcome: {
      product: 'Maka',
      joiner: 'for',
      platforms: { darwin: 'Mac', win32: 'Windows', linux: 'Linux' },
      tagline: '與 Maka 對話的最快方式',
      getStarted: '開始使用',
    },
    menu: {
      label: (name) => `帳號：${name}`,
      accountSettings: '帳號設定',
    },
    settings: {
      title: '公司帳號',
      description: '登入公司的 Maka 伺服器後，Maka 使用公司提供的模型和服務。',
      server: '公司伺服器',
      serverHelp: '公司 Maka 伺服器的位址，以 https:// 開頭。不清楚可以問管理員。',
      serverLockedHelp: '登出後才能更換伺服器。',
      serverManagedHelp: '由這個版本的 Maka 指定，不能更改。',
      serverPlaceholder: 'https://maka.example.com',
      saving: '儲存中…',
      serverRejections: {
        invalid_url: '位址無效：需要以 https:// 開頭，且不帶查詢參數。',
        signed_in: '登入期間不能更換伺服器，請先登出。',
        managed: '伺服器由這個版本的 Maka 指定，不能更改。',
      },
      signedOut: '未登入',
      signInHelp: '在瀏覽器中用公司帳號完成登入。',
      needsServer: '先填寫並儲存公司伺服器位址。',
      signedInUntil: (date) => `登入有效至 ${date}，之後需要重新登入`,
      notRemembered: '系統鑰匙圈無法使用，退出 Maka 後需要重新登入。',
      loadFailed: '無法讀取帳號狀態',
    },
  },
  en: {
    continueWith: (provider) => `Continue with ${provider}`,
    signIn: 'Sign in with company account',
    loadingOptions: 'Loading sign-in options…',
    finishInBrowser: 'Finish signing in in your browser…',
    finishInBrowserWith: (provider) => `Finish signing in with ${provider} in your browser…`,
    finishInBrowserHelp:
      'The sign-in page is open in your browser. Come back to Maka when you are done.',
    cancel: 'Cancel',
    tryAgain: 'Try again',
    admin: 'Admin',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    lastErrors: {
      server_unreachable:
        'Could not reach the server. Check the address and your network, then try again.',
      server_incompatible:
        'This server does not work with this version of Maka. Check the address, or ask your administrator.',
      upgrade_required:
        "This version of Maka is too old for your company's server. Update Maka, then sign in again.",
      domain_not_allowed: 'This email domain is not allowed to sign in. Use your company email.',
      email_not_verified:
        'Your email address is not verified. Verify it with the sign-in service, then try again.',
      account_deactivated: 'Your account has been deactivated. Contact your administrator.',
      identity_conflict:
        'This email already belongs to another account. Ask your administrator to sort it out.',
      provider_error: 'The sign-in service ran into a problem. Try again later.',
      cancelled: 'Sign-in cancelled.',
      timed_out: 'Sign-in timed out. Try again, and finish it in your browser.',
      sign_in_expired: 'Your sign-in has ended. Sign in again.',
      unknown: 'Sign-in failed. Try again.',
    },
    errors: {
      saveFailed: 'Could not save the server address',
      signInFailed: 'Sign-in failed',
      cancelFailed: 'Could not cancel sign-in',
      signOutFailed: 'Sign-out failed',
      refreshFailed: 'Could not reload the sign-in options',
    },
    login: {
      title: 'Sign In',
    },
    or: 'OR',
    welcome: {
      product: 'Maka',
      joiner: 'for',
      platforms: { darwin: 'Mac', win32: 'Windows', linux: 'Linux' },
      tagline: 'The fastest way to talk with Maka',
      getStarted: 'Get started',
    },
    menu: {
      label: (name) => `Account: ${name}`,
      accountSettings: 'Account settings',
    },
    settings: {
      title: 'Company account',
      description:
        "Once you sign in to your company's Maka server, Maka uses the models and services your company provides.",
      server: 'Company server',
      serverHelp:
        "The address of your company's Maka server, starting with https://. Ask your administrator if you don't know it.",
      serverLockedHelp: 'Sign out to change the server.',
      serverManagedHelp: 'Set by this build of Maka; it cannot be changed.',
      serverPlaceholder: 'https://maka.example.com',
      saving: 'Saving…',
      serverRejections: {
        invalid_url: 'Invalid address: it must start with https:// and have no query string.',
        signed_in: 'The server cannot change while you are signed in. Sign out first.',
        managed: 'This build of Maka sets the server; it cannot be changed.',
      },
      signedOut: 'Not signed in',
      signInHelp: 'Finish signing in with your company account in the browser.',
      needsServer: 'Enter and save your company server address first.',
      signedInUntil: (date) => `Signed in until ${date}, then sign in again`,
      notRemembered:
        'Your system keychain is unavailable; you will need to sign in again after quitting Maka.',
      loadFailed: 'Could not read the account status',
    },
  },
} satisfies UiCatalog<OrgAccountCopy>;

export function getOrgAccountCopy(locale: UiLocale): OrgAccountCopy {
  return ORG_ACCOUNT_COPY[locale];
}

/**
 * The line for the last sign-in outcome. A code this catalog does not know yet
 * (a newer main process) reads as `unknown` rather than as nothing.
 */
export function orgAccountErrorMessage(
  error: OrgAccountError | undefined,
  copy: OrgAccountCopy,
): string | undefined {
  if (error === undefined) return undefined;
  return lookupCopy(copy.lastErrors, error) ?? copy.lastErrors.unknown;
}
