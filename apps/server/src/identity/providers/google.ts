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

// Google Workspace over OpenID Connect. The ID token is verified against
// Google's keys and must carry a verified email. Who may sign in is Google's
// call: the company's OAuth client is of the Internal type, so only its
// Workspace accounts get through. A personal Google account is refused even
// so — its ID token has no Workspace domain (`hd`) — because nothing here can
// check the client's type, and a personal account made on a work address
// outlives the person's employment. When a deployment also lists email
// domains, the Workspace domain must be one of them.

import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose';
import {
  type FetchLike,
  type IdentityProvider,
  IdentityRefused,
  isAllowedEmail,
  PROVIDER_TIMEOUT_MS,
  type VerifiedIdentity,
} from './types.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export interface GoogleProviderOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly allowedDomains: readonly string[];
  readonly callbackUrl?: string;
  readonly fetch?: FetchLike;
  readonly keys?: JWTVerifyGetKey;
  readonly now?: () => Date;
}

export function googleProvider(options: GoogleProviderOptions): IdentityProvider {
  const fetchImpl = options.fetch ?? fetch;
  const keys = options.keys ?? createRemoteJWKSet(new URL(JWKS_URL));
  return {
    id: 'google',
    displayName: 'Google',
    ...(options.callbackUrl ? { callbackUrl: options.callbackUrl } : {}),
    authorizationUrl({ state, nonce, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('prompt', 'select_account');
      // A hint only: the domain is enforced on the ID token below.
      if (options.allowedDomains.length === 1)
        url.searchParams.set('hd', options.allowedDomains[0]!);
      return url.toString();
    },
    async exchange({ code, nonce, redirectUri }): Promise<VerifiedIdentity> {
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: options.clientId,
          client_secret: options.clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!response.ok) {
        throw new IdentityRefused(
          'provider_error',
          `Google token exchange failed (${response.status})`,
        );
      }
      const body = (await response.json()) as { id_token?: unknown };
      if (typeof body.id_token !== 'string') {
        throw new IdentityRefused('provider_error', 'Google returned no ID token');
      }
      const { payload } = await jwtVerify(body.id_token, keys, {
        issuer: ISSUERS,
        audience: options.clientId,
        ...(options.now ? { currentDate: options.now() } : {}),
      }).catch(() => {
        throw new IdentityRefused('provider_error', 'Google ID token did not verify');
      });
      if (payload.nonce !== nonce) {
        throw new IdentityRefused('provider_error', 'Google ID token answers a different sign-in');
      }
      const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
      if (payload.email_verified !== true || !email) {
        throw new IdentityRefused(
          'email_not_verified',
          'This Google account has no verified email',
        );
      }
      const hostedDomain = typeof payload.hd === 'string' ? payload.hd.toLowerCase() : '';
      const fenced = options.allowedDomains.length > 0;
      if (
        !hostedDomain ||
        (fenced && !options.allowedDomains.includes(hostedDomain)) ||
        !isAllowedEmail(email, options.allowedDomains)
      ) {
        throw new IdentityRefused(
          'domain_not_allowed',
          'Only company Google Workspace accounts can sign in',
        );
      }
      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        throw new IdentityRefused('provider_error', 'Google ID token has no subject');
      }
      return {
        provider: 'google',
        subject: payload.sub,
        email,
        ...(typeof payload.name === 'string' ? { name: payload.name } : {}),
        ...(typeof payload.picture === 'string' ? { avatarUrl: payload.picture } : {}),
      };
    },
  };
}
