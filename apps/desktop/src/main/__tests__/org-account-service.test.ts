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

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { OrgAccountState } from '../../shared/org-account.js';
import { appOpenUrl, appUrlScheme, canClaimAppUrlScheme, installAppUrlScheme } from '../app-url-scheme.js';
import { findLoopbackFontFiles, loopbackFontsLoader } from '../org-account/loopback-fonts.js';
import { renderLoopbackPage, startLoopbackListener } from '../org-account/loopback-listener.js';
import { normalizeServerUrl, OrgAccountService, OrgAccountUnavailable } from '../org-account/org-account-service.js';
import { type KeychainCipher, OrgAccountStore } from '../org-account/org-account-store.js';

const SERVER = 'https://maka.example.com';
const PAGE = {
  lang: 'en',
  successTitle: 'Finish sign-in in the Maka app',
  successBody: 'Maka should open automatically.',
  failureTitle: "Sign-in didn't finish",
  failureBody: 'Go back to Maka.',
  openApp: 'Open Maka',
  appUrl: 'maka-dev://open',
};
const PROFILE = {
  id: 'u1',
  email: 'ada@relx.com',
  name: 'Ada',
  orgRole: 'member',
};

/** The parts of a state these tests assert on. */
const brief = (state: OrgAccountState) => ({
  status: state.status,
  ...(state.status === 'signed_out' && state.lastError ? { lastError: state.lastError } : {}),
});

const keychain = (available = true): KeychainCipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`sealed:${Buffer.from(plain).toString('base64')}`),
  decryptString: (sealed) => Buffer.from(sealed.toString().slice('sealed:'.length), 'base64').toString(),
});

/** Just enough of the Maka server: metadata, token (both grants), revoke, me. */
class FakeServer {
  now = 1_790_000_000_000;
  challenge = '';
  refreshCount = 0;
  revoked: string[] = [];
  rejectRefresh = false;
  /** Answer refreshes with this status and body instead (a proxy's 400, say). */
  refreshAnswer: { status: number; body: unknown } | undefined;
  down = false;
  /** Hold these answers back this long (ms): room to cancel or sign out meanwhile. */
  delay = { metadata: 0, token: 0 };
  metadata: Record<string, unknown> = {
    apiVersion: 1,
    identityProviders: [
      { id: 'relx-sso', displayName: 'RELX SSO' },
      { id: 'google', displayName: 'Google' },
    ],
    issuer: SERVER,
    authorizationEndpoint: `${SERVER}/oauth/authorize`,
    tokenEndpoint: `${SERVER}/oauth/token`,
    revocationEndpoint: `${SERVER}/oauth/revoke`,
    jwksUri: `${SERVER}/.well-known/jwks.json`,
  };
  requests: { url: string; headers: Record<string, string> }[] = [];

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    this.requests.push({ url: url.toString(), headers });
    if (this.down) throw new TypeError('fetch failed');
    if (url.pathname === '/.well-known/maka-platform') {
      if (this.delay.metadata) await new Promise((resolve) => setTimeout(resolve, this.delay.metadata));
      return Response.json(this.metadata);
    }
    if (url.pathname === '/v1/me') {
      return headers.authorization?.startsWith('Bearer at-') ? Response.json(PROFILE) : new Response('', { status: 401 });
    }
    if (url.pathname === '/oauth/revoke') {
      this.revoked.push(new URLSearchParams(String(init?.body)).get('token') ?? '');
      return Response.json({});
    }
    if (url.pathname === '/oauth/token') {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('grant_type') === 'authorization_code') {
        if (this.delay.token) await new Promise((resolve) => setTimeout(resolve, this.delay.token));
        const challenge = createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url');
        if (body.get('code') !== 'the-code' || challenge !== this.challenge) {
          return Response.json({ error: 'invalid_grant' }, { status: 400 });
        }
        return Response.json(this.tokens('rt-0'));
      }
      if (this.rejectRefresh) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      if (this.refreshAnswer) return Response.json(this.refreshAnswer.body, { status: this.refreshAnswer.status });
      this.refreshCount += 1;
      return Response.json(this.tokens(`rt-${this.refreshCount}`));
    }
    return new Response('', { status: 404 });
  };

  tokens(refresh: string) {
    return {
      access_token: `at-${refresh}`,
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: refresh,
      refresh_expires_at: this.now + 7 * 24 * 3600 * 1000,
      session_id: 's-1',
    };
  }
}

async function withService(
  fn: (input: {
    service: OrgAccountService;
    server: FakeServer;
    storePath: string;
    browser: { behaviour: 'approve' | 'deny' | 'ignore' | 'wrong-state'; opened: URL[] };
    make: (options?: {
      keychainAvailable?: boolean;
      signInTimeoutMs?: number;
      managedServerUrl?: string;
    }) => Promise<OrgAccountService>;
  }) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), 'maka-org-account-'));
  const storePath = join(dir, 'org-account.json');
  const server = new FakeServer();
  const browser = { behaviour: 'approve' as 'approve' | 'deny' | 'ignore' | 'wrong-state', opened: [] as URL[] };
  // The "browser": follows the authorize URL straight to the loopback redirect.
  const openExternal = async (value: string) => {
    const url = new URL(value);
    browser.opened.push(url);
    server.challenge = url.searchParams.get('code_challenge') ?? '';
    if (browser.behaviour === 'ignore') return;
    const back = new URL(url.searchParams.get('redirect_uri') ?? '');
    back.searchParams.set('state', browser.behaviour === 'wrong-state' ? 'forged' : (url.searchParams.get('state') ?? ''));
    if (browser.behaviour === 'deny') {
      back.searchParams.set('error', 'access_denied');
      back.searchParams.set('error_description', 'domain_not_allowed');
    } else {
      back.searchParams.set('code', 'the-code');
    }
    setTimeout(() => void fetch(back).catch(() => {}), 5);
  };
  const make = async (
    options: { keychainAvailable?: boolean; signInTimeoutMs?: number; managedServerUrl?: string } = {},
  ) => {
    const service = new OrgAccountService({
      store: new OrgAccountStore(storePath, keychain(options.keychainAvailable ?? true)),
      openExternal,
      appVersion: '0.3.0',
      deviceName: 'Test Mac',
      loopbackPage: () => PAGE,
      fetch: server.fetch as typeof fetch,
      now: () => server.now,
      ...(options.signInTimeoutMs ? { signInTimeoutMs: options.signInTimeoutMs } : {}),
      ...(options.managedServerUrl ? { managedServerUrl: options.managedServerUrl } : {}),
    });
    await service.initialize();
    return service;
  };
  try {
    const service = await make();
    await fn({ service, server, storePath, browser, make });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('normalizes a server address to https (or loopback http) without query or fragment', () => {
  assert.equal(normalizeServerUrl(' https://maka.example.com/ '), 'https://maka.example.com');
  assert.equal(normalizeServerUrl('https://example.com/maka/'), 'https://example.com/maka');
  assert.equal(normalizeServerUrl('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
  assert.equal(normalizeServerUrl('http://maka.example.com'), undefined);
  assert.equal(normalizeServerUrl('https://maka.example.com/?x=1'), undefined);
  assert.equal(normalizeServerUrl('not a url'), undefined);
});

test('signs in through the browser with PKCE and remembers the sign-in sealed by the keychain', async () => {
  await withService(async ({ service, server, storePath, browser, make }) => {
    const saved = await service.setServerUrl('https://maka.example.com/');
    assert.equal(saved.ok && saved.state.serverUrl, SERVER);
    assert.deepEqual(
      saved.ok && saved.state.status === 'signed_out' ? saved.state.providers?.map((p) => p.id) : undefined,
      ['relx-sso', 'google'],
      'the sign-in buttons come from the server',
    );
    assert.equal(saved.ok && saved.state.enforced, false);
    const states: OrgAccountState['status'][] = [];
    service.subscribe((state) => states.push(state.status));
    const state = await service.signIn();
    assert.equal(state.status, 'signed_in');
    assert.deepEqual(states, ['signing_in', 'signed_in']);
    if (state.status === 'signed_in') {
      assert.equal(state.profile.email, 'ada@relx.com');
      assert.equal(state.remembered, true);
    }
    const opened = browser.opened[0];
    assert.equal(opened?.origin, SERVER);
    assert.equal(opened?.searchParams.get('code_challenge_method'), 'S256');
    assert.match(opened?.searchParams.get('redirect_uri') ?? '', /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.equal(opened?.searchParams.get('device_name'), 'Test Mac');
    assert.ok(server.requests.every((request) => request.headers['x-maka-client-version'] === '0.3.0'));

    const file = await readFile(storePath, 'utf8');
    assert.doesNotMatch(file, /rt-0/, 'the refresh token is never written in the clear');
    assert.equal((await stat(storePath)).mode & 0o777, 0o600);

    // A restart finds the sign-in, and the first token it needs comes from a refresh.
    const restarted = await make();
    assert.equal(restarted.state().status, 'signed_in');
    assert.equal(await restarted.accessToken(), 'at-rt-1');
  });
});

test('reuses a fresh access token and refreshes only once for concurrent callers', async () => {
  await withService(async ({ service, server }) => {
    await service.setServerUrl(SERVER);
    await service.signIn();
    assert.equal(await service.accessToken(), 'at-rt-0');
    assert.equal(server.refreshCount, 0);
    server.now += 14.5 * 60 * 1000;
    const tokens = await Promise.all([service.accessToken(), service.accessToken(), service.accessToken()]);
    assert.deepEqual(tokens, ['at-rt-1', 'at-rt-1', 'at-rt-1']);
    assert.equal(server.refreshCount, 1);
  });
});

test('a refused refresh signs the device out with a reason', async () => {
  await withService(async ({ service, server }) => {
    await service.setServerUrl(SERVER);
    await service.signIn();
    server.now += 20 * 60 * 1000;
    server.rejectRefresh = true;
    await assert.rejects(service.accessToken(), (error: unknown) => {
      return error instanceof OrgAccountUnavailable && error.reason === 'sign_in_expired';
    });
    assert.deepEqual(brief(service.state()), { status: 'signed_out', lastError: 'sign_in_expired' });
  });
});

test('signing out revokes the refresh token and forgets it', async () => {
  await withService(async ({ service, server, storePath }) => {
    await service.setServerUrl(SERVER);
    await service.signIn();
    await service.signOut();
    assert.deepEqual(server.revoked, ['rt-0']);
    assert.equal(service.state().status, 'signed_out');
    assert.doesNotMatch(await readFile(storePath, 'utf8'), /session/);
    await assert.rejects(service.accessToken(), OrgAccountUnavailable);
  });
});

test('a refusal from the server comes back as its reason', async () => {
  await withService(async ({ service, browser }) => {
    await service.setServerUrl(SERVER);
    browser.behaviour = 'deny';
    assert.deepEqual(brief(await service.signIn()), { status: 'signed_out', lastError: 'domain_not_allowed' });
  });
});

test('a forged callback cannot finish or cancel a sign-in; cancel and timeout end it', async () => {
  await withService(async ({ service, browser, make }) => {
    await service.setServerUrl(SERVER);
    browser.behaviour = 'wrong-state';
    const quick = await make({ signInTimeoutMs: 200 });
    const timedOut = await quick.signIn();
    assert.equal(timedOut.status === 'signed_out' ? timedOut.lastError : undefined, 'timed_out');

    browser.behaviour = 'ignore';
    const pending = service.signIn();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(service.state().status, 'signing_in');
    service.cancelSignIn();
    assert.deepEqual(brief(await pending), { status: 'signed_out', lastError: 'cancelled' });
  });
});

test('a server that sends the browser elsewhere, or speaks another version, is refused', async () => {
  await withService(async ({ service, server, browser }) => {
    await service.setServerUrl(SERVER);
    server.metadata.authorizationEndpoint = 'https://phish.example/oauth/authorize';
    await service.signIn();
    assert.deepEqual(brief(service.state()), { status: 'signed_out', lastError: 'server_incompatible' });
    assert.equal(browser.opened.length, 0, 'the browser never opened');

    server.metadata.authorizationEndpoint = `${SERVER}/oauth/authorize`;
    server.metadata.minimumClientVersion = '0.4.0';
    await service.signIn();
    assert.deepEqual(brief(service.state()), { status: 'signed_out', lastError: 'upgrade_required' });
  });
});

test('without a keychain the sign-in lasts only while the app runs', async () => {
  await withService(async ({ make, storePath }) => {
    const service = await make({ keychainAvailable: false });
    await service.setServerUrl(SERVER);
    const state = await service.signIn();
    assert.equal(state.status === 'signed_in' && state.remembered, false);
    assert.doesNotMatch(await readFile(storePath, 'utf8'), /session/);
    assert.equal((await make({ keychainAvailable: false })).state().status, 'signed_out');
  });
});

test('the server address is fixed while signed in and must be https', async () => {
  await withService(async ({ service }) => {
    assert.deepEqual(await service.setServerUrl('http://maka.example.com'), { ok: false, reason: 'invalid_url' });
    await service.setServerUrl(SERVER);
    await service.signIn();
    assert.deepEqual(await service.setServerUrl('https://other.example.com'), { ok: false, reason: 'signed_in' });
  });
});

test('a deployment bound to a company server requires sign-in and fixes the address', async () => {
  await withService(async ({ make }) => {
    const service = await make({ managedServerUrl: 'https://maka.example.com/' });
    await service.refresh();
    const state = service.state();
    assert.equal(state.enforced, true);
    assert.equal(state.serverUrl, SERVER);
    assert.deepEqual(await service.setServerUrl('https://other.example.com'), { ok: false, reason: 'managed' });
    assert.equal((await service.signIn('relx-sso')).status, 'signed_in');
    assert.equal(service.state().enforced, true);
  });
});

test('the chosen provider goes to the server; one it does not offer is left out', async () => {
  await withService(async ({ service, browser }) => {
    await service.setServerUrl(SERVER);
    await service.signIn('google');
    assert.equal(browser.opened[0]?.searchParams.get('provider'), 'google');
    await service.signOut();
    await service.signIn('facebook');
    assert.equal(browser.opened[1]?.searchParams.has('provider'), false);
  });
});

test('a server that cannot be reached is reported, and a retry recovers', async () => {
  await withService(async ({ service, server }) => {
    server.down = true;
    await service.setServerUrl(SERVER);
    const down = service.state();
    assert.deepEqual(brief(down), { status: 'signed_out', lastError: 'server_unreachable' });
    assert.equal(down.status === 'signed_out' ? down.providers : 'x', undefined, 'no buttons without a server');
    server.down = false;
    await service.refresh();
    const up = service.state();
    assert.deepEqual(brief(up), { status: 'signed_out' });
    assert.equal(up.status === 'signed_out' ? up.providers?.length : 0, 2);
  });
});

test('the browser page: success opens the app by itself and offers the button, failure only the button', async () => {
  const listener = await startLoopbackListener('the-state', PAGE);
  try {
    const back = new URL(listener.redirectUri);
    back.searchParams.set('state', 'the-state');
    back.searchParams.set('code', 'the-code');
    const success = await fetch(back);
    assert.equal(success.status, 200);
    assert.match(success.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    const html = await success.text();
    assert.ok(html.includes('<meta http-equiv="refresh" content="0;url=maka-dev://open">'));
    assert.ok(html.includes('<a href="maka-dev://open">Open Maka</a>'));
    assert.ok(html.includes('<h1>Finish sign-in in the Maka app</h1>'));
    assert.ok(html.includes('aria-label="Maka"'), 'the wordmark heads the page');
    assert.match(html, /body\{[^}]*min-height:100vh;display:flex/, 'the block sits in the middle of the window');
    assert.match(html, /main\{[^}]*margin:auto/);
    assert.deepEqual(await listener.result, { code: 'the-code' });

    // A second visit (a reload) is not a sign-in and does not open the app.
    const again = await fetch(back);
    assert.equal(again.status, 400);
    const stale = await again.text();
    assert.ok(stale.includes("<h1>Sign-in didn&#39;t finish</h1>"));
    assert.ok(!stale.includes('http-equiv="refresh"'));
    assert.ok(stale.includes('<a href="maka-dev://open">'));
  } finally {
    listener.close();
  }
  const escaped = renderLoopbackPage({ ...PAGE, successTitle: '<b>"x"</b>', appUrl: 'maka://open?"' }, 'success');
  assert.ok(escaped.includes('&#60;b&#62;&#34;x&#34;&#60;/b&#62;'));
  assert.ok(!escaped.includes('"x"'));
  assert.ok(escaped.includes('url=maka://open?&#34;"'));
});

test('the app URL scheme: packaged and development builds answer to different schemes, links only focus', () => {
  assert.equal(appUrlScheme(true), 'maka');
  assert.equal(appOpenUrl(false), 'maka-dev://open');
  const claimed: string[] = [];
  const handlers = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
  let focused = 0;
  let stole = 0;
  const fakeApp = {
    isPackaged: true,
    focus: (options?: { steal?: boolean }) => {
      if (options?.steal) stole += 1;
    },
    setAsDefaultProtocolClient: (scheme: string) => {
      claimed.push(scheme);
      return true;
    },
    on: (name: string, handler: (event: { preventDefault(): void }, url: string) => void) => {
      handlers.set(name, handler);
      return fakeApp;
    },
  };
  installAppUrlScheme(fakeApp as never, { claim: true, focus: () => (focused += 1) });
  assert.deepEqual(claimed, ['maka']);
  let prevented = 0;
  const event = { preventDefault: () => (prevented += 1) };
  handlers.get('open-url')?.(event, 'maka://open');
  handlers.get('open-url')?.(event, 'other://open');
  assert.equal(focused, 1);
  assert.equal(stole, 1, 'the link was a choice to switch, so the app takes the front');
  assert.equal(prevented, 1);

  claimed.length = 0;
  installAppUrlScheme(fakeApp as never, { claim: false, focus: () => {} });
  assert.deepEqual(claimed, [], 'an automated run leaves the OS handlers alone');

  // Stock Electron on macOS declares no scheme; claiming there would send the
  // links to a bare Electron window.
  const stock = '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
  assert.equal(canClaimAppUrlScheme('darwin', stock), false);
  assert.equal(canClaimAppUrlScheme('darwin', '/repo/apps/desktop/.maka-dev/Maka Dev.app/Contents/MacOS/Electron'), true);
  assert.equal(canClaimAppUrlScheme('darwin', '/Applications/Maka.app/Contents/MacOS/Maka'), true);
  assert.equal(canClaimAppUrlScheme('win32', 'C:/repo/node_modules/electron/dist/electron.exe'), true);
});

test('the browser page carries the app\'s serif and sans inline, or falls back to the system\'s', async () => {
  const bundle = [
    'anthropic-mono-CQcSkHaI.woff2',
    'anthropic-sans-italic-CJtkx3-S.woff2',
    'anthropic-serif-italic-Dcb-9NUS.woff2',
    'anthropic-serif-2VcCjn5t.woff2',
    'anthropic-sans-DDVos-BJ.woff2',
    'index-BZFsF145.js',
  ];
  assert.deepEqual(findLoopbackFontFiles(bundle), {
    serif: 'anthropic-serif-2VcCjn5t.woff2',
    sans: 'anthropic-sans-DDVos-BJ.woff2',
  });
  assert.equal(findLoopbackFontFiles(bundle.filter((name) => !name.startsWith('anthropic-sans-D'))), undefined);

  const dir = await mkdtemp(join(tmpdir(), 'maka-loopback-fonts-'));
  try {
    await writeFile(join(dir, 'anthropic-serif-2VcCjn5t.woff2'), 'serif-bytes');
    await writeFile(join(dir, 'anthropic-sans-DDVos-BJ.woff2'), 'sans-bytes');
    const fonts = loopbackFontsLoader(dir)();
    assert.deepEqual(fonts, {
      serif: Buffer.from('serif-bytes').toString('base64'),
      sans: Buffer.from('sans-bytes').toString('base64'),
    });
    const html = renderLoopbackPage({ ...PAGE, fonts: fonts! }, 'success');
    assert.ok(html.includes(`font-family:"anthropic-serif";src:url(data:font/woff2;base64,${fonts!.serif})`));
    assert.ok(html.includes('font:400 20px/28px "anthropic-serif"'));
    assert.ok(html.includes('font:15px/20px "anthropic-sans"'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  assert.equal(loopbackFontsLoader(join(tmpdir(), 'maka-no-such-bundle'))(), undefined);
  assert.ok(!renderLoopbackPage(PAGE, 'success').includes('@font-face'));

  const listener = await startLoopbackListener('s', PAGE);
  try {
    const page = await fetch(`${listener.redirectUri}?state=s&code=c`);
    assert.match(page.headers.get('content-security-policy') ?? '', /font-src data:/);
  } finally {
    listener.close();
  }
});

test('cancelling while the server is still being asked opens no browser', async () => {
  await withService(async ({ service, server, browser }) => {
    await service.setServerUrl(SERVER);
    server.delay.metadata = 50;
    const pending = service.signIn('google');
    service.cancelSignIn();
    assert.deepEqual(brief(service.state()), { status: 'signed_out', lastError: 'cancelled' }, 'at once');
    await pending;
    assert.equal(browser.opened.length, 0);
    assert.deepEqual(brief(service.state()), { status: 'signed_out', lastError: 'cancelled' });
  });
});

test('pressing a provider again starts over: one browser tab, and the first round leaves no trace', async () => {
  await withService(async ({ service, server, browser }) => {
    await service.setServerUrl(SERVER);
    server.delay.metadata = 50;
    const first = service.signIn('google');
    const second = service.signIn('relx-sso');
    await Promise.all([first, second]);
    assert.equal(browser.opened.length, 1, 'the first round stopped before opening the browser');
    assert.equal(browser.opened[0]?.searchParams.get('provider'), 'relx-sso');
    assert.equal(service.state().status, 'signed_in');
  });
});

test('signing out during the token exchange leaves the device signed out and the sign-in revoked', async () => {
  await withService(async ({ service, server, storePath }) => {
    await service.setServerUrl(SERVER);
    server.delay.token = 50;
    const pending = service.signIn();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await service.signOut();
    await pending;
    assert.equal(service.state().status, 'signed_out');
    assert.doesNotMatch(await readFile(storePath, 'utf8'), /session/);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(server.revoked, ['rt-0'], 'the session the server made is not left behind');
  });
});

test('only the server\'s invalid_grant ends a sign-in; any other refusal is a server problem', async () => {
  await withService(async ({ service, server }) => {
    await service.setServerUrl(SERVER);
    await service.signIn();
    server.now += 20 * 60 * 1000;
    server.refreshAnswer = { status: 400, body: { message: 'Bad request (proxy)' } };
    await assert.rejects(service.accessToken(), (error: unknown) => {
      return error instanceof OrgAccountUnavailable && error.reason === 'server_unreachable';
    });
    assert.equal(service.state().status, 'signed_in');
    server.refreshAnswer = { status: 200, body: { not: 'tokens' } };
    await assert.rejects(service.accessToken(), (error: unknown) => {
      return error instanceof OrgAccountUnavailable && error.reason === 'server_unreachable';
    });
    assert.equal(service.state().status, 'signed_in');
  });
});

test('a bound deployment with an unusable address still requires sign-in, and says why', async () => {
  await withService(async ({ make }) => {
    const bound = await make({ managedServerUrl: 'http://intranet:3000' });
    const state = bound.state();
    assert.equal(state.enforced, true, 'never fails open');
    assert.deepEqual(brief(state), { status: 'signed_out', lastError: 'server_incompatible' });
    assert.equal(state.serverUrl, null);
  });
});

test('a sign-in in progress carries the provider list, so a new window draws the same buttons', async () => {
  await withService(async ({ service, browser }) => {
    await service.setServerUrl(SERVER);
    browser.behaviour = 'ignore';
    const pending = service.signIn('google');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const state = service.state();
    assert.equal(state.status, 'signing_in');
    assert.deepEqual(
      state.status === 'signing_in' ? state.providers?.map((provider) => provider.id) : undefined,
      ['relx-sso', 'google'],
    );
    service.cancelSignIn();
    await pending;
  });
});

test('the store: overlapping saves land in order, and a malformed file is simply no sign-in', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maka-org-store-'));
  try {
    const path = join(dir, 'org-account.json');
    const store = new OrgAccountStore(path, keychain());
    const session = {
      refreshToken: 'rt',
      sessionId: 's',
      refreshExpiresAt: 1,
      profile: { name: 'Ada', email: 'ada@relx.com', orgRole: 'member' as const },
    };
    await Promise.all([
      store.save({ serverUrl: SERVER, session }),
      store.save({ serverUrl: SERVER }),
      store.save({ serverUrl: SERVER, session }),
      store.save({ serverUrl: SERVER }),
    ]);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { version: 1, serverUrl: SERVER });
    await writeFile(path, 'null');
    assert.deepEqual(await store.load(), { serverUrl: null });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the failure page reaches the browser whole even when the sign-in closes at once', async () => {
  // Far larger than any socket buffer, so a close that cuts it short always shows.
  const big = { serif: 'A'.repeat(2_500_000), sans: 'B'.repeat(1_500_000) };
  const listener = await startLoopbackListener('st', { ...PAGE, fonts: big });
  // As the service does: the result settles, and the listener is closed right away.
  void listener.result.then(
    () => listener.close(),
    () => {},
  );
  const page = await fetch(`${listener.redirectUri}?state=st&error=access_denied&error_description=domain_not_allowed`);
  const html = await page.text();
  assert.equal(html, renderLoopbackPage({ ...PAGE, fonts: big }, 'failure'));
});
