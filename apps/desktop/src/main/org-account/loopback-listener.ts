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

// The loopback redirect a desktop sign-in returns to (RFC 8252 §7.3). Same
// rules as the MCP OAuth listener: bound to 127.0.0.1 on a random port; only
// a navigation to exactly this authority is answered; the state is checked
// before anything else, so a forged callback cannot even cancel a sign-in.

import { createServer, type ServerResponse } from 'node:http';
import { MAKA_WORDMARK_PATH, MAKA_WORDMARK_VIEW_BOX } from '@maka/core/maka-wordmark';

const CALLBACK_PATH = '/callback';
const CLOSE_GRACE_MS = 5_000;

export type LoopbackResult =
  | { readonly code: string }
  | { readonly error: string; readonly errorDescription?: string };

export interface LoopbackListener {
  readonly redirectUri: string;
  readonly result: Promise<LoopbackResult>;
  close(): void;
}

/**
 * What the browser shows once the provider sends it back. Drawn after the
 * Claude desktop's "Finish sign-in in the Claude app" page: the wordmark, one
 * serif line, one sentence, and a solid button that opens the app. The success
 * page also follows that link by itself, so the browser offers to switch to
 * Maka straight away; the button is there for when it does not.
 */
export interface LoopbackPage {
  /** `<html lang>`, the app's own locale. */
  readonly lang: string;
  readonly successTitle: string;
  readonly successBody: string;
  readonly failureTitle: string;
  readonly failureBody: string;
  readonly openApp: string;
  /** The app's URL scheme link; opening it only brings Maka to the front. */
  readonly appUrl: string;
  /**
   * The app's own faces (`loopback-fonts.ts`), inlined: the listener closes
   * as soon as the code has been exchanged, so the page cannot come back for
   * them. Without them the page falls back to the system's faces.
   */
  readonly fonts?: LoopbackFonts;
}

/** The woff2 bytes of the app's serif and sans, base64. */
export interface LoopbackFonts {
  readonly serif: string;
  readonly sans: string;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Sizes measured from the reference screenshot at 2x, against the same
// faces: the heading's ink width gives 20px exactly, the body 15px, the
// button 14px at weight 500.
const SERIF = '"anthropic-serif",ui-serif,Georgia,serif';
const SANS = '"anthropic-sans",system-ui,-apple-system,"Segoe UI",sans-serif';

function fontFaces(fonts: LoopbackFonts | undefined): string {
  if (!fonts) return '';
  const face = (family: string, data: string) =>
    `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${data}) format("woff2");` +
    'font-weight:300 800;font-style:normal;font-display:block}';
  return face('anthropic-serif', fonts.serif) + face('anthropic-sans', fonts.sans);
}

const PAGE_STYLE =
  ':root{color-scheme:light dark;--bg:#fcfcfb;--fg:#0b0b0b;--muted:#52514e;--button:#0b0b0b;--on-button:#fff}' +
  '@media (prefers-color-scheme:dark){:root{--bg:#151515;--fg:#f0efec;--muted:#c3c2b7;--button:#f0efec;--on-button:#0b0b0b}}' +
  // The block sits in the middle of the window, a little above centre (the
  // reference's: 16px up), and scrolls rather than clips in a short one.
  `body{margin:0;min-height:100vh;display:flex;background:var(--bg);color:var(--fg);font:15px/20px ${SANS};-webkit-font-smoothing:antialiased}` +
  'main{box-sizing:border-box;width:100%;max-width:calc(28rem + 32px);margin:auto;padding:24px 16px 56px;text-align:center}' +
  'div{display:flex;height:24px;align-items:center;justify-content:center;margin-bottom:48px}' +
  'svg{width:112px;height:auto;color:var(--fg)}' +
  `h1{margin:0;font:400 20px/28px ${SERIF}}` +
  'p{margin:8px 0 0;color:var(--muted)}' +
  'a{display:inline-block;margin-top:24px;padding:0 12px;height:32px;border-radius:8px;background:var(--button);' +
  'color:var(--on-button);font-size:14px;font-weight:500;line-height:32px;text-decoration:none}' +
  'a:focus-visible{outline:2px solid var(--fg);outline-offset:2px}';

export function renderLoopbackPage(page: LoopbackPage, outcome: 'success' | 'failure'): string {
  const title = outcome === 'success' ? page.successTitle : page.failureTitle;
  const body = outcome === 'success' ? page.successBody : page.failureBody;
  const appUrl = escapeHtml(page.appUrl);
  return (
    `<!doctype html><html lang="${escapeHtml(page.lang)}"><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    (outcome === 'success' ? `<meta http-equiv="refresh" content="0;url=${appUrl}">` : '') +
    `<title>${escapeHtml(title)}</title><style>${fontFaces(page.fonts)}${PAGE_STYLE}</style>` +
    `<main><div><svg viewBox="${MAKA_WORDMARK_VIEW_BOX}" role="img" aria-label="Maka">` +
    `<path d="${MAKA_WORDMARK_PATH}" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"/></svg></div>` +
    `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>` +
    `<a href="${appUrl}">${escapeHtml(page.openApp)}</a></main></html>`
  );
}

function respond(response: ServerResponse, status: number, page: LoopbackPage, outcome: 'success' | 'failure'): void {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    // One page per sign-in: the connection ends with it.
    connection: 'close',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; font-src data:",
  });
  response.end(renderLoopbackPage(page, outcome));
}

export function startLoopbackListener(state: string, page: LoopbackPage): Promise<LoopbackListener> {
  return new Promise((resolveListener, rejectListener) => {
    let settle!: (result: LoopbackResult) => void;
    let fail!: (error: Error) => void;
    const result = new Promise<LoopbackResult>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    result.catch(() => {});
    let expectedHost: string | undefined;
    let answered = false;
    // Pages still on their way to the browser. Node counts a connection as
    // idle once `end()` has been called, and closing the server destroys idle
    // sockets with whatever has not been flushed — so the server stays up
    // until every page has gone out (or a few seconds have passed).
    const sending = new Set<ServerResponse>();
    let closing = false;
    let closed = false;
    const shutDown = () => {
      if (closed) return;
      closed = true;
      server.close();
      server.closeAllConnections();
    };
    const server = createServer((request, response) => {
      sending.add(response);
      response.on('close', () => {
        sending.delete(response);
        if (closing && sending.size === 0) shutDown();
      });
      if (expectedHost !== undefined && request.headers.host !== expectedHost) {
        response.writeHead(403).end();
        return;
      }
      if (request.headers.origin !== undefined) {
        response.writeHead(403).end();
        return;
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end();
        return;
      }
      if (url.searchParams.get('state') !== state || answered) {
        respond(response, 400, page, 'failure');
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      if ((code && error) || (!code && !error)) {
        respond(response, 400, page, 'failure');
        return;
      }
      answered = true;
      if (code) {
        respond(response, 200, page, 'success');
        settle({ code });
      } else {
        respond(response, 200, page, 'failure');
        const description = url.searchParams.get('error_description');
        settle({ error: error!, ...(description ? { errorDescription: description } : {}) });
      }
    });
    server.on('error', rejectListener);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        rejectListener(new Error('The sign-in listener has no address'));
        return;
      }
      expectedHost = `127.0.0.1:${address.port}`;
      resolveListener({
        redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`,
        result,
        close() {
          fail(new Error('Sign-in closed'));
          // The sign-in often ends in the same tick its page was answered, and
          // the page (fonts inlined) is larger than a socket buffer.
          closing = true;
          if (sending.size === 0) shutDown();
          else setTimeout(shutDown, CLOSE_GRACE_MS).unref();
        },
      });
    });
  });
}
