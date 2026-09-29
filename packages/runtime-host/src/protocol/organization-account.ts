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

// The organisation account's access token, which the Host asks the desktop
// app for whenever a model call or a catalog read goes to the organisation
// server (design §5.3). The app keeps the account and its refresh token; the
// Host only ever holds a short-lived access token, in memory.

import { requireExactRecord, requireRecord, requireShapedRecord, requireString } from './codec.js';
import { invalidProtocolFrame } from './errors.js';

export const ORGANIZATION_ACCOUNT_SERVICE_ID = 'organization_account';
export const ORGANIZATION_ACCOUNT_SERVICE_VERSION = '1';
export const ORGANIZATION_ACCOUNT_TOKEN_METHOD = 'access_token';
/** A JWT the server signs; far below this in practice. */
export const ORGANIZATION_ACCOUNT_TOKEN_MAX_LENGTH = 16_384;
const SERVER_URL_MAX_LENGTH = 2_048;

/** Why the app has no token to give, in the account's own terms. */
export const ORGANIZATION_ACCOUNT_UNAVAILABLE_REASONS = [
  'signed_out',
  'sign_in_expired',
  'server_unreachable',
  'upgrade_required',
] as const;
export type OrganizationAccountUnavailableReason =
  (typeof ORGANIZATION_ACCOUNT_UNAVAILABLE_REASONS)[number];

export interface OrganizationAccountTokenRequest {
  /** The gateway refused the last token: have the app refresh it now. */
  readonly forceRefresh: boolean;
}

export type OrganizationAccountTokenResult =
  | {
      readonly kind: 'token';
      readonly accessToken: string;
      /** The server the token is for; the Host sends it nowhere else. */
      readonly serverUrl: string;
      /** The app's version, which the gateway checks like any other request's. */
      readonly clientVersion: string;
    }
  | { readonly kind: 'unavailable'; readonly reason: OrganizationAccountUnavailableReason };

export function decodeOrganizationAccountTokenRequest(
  method: unknown,
  value: unknown,
): OrganizationAccountTokenRequest {
  if (method !== ORGANIZATION_ACCOUNT_TOKEN_METHOD) {
    throw invalidProtocolFrame('Invalid organization account method');
  }
  const input = requireShapedRecord(
    value,
    'Organization account token input',
    [],
    ['forceRefresh'],
  );
  if (input.forceRefresh !== undefined && typeof input.forceRefresh !== 'boolean') {
    throw invalidProtocolFrame('Invalid organization account refresh flag');
  }
  return { forceRefresh: input.forceRefresh === true };
}

/** An absolute http(s) address: the Host compares it with the connection's and sends tokens there. */
function requireServerUrl(value: unknown): string {
  const url = requireString(value, 'Organization server URL', SERVER_URL_MAX_LENGTH);
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
    throw invalidProtocolFrame('Invalid organization server URL');
  }
  return url;
}

export function decodeOrganizationAccountTokenResult(
  value: unknown,
): OrganizationAccountTokenResult {
  const kind = requireRecord(value, 'Organization account token result').kind;
  if (kind === 'token') {
    const result = requireExactRecord(value, 'Organization account token', [
      'kind',
      'accessToken',
      'serverUrl',
      'clientVersion',
    ]);
    return {
      kind,
      accessToken: requireString(
        result.accessToken,
        'Organization account access token',
        ORGANIZATION_ACCOUNT_TOKEN_MAX_LENGTH,
      ),
      serverUrl: requireServerUrl(result.serverUrl),
      clientVersion: requireString(result.clientVersion, 'Organization client version', 64),
    };
  }
  if (kind === 'unavailable') {
    const result = requireExactRecord(value, 'Organization account unavailable', [
      'kind',
      'reason',
    ]);
    if (
      typeof result.reason !== 'string' ||
      !ORGANIZATION_ACCOUNT_UNAVAILABLE_REASONS.includes(
        result.reason as OrganizationAccountUnavailableReason,
      )
    ) {
      throw invalidProtocolFrame('Invalid organization account unavailable reason');
    }
    return { kind, reason: result.reason as OrganizationAccountUnavailableReason };
  }
  throw invalidProtocolFrame('Invalid organization account token result');
}
