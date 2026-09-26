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

// The wire contract between the Maka desktop app and the Maka organization
// server. Both sides import this package, so a field renamed here fails to
// compile on both at once instead of drifting apart in production.

/** Bumped when a change to this contract is not backward compatible. */
export const PLATFORM_API_VERSION = 1;

/** Every desktop request carries its app version; the server may refuse one too old to talk to. */
export const CLIENT_VERSION_HEADER = 'x-maka-client-version';

/** The OAuth client id the desktop app signs in as. A public client: it holds no secret. */
export const DESKTOP_CLIENT_ID = 'maka-desktop';

/** Where a server describes itself, relative to its base URL. */
export const PLATFORM_METADATA_PATH = '/.well-known/maka-platform';

/** An identity provider people can sign in with; the desktop shows one button each. */
export interface PlatformIdentityProvider {
  readonly id: string;
  readonly displayName: string;
}

export interface PlatformMetadata {
  readonly apiVersion: number;
  /** In the order the sign-in screen should offer them. */
  readonly identityProviders: readonly PlatformIdentityProvider[];
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly revocationEndpoint: string;
  readonly jwksUri: string;
  /** Oldest desktop version the server still serves; absent when any version is accepted. */
  readonly minimumClientVersion?: string;
}

/** A successful `/oauth/token` answer, for either grant. */
export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: 'Bearer';
  /** Seconds until the access token expires. */
  readonly expires_in: number;
  readonly refresh_token: string;
  /** When this sign-in stops refreshing and the person must sign in again (epoch ms). */
  readonly refresh_expires_at: number;
  readonly session_id: string;
}

/** RFC 6749 §5.2. */
export interface OAuthErrorResponse {
  readonly error:
    | 'invalid_request'
    | 'invalid_client'
    | 'invalid_grant'
    | 'unauthorized_client'
    | 'unsupported_grant_type';
  readonly error_description?: string;
}

export type OrgRole = 'member' | 'org_admin';

/** `GET /v1/me`. */
export interface PlatformMe {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl?: string;
  readonly orgRole: OrgRole;
}

export type PlatformErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'upgrade_required'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'model_not_allowed'
  | 'upstream_unavailable';

/** The body of every non-OAuth error the server returns. */
export interface PlatformErrorBody {
  readonly error: {
    readonly code: PlatformErrorCode;
    readonly message: string;
    /** For `upgrade_required`: the oldest version the server accepts. */
    readonly minimumClientVersion?: string;
    /** For `quota_exceeded` and `rate_limited`: when to try again (epoch ms). */
    readonly retryAt?: number;
  };
}

/** The wire protocols the model gateway speaks, one path prefix each (design §5.1). */
export type GatewayProtocol = 'anthropic' | 'openai' | 'gemini';

export const GATEWAY_PATHS: Readonly<Record<GatewayProtocol, string>> = {
  anthropic: '/model/anthropic/v1',
  openai: '/model/openai/v1',
  gemini: '/model/gemini',
};

export const MODEL_CATALOG_PATH = '/model/catalog';

/** One model the signed-in person may use, in the shape Maka's model metadata expects. */
export interface PlatformModel {
  readonly id: string;
  readonly protocol: GatewayProtocol;
  readonly displayName: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly thinkingLevels?: readonly string[];
  readonly defaultThinkingLevel?: string;
  readonly inputModalities?: readonly string[];
  readonly supportsTools?: boolean;
  /** The vendor's own model id, for looking up anything the server does not say. */
  readonly referenceModelId?: string;
}

/** `GET /model/catalog`. */
export interface PlatformModelCatalog {
  readonly models: readonly PlatformModel[];
}

/**
 * Errors on the gateway paths keep each protocol's own error shape, so a
 * client library shows `error.message` as is; `maka` carries the reason.
 */
export interface GatewayErrorDetail {
  readonly code: PlatformErrorCode;
  readonly retryAt?: number;
}

/** Decode a token answer from the wire, refusing anything that is not one. */
export function decodeTokenResponse(value: unknown): TokenResponse {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid token response');
  const record = value as Record<string, unknown>;
  if (
    typeof record.access_token !== 'string' ||
    record.token_type !== 'Bearer' ||
    typeof record.expires_in !== 'number' ||
    typeof record.refresh_token !== 'string' ||
    typeof record.refresh_expires_at !== 'number' ||
    typeof record.session_id !== 'string'
  ) {
    throw new Error('Invalid token response');
  }
  return {
    access_token: record.access_token,
    token_type: 'Bearer',
    expires_in: record.expires_in,
    refresh_token: record.refresh_token,
    refresh_expires_at: record.refresh_expires_at,
    session_id: record.session_id,
  };
}

/** Whether `candidate` is at least `minimum`, comparing dotted numeric versions. */
export function versionAtLeast(candidate: string, minimum: string): boolean {
  const parse = (value: string) =>
    value
      .split(/[.+-]/)
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(candidate), parse(minimum)];
  for (let index = 0; index < 3; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}
