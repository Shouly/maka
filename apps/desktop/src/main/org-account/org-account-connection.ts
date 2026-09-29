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
// person has none of their own. Signing out leaves it where it is: the
// Sessions on it keep their model and ask for a sign-in when sent.
//
// A sign-in whose synchronization fails (the server did not answer, another
// write moved the catalog first) is tried again a few times; until it lands,
// Settings says the models are still on their way.

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
  if (current.defaultTarget !== null) return;
  const latest = organizationConnection(current);
  const modelId = latest?.enabledModelIds[0];
  if (!latest || !modelId) return;
  const selected = await client.setDefaultConnectionTarget(current.revision, {
    connectionId: latest.connectionId,
    modelId,
  });
  if (selected.kind !== 'committed') {
    throw new Error(`Unable to make the organization model the default: ${selected.kind}`);
  }
}

/** How long a failed synchronization waits before each further try. */
const SYNC_RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000] as const;

/**
 * Run `synchronizeOrganizationConnection` for each sign-in the account sees,
 * the one it starts with included, one at a time, trying a failed one again
 * after each of `retryDelaysMs` while that sign-in lasts. Returns the stop.
 */
export function followOrganizationAccount(input: {
  readonly account: {
    state(): OrgAccountState;
    subscribe(listener: (state: OrgAccountState) => void): () => void;
  };
  readonly client: OrganizationConnectionClient;
  readonly onError: (error: unknown) => void;
  readonly retryDelaysMs?: readonly number[];
}): () => void {
  const delays = input.retryDelaysMs ?? SYNC_RETRY_DELAYS_MS;
  // The sign-in being synchronized, until it is replaced or ends.
  let current: string | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let queue = Promise.resolve();

  const attempt = (signIn: string, serverUrl: string, tries: number) => {
    queue = queue.then(async () => {
      if (stopped || current !== signIn) return;
      try {
        await synchronizeOrganizationConnection(input.client, serverUrl);
      } catch (error) {
        input.onError(error);
        const delay = delays[tries];
        if (delay === undefined || stopped || current !== signIn) return;
        retry = setTimeout(() => attempt(signIn, serverUrl, tries + 1), delay);
      }
    });
  };
  const follow = (state: OrgAccountState) => {
    // A sign-in is its server and its expiry; a profile change is neither.
    const signIn =
      state.status === 'signed_in' ? `${state.serverUrl}\0${state.signInExpiresAt}` : undefined;
    if (signIn === current) return;
    current = signIn;
    clearTimeout(retry);
    if (signIn !== undefined && state.status === 'signed_in') attempt(signIn, state.serverUrl, 0);
  };
  const unsubscribe = input.account.subscribe(follow);
  follow(input.account.state());
  return () => {
    stopped = true;
    clearTimeout(retry);
    unsubscribe();
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
