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

// The company account, as the renderer knows it.
//
// One store because three surfaces read it — the login gate at the app root,
// the sidebar's account entry and Settings › Account — and a sign-in started
// on one must disable the buttons on the others. It is started by the gate,
// not by `startRendererStores`: the gate decides whether the rest of the app
// (and its stores) mounts at all, so the account has to be known first.
//
// Every state is one main reported: a read on start, then the pushes. Actions
// apply the state they resolve with and REJECT on failure, so the surface that
// started one reports it in its own words.

import { createStore } from 'zustand/vanilla';
import * as api from '../bridge/org-account.js';
import type {
  OrgAccountSetServerResult,
  OrgAccountState,
  OrgIdentityProvider,
} from '../bridge/org-account.js';

export type OrgAccountBridge = Pick<
  typeof api,
  | 'getOrgAccountState'
  | 'subscribeOrgAccount'
  | 'setOrgAccountServerUrl'
  | 'signInToOrgAccount'
  | 'refreshOrgAccount'
  | 'cancelOrgAccountSignIn'
  | 'signOutOfOrgAccount'
>;

export type OrgAccountAction = 'signIn' | 'cancel' | 'signOut' | 'refresh';

export interface OrgAccountStoreState {
  /** `undefined` until the first read or push lands. */
  readonly account: OrgAccountState | undefined;
  /** The first read failed and nothing has been pushed since. */
  readonly loadFailed: boolean;
  readonly pending: OrgAccountAction | null;
  /**
   * The providers the server offered last: what the buttons fall back to if a
   * sign-in in progress arrives without its own list. The buttons stay on
   * screen while it runs, and pressing one starts over.
   */
  readonly knownProviders: readonly OrgIdentityProvider[];
}

export function createOrgAccountStore(bridge: OrgAccountBridge = api) {
  const store = createStore<OrgAccountStoreState>(() => ({
    account: undefined,
    loadFailed: false,
    pending: null,
    knownProviders: [],
  }));
  let lifetime = 0;
  // A push is newer than any read that was already in flight when it came.
  let pushes = 0;

  const apply = (account: OrgAccountState) => {
    store.setState((state) => ({
      account,
      loadFailed: false,
      knownProviders:
        account.status !== 'signed_in' && account.providers
          ? account.providers
          : state.knownProviders,
    }));
  };

  const read = (owner: number) => {
    const seen = pushes;
    // `Promise.resolve().then`: a bridge that throws outright (no account
    // bridge at all) is a failed read like any other, not a crash.
    void Promise.resolve()
      .then(() => bridge.getOrgAccountState())
      .then(
        (account) => {
          if (owner === lifetime && pushes === seen) apply(account);
        },
        () => {
          if (owner === lifetime && pushes === seen && store.getState().account === undefined) {
            store.setState({ loadFailed: true });
          }
        },
      );
  };

  const run = async (
    action: OrgAccountAction,
    operation: () => Promise<OrgAccountState | undefined>,
  ): Promise<void> => {
    store.setState({ pending: action });
    try {
      const account = await operation();
      if (account) apply(account);
    } finally {
      // A Cancel pressed while the sign-in call is still out takes the gate;
      // the sign-in resolving afterwards must not hand it back.
      store.setState((state) => (state.pending === action ? { pending: null } : state));
    }
  };

  return {
    ...store,
    start(): () => void {
      const owner = ++lifetime;
      let off = () => {};
      try {
        off = bridge.subscribeOrgAccount((account) => {
          if (owner !== lifetime) return;
          pushes++;
          apply(account);
        });
      } catch {
        // No account bridge: the read below fails too, and the gate says so.
      }
      read(owner);
      return () => {
        off();
        if (owner === lifetime) lifetime++;
      };
    },
    /** Read again after a failed first read. */
    reload(): void {
      store.setState({ loadFailed: false });
      read(lifetime);
    },
    signIn: (provider?: string) => run('signIn', () => bridge.signInToOrgAccount(provider)),
    cancelSignIn: () =>
      run('cancel', async () => {
        await bridge.cancelOrgAccountSignIn();
        return undefined;
      }),
    signOut: () => run('signOut', () => bridge.signOutOfOrgAccount()),
    refresh: () => run('refresh', () => bridge.refreshOrgAccount()),
    async setServerUrl(url: string): Promise<OrgAccountSetServerResult> {
      const result = await bridge.setOrgAccountServerUrl(url);
      if (result.ok) apply(result.state);
      return result;
    },
  };
}

export const orgAccountStore = createOrgAccountStore();
