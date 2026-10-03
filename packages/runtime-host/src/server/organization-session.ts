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

// The Host's side of the organisation account (design §5.3). The desktop app
// owns the account and refreshes its token; the Host asks for one when a model
// call or a catalog read goes to the organisation server, and sends it only to
// the server it is for.

import {
  createOrganizationModelFetch,
  OrganizationAccountUnavailableError,
  type OrganizationAccessToken,
} from '@maka/runtime/organization-model-fetch';
import type { OrganizationAccount } from '@maka/runtime/organization-web';
import {
  decodeOrganizationAccountTokenResult,
  ORGANIZATION_ACCOUNT_SERVICE_ID,
  ORGANIZATION_ACCOUNT_SERVICE_VERSION,
  ORGANIZATION_ACCOUNT_TOKEN_METHOD,
} from '../protocol/organization-account.js';
import { ClientCapabilityInvocationError } from './client-capability-invocation-broker.js';

export interface HostOrganizationSession {
  /** A token the server at `serverUrl` accepts now. */
  accessToken(
    serverUrl: string,
    options?: { readonly forceRefresh?: boolean; readonly signal?: AbortSignal | null },
  ): Promise<OrganizationAccessToken>;
  /** Whichever server the person is signed in to, with a token it accepts now. */
  account(options?: {
    readonly forceRefresh?: boolean;
    readonly signal?: AbortSignal | null;
  }): Promise<OrganizationAccount>;
}

/** Ask the desktop app for the account's token, through its workspace service. */
export type OrganizationAccountServiceCall = (request: {
  readonly serviceId: string;
  readonly version: string;
  readonly method: string;
  readonly input: Record<string, unknown>;
  readonly signal?: AbortSignal;
}) => Promise<Record<string, unknown>>;

/**
 * The Host keeps no token of its own: the app caches the account's, refreshes
 * it, and drops it the moment the person signs out or signs in as someone
 * else, so asking each time is what keeps a request from carrying the last
 * person's token. Callers that ask at the same moment share one question,
 * which is why that question carries no caller's signal: one of them stopping
 * must not fail the others. Each stops waiting on its own signal instead.
 */
export function createHostOrganizationSession(input: {
  call: OrganizationAccountServiceCall;
}): HostOrganizationSession {
  let shared: Promise<OrganizationAccessToken & { serverUrl: string }> | undefined;

  const ask = async (forceRefresh: boolean, signal?: AbortSignal | null) => {
    let answer: Record<string, unknown>;
    try {
      answer = await input.call({
        serviceId: ORGANIZATION_ACCOUNT_SERVICE_ID,
        version: ORGANIZATION_ACCOUNT_SERVICE_VERSION,
        method: ORGANIZATION_ACCOUNT_TOKEN_METHOD,
        input: { forceRefresh },
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof ClientCapabilityInvocationError && error.code === 'capability_lost') {
        throw new OrganizationAccountUnavailableError('not_offered', { cause: error });
      }
      throw error;
    }
    const result = decodeOrganizationAccountTokenResult(answer);
    if (result.kind === 'unavailable') throw new OrganizationAccountUnavailableError(result.reason);
    return {
      accessToken: result.accessToken,
      clientVersion: result.clientVersion,
      serverUrl: serverKey(result.serverUrl),
    };
  };

  const current = (options: {
    readonly forceRefresh?: boolean;
    readonly signal?: AbortSignal | null;
  }) =>
    untilAborted(
      // A forced refresh is the one caller's own question, so it is theirs to stop.
      options.forceRefresh
        ? ask(true, options.signal)
        : (shared ??= ask(false).finally(() => {
            shared = undefined;
          })),
      options.signal,
    );

  return {
    async accessToken(serverUrl, options = {}) {
      const token = await current(options);
      if (token.serverUrl !== serverKey(serverUrl)) {
        throw new OrganizationAccountUnavailableError('server_mismatch');
      }
      return { accessToken: token.accessToken, clientVersion: token.clientVersion };
    },
    account: (options = {}) => current(options),
  };
}

/** Sign a Runtime model request for the organisation server at `serverUrl`. */
export function createHostOrganizationModelFetch(input: {
  session: HostOrganizationSession;
  serverUrl: string;
  fetchFn: typeof fetch;
}): typeof fetch {
  return createOrganizationModelFetch({
    token: ({ forceRefresh, signal }) =>
      input.session.accessToken(input.serverUrl, { forceRefresh, signal }),
    fetchFn: input.fetchFn,
  });
}

/** `answer`, or the signal's reason once it aborts; the answer itself runs on. */
function untilAborted<T>(answer: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return answer;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    void answer.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Two spellings of one server compare equal: origin and path, no trailing slash. */
function serverKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}
