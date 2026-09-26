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

// An identity provider signs a person in and vouches for their email. Each
// one is an adapter behind this interface, so adding Azure AD, generic OIDC
// or SAML later is a new file, not a change to the sign-in flow (§4.1).

export interface VerifiedIdentity {
  readonly provider: string;
  /** The provider's stable id for the person. */
  readonly subject: string;
  /** Verified by the provider; never taken from the client. */
  readonly email: string;
  readonly name?: string;
  readonly avatarUrl?: string;
}

export interface IdentityProvider {
  readonly id: string;
  readonly displayName: string;
  /** The callback registered with the provider, when not the default /login/<id>/callback. */
  readonly callbackUrl?: string;
  authorizationUrl(input: { state: string; nonce: string; redirectUri: string }): string;
  exchange(input: { code: string; nonce: string; redirectUri: string }): Promise<VerifiedIdentity>;
}

export type IdentityRefusal =
  | 'email_not_verified'
  | 'domain_not_allowed'
  | 'account_deactivated'
  | 'identity_conflict'
  | 'provider_error';

/** A sign-in the provider or this server refuses; `reason` is shown to the person. */
export class IdentityRefused extends Error {
  constructor(
    readonly reason: IdentityRefusal,
    message: string,
  ) {
    super(message);
  }
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** How long a call to an identity provider may take before the sign-in fails. */
export const PROVIDER_TIMEOUT_MS = 10_000;

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/** A well-formed email, inside `allowedDomains` when that list is not empty. */
export function isAllowedEmail(email: string, allowedDomains: readonly string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return false;
  return allowedDomains.length === 0 || allowedDomains.includes(emailDomain(email));
}
