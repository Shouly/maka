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

// RELX enterprise SSO: OAuth2 with its own conventions. Scopes are comma
// separated; the token request is a GET with every parameter in the query;
// user info is a POST answering `{ code: 10000, data: { uid, name, email } }`.
// Mirrors relx-copilot backend/app/core/oauth.py, the one working client.
//
// The emails it returns come from the company directory and are treated as
// verified (to be confirmed with RELX IT, design §12).

import {
  type FetchLike,
  type IdentityProvider,
  IdentityRefused,
  isAllowedEmail,
  PROVIDER_TIMEOUT_MS,
  type VerifiedIdentity,
} from './types.js';

const SUCCESS_CODE = 10000;

export interface RelxSsoProviderOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly userinfoUrl: string;
  readonly allowedDomains: readonly string[];
  readonly callbackUrl?: string;
  readonly fetch?: FetchLike;
}

export function relxSsoProvider(options: RelxSsoProviderOptions): IdentityProvider {
  const fetchImpl = options.fetch ?? fetch;
  return {
    id: 'relx-sso',
    displayName: 'RELX SSO',
    ...(options.callbackUrl ? { callbackUrl: options.callbackUrl } : {}),
    authorizationUrl({ state, redirectUri }) {
      const url = new URL(options.authorizeUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', 'uid,name,email');
      url.searchParams.set('state', state);
      return url.toString();
    },
    async exchange({ code, redirectUri }): Promise<VerifiedIdentity> {
      const tokenUrl = new URL(options.tokenUrl);
      tokenUrl.searchParams.set('client_id', options.clientId);
      tokenUrl.searchParams.set('client_secret', options.clientSecret);
      tokenUrl.searchParams.set('grant_type', 'authorization_code');
      tokenUrl.searchParams.set('code', code);
      tokenUrl.searchParams.set('redirect_uri', redirectUri);
      const tokenResponse = await fetchImpl(tokenUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      if (!tokenResponse.ok) {
        throw new IdentityRefused(
          'provider_error',
          `RELX SSO token exchange failed (${tokenResponse.status})`,
        );
      }
      const token = (await tokenResponse.json()) as { access_token?: unknown; error?: unknown };
      if (token.error || typeof token.access_token !== 'string') {
        throw new IdentityRefused('provider_error', 'RELX SSO returned no access token');
      }
      const infoResponse = await fetchImpl(options.userinfoUrl, {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        method: 'POST',
        headers: {
          authorization: `Bearer ${token.access_token}`,
          'content-type': 'application/json',
        },
      });
      if (!infoResponse.ok) {
        throw new IdentityRefused(
          'provider_error',
          `RELX SSO user info failed (${infoResponse.status})`,
        );
      }
      const info = (await infoResponse.json()) as {
        code?: unknown;
        data?: Record<string, unknown>;
      };
      if (info.code !== SUCCESS_CODE || typeof info.data !== 'object' || info.data === null) {
        throw new IdentityRefused('provider_error', 'RELX SSO user info was refused');
      }
      const data = info.data;
      const subjectValue = data.uid ?? data.sub ?? data.id;
      const subject =
        typeof subjectValue === 'string' || typeof subjectValue === 'number'
          ? String(subjectValue)
          : '';
      const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
      if (!subject || !email) {
        throw new IdentityRefused('provider_error', 'RELX SSO user info is missing uid or email');
      }
      if (!isAllowedEmail(email, options.allowedDomains)) {
        throw new IdentityRefused('domain_not_allowed', 'This email domain cannot sign in');
      }
      return {
        provider: 'relx-sso',
        subject,
        email,
        ...(typeof data.name === 'string' && data.name.trim() ? { name: data.name.trim() } : {}),
      };
    },
  };
}
