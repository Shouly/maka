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

import { CONSOLE_CSRF_HEADER, type ConsoleSession } from '../../src/admin-console/types.js';
import { consoleLocale, getCopy } from './copy.js';

const text = getCopy(consoleLocale()).common;

export class ConsoleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ConsoleApiError';
  }
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
    const message =
      (payload as { error?: { message?: string } } | undefined)?.error?.message ??
      text.requestFailed(response.status);
    throw new ConsoleApiError(response.status, message);
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
  delete: <T>(path: string) => call<T>('DELETE', path),
};

/** A path segment: model ids carry slashes. */
export const segment = (value: string) => encodeURIComponent(value);
