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

// Scan-to-connect: the main process registers the app with the IM platform
// and hands back a QR code; this dialog shows it and polls the session until
// the platform confirms, expires it, or the user gives up.
//
// The QR data URL arrives only on the start snapshot (polls omit it, it is
// large), so it is cached here for the polls that follow. Closing the dialog
// cancels the session first: a late confirmation must not persist
// credentials into a page nobody is looking at.

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BotOnboardingBrand,
  BotOnboardingProvider,
  BotOnboardingSnapshot,
} from '@maka/core/bot-onboarding';
import type { UiLocale } from '@maka/core/ui-locale';
import { useMountedRef, useUiLocale } from '@maka/ui';
import {
  cancelBotOnboarding,
  openBotOnboardingInBrowser,
  pollBotOnboarding,
  startBotOnboarding,
} from '../../../bridge/bots.js';
import { cn } from '../../../lib/cn.js';
import {
  botOnboardingErrorMessage,
  botStatusReasonMessage,
  getBotSettingsCopy,
  type BotSettingsCopy,
} from '../../../locales/settings-bot-copy.js';
import { errorMessage } from '../../../store/resource-store.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog.js';
import { BotBrandTile } from './bot-shared.js';

const POLLING_STATES: ReadonlyArray<BotOnboardingSnapshot['state']> = ['waiting', 'scanned'];

export function BotOnboardingDialog(props: {
  provider: BotOnboardingProvider;
  brand?: BotOnboardingBrand;
  open: boolean;
  onOpenChange(open: boolean): void;
  onConnected(snapshot: BotOnboardingSnapshot): void | Promise<void>;
}) {
  const mounted = useMountedRef();
  const locale = useUiLocale();
  const botCopy = getBotSettingsCopy(locale);
  const shared = botCopy.onboarding;
  const copy = providerCopy(props.provider, props.brand, shared);
  const [snapshot, setSnapshot] = useState<BotOnboardingSnapshot | null>(null);
  const [starting, setStarting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const connectedNotifiedRef = useRef(false);
  const qrCacheRef = useRef<string | null>(null);

  const cancelCurrent = useCallback(() => {
    generationRef.current += 1;
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) void cancelBotOnboarding(sessionId).catch(() => undefined);
  }, []);

  const start = useCallback(async () => {
    cancelCurrent();
    const generation = generationRef.current;
    setStarting(true);
    setError(null);
    setSnapshot(null);
    connectedNotifiedRef.current = false;
    qrCacheRef.current = null;
    try {
      const result = await startBotOnboarding({
        provider: props.provider,
        ...(props.provider === 'feishu' ? { brand: props.brand ?? 'feishu' } : {}),
      });
      if (!mounted.current || generation !== generationRef.current) return;
      setStarting(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      sessionIdRef.current = result.data.sessionId;
      if (result.data.qrCodeDataUrl) qrCacheRef.current = result.data.qrCodeDataUrl;
      setSnapshot(result.data);
    } catch (cause) {
      if (!mounted.current || generation !== generationRef.current) return;
      setStarting(false);
      setError(errorMessage(cause));
    }
  }, [cancelCurrent, mounted, props.provider, props.brand]);

  useEffect(() => {
    void start();
    return cancelCurrent;
  }, [start, cancelCurrent]);

  useEffect(() => {
    const sessionId = snapshot?.sessionId;
    if (!sessionId || !POLLING_STATES.includes(snapshot.state)) return;
    const generation = generationRef.current;
    const delay = Math.max(400, snapshot.nextPollAfterMs);
    const timer = window.setTimeout(async () => {
      try {
        const result = await pollBotOnboarding(sessionId);
        if (!mounted.current || generation !== generationRef.current) return;
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setSnapshot(result.data);
      } catch (cause) {
        if (!mounted.current || generation !== generationRef.current) return;
        setError(errorMessage(cause));
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [snapshot, mounted]);

  const { onConnected } = props;
  useEffect(() => {
    if (snapshot?.state !== 'connected' || connectedNotifiedRef.current) return;
    connectedNotifiedRef.current = true;
    void Promise.resolve(onConnected(snapshot)).catch((cause) => {
      if (!mounted.current || sessionIdRef.current !== snapshot.sessionId) return;
      setError(shared.connectedRefreshFailed(errorMessage(cause)));
    });
  }, [snapshot, onConnected, mounted, shared]);

  const openInBrowser = async () => {
    if (!snapshot) return;
    try {
      const result = await openBotOnboardingInBrowser(snapshot.sessionId);
      if (!mounted.current || sessionIdRef.current !== snapshot.sessionId) return;
      if (!result.ok) setError(result.error.message);
    } catch (cause) {
      if (!mounted.current || sessionIdRef.current !== snapshot.sessionId) return;
      setError(errorMessage(cause));
    }
  };

  const requestClose = () => {
    cancelCurrent();
    props.onOpenChange(false);
  };

  const status = statusText(snapshot, starting, error, copy, locale);
  const qrDataUrl = snapshot?.qrCodeDataUrl ?? qrCacheRef.current;
  const showQr =
    Boolean(qrDataUrl) &&
    snapshot?.state !== 'expired' &&
    snapshot?.state !== 'denied' &&
    snapshot?.state !== 'error';
  const frameState = snapshot?.state ?? (starting ? 'starting' : error ? 'error' : 'starting');

  return (
    <Dialog open={props.open} onOpenChange={(open) => (open ? undefined : requestClose())}>
      <DialogContent
        className="md:max-w-[480px]"
        aria-label={copy.ariaLabel}
        data-maka-contract="bot-onboarding-dialog"
        data-provider={props.provider}
      >
        <DialogHeader closeLabel={shared.close(copy.title)}>
          <div className="flex items-center gap-3">
            <BotBrandTile provider={props.provider} size="lg" />
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>{copy.subtitle}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2" aria-live="polite">
          <div
            className={cn(
              'flex size-56 items-center justify-center overflow-hidden rounded-xl border border-hairline bg-white',
            )}
            data-state={frameState}
          >
            {showQr ? (
              <img
                src={qrDataUrl ?? undefined}
                alt={copy.qrAlt}
                className="size-full object-contain"
              />
            ) : starting || snapshot?.state === 'connecting' ? (
              <Anthropicon
                name="spinner"
                size={24}
                className="animate-spin text-text-muted"
                aria-label={shared.generatingAria}
              />
            ) : snapshot?.state === 'connected' && !snapshot.warningCode ? (
              <Anthropicon name="check" size={32} className="text-success" aria-hidden="true" />
            ) : (
              <Anthropicon
                name="warningCircle"
                size={32}
                className="text-warning"
                aria-hidden="true"
              />
            )}
          </div>
          <p
            className="text-center text-sm leading-5 text-text-primary"
            data-state={snapshot?.state ?? (error ? 'error' : 'starting')}
          >
            {status}
          </p>
          <p className="text-center text-[0.8125rem] leading-[1.125rem] text-text-muted">
            {shared.privacy}
          </p>
          {snapshot?.canOpenInBrowser && POLLING_STATES.includes(snapshot.state) && (
            <Button variant="ghost" size="sm" onClick={() => void openInBrowser()}>
              {shared.openBrowser}
            </Button>
          )}
        </div>
        <DialogFooter>
          {snapshot?.state === 'connected' ? (
            <Button onClick={requestClose}>{shared.done}</Button>
          ) : snapshot?.state === 'expired' || snapshot?.state === 'denied' || error ? (
            <Button onClick={() => void start()}>{shared.regenerate}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={requestClose}>
                {shared.cancel}
              </Button>
              <Button variant="secondary" disabled={starting} onClick={() => void start()}>
                {shared.refreshQr}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function providerCopy(
  provider: BotOnboardingProvider,
  brand: BotOnboardingBrand | undefined,
  copy: BotSettingsCopy['onboarding'],
): BotSettingsCopy['onboarding']['providers'][BotOnboardingProvider] {
  if (provider !== 'feishu' || brand !== 'lark') return copy.providers[provider];
  return copy.lark;
}

function statusText(
  snapshot: BotOnboardingSnapshot | null,
  starting: boolean,
  error: string | null,
  copy: BotSettingsCopy['onboarding']['providers'][BotOnboardingProvider],
  locale: UiLocale,
): string {
  const botCopy = getBotSettingsCopy(locale);
  const shared = botCopy.onboarding;
  if (starting) return shared.generating;
  if (error) return error;
  switch (snapshot?.state) {
    case 'waiting':
      return copy.waiting;
    case 'scanned':
      return copy.scanned;
    case 'connecting':
      return shared.connecting;
    case 'connected':
      return snapshot.warningCode
        ? snapshot.warningDetail
          ? shared.savedNotConnectedDetail(botStatusReasonMessage(snapshot.warningDetail, locale))
          : shared.savedNotConnected
        : shared.connected(botCopy.providers[snapshot.provider].label);
    case 'expired':
      return shared.expired;
    case 'denied':
      return shared.denied;
    case 'cancelled':
      return shared.cancelled;
    case 'error':
      return botOnboardingErrorMessage(snapshot.errorCode, locale);
    default:
      return shared.preparing;
  }
}
