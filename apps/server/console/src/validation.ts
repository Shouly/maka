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

// What the server accepts in a provider's settings and a model's, checked
// before sending so the reason shows on the field instead of coming back as a
// refused request. The rules are the server's own; keep them in step.

export const PROVIDER_NAME_MAX = 100;
export const DISPLAY_NAME_MAX = 150;
export const API_KEY_MAX = 16384;
export const COST_WEIGHT_MAX = 10000;
export const SORT_ORDER_MAX = 100000;

/** A Google Cloud project id, optionally under a domain (`example.com:my-project`). */
const VERTEX_PROJECT = /^(?:[a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const VERTEX_REGION = /^[a-z0-9-]{2,40}$/;
/** The server's email rule, for a service account's client_email. */
const EMAIL =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

export function isVertexProject(value: string): boolean {
  return VERTEX_PROJECT.test(value);
}

export function isVertexRegion(value: string): boolean {
  return VERTEX_REGION.test(value);
}

/** An API address: http(s), with no user or password in it, no query and no fragment. */
export function isApiAddress(value: string): boolean {
  if (value.includes('?') || value.includes('#')) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.username === '' &&
    url.password === ''
  );
}

/** A service account key file: JSON of `type: "service_account"` with its email and private key. */
export function parseServiceAccount(value: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const account = parsed as Record<string, unknown>;
  const present = (key: string) => typeof account[key] === 'string' && account[key] !== '';
  const optional = (key: string) => account[key] === undefined || typeof account[key] === 'string';
  return account.type === 'service_account' &&
    present('client_email') &&
    EMAIL.test(account.client_email as string) &&
    present('private_key') &&
    optional('private_key_id') &&
    optional('project_id') &&
    optional('client_id')
    ? account
    : undefined;
}

export function isProviderName(value: string): boolean {
  return value.length <= PROVIDER_NAME_MAX;
}

export function isDisplayName(value: string): boolean {
  return value.length <= DISPLAY_NAME_MAX;
}

export function isApiKey(value: string): boolean {
  return value.length <= API_KEY_MAX;
}

/** A search service key is printable ASCII without spaces, as the server checks. */
export function isSearchKey(value: string): boolean {
  return /^[\x21-\x7E]+$/.test(value);
}

export function isCostWeight(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= COST_WEIGHT_MAX;
}

export function isSortOrder(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= SORT_ORDER_MAX;
}
