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
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { LocaleProvider } from '@maka/ui';
import {
  BOT_PROVIDERS,
  createDefaultBotChatSettings,
  type BotChannelSettings,
  type BotProvider,
} from '@maka/core/bot-chat-settings';
import type { BotStatus } from '@maka/runtime/bots';
import {
  botOverviewSummary,
  canEnableBotChannel,
  deriveBotChannelViewState,
} from '../../lib/bot-channel-view.js';
import { createBotsStore } from '../bots-store.js';
import { BotChatOverview } from '../../components/settings/bots/BotChatOverview.js';
import { BotChannelDetail } from '../../components/settings/bots/BotChannelDetail.js';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function status(platform: BotProvider, overrides: Partial<BotStatus> = {}): BotStatus {
  return {
    platform,
    running: false,
    readiness: 'scaffolded',
    connection: 'none',
    ...overrides,
  };
}

function channels(overrides: Partial<Record<BotProvider, Partial<BotChannelSettings>>> = {}) {
  const base = createDefaultBotChatSettings().channels;
  for (const provider of BOT_PROVIDERS) {
    const patch = overrides[provider];
    if (patch) base[provider] = { ...base[provider], ...patch };
  }
  return base;
}

function render(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return parseHTML(
    renderToStaticMarkup(createElement(LocaleProvider, { locale: 'en', children: node })),
  ).document;
}

test('a channel reads as in use once anything is entered, and as needing attention once it fails', () => {
  const fresh = deriveBotChannelViewState({
    channel: createDefaultBotChatSettings().channels.telegram,
    status: undefined,
  });
  assert.equal(fresh.configured, false);
  assert.equal(fresh.needsAttention, false);

  const configured = deriveBotChannelViewState({
    channel: { ...createDefaultBotChatSettings().channels.telegram, readiness: 'configured' },
    status: undefined,
  });
  assert.equal(configured.configured, true);
  assert.equal(configured.needsAttention, false);

  // Enabled but the bridge is not running: attention, and the live readiness wins.
  const stopped = deriveBotChannelViewState({
    channel: {
      ...createDefaultBotChatSettings().channels.telegram,
      enabled: true,
      readiness: 'credentials_valid',
    },
    status: status('telegram', { running: false, readiness: 'degraded', reason: 'token rejected' }),
  });
  assert.equal(stopped.readiness, 'degraded');
  assert.equal(stopped.needsAttention, true);
  assert.equal(stopped.currentError, 'token rejected');

  const live = deriveBotChannelViewState({
    channel: { ...createDefaultBotChatSettings().channels.telegram, enabled: true },
    status: status('telegram', {
      running: true,
      readiness: 'operational',
      identity: { username: 'maka_bot' },
    }),
  });
  assert.equal(live.liveOperational, true);
  assert.equal(live.currentError, undefined);
  assert.equal(
    botOverviewSummary({
      status:
        live &&
        status('telegram', {
          running: true,
          readiness: 'operational',
          identity: { username: 'maka_bot' },
          lastEventAt: 5,
        }),
      view: live,
      fallback: '-',
      locale: 'en',
    }).text,
    'Listening · maka_bot',
  );
});

test('the enable switch only arms proven credentials', () => {
  assert.equal(canEnableBotChannel('scaffolded'), false);
  assert.equal(canEnableBotChannel('configured'), false);
  assert.equal(canEnableBotChannel('credentials_valid'), true);
  assert.equal(canEnableBotChannel('degraded'), true);
});

test('the status store reads once, patches per platform, and gates one action at a time', async () => {
  let listener: ((next: BotStatus) => void) | undefined;
  const calls: string[] = [];
  const store = createBotsStore({
    listBotStatuses: async () =>
      Object.fromEntries(BOT_PROVIDERS.map((p) => [p, status(p)])) as Record<
        BotProvider,
        BotStatus
      >,
    subscribeBotStatusChanges: (handler) => {
      listener = handler;
      return () => {
        listener = undefined;
      };
    },
    testBotChannel: async (provider) => {
      calls.push(`test:${provider}`);
      return { ok: true, message: 'ok' };
    },
    restartBot: async (provider) => {
      calls.push(`restart:${provider}`);
      return status(provider, { running: true, readiness: 'operational' });
    },
  });
  const stop = store.observe();
  await tick();
  assert.equal(store.getState().statuses?.telegram.running, false);
  listener?.(status('telegram', { running: true, readiness: 'operational' }));
  assert.equal(store.getState().statuses?.telegram.running, true);
  assert.equal(store.begin('telegram', 'test'), true);
  assert.equal(store.begin('slack', 'restart'), false, 'a second action waits for the first');
  store.finish('slack', 'restart');
  assert.deepEqual(store.getState().pending, { provider: 'telegram', action: 'test' });
  store.finish('telegram', 'test');
  assert.equal(store.getState().pending, null);
  await store.restart('discord');
  assert.equal(store.getState().statuses?.discord.running, true);
  assert.deepEqual(calls, ['restart:discord']);
  stop();
  assert.equal(listener, undefined);
});

test('the overview lists channels in use first, attention on top, and the rest as a catalog', () => {
  const document = render(
    createElement(BotChatOverview, {
      channels: channels({
        telegram: { enabled: true, readiness: 'credentials_valid' },
        dingtalk: { readiness: 'configured' },
      }),
      statuses: {
        ...(Object.fromEntries(BOT_PROVIDERS.map((p) => [p, status(p)])) as Record<
          BotProvider,
          BotStatus
        >),
        telegram: status('telegram', {
          running: false,
          readiness: 'degraded',
          reason: 'token rejected',
        }),
        dingtalk: status('dingtalk', { running: true, readiness: 'operational' }),
      },
      statusLoadError: undefined,
      onOpenChannel: () => {},
      onRefreshStatuses: () => {},
    }),
  );
  const active = Array.from(
    document.querySelectorAll('#settings-bots-active button[data-provider]'),
  ).map((node) => node.getAttribute('data-provider'));
  assert.deepEqual(active, ['telegram', 'dingtalk']);
  assert.equal(
    document
      .querySelector('#settings-bots-active button[data-provider="telegram"]')
      ?.getAttribute('data-attention'),
    'true',
  );
  const available = Array.from(
    document.querySelectorAll('#settings-bots-available button[data-provider]'),
  ).map((node) => node.getAttribute('data-provider'));
  assert.equal(available.length, BOT_PROVIDERS.length - 2);
  assert.ok(!available.includes('telegram') && !available.includes('dingtalk'));
});

test('the detail page offers scan-to-connect where the platform has it, and manual fields elsewhere', () => {
  const base = {
    status: undefined,
    statusLoadError: undefined,
    actionBusy: false,
    pendingAction: null,
    onBack: () => {},
    onUpdateChannel: async () => true,
    onTest: () => {},
    onTestAndConnect: () => {},
    onRestart: () => {},
    onDisconnectWechat: () => {},
    onConnected: async () => {},
    onRefreshStatuses: () => {},
  };
  const dingtalk = render(
    createElement(BotChannelDetail, {
      ...base,
      provider: 'dingtalk',
      channel: createDefaultBotChatSettings().channels.dingtalk,
    }),
  );
  const quick = dingtalk.querySelector('[role="region"][aria-label]');
  assert.ok(quick, 'the quick-setup callout is up in quick mode');
  assert.ok(quick.textContent?.includes('Scan with DingTalk'));
  // Nothing proven yet: the switch is locked and says why.
  const dingtalkSwitch = dingtalk.querySelector('button[role="switch"]');
  assert.ok(dingtalkSwitch);
  assert.ok(dingtalkSwitch.hasAttribute('disabled'));
  assert.ok(
    dingtalk
      .querySelector('[data-maka-contract="bot-channel-detail"]')
      ?.textContent?.includes('DingTalk'),
  );

  const telegram = render(
    createElement(BotChannelDetail, {
      ...base,
      provider: 'telegram',
      channel: {
        ...createDefaultBotChatSettings().channels.telegram,
        readiness: 'credentials_valid',
      },
    }),
  );
  assert.equal(telegram.querySelector('[role="region"][aria-label]'), null, 'no quick setup');
  assert.ok(telegram.querySelector('input[aria-label="Telegram Bot Token"][type="password"]'));
  assert.ok(telegram.querySelector('textarea#settings-bot-allowed-user-ids'));
  assert.ok(!telegram.querySelector('button[role="switch"]')?.hasAttribute('disabled'));
  const labels = Array.from(telegram.querySelectorAll('button')).map((b) => b.textContent);
  assert.ok(labels.includes('Test and connect'), labels.join(' | '));
});
