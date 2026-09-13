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

// What a bot channel row says about itself, derived once from the two
// records that describe it: the stored channel settings (credentials, the
// enable switch, the last probe) and the bridge's live status (running,
// readiness, identity). Ported from upstream's `bot-settings-view-model.ts`
// and `bot-chat-shared.tsx`; pure, so the overview and the detail page read
// the same verdict and the tests can pin it.

import { botStatusErrorReason } from '@maka/core/bot-events';
import type {
  BotChannelSettings,
  BotProvider,
  BotReadinessState,
} from '@maka/core/bot-chat-settings';
import type { UiLocale } from '@maka/core/ui-locale';
import type { BotStatus } from '@maka/runtime/bots';
import { botStatusReasonMessage, getBotSettingsCopy } from '../locales/settings-bot-copy.js';

/**
 * How far this build takes each platform. `runtime` bridges listen from this
 * process and can be started here; `credentials` platforms are configured
 * here and served elsewhere; `planned` has no bridge yet.
 */
export type BotSupport = 'runtime' | 'credentials' | 'planned';

export const BOT_SUPPORT: Record<BotProvider, BotSupport> = {
  telegram: 'runtime',
  feishu: 'credentials',
  wecom: 'credentials',
  wechat: 'credentials',
  discord: 'runtime',
  dingtalk: 'runtime',
  qq: 'runtime',
  slack: 'runtime',
};

export type BotPendingActionName = 'test' | 'connect' | 'restart' | 'disconnect';
export interface BotPendingAction {
  readonly provider: BotProvider;
  readonly action: BotPendingActionName;
}

export interface BotChannelViewState {
  readonly readiness: BotReadinessState;
  /** Something has been entered or is running: the row belongs under "in use". */
  readonly configured: boolean;
  /** Configured, and not healthy: sorts to the top of the list. */
  readonly needsAttention: boolean;
  readonly currentError: string | undefined;
  readonly liveOperational: boolean;
}

export function deriveBotChannelViewState(input: {
  channel: BotChannelSettings;
  status: BotStatus | undefined;
}): BotChannelViewState {
  const { channel, status } = input;
  const readiness =
    channel.enabled || status?.running
      ? (status?.readiness ?? channel.readiness)
      : channel.readiness;
  const configured =
    channel.connected ||
    channel.enabled ||
    status?.running === true ||
    Boolean(status?.identity) ||
    isConfiguredReadiness(channel.readiness) ||
    isConfiguredReadiness(readiness);
  const liveOperational = status?.running === true && readiness === 'operational';
  const liveError = readiness === 'degraded' ? botStatusErrorReason(status?.reason) : undefined;
  const currentError = liveOperational ? undefined : (liveError ?? channel.lastError);
  const needsAttention =
    configured &&
    (readiness === 'degraded' ||
      Boolean(currentError) ||
      (channel.enabled && status?.running === false));
  return { readiness, configured, needsAttention, currentError, liveOperational };
}

function isConfiguredReadiness(readiness: BotReadinessState): boolean {
  return (
    readiness === 'configured' ||
    readiness === 'credentials_valid' ||
    readiness === 'operational' ||
    readiness === 'degraded'
  );
}

/** The enable switch only arms a channel whose credentials have been proven. */
export function canEnableBotChannel(readiness: BotReadinessState): boolean {
  return (
    readiness === 'credentials_valid' || readiness === 'operational' || readiness === 'degraded'
  );
}

export function botReadinessCopy(
  support: BotSupport,
  readiness: BotReadinessState,
  locale: UiLocale,
) {
  const copy = getBotSettingsCopy(locale);
  if (support === 'planned') return copy.planned;
  return copy.readiness[readiness] ?? copy.readiness.scaffolded;
}

/** One line for a bridge's `reason`, in the user's words. */
export function botStatusDetail(status: BotStatus, locale: UiLocale): string {
  const copy = getBotSettingsCopy(locale).status;
  switch (status.reason) {
    case 'disabled':
      return copy.disabled;
    case 'token_missing':
      return copy.noToken;
    case 'feishu_credentials_missing':
      return copy.missingFeishuCredentials;
    case 'feishu-domain-required':
      return copy.feishuDomainRequired;
    case 'feishu-events-not-connected':
      return copy.feishuEventsNotConnected;
    case 'scaffold-only':
    case 'unimplemented':
      return copy.unavailable;
    case 'stopped':
      return copy.stopped;
    default:
      return botStatusReasonMessage(status.reason, locale) ?? copy.detailsInLogs;
  }
}

export function botConnectionLabel(connection: BotStatus['connection'], locale: UiLocale): string {
  const copy = getBotSettingsCopy(locale).status;
  switch (connection) {
    case 'polling':
      return copy.polling;
    case 'gateway':
      return copy.gateway;
    case 'webhook':
      return copy.webhook;
    default:
      return copy.none;
  }
}

/** The overview row's one-line summary: live identity, else the failure, else the readiness detail. */
export function botOverviewSummary(input: {
  status: BotStatus | undefined;
  view: BotChannelViewState;
  fallback: string;
  locale: UiLocale;
}): { text: string; lastEventAt?: number } {
  const { status, view, fallback, locale } = input;
  const copy = getBotSettingsCopy(locale).overview;
  if (view.liveOperational) {
    const identity = status?.identity?.username ?? status?.identity?.displayName;
    return {
      text: identity ? `${copy.listening} · ${identity}` : copy.listening,
      ...(status?.lastEventAt ? { lastEventAt: status.lastEventAt } : {}),
    };
  }
  if (view.currentError) return { text: botStatusReasonMessage(view.currentError, locale) };
  if (status?.reason) return { text: botStatusDetail(status, locale) };
  return { text: fallback };
}
