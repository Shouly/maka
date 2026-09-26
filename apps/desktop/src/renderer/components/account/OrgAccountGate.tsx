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

// The app, or the login screen in its place.
//
// A deployment bound to a company server (`enforced`) is not usable until
// someone signs in, so the shell does not mount at all before then — nor do
// its stores, which would otherwise start reading Sessions for nobody. Until
// the first account state arrives the window shows the login surface's empty
// frame: quiet, and the same frame the login screen then fills, so neither
// case flashes the app. Unenforced builds (development, e2e, open source)
// pass straight through once the state says so. `orgAccountGate` decides.
//
// Signed out, the window opens on the welcome page first — at launch, and
// again after a sign-out or an ended sign-in — and "Get started" leads to Sign
// In, where a failed attempt stays until it succeeds.

import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { LoginScreen, LoginSurface, WelcomeScreen } from './LoginScreen.js';
import { Button } from '../ui/button.js';
import { orgAccountGate } from '../../lib/org-account-view.js';
import { detectPlatform } from '../../lib/platform.js';
import { useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { orgAccountStore } from '../../store/index.js';
import { getOrgAccountCopy } from '../../locales/org-account-copy.js';
import { useUiLocale } from '@maka/ui';

export function OrgAccountGate(props: { children: ReactNode }) {
  const copy = getOrgAccountCopy(useUiLocale());
  const report = useSettingsErrorReporter();
  const account = useStore(orgAccountStore, (state) => state.account);
  const loadFailed = useStore(orgAccountStore, (state) => state.loadFailed);
  const knownProviders = useStore(orgAccountStore, (state) => state.knownProviders);
  const pending = useStore(orgAccountStore, (state) => state.pending);
  const [welcomed, setWelcomed] = useState(false);

  useEffect(() => orgAccountStore.start(), []);

  const gate = orgAccountGate(account, loadFailed);
  useEffect(() => {
    if (gate === 'app') setWelcomed(false);
  }, [gate]);
  if (gate === 'app') return props.children;
  if (gate === 'failed') {
    return (
      <LoginSurface>
        <div className="flex w-full max-w-[20rem] flex-col gap-3">
          <p role="alert" className="text-[0.8125rem] leading-[1.125rem] text-danger">
            {copy.settings.loadFailed}
          </p>
          <Button variant="secondary" size="lg" fullWidth onClick={() => orgAccountStore.reload()}>
            {copy.tryAgain}
          </Button>
        </div>
      </LoginSurface>
    );
  }
  if (gate === 'loading' || account === undefined || account.status === 'signed_in') {
    return <LoginSurface busy />;
  }
  if (!welcomed && account.status === 'signed_out') {
    return <WelcomeScreen platform={detectPlatform()} onGetStarted={() => setWelcomed(true)} />;
  }
  return (
    <LoginScreen
      account={account}
      knownProviders={knownProviders}
      pending={pending}
      onSignIn={(provider) =>
        void orgAccountStore
          .signIn(provider)
          .catch((error: unknown) => report(copy.errors.signInFailed, error))
      }
      onRefresh={() =>
        void orgAccountStore
          .refresh()
          .catch((error: unknown) => report(copy.errors.refreshFailed, error))
      }
    />
  );
}
