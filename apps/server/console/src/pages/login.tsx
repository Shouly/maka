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

// Signing in to the console, drawn as the desktop app's own sign-in: a serif
// title over one card, Google outlined and carrying its "G" above an "OR",
// every other provider as the solid primary below it, and why the last
// attempt failed in the card's foot. A button leads to /admin/login/<id>,
// where the server sends the browser on to that provider.
//
// The providers are the server's public metadata, the same list the desktop
// reads before it signs in.

import { useCallback, useEffect, useState } from 'react';
import { PLATFORM_METADATA_PATH, type PlatformMetadata } from '@maka/platform-protocol';
import { LoginSurface } from '@desktop/components/account/LoginScreen.js';
import { Anthropicon } from '@desktop/components/icons/Anthropicon.js';
import { Button } from '@desktop/components/ui/button.js';
import { Skeleton } from '@desktop/components/ui/skeleton.js';
import { GoogleSignInMark } from '@desktop/lib/ported/provider-brand-marks.js';
import type { ConsoleCopy } from '../copy.js';

type Provider = PlatformMetadata['identityProviders'][number];

/** The desktop sign-in's 40px control with 15px type. */
const SIGN_IN_BUTTON = 'md:h-10 text-[0.9375rem]';
const FOOT_LINE = 'text-center text-[0.8125rem] leading-5';
const DISPLAY_TITLE =
  "text-center font-display text-[1.875rem] font-normal leading-9 text-text-primary [font-variation-settings:'opsz'_30]";

export function LoginPage(props: { copy: ConsoleCopy }) {
  const text = props.copy.login;
  const params = new URLSearchParams(window.location.search);
  const failure = params.get('error');
  const next = params.get('next');
  const [providers, setProviders] = useState<readonly Provider[] | undefined>(undefined);
  const [unreachable, setUnreachable] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);

  const load = useCallback(() => {
    setUnreachable(false);
    fetch(PLATFORM_METADATA_PATH, { headers: { accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<PlatformMetadata>;
      })
      .then((metadata) => setProviders(metadata.identityProviders))
      .catch(() => setUnreachable(true));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    document.title = `${text.title} · ${props.copy.product}`;
  }, [props.copy, text.title]);
  // Back from the provider to a page the browser kept: the buttons work again.
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(null);
    };
    window.addEventListener('pageshow', shown);
    return () => window.removeEventListener('pageshow', shown);
  }, []);

  const signIn = (provider: Provider) => {
    setLeaving(provider.id);
    const query = next ? `?next=${encodeURIComponent(next)}` : '';
    window.location.assign(`/admin/login/${encodeURIComponent(provider.id)}${query}`);
  };
  const button = (provider: Provider, outlined: boolean) => (
    <Button
      key={provider.id}
      {...(outlined ? { variant: 'secondary' as const } : {})}
      size="lg"
      fullWidth
      className={SIGN_IN_BUTTON}
      aria-busy={leaving === provider.id || undefined}
      onClick={() => {
        if (leaving === null) signIn(provider);
      }}
    >
      {leaving === provider.id ? (
        <Anthropicon name="spinner" size={16} className="animate-spin" />
      ) : (
        <>
          {provider.id === 'google' && <GoogleSignInMark className="size-4 shrink-0" />}
          {text.continueWith(provider.displayName)}
        </>
      )}
    </Button>
  );

  const google = providers?.find((provider) => provider.id === 'google');
  const others = providers?.filter((provider) => provider !== google) ?? [];
  const reason = failure ? (text.failures[failure] ?? text.failures.provider_error) : undefined;

  return (
    <div className="flex h-dvh w-full flex-col">
      <LoginSurface>
        <div className="flex w-full max-w-[27.875rem] flex-col items-center gap-16">
          <h1 className={DISPLAY_TITLE}>{text.title}</h1>
          <div className="flex w-full flex-col gap-3 rounded-[2rem] border border-hairline bg-surface-1 p-7 shadow-[0_4px_24px_0_var(--shadow-near)]">
            {unreachable ? (
              <>
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  className={SIGN_IN_BUTTON}
                  onClick={load}
                >
                  {text.retry}
                </Button>
                <p role="alert" className={`${FOOT_LINE} text-danger`}>
                  {text.loadFailed}
                </p>
              </>
            ) : !providers ? (
              <div className="flex flex-col gap-3" role="status">
                <span className="sr-only">{text.loading}</span>
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="mx-auto h-4 w-6 rounded" />
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            ) : (
              <>
                {google && button(google, true)}
                {google && others.length > 0 && (
                  <p className="text-center text-xs leading-4 text-text-secondary">{text.or}</p>
                )}
                {others.map((provider) => button(provider, false))}
                {reason && (
                  <p role="alert" className={`${FOOT_LINE} text-danger`}>
                    {reason}
                  </p>
                )}
              </>
            )}
          </div>
          <p className={`${FOOT_LINE} -mt-12 text-text-muted`}>{text.foot}</p>
        </div>
      </LoginSurface>
    </div>
  );
}
