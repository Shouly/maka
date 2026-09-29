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

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConnectionTarget } from '@maka/core/runtime-policy';
import type {
  RuntimeHostConnectionCatalogEntry as ConnectionCatalogEntry,
  RuntimeHostConnectionCatalogSnapshot as ConnectionCatalogSnapshot,
} from '@maka/runtime-host/client';
import {
  followOrganizationAccount,
  synchronizeOrganizationConnection,
  type OrganizationConnectionClient,
} from '../org-account/org-account-connection.js';
import type { OrgAccountState } from '../../shared/org-account.js';

const SERVER = 'https://maka.example.com';

/** A Host catalog in memory, whose model fetch lists `models` for the organisation. */
function hostCatalog(initial: Partial<ConnectionCatalogSnapshot> = {}) {
  let catalog: ConnectionCatalogSnapshot = {
    revision: 1,
    defaultTarget: null,
    connections: [],
    ...initial,
  };
  const calls: string[] = [];
  let models = ['claude-a', 'claude-b'];
  // What the next fetches answer, before falling back to a commit.
  const fetchOutcomes: Array<'failed' | 'throw'> = [];
  const commit = (next: Partial<ConnectionCatalogSnapshot>) => {
    catalog = { ...catalog, ...next, revision: catalog.revision + 1 };
    return { kind: 'committed' as const, catalogRevision: catalog.revision };
  };
  const client = {
    loadConnectionCatalog: async () => catalog,
    createConnection: async (revision: number, draft: Record<string, unknown>) => {
      calls.push('create');
      assert.equal(revision, catalog.revision);
      const entry = {
        ...draft,
        connectionId: '00000000-0000-4000-8000-0000000000b1',
        revision: 1,
        catalogEntries: [],
        models: [],
        modelSource: 'fallback',
      } as unknown as ConnectionCatalogEntry;
      return commit({ connections: [...catalog.connections, entry] });
    },
    updateConnection: async (
      expected: { connectionId: string; revision: number },
      changes: Record<string, unknown>,
    ) => {
      calls.push('update');
      const entry = catalog.connections.find(
        ({ connectionId }) => connectionId === expected.connectionId,
      );
      assert.equal(expected.revision, entry?.revision, 'written against the revision it read');
      return commit({
        connections: catalog.connections.map((entry) =>
          entry.connectionId === expected.connectionId
            ? ({ ...entry, ...changes, revision: entry.revision + 1 } as ConnectionCatalogEntry)
            : entry,
        ),
      });
    },
    fetchConnectionModels: async (connectionId: string) => {
      calls.push('fetch');
      const outcome = fetchOutcomes.shift();
      if (outcome === 'throw') throw new Error('Host unavailable');
      if (outcome === 'failed') return { kind: 'failed', errorClass: 'network' };
      const result = commit({
        connections: catalog.connections.map((entry) =>
          entry.connectionId === connectionId
            ? ({
                ...entry,
                models: models.map((id) => ({ id })),
                enabledModelIds: [...models],
              } as ConnectionCatalogEntry)
            : entry,
        ),
      });
      return { ...result, modelCount: models.length };
    },
    setDefaultConnectionTarget: async (revision: number, target: ConnectionTarget | null) => {
      calls.push('default');
      assert.equal(revision, catalog.revision);
      return commit({ defaultTarget: target });
    },
  } as unknown as OrganizationConnectionClient;
  return {
    client,
    calls,
    catalog: () => catalog,
    list(next: string[]) {
      models = next;
    },
    failNextFetches(...outcomes: Array<'failed' | 'throw'>) {
      fetchOutcomes.push(...outcomes);
    },
  };
}

const organization = (catalog: ConnectionCatalogSnapshot) =>
  catalog.connections.find(({ providerType }) => providerType === 'organization');

describe('synchronizeOrganizationConnection', () => {
  it('makes the connection on the first sign-in, reads the catalog, and takes the empty default', async () => {
    const host = hostCatalog();
    await synchronizeOrganizationConnection(host.client, SERVER);
    const made = organization(host.catalog());
    assert.ok(made);
    assert.equal(made.slug, 'organization');
    assert.equal(made.name, 'maka.example.com');
    assert.equal(made.baseUrl, SERVER);
    assert.deepEqual(made.enabledModelIds, ['claude-a', 'claude-b']);
    assert.deepEqual(host.catalog().defaultTarget, {
      connectionId: made.connectionId,
      modelId: 'claude-a',
    });
    assert.deepEqual(host.calls, ['create', 'fetch', 'default']);
  });

  it("leaves the person's own default where it is", async () => {
    const own: ConnectionTarget = {
      connectionId: '00000000-0000-4000-8000-0000000000c1',
      modelId: 'gpt-5',
    };
    const host = hostCatalog({ defaultTarget: own });
    await synchronizeOrganizationConnection(host.client, SERVER);
    assert.deepEqual(host.catalog().defaultTarget, own);
    assert.equal(host.calls.includes('default'), false);
  });

  it('reads the catalog again on a later sign-in without making a second connection', async () => {
    const host = hostCatalog();
    await synchronizeOrganizationConnection(host.client, SERVER);
    host.list(['claude-a', 'claude-b', 'claude-c']);
    await synchronizeOrganizationConnection(host.client, `${SERVER}/`);
    assert.equal(host.catalog().connections.length, 1);
    assert.deepEqual(organization(host.catalog())?.enabledModelIds, [
      'claude-a',
      'claude-b',
      'claude-c',
    ]);
    assert.deepEqual(host.calls, ['create', 'fetch', 'default', 'fetch']);
  });

  it("follows the account to another server, whose catalog replaces the old one's", async () => {
    const host = hostCatalog();
    await synchronizeOrganizationConnection(host.client, SERVER);
    host.list(['claude-z']);
    // The other server cannot answer yet: none of the old server's models stay behind.
    host.failNextFetches('failed');
    await assert.rejects(
      synchronizeOrganizationConnection(host.client, 'https://other.example.com'),
      /catalog/,
    );
    const moved = organization(host.catalog());
    assert.equal(moved?.baseUrl, 'https://other.example.com');
    assert.equal(moved?.name, 'other.example.com');
    assert.deepEqual(moved?.enabledModelIds, []);
    await synchronizeOrganizationConnection(host.client, 'https://other.example.com');
    assert.deepEqual(organization(host.catalog())?.enabledModelIds, ['claude-z']);
    assert.equal(host.calls.filter((call) => call === 'update').length, 1);
  });

  it('keeps clear of a slug the person already uses', async () => {
    const host = hostCatalog({
      connections: [
        {
          connectionId: '00000000-0000-4000-8000-0000000000c1',
          revision: 1,
          slug: 'organization',
          name: 'Mine',
          providerType: 'openai',
          enabled: true,
          enabledModelIds: ['gpt-5'],
          catalogEntries: [],
          models: [{ id: 'gpt-5' }],
          modelSource: 'fetched',
        } as unknown as ConnectionCatalogEntry,
      ],
    });
    await synchronizeOrganizationConnection(host.client, SERVER);
    assert.equal(organization(host.catalog())?.slug, 'organization-2');
  });
});

describe('followOrganizationAccount', () => {
  const signedIn = (serverUrl: string, signInExpiresAt: number): OrgAccountState => ({
    enforced: true,
    status: 'signed_in',
    serverUrl,
    signInExpiresAt,
    remembered: true,
    profile: {} as never,
  });

  it('syncs once per sign-in: at start, on a new sign-in, never on a profile change or sign-out', async () => {
    const host = hostCatalog();
    let listener: ((state: OrgAccountState) => void) | undefined;
    let state = signedIn(SERVER, 100);
    const errors: unknown[] = [];
    const stop = followOrganizationAccount({
      account: {
        state: () => state,
        subscribe: (next) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
      },
      client: host.client,
      onError: (error) => errors.push(error),
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    assert.deepEqual(host.calls, ['create', 'fetch', 'default']);

    // A profile edit repeats the same sign-in.
    listener?.(signedIn(SERVER, 100));
    state = { enforced: true, status: 'signed_out', serverUrl: SERVER };
    listener?.(state);
    await settle();
    assert.deepEqual(host.calls, ['create', 'fetch', 'default']);

    // Signing in again reads the catalog again.
    listener?.(signedIn(SERVER, 200));
    await settle();
    assert.deepEqual(host.calls, ['create', 'fetch', 'default', 'fetch']);
    assert.deepEqual(errors, []);

    stop();
    assert.equal(listener, undefined);
  });

  it('tries a failed synchronization again while the sign-in lasts', async () => {
    const host = hostCatalog();
    host.failNextFetches('throw', 'failed');
    const errors: unknown[] = [];
    const stop = followOrganizationAccount({
      account: { state: () => signedIn(SERVER, 100), subscribe: () => () => undefined },
      client: host.client,
      onError: (error) => errors.push(error),
      retryDelaysMs: [0, 0],
    });
    for (let turn = 0; turn < 20 && errors.length < 2; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(errors.length, 2);
    assert.deepEqual(organization(host.catalog())?.enabledModelIds, ['claude-a', 'claude-b']);
    assert.deepEqual(host.calls, ['create', 'fetch', 'fetch', 'fetch', 'default']);
    stop();
  });
});
