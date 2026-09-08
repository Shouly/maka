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

// Driving one browser-assisted OAuth sign-in.
//
// All three providers hand authorization to the system browser, so there is
// one shape: ask the Host for a request id, open the page it holds, wait for
// the Host to finish polling, then re-read the account. The renderer never
// sees the URL — only an opaque id and the short code the provider page asks
// the user to confirm.
//
// Two rules this encodes, both learned the hard way:
//
// - An in-flight authorization is CANCELLED on unmount. Leaving it open means
//   the Host keeps polling for a login the user walked away from, and the next
//   attempt comes back `authorization_pending` against a round nobody is
//   completing any more.
// - Enrollment is read as three states, not two. `undefined` means the probe
//   has not answered, and the panel treats that as enabled: a slow Host must
//   not hide a sign-in that would in fact work. Only an explicit `false`
//   removes the button.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useUiLocale } from '@maka/ui';
import {
  cancelOAuthAuthorization,
  completeOAuthAuthorization,
  getOAuthAccountState,
  getOAuthEnrollmentState,
  isOAuthAccountProjection,
  openOAuthAuthorizationUrl,
  signOutOAuthConnection,
  startOAuthAuthorization,
  type DesktopOAuthConnectionIdentity,
  type InteractiveOAuthProviderType,
  type OAuthAccountProjection,
} from '../bridge/oauth.js';
import type { DesktopRuntimeHostRef } from '../bridge/projects.js';
import { oauthErrorMessage, oauthFailureMessage } from '../lib/ported/provider-oauth-message.js';
import { getSettingsModelsCopy } from '../locales/settings-models-copy.js';

export type OAuthPendingAction = 'login' | 'logout' | 'refresh';

export interface OAuthLoginFlow {
  /** `undefined` until the account read answers, or when there is no connection to read. */
  readonly account: OAuthAccountProjection | undefined;
  readonly accountLoading: boolean;
  readonly enrollmentEnabled: boolean | undefined;
  readonly pending: OAuthPendingAction | null;
  /** The short code the provider's page asks the user to confirm, while a round is open. */
  readonly stateHint: string | null;
  readonly errorMessage: string | null;
  readonly startLogin: () => Promise<void>;
  readonly cancelLogin: () => void;
  readonly signOut: () => Promise<void>;
  readonly reloadAccount: () => Promise<void>;
}

export function useOAuthLoginFlow(input: {
  provider: InteractiveOAuthProviderType;
  host: DesktopRuntimeHostRef | undefined;
  /** Absent for "add an account"; present to manage one that exists. */
  connectionId?: string;
  onSignedIn?: (connection: DesktopOAuthConnectionIdentity) => void | Promise<void>;
  onSignedOut?: () => void | Promise<void>;
}): OAuthLoginFlow {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale).oauthFlow;
  const { provider, host, connectionId } = input;
  const [account, setAccount] = useState<OAuthAccountProjection | undefined>(undefined);
  const [accountLoading, setAccountLoading] = useState(connectionId !== undefined);
  const [enrollmentEnabled, setEnrollmentEnabled] = useState<boolean | undefined>(undefined);
  const [pending, setPending] = useState<OAuthPendingAction | null>(null);
  const [stateHint, setStateHint] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mounted = useRef(true);
  const openRequestId = useRef<string | null>(null);
  const callbacks = useRef(input);
  callbacks.current = input;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const requestId = openRequestId.current;
      openRequestId.current = null;
      if (requestId) void cancelOAuthAuthorization(provider, requestId, host);
    };
  }, [provider, host]);

  const reloadAccount = useCallback(async () => {
    if (!connectionId) {
      setAccount(undefined);
      setAccountLoading(false);
      return;
    }
    setAccountLoading(true);
    try {
      const state = await getOAuthAccountState(provider, connectionId, host);
      if (!mounted.current) return;
      // The failure half of the union is not an account: keeping the previous
      // projection is honest ("this is what we last knew"), and replacing it
      // with a blank one would read as "signed out".
      if (isOAuthAccountProjection(state)) {
        setAccount(state);
        setErrorMessage(null);
      } else {
        setErrorMessage(oauthFailureMessage(state, copy.serviceUnavailable, locale));
      }
    } catch (error) {
      if (mounted.current) setErrorMessage(oauthErrorMessage(error, copy.refreshFailed, locale));
    } finally {
      if (mounted.current) setAccountLoading(false);
    }
  }, [connectionId, provider, host, copy, locale]);

  useEffect(() => {
    void reloadAccount();
  }, [reloadAccount]);

  useEffect(() => {
    let cancelled = false;
    void getOAuthEnrollmentState(provider, host)
      .then((result) => {
        if (!cancelled && mounted.current) setEnrollmentEnabled(result.enabled);
      })
      // A probe that throws leaves the answer unknown on purpose; see the
      // module comment.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [provider, host]);

  const startLogin = useCallback(async () => {
    if (pending !== null) return;
    setPending('login');
    setErrorMessage(null);
    try {
      const started = await startOAuthAuthorization(
        provider,
        connectionId ? { kind: 'existing', connectionId } : { kind: 'create' },
        host,
      );
      if (!('connection' in started)) {
        setErrorMessage(oauthFailureMessage(started, copy.startFailedRetry, locale));
        return;
      }
      openRequestId.current = started.authRequestId;
      if (!mounted.current) {
        openRequestId.current = null;
        void cancelOAuthAuthorization(provider, started.authRequestId, host);
        return;
      }
      setStateHint(started.stateHint);
      const opened = await openOAuthAuthorizationUrl(provider, started.authRequestId, host);
      if (!mounted.current) return;
      if (!opened.ok) {
        setErrorMessage(oauthFailureMessage(opened, copy.openFailedRetry, locale));
        void cancelOAuthAuthorization(provider, started.authRequestId, host);
        openRequestId.current = null;
        setStateHint(null);
        return;
      }
      const result = await completeOAuthAuthorization(provider, started.authRequestId, host);
      if (!mounted.current) return;
      openRequestId.current = null;
      setStateHint(null);
      if (!result.ok) {
        setErrorMessage(oauthFailureMessage(result, copy.incompleteRetry, locale));
        return;
      }
      await reloadAccount();
      await callbacks.current.onSignedIn?.(result.connection);
    } catch (error) {
      if (!mounted.current) return;
      const requestId = openRequestId.current;
      openRequestId.current = null;
      if (requestId) void cancelOAuthAuthorization(provider, requestId, host);
      setStateHint(null);
      setErrorMessage(oauthErrorMessage(error, copy.loginFailedRetry, locale));
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [pending, provider, connectionId, host, copy, locale, reloadAccount]);

  const cancelLogin = useCallback(() => {
    const requestId = openRequestId.current;
    openRequestId.current = null;
    setStateHint(null);
    if (requestId) void cancelOAuthAuthorization(provider, requestId, host);
  }, [provider, host]);

  const signOut = useCallback(async () => {
    if (!connectionId || pending !== null) return;
    setPending('logout');
    setErrorMessage(null);
    try {
      const result = await signOutOAuthConnection(provider, connectionId, host);
      if (!mounted.current) return;
      if (!result.ok) {
        setErrorMessage(oauthFailureMessage(result, copy.logoutFailedRetry, locale));
        return;
      }
      await reloadAccount();
      await callbacks.current.onSignedOut?.();
    } catch (error) {
      if (mounted.current)
        setErrorMessage(oauthErrorMessage(error, copy.logoutFailedRetry, locale));
    } finally {
      if (mounted.current) setPending(null);
    }
  }, [connectionId, pending, provider, host, copy, locale, reloadAccount]);

  return {
    account,
    accountLoading,
    enrollmentEnabled,
    pending,
    stateHint,
    errorMessage,
    startLogin,
    cancelLogin,
    signOut,
    reloadAccount,
  };
}
