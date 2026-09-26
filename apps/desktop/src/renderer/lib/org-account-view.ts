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

// What the company account means for what is on screen. Three surfaces read
// the same account — the login gate at the app root, Settings › Account and
// the sidebar's account entry — and they must agree on when the app is
// usable and which sign-in buttons a signed-out person gets.

import type {
  OrgAccountError,
  OrgAccountState,
  OrgIdentityProvider,
} from '../../shared/org-account.js';

/**
 * What the app root renders.
 *
 * `loading` until the first answer: the page cannot know whether sign-in is
 * required before main says so. A first read that FAILS stays shut, with the
 * reason and a retry: sign-in is mandatory where it is enforced, and a gate
 * that opened on an unreadable account would let anyone past it. (The main
 * process answers the read from its first moment, so this is a fault, not a
 * startup race.)
 */
export function orgAccountGate(
  account: OrgAccountState | undefined,
  loadFailed: boolean,
): 'app' | 'loading' | 'failed' | 'login' {
  if (account === undefined) return loadFailed ? 'failed' : 'loading';
  if (!account.enforced || account.status === 'signed_in') return 'app';
  return 'login';
}

/** Errors that mean the server's sign-in options are not there to choose from. */
/** Loading the server's providers failed for one of these; they are what keeps the buttons away. */
const SERVER_ERRORS: ReadonlySet<OrgAccountError> = new Set([
  'server_unreachable',
  'server_incompatible',
  'upgrade_required',
]);

export type SignInOptions =
  /** Nothing to sign in to yet: the address has not been entered. */
  | { readonly kind: 'no_server' }
  /** The server's providers are on their way. */
  | { readonly kind: 'loading' }
  /** The options could not be loaded: the reason, and "Try again". */
  | { readonly kind: 'retry'; readonly error: OrgAccountError }
  /**
   * One button per provider, in the server's order. An empty list is a server
   * that names none: one button, and the server's own page offers the choice.
   */
  | {
      readonly kind: 'choose';
      readonly providers: readonly OrgIdentityProvider[];
      /** Why the last attempt did not sign in, shown in the card's foot. */
      readonly error?: OrgAccountError;
    };

export function signInOptions(
  account: Extract<OrgAccountState, { status: 'signed_out' }>,
): SignInOptions {
  const error = account.lastError;
  // No address: nothing to offer — unless there is a reason to show (a bound
  // deployment whose address is unusable).
  if (account.serverUrl === null)
    return error !== undefined ? { kind: 'retry', error } : { kind: 'no_server' };
  if (error !== undefined && SERVER_ERRORS.has(error)) return { kind: 'retry', error };
  // A sign-in that just ended (expired, signed out) is followed by a fresh load.
  if (account.providers === undefined) return { kind: 'loading' };
  return {
    kind: 'choose',
    providers: account.providers,
    ...(error !== undefined ? { error } : {}),
  };
}

/**
 * The provider a sign-in in progress went to, by name. `signing_in` carries
 * only the id; the name comes from the list the server offered before it.
 */
export function signingInProvider(
  account: Extract<OrgAccountState, { status: 'signing_in' }>,
  known: readonly OrgIdentityProvider[],
): OrgIdentityProvider | undefined {
  if (account.provider === undefined) return undefined;
  return known.find((provider) => provider.id === account.provider);
}

/** A sign-in the person cancelled themselves is a note; every other outcome is an alert. */
export function signInOutcomeTone(error: OrgAccountError): 'note' | 'alert' {
  return error === 'cancelled' ? 'note' : 'alert';
}
