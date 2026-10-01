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

// The organisation connection follows the account (design §5.3): the first
// sign-in makes it, each sign-in points it at the account's server and reads
// the server's catalog again, and it becomes the default model while the
// person has none of their own (or while theirs is an organisation model the
// organisation no longer offers). Signing out leaves it where it is: the
// Sessions on it keep their model and ask for a sign-in when sent.
//
// While signed in, the catalog is read again every few minutes, and sooner
// when the app comes to the front or Settings reads the models and the last
// read is more than half a minute old. A synchronization that fails (the
// server did not answer, another write moved the catalog first) is tried
// again after a growing delay, and nothing else hurries it; until one lands,
// the last catalog read stays.

import type {
  ConnectionCatalogEntry,
  ConnectionCatalogSnapshot,
} from '@maka/core/runtime-policy';
import type { OrgAccountState } from '../../shared/org-account.js';
import type { DesktopRuntimeHostClient } from '../runtime-host-client.js';

const ORGANIZATION_PROVIDER = 'organization';

export type OrganizationConnectionClient = Pick<
  DesktopRuntimeHostClient,
  | 'createConnection'
  | 'fetchConnectionModels'
  | 'loadConnectionCatalog'
  | 'setDefaultConnectionTarget'
  | 'updateConnection'
>;

export async function synchronizeOrganizationConnection(
  client: OrganizationConnectionClient,
  serverUrl: string,
): Promise<void> {
  const catalog = await client.loadConnectionCatalog();
  const existing = organizationConnection(catalog);
  if (!existing) {
    const created = await client.createConnection(catalog.revision, {
      slug: freeSlug(catalog),
      name: serverName(serverUrl),
      providerType: ORGANIZATION_PROVIDER,
      baseUrl: serverUrl,
      enabled: true,
      enabledModelIds: [],
    });
    if (created.kind !== 'committed') {
      throw new Error(`Unable to create the organization connection: ${created.kind}`);
    }
  } else if (!sameServer(existing.baseUrl, serverUrl)) {
    // Signed in to another server: none of the old one's models are offered
    // there, and the read below lists what is.
    const moved = await client.updateConnection(
      { connectionId: existing.connectionId, revision: existing.revision },
      {
        name: serverName(serverUrl),
        baseUrl: serverUrl,
        enabled: existing.enabled,
        enabledModelIds: [],
      },
    );
    if (moved.kind !== 'committed') {
      throw new Error(`Unable to move the organization connection: ${moved.kind}`);
    }
  }
  const connection = organizationConnection(await client.loadConnectionCatalog());
  if (!connection) throw new Error('The organization connection is missing');
  // A catalog that could not be read fails the synchronization, to be tried
  // again; the sign-in itself stands either way.
  const fetched = await client.fetchConnectionModels(connection.connectionId);
  if (fetched.kind !== 'committed') {
    throw new Error(`Unable to read the organization catalog: ${fetched.kind}`);
  }
  const current = await client.loadConnectionCatalog();
  const latest = organizationConnection(current);
  if (!latest) return;
  // A model whose provider the organisation switched off is listed, not callable.
  const callable = (id: string) =>
    latest.enabledModelIds.includes(id) &&
    latest.models.find((model) => model.id === id)?.availability === 'available';
  const target = current.defaultTarget;
  // The person's own default stays; so does an organisation model that can
  // still be called. One the organisation withdrew or switched off gives way.
  if (
    target !== null &&
    (target.connectionId !== latest.connectionId || callable(target.modelId))
  ) {
    return;
  }
  const modelId = latest.enabledModelIds.find(callable);
  if (!modelId) return;
  const selected = await client.setDefaultConnectionTarget(current.revision, {
    connectionId: latest.connectionId,
    modelId,
  });
  if (selected.kind !== 'committed') {
    throw new Error(`Unable to make the organization model the default: ${selected.kind}`);
  }
}

/** How long a failed synchronization waits before each further try; the last repeats. */
const SYNC_RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000] as const;
/** How often a signed-in account's catalog is read again. */
const SYNC_INTERVAL_MS = 5 * 60_000;
/** A catalog read more recently than this is not read again on request. */
const SYNC_FRESH_MS = 30_000;

export interface OrganizationAccountFollowing {
  /**
   * Read the catalog again now (the app came to the front, Settings is
   * reading the models), unless the account is signed out, a read is under
   * way or a failed one is waiting out its delay, or the last read is still
   * fresh. The waiting is the failure's: a request does not cut it short.
   */
  refresh(): void;
  stop(): void;
}

/**
 * Run `synchronizeOrganizationConnection` for each sign-in the account sees,
 * the one it starts with included, then every `refreshIntervalMs` while that
 * sign-in lasts, one at a time. A failed one is tried again after each of
 * `retryDelaysMs` in turn, the last repeating.
 */
export function followOrganizationAccount(input: {
  readonly account: {
    state(): OrgAccountState;
    subscribe(listener: (state: OrgAccountState) => void): () => void;
  };
  readonly client: OrganizationConnectionClient;
  readonly onError: (error: unknown) => void;
  readonly retryDelaysMs?: readonly number[];
  readonly refreshIntervalMs?: number;
  readonly now?: () => number;
}): OrganizationAccountFollowing {
  const delays = input.retryDelaysMs ?? SYNC_RETRY_DELAYS_MS;
  const now = input.now ?? Date.now;
  // The sign-in being synchronized, until it is replaced or ends.
  let current: { readonly key: string; readonly serverUrl: string } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  // One synchronization at a time, whoever asked for it.
  let running = false;
  // Failed tries since the last one that landed: while there are any, the
  // pending timer is a retry, and only it tries again.
  let failures = 0;
  let syncedAt = Number.NEGATIVE_INFINITY;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(attempt, delay);
  };
  const synchronize = async (signIn: NonNullable<typeof current>) => {
    try {
      await synchronizeOrganizationConnection(input.client, signIn.serverUrl);
      if (stopped || current !== signIn) return;
      failures = 0;
      syncedAt = now();
      schedule(input.refreshIntervalMs ?? SYNC_INTERVAL_MS);
    } catch (error) {
      input.onError(error);
      if (stopped || current !== signIn) return;
      schedule(delays[Math.min(failures, delays.length - 1)] ?? SYNC_INTERVAL_MS);
      failures += 1;
    }
  };
  function attempt(): void {
    const signIn = current;
    if (stopped || !signIn || running) return;
    running = true;
    clearTimeout(timer);
    void synchronize(signIn).finally(() => {
      running = false;
      // A sign-in that came while another was being synchronized goes next.
      if (current !== signIn) attempt();
    });
  }
  const follow = (state: OrgAccountState) => {
    // A sign-in is its server and its expiry; a profile change is neither.
    const key =
      state.status === 'signed_in' ? `${state.serverUrl}\0${state.signInExpiresAt}` : undefined;
    if (key === current?.key) return;
    clearTimeout(timer);
    failures = 0;
    syncedAt = Number.NEGATIVE_INFINITY;
    current =
      key !== undefined && state.status === 'signed_in'
        ? { key, serverUrl: state.serverUrl }
        : undefined;
    attempt();
  };
  const unsubscribe = input.account.subscribe(follow);
  follow(input.account.state());
  return {
    refresh() {
      if (failures > 0 || now() - syncedAt < SYNC_FRESH_MS) return;
      attempt();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
    },
  };
}

function organizationConnection(
  catalog: ConnectionCatalogSnapshot,
): ConnectionCatalogEntry | undefined {
  return catalog.connections.find(({ providerType }) => providerType === ORGANIZATION_PROVIDER);
}

/** `organization`, or the first free variant when the person already named one so. */
function freeSlug(catalog: ConnectionCatalogSnapshot): string {
  const taken = new Set(catalog.connections.map(({ slug }) => slug));
  if (!taken.has(ORGANIZATION_PROVIDER)) return ORGANIZATION_PROVIDER;
  for (let index = 2; ; index += 1) {
    const slug = `${ORGANIZATION_PROVIDER}-${index}`;
    if (!taken.has(slug)) return slug;
  }
}

/** The connection is named after the server, which is what tells two apart. */
function serverName(serverUrl: string): string {
  return new URL(serverUrl).host;
}

function sameServer(left: string | undefined, right: string): boolean {
  if (!left) return false;
  const key = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  };
  return key(left) === key(right);
}
