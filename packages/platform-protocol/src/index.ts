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

/** `GET /v1/me`, and the answer to `PATCH /v1/me`. */
export interface PlatformMe {
  readonly id: string;
  readonly email: string;
  /** The name the person set for themselves, else the identity provider's. */
  readonly name: string;
  readonly avatarUrl?: string;
  /** The seed of the generated avatar the person picked; absent means their initials. */
  readonly avatarSeed?: string;
  /** What they asked to be called; absent when they have not said. */
  readonly nickname?: string;
  /** Their personal preferences for the assistant, as they wrote them; absent when empty. */
  readonly preferences?: string;
  readonly orgRole: OrgRole;
}

/**
 * `PATCH /v1/me`: what a person may change about their own profile. Absent
 * fields are left alone.
 */
export interface PlatformProfileUpdate {
  /** Their full name, trimmed; an empty string goes back to the identity provider's. */
  readonly name?: string;
  /** A generated avatar's seed; `null` goes back to their initials. */
  readonly avatarSeed?: string | null;
  /** What to call them, trimmed; an empty string clears it. */
  readonly nickname?: string;
  /** Their personal preferences, trimmed; an empty string clears them. */
  readonly preferences?: string;
}

export const PROFILE_NAME_MAX_LENGTH = 80;
export const AVATAR_SEED_MAX_LENGTH = 64;
export const NICKNAME_MAX_LENGTH = 60;
export const PREFERENCES_MAX_LENGTH = 2000;

export type PlatformErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'invalid_request'
  | 'upgrade_required'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'model_not_allowed'
  | 'upstream_unavailable'
  /** The organization has no web access: not set up, switched off, its key refused or its plan used up. */
  | 'web_access_unavailable'
  /** The web service could not read that page. */
  | 'web_fetch_failed';

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

export type { ModelApiProtocol, ModelExecutionContract } from '@maka/core/model-gateway';
import type { ModelApiProtocol, ModelExecutionContract } from '@maka/core/model-gateway';
// The model gateway forwards each request in the protocol the desktop's SDK
// spoke and returns the provider's answer as it came, errors included. Only
// its own refusals (sign-in, model, allowance, version) are its words, and
// they carry GATEWAY_ERROR_HEADER so a client can tell them from the
// provider's.
export const GATEWAY_SCHEMA_VERSION = 1;
export const GATEWAY_VERSION_HEADER = 'x-maka-gateway-version';
/** The organization model (`m_…`) a request is for; the body names the provider's model. */
export const GATEWAY_MODEL_HEADER = 'x-maka-model-id';
/** On the gateway's own refusals only: its `PlatformErrorCode`. */
export const GATEWAY_ERROR_HEADER = 'x-maka-error';
export const GATEWAY_PATHS: Readonly<Record<ModelApiProtocol, string>> = {
  'anthropic-messages': '/model/anthropic/v1',
  'openai-chat': '/model/openai/v1',
  'openai-responses': '/model/openai/v1',
  'google-generate': '/model/gemini/v1beta',
};
export const MODEL_CATALOG_PATH = '/model/catalog';
export interface PlatformModel {
  readonly id: string;
  readonly displayName: string;
  readonly contract: ModelExecutionContract;
  /** `provider_disabled`: listed so a conversation keeps its name, but not callable. */
  readonly availability: 'available' | 'provider_disabled';
}
export interface PlatformModelCatalog {
  readonly schemaVersion: typeof GATEWAY_SCHEMA_VERSION;
  readonly revision: string;
  readonly models: readonly PlatformModel[];
}

// Web search: the desktop's WebSearch tool asks the server, which holds the
// organization's web service key. Refusals are PlatformErrorBody.
export const WEB_SEARCH_PATH = '/tools/web-search';
export const WEB_SEARCH_QUERY_MAX_LENGTH = 200;
export const WEB_SEARCH_DOMAINS_MAX = 20;
export const WEB_SEARCH_LIMIT_MAX = 10;
/** `POST /tools/web-search`. */
export interface PlatformWebSearchRequest {
  readonly query: string;
  /** How many results, 1 to WEB_SEARCH_LIMIT_MAX; 5 when absent. */
  readonly limit?: number;
  /** Only results from these domains. */
  readonly allowedDomains?: readonly string[];
  /** No results from these domains. */
  readonly blockedDomains?: readonly string[];
}
export interface PlatformWebSearchResult {
  readonly title: string;
  readonly url: string;
  /** What the page says about the query; may be empty. */
  readonly snippet: string;
}
export interface PlatformWebSearchResponse {
  readonly results: readonly PlatformWebSearchResult[];
}

// Web fetch: the desktop's WebFetch tool reads a page through the same
// service and key, and hands the page to the model as it came.
export const WEB_FETCH_PATH = '/tools/web-fetch';
export const WEB_FETCH_URL_MAX_LENGTH = 2048;
export const WEB_FETCH_CONTENT_MAX_LENGTH = 200_000;
/** `POST /tools/web-fetch`: one http(s) page. */
export interface PlatformWebFetchRequest {
  readonly url: string;
}
export interface PlatformWebFetchResponse {
  /** The page that was read, as the service names it. */
  readonly url: string;
  /** The page as markdown, cut to WEB_FETCH_CONTENT_MAX_LENGTH characters. */
  readonly content: string;
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
