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

// The console's calls to /admin/api. The cookie rides along on its own; every
// change also carries the session's CSRF token. A 401 means the session is
// over, and the page goes back to sign in. A 403 means the token is not the
// cookie's any more (this browser signed in again in another tab): the
// session is read again and the change sent once more, or, if someone else
// signed in, the page starts over as them.

import {
  CONSOLE_CSRF_HEADER,
  type ConsoleErrorCode,
  type ConsoleSession,
} from '../../src/admin-console/types.js';
import { consoleLocale, getCopy } from './copy.js';

const text = getCopy(consoleLocale()).common;

const ERROR_CODES: ReadonlySet<string> = new Set<ConsoleErrorCode>([
  'invalid_request',
  'not_found',
  'revision_conflict',
  'catalog_expired',
  'credentials_rejected',
  'provider_in_use',
  'name_taken',
  'idempotency_conflict',
]);

/**
 * A call that did not go through. `code` is why, where the server said; the
 * message is the server's own words (English), or the page's when the server
 * was not reached — the page says it in its own words from the code.
 */
export class ConsoleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: ConsoleErrorCode,
  ) {
    super(message);
    this.name = 'ConsoleApiError';
  }
}

/** Why a call was refused, when the server said. */
export function errorCode(error: unknown): ConsoleErrorCode | undefined {
  return error instanceof ConsoleApiError ? error.code : undefined;
}

/**
 * Someone changed it in the meantime: what the page shows is old, and the
 * change goes again once it is read afresh.
 */
export function isStale(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'revision_conflict' || code === 'catalog_expired' || code === 'not_found';
}

/**
 * The answer never came (the network, or a proxy in front of the server): the
 * change may have been made, so a retry of the same change sends the same
 * idempotency key.
 */
export function answerLost(error: unknown): boolean {
  return error instanceof ConsoleApiError && (error.status === 0 || error.status >= 500);
}

/**
 * A key for one save attempt: an RFC 4122 version 4 UUID, which the server
 * checks. A page served over plain http has no `randomUUID`, so the same is
 * built from random bytes there.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let csrfToken: string | undefined;
let signedInAs: string | undefined;

function signInAgain(): never {
  const next = window.location.pathname;
  window.location.assign(`/admin/login?next=${encodeURIComponent(next)}`);
  throw new ConsoleApiError(401, 'Signed out');
}

async function call<T>(method: string, path: string, body?: unknown, again = false): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') {
    if (csrfToken) headers[CONSOLE_CSRF_HEADER] = csrfToken;
    headers['content-type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(`/admin/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch {
    throw new ConsoleApiError(0, text.unreachable);
  }
  if (response.status === 401) signInAgain();
  if (response.status === 403 && method !== 'GET' && !again) {
    const before = signedInAs;
    const session = await loadSession();
    if (session.user.id !== before) {
      window.location.reload();
      throw new ConsoleApiError(403, text.consoleUnavailable);
    }
    return call<T>(method, path, body, true);
  }
  const raw = await response.text();
  let payload: unknown;
  try {
    payload = raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    // Not the API's answer (a proxy's error page): only the status says anything.
    payload = undefined;
  }
  if (!response.ok) {
    const failure = (payload as { error?: { message?: unknown; code?: unknown } } | undefined)
      ?.error;
    const message =
      typeof failure?.message === 'string' ? failure.message : text.requestFailed(response.status);
    const code =
      typeof failure?.code === 'string' && ERROR_CODES.has(failure.code)
        ? (failure.code as ConsoleErrorCode)
        : undefined;
    throw new ConsoleApiError(response.status, message, code);
  }
  return payload as T;
}

export async function loadSession(): Promise<ConsoleSession> {
  const session = await call<ConsoleSession>('GET', '/session');
  csrfToken = session.csrfToken;
  signedInAs = session.user.id;
  return session;
}

export async function signOut(): Promise<void> {
  await call('POST', '/session/sign-out');
  window.location.assign('/admin/login');
}

export const api = {
  get: <T>(path: string) => call<T>('GET', path),
  post: <T>(path: string, body?: unknown) => call<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => call<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => call<T>('PATCH', path, body),
  delete: <T>(path: string, body?: unknown) => call<T>('DELETE', path, body),
};

/** A path segment: model ids carry slashes. */
export const segment = (value: string) => encodeURIComponent(value);
