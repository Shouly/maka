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

// Settings › Remote access: the page. Owns the overview ⇄ detail routing,
// the bridges' live status (through `botsStore`) and the per-platform action
// lifecycles — test, test-and-connect, restart, WeChat sign-out — each of
// which reports through a toast and re-reads settings and status when done.
//
// Channel settings are client-owned (`settings-ownership.ts`), so they are
// read from the client snapshot and written through `settingsStore.update`,
// which routes them the same way.

import { useCallback, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import type { BotChannelSettings, BotProvider } from '@maka/core/bot-chat-settings';
import type { BotOnboardingProvider, BotOnboardingSnapshot } from '@maka/core/bot-onboarding';
import type { E2eFixtureState } from '@maka/core/e2e-fixture';
import { getE2eFixtureState } from '../../../bridge/e2e-fixture.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';
import { useClientSettings, useSettingsErrorReporter } from '../../../hooks/use-settings.js';
import {
  BOT_SUPPORT,
  botStatusDetail,
  type BotPendingActionName,
} from '../../../lib/bot-channel-view.js';
import { getBotSettingsCopy } from '../../../locales/settings-bot-copy.js';
import { settingsTestResultMessage } from '../../../locales/settings-test-result-copy.js';
import { botsStore, settingsStore } from '../../../store/index.js';
import { toast } from '../../../store/toast-store.js';
import { ConfirmDialog } from '../../ui/confirm-dialog.js';
import { Skeleton } from '../../ui/skeleton.js';
import { SettingsRow, SettingsSection } from '../settings-row.js';
import { BotChannelDetail } from './BotChannelDetail.js';
import { BotChatOverview } from './BotChatOverview.js';

export function BotChatSettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const botCopy = getBotSettingsCopy(locale);
  const copy = botCopy.page;
  const report = useSettingsErrorReporter();
  const settings = useClientSettings().data;
  const statuses = useStore(botsStore, (state) => state.statuses);
  const statusLoadError = useStore(botsStore, (state) => state.error);
  const pending = useStore(botsStore, (state) => state.pending);
  const [selected, setSelected] = useState<BotProvider>('telegram');
  const [detailOpen, setDetailOpen] = useState(false);
  const [autoOpenScan, setAutoOpenScan] = useState<BotOnboardingProvider | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  useEffect(() => botsStore.observe(), []);

  // Under the settings-bots-onboarding fixture the page opens on the seeded
  // provider with its scan dialog up, so the QR waiting state can be captured.
  useEffect(() => {
    let active = true;
    void getE2eFixtureState()
      .then((state: E2eFixtureState | null) => {
        if (!active || !state?.botOnboardingProvider) return;
        setSelected(state.botOnboardingProvider);
        setDetailOpen(true);
        setAutoOpenScan(state.botOnboardingProvider);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const providerLabel = (provider: BotProvider) => botCopy.providers[provider].label;

  const updateChannelFor = useCallback(
    async (provider: BotProvider, patch: Partial<BotChannelSettings>): Promise<boolean> => {
      try {
        await settingsStore.update({ botChat: { channels: { [provider]: patch } } }, props.host);
        return true;
      } catch (error) {
        report(copy.saveFailed(botCopy.providers[provider].label), error);
        return false;
      }
    },
    [props.host, report, copy, botCopy],
  );

  const refreshAll = useCallback(async (): Promise<boolean> => {
    await settingsStore.client.refresh();
    const ok = await botsStore.refresh();
    if (!ok) {
      const error = botsStore.getState().error;
      if (error) report(copy.refreshFailed, new Error(error));
    }
    return ok;
  }, [copy.refreshFailed, report]);

  const probe = async (provider: BotProvider): Promise<boolean> => {
    const result = await botsStore.test(provider);
    const message = settingsTestResultMessage(result, locale);
    if (result.ok) {
      toast({
        title: copy.credentialVerified(providerLabel(provider)),
        description: message,
        variant: 'success',
      });
    } else {
      toast({
        title: copy.credentialTestFailed(providerLabel(provider)),
        description: message,
        variant: 'destructive',
      });
    }
    await refreshAll();
    return result.ok;
  };

  const restart = async (provider: BotProvider): Promise<boolean> => {
    try {
      const status = await botsStore.restart(provider);
      const detail = botStatusDetail(status, locale);
      if (status.running) {
        toast({
          title: copy.listening(providerLabel(provider)),
          description: detail,
          variant: 'success',
        });
      } else {
        toast({
          title: copy.notListening(providerLabel(provider)),
          description: detail,
          variant: 'destructive',
        });
      }
      return status.running;
    } catch (error) {
      report(copy.startFailed(providerLabel(provider)), error);
      return false;
    }
  };

  const withAction = async (
    provider: BotProvider,
    action: BotPendingActionName,
    run: () => Promise<void>,
  ) => {
    if (!botsStore.begin(provider, action)) return;
    try {
      await run();
    } finally {
      botsStore.finish(provider, action);
    }
  };

  const testChannel = () =>
    withAction(selected, 'test', async () => {
      try {
        await probe(selected);
      } catch (error) {
        report(copy.testError(providerLabel(selected)), error);
      }
    });

  /** Probe, then — for a bridge this process runs — switch it on and start it. */
  const testAndConnect = () => {
    const provider = selected;
    const channel = settings?.botChat.channels[provider];
    return withAction(provider, 'connect', async () => {
      let ok = false;
      try {
        ok = await probe(provider);
      } catch (error) {
        report(copy.testError(providerLabel(provider)), error);
        return;
      }
      if (!ok || BOT_SUPPORT[provider] !== 'runtime') return;
      if (channel && !channel.enabled) {
        const saved = await updateChannelFor(provider, { enabled: true });
        if (!saved) return;
      }
      await restart(provider);
    });
  };

  const restartChannel = () =>
    withAction(selected, 'restart', () => restart(selected).then(() => undefined));

  const disconnectWechat = () => {
    const channel = settings?.botChat.channels.wechat;
    if (!channel) return;
    void withAction('wechat', 'disconnect', async () => {
      const isIlink =
        channel.webhookUrl?.trim().startsWith('https://ilinkai.weixin.qq.com') ?? false;
      const saved = await updateChannelFor('wechat', {
        token: '',
        ...(isIlink ? { webhookUrl: '' } : {}),
        botUserId: undefined,
        connected: false,
        readiness: 'scaffolded',
        readinessReason: undefined,
        readinessUpdatedAt: Date.now(),
        lastError: undefined,
      });
      if (!saved) return;
      await refreshAll();
      toast({ title: copy.disconnected, description: copy.credentialsCleared, variant: 'success' });
    });
  };

  const onConnected = useCallback(
    async (snapshot: BotOnboardingSnapshot) => {
      await refreshAll();
      const label = botCopy.providers[snapshot.provider].label;
      if (snapshot.warningCode) {
        toast({
          title: botCopy.detail.credentialsSaved(label),
          description: snapshot.warningDetail
            ? botCopy.onboarding.savedNotConnectedDetail(snapshot.warningDetail)
            : botCopy.onboarding.savedNotConnected,
          variant: 'info',
        });
        return;
      }
      toast({
        title: botCopy.detail.scanComplete(label),
        description:
          snapshot.identity?.displayName ??
          snapshot.identity?.id ??
          botCopy.detail.savedAndConnected,
        variant: 'success',
      });
    },
    [botCopy, refreshAll],
  );

  if (!settings) {
    return (
      <SettingsSection title={botCopy.overview.active} description={botCopy.overview.sortHint}>
        <SettingsRow
          title={<Skeleton className="h-4 w-40 rounded" />}
          control={<Skeleton className="h-5 w-16 rounded-full" />}
        />
        <SettingsRow
          title={<Skeleton className="h-4 w-32 rounded" />}
          control={<Skeleton className="h-5 w-16 rounded-full" />}
        />
      </SettingsSection>
    );
  }

  const channels = settings.botChat.channels;
  if (!detailOpen) {
    return (
      <BotChatOverview
        channels={channels}
        statuses={statuses}
        statusLoadError={statusLoadError}
        onOpenChannel={(provider) => {
          setSelected(provider);
          setDetailOpen(true);
        }}
        onRefreshStatuses={() => void refreshAll()}
      />
    );
  }

  return (
    <>
      <BotChannelDetail
        provider={selected}
        channel={channels[selected]}
        status={statuses?.[selected]}
        statusLoadError={statusLoadError}
        actionBusy={pending !== null}
        pendingAction={pending?.provider === selected ? pending.action : null}
        autoOpenScan={autoOpenScan === selected}
        onBack={() => setDetailOpen(false)}
        onUpdateChannel={(patch) => updateChannelFor(selected, patch)}
        onTest={() => void testChannel()}
        onTestAndConnect={() => void testAndConnect()}
        onRestart={() => void restartChannel()}
        onDisconnectWechat={() => setDisconnectOpen(true)}
        onConnected={onConnected}
        onRefreshStatuses={() => void refreshAll()}
      />
      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title={copy.disconnectTitle}
        description={copy.disconnectDescription}
        confirmText={copy.disconnect}
        cancelText={copy.cancel}
        variant="destructive"
        onConfirm={disconnectWechat}
      />
    </>
  );
}
