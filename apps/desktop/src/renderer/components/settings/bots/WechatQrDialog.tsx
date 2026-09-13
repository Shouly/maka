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

// The local WeChat bridge's QR sign-in. Unlike scan-to-connect, there is no
// session to poll: the bridge is asked for its current code every three
// seconds while a code is on screen, and stops once it reports a login.

import { useEffect, useRef, useState } from 'react';
import { useUiLocale } from '@maka/ui';
import { wechatQrCode, type WechatBridgeQrCodeResult } from '../../../bridge/bots.js';
import { getBotSettingsCopy } from '../../../locales/settings-bot-copy.js';
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
import { NoticeCard } from '../../session/notices/NoticeCard.js';

export function WechatQrDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onLoggedIn(): void;
}) {
  const locale = useUiLocale();
  const botCopy = getBotSettingsCopy(locale);
  const copy = botCopy.wechat;
  const [result, setResult] = useState<WechatBridgeQrCodeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const notifiedRef = useRef(false);
  const loadingRef = useRef(false);
  const { onLoggedIn } = props;

  const reload = () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setNonce((value) => value + 1);
  };

  useEffect(() => {
    let active = true;
    loadingRef.current = true;
    setLoading(true);
    void wechatQrCode()
      .then((next) => {
        if (!active) return;
        setResult(next);
        if (next.ok && next.loggedIn && !notifiedRef.current) {
          notifiedRef.current = true;
          onLoggedIn();
        }
      })
      .catch((cause) => {
        if (!active) return;
        setResult({ ok: false, error: errorMessage(cause) });
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        loadingRef.current = false;
      });
    return () => {
      active = false;
    };
  }, [nonce, onLoggedIn]);

  const shouldPoll = result?.ok === true && !result.loggedIn && !result.expired;
  useEffect(() => {
    if (!shouldPoll) return;
    const interval = window.setInterval(reload, 3_000);
    return () => window.clearInterval(interval);
  }, [shouldPoll]);

  const qrDataUrl = result?.ok ? result.qrcode : null;
  const expired = result?.ok ? result.expired : false;
  const loggedIn = result?.ok ? result.loggedIn : false;
  const failure = result && !result.ok ? result : null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="md:max-w-[480px]" data-maka-contract="wechat-qr-dialog">
        <DialogHeader closeLabel={copy.close}>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.subtitle}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2" aria-live="polite">
          {loading && !qrDataUrl ? (
            <>
              <Anthropicon name="spinner" size={24} className="animate-spin text-text-muted" />
              <p className="text-sm leading-5 text-text-secondary">{copy.generating}</p>
            </>
          ) : loggedIn ? (
            <NoticeCard tone="info" title={copy.loggedIn} />
          ) : expired ? (
            <Empty title={copy.expired} description={copy.expiredHint} />
          ) : qrDataUrl ? (
            <>
              <div className="flex size-56 items-center justify-center overflow-hidden rounded-xl border border-hairline bg-white">
                <img src={qrDataUrl} alt={copy.qrAlt} className="size-full object-contain" />
              </div>
              <p className="text-sm leading-5 text-text-secondary">{copy.waiting}</p>
            </>
          ) : failure ? (
            <div role="alert" className="w-full">
              <Empty
                title={failure.hintCode ? botCopy.testHints[failure.hintCode] : copy.readQrFailed}
                description={copy.readQrFailed}
              />
            </div>
          ) : (
            <Empty title={copy.bridgeGenerating} description={copy.bridgeGeneratingHint} />
          )}
        </div>
        {!loggedIn && (
          <DialogFooter>
            <Button variant="secondary" size="sm" disabled={loading} onClick={reload}>
              {loading
                ? expired
                  ? copy.refreshing
                  : failure
                    ? copy.retrying
                    : copy.fetching
                : expired
                  ? copy.refresh
                  : failure
                    ? copy.retry
                    : copy.fetchAgain}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Empty(props: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <Anthropicon name="chats" size={24} className="text-text-muted" aria-hidden="true" />
      <p className="text-sm font-medium leading-5 text-text-primary">{props.title}</p>
      <p className="text-[0.8125rem] leading-[1.125rem] text-text-secondary">{props.description}</p>
    </div>
  );
}
