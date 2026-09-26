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

// The company account: when the app is gated behind a sign-in, which way in
// each state offers, and what the login screen, Settings › Account and the
// sidebar's account entry put on screen for it.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { LocaleProvider } from '@maka/ui';
import { UI_LOCALES } from '@maka/core/ui-locale';
import { formatAbsoluteTimestamp } from '@maka/core/relative-time';
import type {
  OrgAccountError,
  OrgAccountState,
  OrgIdentityProvider,
} from '../../bridge/org-account.js';
import {
  orgAccountGate,
  signingInProvider,
  signInOptions,
  signInOutcomeTone,
} from '../../lib/org-account-view.js';
import { createOrgAccountStore, type OrgAccountBridge } from '../org-account-store.js';
import { LoginScreen, WelcomeScreen } from '../../components/account/LoginScreen.js';
import { AccountSettingsView } from '../../components/settings/account/AccountSettings.js';
import { SidebarAccountMenu } from '../../components/layout/sidebar-parts/SidebarAccountEntry.js';
import { getOrgAccountCopy, orgAccountErrorMessage } from '../../locales/org-account-copy.js';
import { SETTINGS_NAV_GROUPS } from '../../components/settings/settings-sections.js';

// A record rather than an array so the compiler notices a new code.
const ERROR_CODES = Object.keys({
  server_unreachable: true,
  server_incompatible: true,
  upgrade_required: true,
  domain_not_allowed: true,
  email_not_verified: true,
  account_deactivated: true,
  identity_conflict: true,
  provider_error: true,
  cancelled: true,
  timed_out: true,
  sign_in_expired: true,
  unknown: true,
} satisfies Record<OrgAccountError, true>) as OrgAccountError[];

const en = getOrgAccountCopy('en');
const SERVER = 'https://maka.example.com';
const PROVIDERS: readonly OrgIdentityProvider[] = [
  { id: 'relx', displayName: 'RELX SSO' },
  { id: 'google', displayName: 'Google' },
];

type SignedOut = Extract<OrgAccountState, { status: 'signed_out' }>;
type SigningIn = Extract<OrgAccountState, { status: 'signing_in' }>;
type SignedIn = Extract<OrgAccountState, { status: 'signed_in' }>;

function signedOut(overrides: Partial<SignedOut> = {}): SignedOut {
  return { enforced: true, status: 'signed_out', serverUrl: SERVER, ...overrides };
}

function signingIn(overrides: Partial<SigningIn> = {}): SigningIn {
  return { enforced: true, status: 'signing_in', serverUrl: SERVER, ...overrides };
}

function signedIn(overrides: Partial<SignedIn> = {}): SignedIn {
  return {
    enforced: true,
    status: 'signed_in',
    serverUrl: SERVER,
    profile: {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      orgRole: 'org_admin',
    },
    signInExpiresAt: Date.UTC(2026, 9, 3, 12, 0),
    remembered: true,
    ...overrides,
  };
}

function render(node: ReactElement) {
  return parseHTML(
    renderToStaticMarkup(createElement(LocaleProvider, { locale: 'en', children: node })),
  ).document;
}

// The markup is a fragment, so linkedom makes its root the document element;
// there is no <body> to read.
function text(document: Document): string {
  return document.documentElement?.textContent ?? '';
}

function buttons(document: Document) {
  return Array.from(document.querySelectorAll('button'));
}

function button(document: Document, name: string) {
  return buttons(document).find((node) => node.textContent?.trim() === name);
}

const noop = () => {};

function login(
  account: SignedOut | SigningIn,
  options: {
    known?: readonly OrgIdentityProvider[];
    pending?: 'signIn' | 'cancel' | 'signOut' | 'refresh' | null;
  } = {},
) {
  return render(
    createElement(LoginScreen, {
      account,
      knownProviders: options.known ?? [],
      pending: options.pending ?? null,
      onSignIn: noop,
      onRefresh: noop,
    }),
  );
}

function settings(
  account: OrgAccountState,
  options: { known?: readonly OrgIdentityProvider[] } = {},
) {
  return render(
    createElement(AccountSettingsView, {
      account,
      knownProviders: options.known ?? [],
      pending: null,
      onSaveServer: async () => undefined,
      onSignIn: noop,
      onCancelSignIn: noop,
      onRefresh: noop,
      onSignOut: noop,
    }),
  );
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ── the gate ────────────────────────────────────────────────────────────────

test('the gate holds the app only where the deployment requires a sign-in', () => {
  assert.equal(orgAccountGate(undefined, false), 'loading');
  // An unreadable account keeps the gate shut, with a retry.
  assert.equal(
    orgAccountGate(undefined, true),
    'failed',
    'an unreadable account keeps the gate shut',
  );
  assert.equal(orgAccountGate(signedOut({ enforced: false }), false), 'app');
  assert.equal(orgAccountGate(signingIn({ enforced: false }), false), 'app');
  assert.equal(orgAccountGate(signedOut(), false), 'login');
  assert.equal(orgAccountGate(signingIn(), false), 'login');
  assert.equal(orgAccountGate(signedIn(), false), 'app');
});

test('the way in: providers, a retry when the server is not there, or a wait', () => {
  assert.deepEqual(signInOptions(signedOut({ serverUrl: null, enforced: false })), {
    kind: 'no_server',
  });
  assert.deepEqual(signInOptions(signedOut()), { kind: 'loading' });
  assert.deepEqual(signInOptions(signedOut({ providers: PROVIDERS })), {
    kind: 'choose',
    providers: PROVIDERS,
  });
  // The server's own errors replace the buttons, even with providers loaded.
  for (const error of ['server_unreachable', 'server_incompatible'] as const) {
    assert.deepEqual(signInOptions(signedOut({ providers: PROVIDERS, lastError: error })), {
      kind: 'retry',
      error,
    });
  }
  // Loading the providers failed: the reason, and a retry.
  assert.deepEqual(signInOptions(signedOut({ lastError: 'upgrade_required' })), {
    kind: 'retry',
    error: 'upgrade_required',
  });
  // A sign-in that just ended: the providers are being loaded again.
  assert.deepEqual(signInOptions(signedOut({ lastError: 'sign_in_expired' })), { kind: 'loading' });
  // A bound deployment with no usable address says why.
  assert.deepEqual(
    signInOptions(signedOut({ serverUrl: null, lastError: 'server_incompatible' })),
    {
      kind: 'retry',
      error: 'server_incompatible',
    },
  );
  // An attempt's own failure keeps the buttons and says why in the card's foot.
  assert.deepEqual(signInOptions(signedOut({ providers: PROVIDERS, lastError: 'timed_out' })), {
    kind: 'choose',
    providers: PROVIDERS,
    error: 'timed_out',
  });
  assert.equal(signInOutcomeTone('cancelled'), 'note');
  assert.equal(signInOutcomeTone('domain_not_allowed'), 'alert');
  assert.equal(
    signingInProvider(signingIn({ provider: 'google' }), PROVIDERS)?.displayName,
    'Google',
  );
  assert.equal(signingInProvider(signingIn({ provider: 'gone' }), PROVIDERS), undefined);
  assert.equal(signingInProvider(signingIn(), PROVIDERS), undefined);
});

test('every outcome and every provider button has words in every locale', () => {
  for (const locale of UI_LOCALES) {
    const copy = getOrgAccountCopy(locale);
    const lines = ERROR_CODES.map((code) => orgAccountErrorMessage(code, copy));
    for (const [index, line] of lines.entries()) {
      assert.ok(line && line.trim().length > 0, `${locale}: ${ERROR_CODES[index]}`);
    }
    assert.equal(new Set(lines).size, lines.length, `${locale}: two outcomes share a line`);
    assert.equal(orgAccountErrorMessage(undefined, copy), undefined);
    // A code from a newer main process still says something.
    assert.equal(
      orgAccountErrorMessage('brand_new' as OrgAccountError, copy),
      copy.lastErrors.unknown,
    );
    assert.ok(copy.continueWith('RELX SSO').includes('RELX SSO'), locale);
    assert.ok(copy.finishInBrowserWith('Google').includes('Google'), locale);
  }
  assert.equal(getOrgAccountCopy('zh-CN').continueWith('Google'), '使用 Google 登录');
  assert.equal(en.continueWith('Google'), 'Continue with Google');
});

// ── the login screen ────────────────────────────────────────────────────────

test('the login screen: Google outlined above the OR, the company sign-in solid below it', () => {
  const document = login(signedOut({ providers: PROVIDERS }));
  assert.equal(document.querySelector('h1')?.textContent, en.login.title);
  const offered = buttons(document).map((node) => node.getAttribute('data-provider'));
  assert.deepEqual(offered, ['google', 'relx']);
  assert.deepEqual(
    buttons(document).map((node) => node.textContent),
    [en.continueWith('Google'), en.continueWith('RELX SSO')],
  );
  const [google, relx] = buttons(document);
  assert.ok(google?.querySelector('svg'), 'Google carries its mark');
  assert.equal(relx?.querySelector('svg'), null);
  assert.ok(
    relx?.className.includes('ui-control-squish-primary'),
    'the company sign-in is the solid button',
  );
  assert.ok(!google?.className.includes('ui-control-squish-primary'));
  assert.deepEqual(
    Array.from(document.querySelectorAll('button, p')).map((node) => node.textContent),
    [en.continueWith('Google'), en.or, en.continueWith('RELX SSO')],
    'an OR between the two',
  );
  assert.ok(buttons(document).every((node) => !node.hasAttribute('disabled')));
  assert.equal(document.querySelector('input'), null, 'no server field on the login screen');
  assert.equal(document.querySelector('.maka-window-titlebar') !== null, true);
});

test('the login screen: without Google there is no OR, only the solid buttons', () => {
  const document = login(signedOut({ providers: [{ id: 'relx', displayName: 'RELX SSO' }] }));
  assert.deepEqual(
    buttons(document).map((node) => node.textContent),
    [en.continueWith('RELX SSO')],
  );
  assert.ok(!text(document).includes(en.or));
});

test('the login screen: a server it cannot reach is a message and Try again', () => {
  const document = login(signedOut({ providers: PROVIDERS, lastError: 'server_unreachable' }));
  assert.equal(
    document.querySelector('[role="alert"]')?.textContent,
    en.lastErrors.server_unreachable,
  );
  assert.deepEqual(
    buttons(document).map((node) => node.textContent),
    [en.tryAgain],
  );
});

test("the login screen: a failed attempt says why in the card's foot, a cancel is a note", () => {
  const failed = login(signedOut({ providers: PROVIDERS, lastError: 'domain_not_allowed' }));
  assert.equal(
    failed.querySelector('[role="alert"]')?.textContent,
    en.lastErrors.domain_not_allowed,
  );
  assert.equal(buttons(failed).length, 2);
  const order = Array.from(failed.querySelectorAll('button, [role="alert"]'));
  assert.equal(order.at(-1)?.getAttribute('role'), 'alert', 'below the buttons');
  const cancelled = login(signedOut({ providers: PROVIDERS, lastError: 'cancelled' }));
  assert.equal(cancelled.querySelector('[role="alert"]'), null);
  assert.ok(text(cancelled).includes(en.lastErrors.cancelled));
});

test('the login screen: while the browser is out, the chosen button spins and nothing else is said', () => {
  const document = login(signingIn({ provider: 'google' }), {
    known: PROVIDERS,
    pending: 'signIn',
  });
  const [google, relx] = buttons(document);
  assert.equal(google?.getAttribute('aria-busy'), 'true');
  assert.equal(google?.getAttribute('aria-label'), en.continueWith('Google'));
  assert.ok(google?.querySelector('.animate-spin'), 'a spinner in place of the words');
  assert.ok(!google?.textContent?.includes('Google'));
  assert.equal(google?.querySelector('svg'), null, 'and in place of the mark');
  assert.equal(relx?.textContent, en.continueWith('RELX SSO'));
  assert.equal(relx?.hasAttribute('aria-busy'), false);
  // Pressing either again starts over, so a closed browser tab is not a dead
  // end — the spinning one only after a moment, so a double click is one
  // sign-in. Nothing is disabled outright: focus stays where it was.
  assert.ok(buttons(document).every((node) => !node.hasAttribute('disabled')));
  assert.equal(google?.getAttribute('aria-disabled'), 'true');
  assert.equal(relx?.hasAttribute('aria-disabled'), false);
  assert.equal(buttons(document).length, 2, 'no Cancel');
  assert.ok(!text(document).includes(en.finishInBrowserWith('Google')));

  const generic = login(signingIn(), { known: [] });
  assert.equal(buttons(generic)[0]?.getAttribute('aria-label'), en.signIn);

  // A window opened mid sign-in draws the buttons from the state itself.
  const fresh = login(signingIn({ provider: 'google', providers: PROVIDERS }), { known: [] });
  assert.deepEqual(
    buttons(fresh).map((node) => node.getAttribute('data-provider')),
    ['google', 'relx'],
  );
});

test('the login screen: a click waits for main before a second one can open another tab', () => {
  const document = login(signedOut({ providers: PROVIDERS }), { pending: 'signIn' });
  assert.ok(buttons(document).every((node) => node.getAttribute('aria-disabled') === 'true'));
  assert.ok(
    buttons(document).every((node) => !node.hasAttribute('disabled')),
    'and keeps focus',
  );
});

test('the welcome page: the product for this platform, one line, and Get started', () => {
  const mac = render(createElement(WelcomeScreen, { platform: 'darwin', onGetStarted: noop }));
  assert.equal(mac.querySelector('h1')?.textContent, 'Maka for Mac');
  assert.equal(mac.querySelector('h1 em')?.textContent, en.welcome.joiner);
  assert.ok(text(mac).includes(en.welcome.tagline));
  assert.deepEqual(
    buttons(mac).map((node) => node.textContent),
    [en.welcome.getStarted],
  );
  assert.ok(mac.querySelector('[data-maka-contract="welcome-brand"]'));
  const windows = render(createElement(WelcomeScreen, { platform: 'win32', onGetStarted: noop }));
  assert.equal(windows.querySelector('h1')?.textContent, 'Maka for Windows');
  for (const locale of ['zh-CN', 'zh-TW', 'en'] as const) {
    const welcome = getOrgAccountCopy(locale).welcome;
    assert.ok(welcome.tagline && welcome.getStarted && welcome.platforms.linux, locale);
  }
});

test('the login screen: providers still loading is quiet, and a server that names none gets one button', () => {
  const loading = login(signedOut());
  assert.equal(buttons(loading).length, 0);
  assert.equal(
    loading.querySelector('[role="status"]')?.textContent,
    en.loadingOptions,
    'said, not only drawn',
  );
  const generic = login(signedOut({ providers: [] }));
  assert.deepEqual(
    buttons(generic).map((node) => node.textContent),
    [en.signIn],
  );
});

// ── the store ───────────────────────────────────────────────────────────────

function fakeBridge(overrides: Partial<OrgAccountBridge> = {}) {
  let listener: ((account: OrgAccountState) => void) | undefined;
  const calls: string[] = [];
  const bridge: OrgAccountBridge = {
    getOrgAccountState: async () => signedOut({ providers: PROVIDERS }),
    subscribeOrgAccount: (handler) => {
      listener = handler;
      return () => {
        listener = undefined;
      };
    },
    setOrgAccountServerUrl: async () => ({ ok: false, reason: 'managed' }),
    signInToOrgAccount: async (provider) => {
      calls.push(`signIn:${provider}`);
      return signedIn();
    },
    refreshOrgAccount: async () => signedOut({ providers: PROVIDERS }),
    cancelOrgAccountSignIn: async () => {
      calls.push('cancel');
    },
    signOutOfOrgAccount: async () => signedOut({ providers: PROVIDERS }),
    ...overrides,
  };
  return { bridge, calls, push: (account: OrgAccountState) => listener?.(account) };
}

test('the store reads once, lets a push win over a slower read, and remembers the providers', async () => {
  let answer: (account: OrgAccountState) => void = noop;
  const { bridge, push } = fakeBridge({
    getOrgAccountState: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });
  const store = createOrgAccountStore(bridge);
  const stop = store.start();
  assert.equal(store.getState().account, undefined);
  push(signingIn({ provider: 'relx' }));
  answer(signedOut());
  await tick();
  assert.equal(store.getState().account?.status, 'signing_in', 'the older read is dropped');
  push(signedOut({ providers: PROVIDERS }));
  push(signingIn({ provider: 'google' }));
  assert.deepEqual(store.getState().knownProviders, PROVIDERS);
  stop();
});

test('the store: a failed first read keeps the gate shut, and a reload tries again', async () => {
  let fail = true;
  const { bridge } = fakeBridge({
    getOrgAccountState: async () => {
      if (fail) throw new Error('no handler');
      return signedOut({ providers: PROVIDERS });
    },
  });
  const store = createOrgAccountStore(bridge);
  const stop = store.start();
  await tick();
  assert.equal(store.getState().loadFailed, true);
  assert.equal(orgAccountGate(store.getState().account, store.getState().loadFailed), 'failed');
  fail = false;
  store.reload();
  assert.equal(store.getState().loadFailed, false);
  await tick();
  assert.equal(store.getState().account?.status, 'signed_out');
  stop();
});

test('the store: an action holds the gate until it settles and rejects for its caller', async () => {
  const { bridge, calls } = fakeBridge({
    signOutOfOrgAccount: async () => {
      throw new Error('ipc down');
    },
  });
  const store = createOrgAccountStore(bridge);
  const stop = store.start();
  await tick();
  const signing = store.signIn('google');
  assert.equal(store.getState().pending, 'signIn');
  await signing;
  assert.equal(store.getState().pending, null);
  assert.equal(store.getState().account?.status, 'signed_in');
  assert.deepEqual(calls, ['signIn:google']);
  await assert.rejects(store.signOut(), /ipc down/);
  assert.equal(store.getState().pending, null);
  const refused = await store.setServerUrl('https://elsewhere.example.com');
  assert.deepEqual(refused, { ok: false, reason: 'managed' });
  stop();
});

// ── the sidebar entry ───────────────────────────────────────────────────────

test('the sidebar entry is there only while signed in, as the person’s initials and name', () => {
  const entry = (account: OrgAccountState | undefined) =>
    createElement(SidebarAccountMenu, {
      account,
      pending: null,
      onOpenAccount: noop,
      onSignOut: noop,
    });
  for (const account of [undefined, signedOut({ enforced: false }), signingIn()]) {
    assert.equal(
      renderToStaticMarkup(
        createElement(LocaleProvider, { locale: 'en', children: entry(account) }),
      ),
      '',
    );
  }
  const document = render(entry(signedIn()));
  const trigger = document.querySelector('[data-maka-contract="sidebar-account"]');
  assert.equal(trigger?.getAttribute('aria-label'), en.menu.label('Ada Lovelace'));
  assert.ok(trigger?.textContent?.includes('AL'));
  assert.ok(trigger?.textContent?.includes('Ada Lovelace'));
});

// ── Settings › Account ──────────────────────────────────────────────────────

test('Account leads the preferences group', () => {
  assert.equal(SETTINGS_NAV_GROUPS[0]?.group, 'preferences');
  assert.equal(SETTINGS_NAV_GROUPS[0]?.sections[0], 'account');
});

test('Settings, unenforced: the address stays a field and the providers are buttons', () => {
  const empty = settings(signedOut({ enforced: false, serverUrl: null }));
  assert.equal(empty.querySelector('#org-account-server-url')?.getAttribute('value'), '');
  assert.equal(button(empty, en.signIn)?.hasAttribute('disabled'), true);
  assert.ok(text(empty).includes(en.settings.needsServer));

  const ready = settings(signedOut({ enforced: false, providers: PROVIDERS }));
  assert.equal(ready.querySelector('#org-account-server-url')?.getAttribute('value'), SERVER);
  assert.deepEqual(
    buttons(ready)
      .filter((node) => node.hasAttribute('data-provider'))
      .map((node) => node.textContent),
    [en.continueWith('RELX SSO'), en.continueWith('Google')],
  );
});

test('Settings, enforced: the address is read-only and says why', () => {
  const document = settings(signedOut({ providers: PROVIDERS }));
  assert.equal(document.querySelector('input'), null);
  assert.ok(text(document).includes(SERVER));
  assert.ok(text(document).includes(en.settings.serverManagedHelp));
  assert.equal(buttons(document).filter((node) => node.hasAttribute('data-provider')).length, 2);

  const unreachable = settings(signedOut({ lastError: 'server_incompatible' }));
  assert.equal(
    unreachable.querySelector('[role="alert"]')?.textContent,
    en.lastErrors.server_incompatible,
  );
  assert.ok(button(unreachable, en.tryAgain));
});

test('Settings, signing in: the provider by name, and Cancel', () => {
  const document = settings(signingIn({ provider: 'relx' }), { known: PROVIDERS });
  assert.equal(document.querySelector('input'), null);
  assert.ok(text(document).includes(en.finishInBrowserWith('RELX SSO')));
  assert.equal(button(document, en.cancel)?.hasAttribute('disabled'), false);
});

test('Settings, signed in: who, until when, and the address read-only', () => {
  const account = signedIn({ enforced: false });
  const document = settings(account);
  const page = text(document);
  assert.equal(document.querySelector('input'), null);
  for (const expected of [
    'Ada Lovelace',
    'ada@example.com',
    en.admin,
    en.settings.signedInUntil(formatAbsoluteTimestamp(account.signInExpiresAt, 'en')),
    SERVER,
    en.settings.serverLockedHelp,
  ]) {
    assert.ok(page.includes(expected), expected);
  }
  assert.equal(page.includes(en.settings.notRemembered), false);
  assert.equal(button(document, en.signOut)?.hasAttribute('disabled'), false);

  const member = text(
    settings(
      signedIn({
        profile: { ...account.profile, orgRole: 'member' },
        remembered: false,
      }),
    ),
  );
  assert.equal(member.includes(en.admin), false);
  assert.ok(member.includes(en.settings.notRemembered));
  assert.ok(member.includes(en.settings.serverManagedHelp), 'enforced: the build names it');
});
