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

// The `orgAccount` namespace of the preload bridge, wrapped.
//
// The company account this desktop signs in with. It is app-level, not per
// Runtime Host: the main process owns the sign-in and the refresh token, so
// nothing here takes a `host`. Every change is pushed through `subscribe`,
// including the ones the calls below cause.

import type {
  OrgAccountError,
  OrgAccountSetServerResult,
  OrgAccountState,
  OrgIdentityProvider,
} from '../../shared/org-account.js';
import type { MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type OrgAccount = MakaBridge['orgAccount'];

export type { OrgAccountError, OrgAccountSetServerResult, OrgAccountState, OrgIdentityProvider };

const orgAccount = (): OrgAccount => requireNamespace('orgAccount');

export function getOrgAccountState(): Promise<OrgAccountState> {
  return orgAccount().state();
}

/**
 * Refused while signed in or signing in (`signed_in`), when the deployment
 * names the server (`managed`), or for an address that is not https.
 */
export function setOrgAccountServerUrl(url: string): Promise<OrgAccountSetServerResult> {
  return orgAccount().setServerUrl(url);
}

/**
 * Opens the system browser at `provider` (an id from the state's `providers`;
 * without one the server's page offers the choice). Resolves when the sign-in
 * finishes, fails or is cancelled.
 */
export function signInToOrgAccount(provider?: string): Promise<OrgAccountState> {
  return orgAccount().signIn(provider);
}

/** Loads the server's sign-in options again: the "Try again" after it could not be reached. */
export function refreshOrgAccount(): Promise<OrgAccountState> {
  return orgAccount().refresh();
}

export function cancelOrgAccountSignIn(): Promise<void> {
  return orgAccount().cancelSignIn();
}

export function signOutOfOrgAccount(): Promise<OrgAccountState> {
  return orgAccount().signOut();
}

export function subscribeOrgAccount(handler: (state: OrgAccountState) => void): () => void {
  return toUnsubscribe(tryNamespace('orgAccount')?.subscribe(handler));
}
