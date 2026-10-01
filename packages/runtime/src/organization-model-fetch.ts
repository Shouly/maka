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

import {
  CLIENT_VERSION_HEADER,
  GATEWAY_ERROR_HEADER,
  GATEWAY_MODEL_HEADER,
  GATEWAY_SCHEMA_VERSION,
  GATEWAY_VERSION_HEADER,
} from '@maka/platform-protocol';

/** Why no request can be signed for the organisation account right now. */
export type OrganizationAccountUnavailableReason =
  | 'signed_out'
  | 'sign_in_expired'
  | 'server_unreachable'
  | 'upgrade_required'
  /** No desktop app is connected to hand a token out (a CLI Host, a remote client). */
  | 'not_offered'
  /** The account is for another server than the connection's. */
  | 'server_mismatch';

/**
 * Raised where a token was needed and none could be had. Model-failure
 * classification recognises it by name along the cause chain, so the person
 * is told to sign in (or update) rather than that something went wrong.
 */
export class OrganizationAccountUnavailableError extends Error {
  readonly reason: OrganizationAccountUnavailableReason;

  constructor(reason: OrganizationAccountUnavailableReason, options?: ErrorOptions) {
    super(`The organization account cannot sign this request: ${reason}`, options);
    this.name = 'OrganizationAccountUnavailableError';
    this.reason = reason;
  }
}

/**
 * What the SDK is built with for an organisation connection. It wants a key
 * when the model is made; the account's token replaces it on every request,
 * and asking for that token then (not while the turn is set up) lets a
 * signed-out account fail the request as a model failure the person can read.
 */
export const ORGANIZATION_ACCOUNT_KEY_PLACEHOLDER = 'organization-account';

/** What signs one request to an organisation gateway. */
export interface OrganizationAccessToken {
  readonly accessToken: string;
  /** The app's version, which the gateway checks like any other request's. */
  readonly clientVersion: string;
}

/**
 * Sign each request to an organisation gateway with the account's current
 * access token, whatever key the SDK put on it, and the gateway version the
 * request is written for.
 *
 * A request the gateway itself refuses as unauthenticated (401 with
 * `x-maka-error: unauthenticated`) goes out once more with a refreshed token:
 * the token lives minutes and can lapse between two requests of one turn, and
 * the app refreshes it only when asked. A 401 without that header is the
 * provider's, about the organisation's own key, and a new token cannot change
 * it. A refresh that fails says more than the 401 it answers (the app must be
 * updated, the server is down), so its error is what the request fails with.
 * Anything else, including a second 401, goes back as it came.
 *
 * Redirects are not followed: the organisation's credential goes to its
 * server and nowhere else.
 */
export function createOrganizationModelFetch(input: {
  token(options: {
    readonly forceRefresh: boolean;
    readonly signal?: AbortSignal | null;
  }): Promise<OrganizationAccessToken>;
  fetchFn: typeof fetch;
}): typeof fetch {
  return async (url, init) => {
    const signal =
      init?.signal !== undefined ? init.signal : url instanceof Request ? url.signal : undefined;
    const send = (token: OrganizationAccessToken) =>
      input.fetchFn(url, {
        ...init,
        redirect: 'manual',
        headers: signed(url, init?.headers, token),
      });
    const first = await input.token({ forceRefresh: false, signal });
    const response = await send(first);
    if (
      response.status !== 401 ||
      response.headers.get(GATEWAY_ERROR_HEADER) !== 'unauthenticated' ||
      !replayable(url, init)
    )
      return response;
    let fresh: OrganizationAccessToken;
    try {
      fresh = await input.token({ forceRefresh: true, signal });
    } catch (error) {
      await response.body?.cancel();
      throw error;
    }
    if (fresh.accessToken === first.accessToken) return response;
    await response.body?.cancel();
    return send(fresh);
  };
}

/**
 * Name the organisation model (`m_…`) a request is for. The body the SDK
 * writes names the provider's own model; the gateway routes by this header.
 */
export function withOrganizationModel(
  fetchFn: typeof fetch,
  organizationModelId: string,
): typeof fetch {
  return (url, init) => {
    const headers = new Headers(url instanceof Request ? url.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    headers.set(GATEWAY_MODEL_HEADER, organizationModelId);
    return fetchFn(url, { ...init, headers });
  };
}

function signed(
  url: Parameters<typeof fetch>[0],
  initHeaders: HeadersInit | undefined,
  token: OrganizationAccessToken,
): Headers {
  const headers = new Headers(url instanceof Request ? url.headers : undefined);
  new Headers(initHeaders).forEach((value, name) => headers.set(name, value));
  // The SDKs name their key three ways; the gateway reads the bearer token.
  headers.delete('x-api-key');
  headers.delete('api-key');
  headers.delete('x-goog-api-key');
  headers.set('authorization', `Bearer ${token.accessToken}`);
  headers.set(CLIENT_VERSION_HEADER, token.clientVersion);
  headers.set(GATEWAY_VERSION_HEADER, String(GATEWAY_SCHEMA_VERSION));
  return headers;
}

/** A body read once cannot be sent again; the SDKs send strings. */
function replayable(url: Parameters<typeof fetch>[0], init: RequestInit | undefined): boolean {
  if (url instanceof Request && url.body !== null) return false;
  const body = init?.body;
  return body === undefined || body === null || typeof body === 'string';
}
