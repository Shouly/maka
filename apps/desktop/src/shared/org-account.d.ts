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

// The company account the desktop signs in with (design §4.2): shared by the
// main process, which owns it, and the renderer, which shows it.

export type OrgAccountError =
  /** The server address is wrong or the server is down. */
  | 'server_unreachable'
  /** The server speaks a platform version this app does not. */
  | 'server_incompatible'
  /** This app is older than the server accepts. */
  | 'upgrade_required'
  | 'domain_not_allowed'
  | 'email_not_verified'
  | 'account_deactivated'
  /** The email belongs to someone else at this provider; an administrator must sort it out. */
  | 'identity_conflict'
  /** The identity provider failed or refused. */
  | 'provider_error'
  | 'cancelled'
  | 'timed_out'
  /** Seven days since the last sign-in, or the device was signed out elsewhere. */
  | 'sign_in_expired'
  | 'unknown';

export interface OrgAccountProfile {
  readonly name: string;
  readonly email: string;
  readonly avatarUrl?: string;
  readonly orgRole: 'member' | 'org_admin';
}

/** One sign-in button: an identity provider the company server offers. */
export interface OrgIdentityProvider {
  readonly id: string;
  readonly displayName: string;
}

interface OrgAccountCommon {
  /**
   * The deployment names the company server: signing in is required before
   * the app can be used, and the address cannot be changed.
   */
  readonly enforced: boolean;
}

export type OrgAccountState = OrgAccountCommon &
  (
  | {
      readonly status: 'signed_out';
      readonly serverUrl: string | null;
      readonly lastError?: OrgAccountError;
      /** The server's providers; absent until they are loaded or when it cannot be reached. */
      readonly providers?: readonly OrgIdentityProvider[];
    }
  | {
      readonly status: 'signing_in';
      readonly serverUrl: string;
      readonly provider?: string;
      /** The server's providers, so a window opened mid sign-in can draw the same buttons. */
      readonly providers?: readonly OrgIdentityProvider[];
    }
  | {
      readonly status: 'signed_in';
      readonly serverUrl: string;
      readonly profile: OrgAccountProfile;
      /** When this sign-in stops refreshing (epoch ms). */
      readonly signInExpiresAt: number;
      /** False when the OS keychain is unavailable: the sign-in lasts until Maka quits. */
      readonly remembered: boolean;
    }
  );

export type OrgAccountSetServerResult =
  | { readonly ok: true; readonly state: OrgAccountState }
  | { readonly ok: false; readonly reason: 'invalid_url' | 'signed_in' | 'managed' };
