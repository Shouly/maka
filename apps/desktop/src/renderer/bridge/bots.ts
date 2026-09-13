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

// The bot half of the `settings` namespace, wrapped: the IM bridges' live
// status, the credential probe, restart, the WeChat bridge's QR sign-in and
// the scan-to-connect onboarding sessions.
//
// The channel settings themselves (`botChat.channels.*`) travel with the rest
// of the client-owned settings through `./settings.js`; only the runtime
// side — what the bridges are doing right now — lives here.

import type { BotProvider } from '@maka/core/bot-chat-settings';
import type { BotOnboardingSnapshot, BotOnboardingStartInput } from '@maka/core/bot-onboarding';
import type { Result } from '@maka/core/result';
import type { SettingsTestResult } from '@maka/core/settings';
import type { BotStatus, WechatBridgeQrCodeResult } from '@maka/runtime/bots';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

export type { BotStatus, WechatBridgeQrCodeResult, BotOnboardingSnapshot };

const settings = () => requireNamespace('settings');

export function listBotStatuses(): Promise<Record<BotProvider, BotStatus>> {
  return settings().bots.listStatuses();
}

export function subscribeBotStatusChanges(handler: (status: BotStatus) => void): () => void {
  return toUnsubscribe(tryNamespace('settings')?.bots.subscribeStatusChanges(handler));
}

export function testBotChannel(provider: BotProvider): Promise<SettingsTestResult> {
  return settings().testBotChannel(provider);
}

export function restartBot(provider: BotProvider): Promise<BotStatus> {
  return settings().bots.restart(provider);
}

export function wechatQrCode(): Promise<WechatBridgeQrCodeResult> {
  return settings().bots.wechatQrCode();
}

export function startBotOnboarding(
  input: BotOnboardingStartInput,
): Promise<Result<BotOnboardingSnapshot>> {
  return settings().bots.onboarding.start(input);
}

export function pollBotOnboarding(sessionId: string): Promise<Result<BotOnboardingSnapshot>> {
  return settings().bots.onboarding.poll(sessionId);
}

export function cancelBotOnboarding(sessionId: string): Promise<Result<BotOnboardingSnapshot>> {
  return settings().bots.onboarding.cancel(sessionId);
}

export function openBotOnboardingInBrowser(sessionId: string): Promise<Result<void>> {
  return settings().bots.onboarding.openInBrowser(sessionId);
}
