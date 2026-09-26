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

// The pages a person sees in their browser while signing in: the choice of
// provider and the error page. Plain server-rendered HTML with no script,
// served under a strict Content-Security-Policy.

import type { FastifyReply, FastifyRequest } from 'fastify';

type Locale = 'zh' | 'en';

const COPY = {
  zh: {
    title: '登录 Maka',
    heading: '用公司账号登录',
    continueWith: (name: string) => `使用 ${name} 继续`,
    errorTitle: '无法登录',
    errorHint: '请回到 Maka 重新发起登录。',
  },
  en: {
    title: 'Sign in to Maka',
    heading: 'Sign in with your company account',
    continueWith: (name: string) => `Continue with ${name}`,
    errorTitle: 'Could not sign in',
    errorHint: 'Go back to Maka and start signing in again.',
  },
} as const;

export function requestLocale(request: FastifyRequest): Locale {
  return /^zh\b/i.test(request.headers['accept-language'] ?? '') ? 'zh' : 'en';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function page(locale: Locale, title: string, body: string): string {
  return `<!doctype html>
<html lang="${locale === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f7f7f5;--fg:#1f1f1c;--muted:#6b6b66;--card:#fff;--line:#e4e4df;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#1c1c1a;--fg:#ecece8;--muted:#a3a39c;--card:#262624;--line:#3a3a36;--accent:#60a5fa}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(360px,calc(100vw - 32px));background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{font-size:18px;margin:0 0 20px}
a.provider{display:block;padding:10px 14px;margin-top:10px;border:1px solid var(--line);border-radius:8px;color:var(--fg);text-decoration:none;text-align:center}
a.provider:hover{border-color:var(--accent)}
p{color:var(--muted);margin:8px 0 0}
</style></head><body><main>${body}</main></body></html>`;
}

export function sendHtml(reply: FastifyReply, status: number, html: string): FastifyReply {
  return reply
    .status(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', 'no-store')
    .header('x-frame-options', 'DENY')
    .header(
      'content-security-policy',
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'",
    )
    .send(html);
}

export function renderProviderChoice(
  locale: Locale,
  choices: readonly { href: string; displayName: string }[],
): string {
  const copy = COPY[locale];
  const links = choices
    .map(
      (choice) =>
        `<a class="provider" href="${escapeHtml(choice.href)}">${escapeHtml(copy.continueWith(choice.displayName))}</a>`,
    )
    .join('');
  return page(locale, copy.title, `<h1>${escapeHtml(copy.heading)}</h1>${links}`);
}

export function renderError(locale: Locale, message: string): string {
  const copy = COPY[locale];
  return page(
    locale,
    copy.errorTitle,
    `<h1>${escapeHtml(copy.errorTitle)}</h1><p>${escapeHtml(message)}</p><p>${escapeHtml(copy.errorHint)}</p>`,
  );
}
