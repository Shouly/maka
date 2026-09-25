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
import { test } from 'node:test';
import type { ConnectionCatalogEntry } from '@maka/core/runtime-policy';
import {
  MODEL_INVENTORY_FACTS_SINCE,
  MODEL_INVENTORY_MAX_AGE_MS,
  staleModelInventories,
  startHostModelInventoryRefresh,
} from '../server/model-inventory-refresh.js';

const NOW = MODEL_INVENTORY_FACTS_SINCE + 10 * MODEL_INVENTORY_MAX_AGE_MS;

function connection(
  connectionId: string,
  overrides: Partial<ConnectionCatalogEntry> = {},
): ConnectionCatalogEntry {
  return {
    connectionId,
    revision: 1,
    slug: connectionId,
    name: connectionId,
    providerType: 'openai-codex',
    enabled: true,
    enabledModelIds: [],
    models: [],
    modelSource: 'fetched',
    modelsFetchedAt: NOW - 1_000,
    ...overrides,
  } as ConnectionCatalogEntry;
}

test('a fetched list is due once it is a day old or predates the facts discovery now keeps', () => {
  const due = staleModelInventories(
    {
      connections: [
        connection('fresh'),
        connection('day-old', { modelsFetchedAt: NOW - MODEL_INVENTORY_MAX_AGE_MS - 1 }),
        connection('pre-facts', { modelsFetchedAt: MODEL_INVENTORY_FACTS_SINCE - 1 }),
        connection('never', { modelsFetchedAt: undefined }),
        connection('fallback', { modelSource: 'fallback', modelsFetchedAt: 0 }),
        connection('disabled', { enabled: false, modelsFetchedAt: 0 }),
        // opencode-free has no discovery of its own; nothing to fetch.
        connection('no-discovery', { providerType: 'opencode-free', modelsFetchedAt: 0 }),
      ],
    },
    NOW,
  );
  // Oldest first, so the list most out of date refreshes first.
  assert.deepEqual(due, ['never', 'pre-facts', 'day-old']);
});

test('one pass fetches each due list in turn and logs how each ended', async () => {
  const fetched: string[] = [];
  const lines: string[] = [];
  const refresh = startHostModelInventoryRefresh({
    readCatalog: async () => ({
      connections: [
        connection('a', { modelsFetchedAt: 0 }),
        connection('b', { modelsFetchedAt: 1 }),
        connection('c', { modelsFetchedAt: 2 }),
      ],
    }),
    fetchModels: async (id) => {
      fetched.push(id);
      if (id === 'b') return { kind: 'failed', detail: 'auth' };
      if (id === 'c') throw new Error('socket hang up');
      return { kind: 'committed' };
    },
    now: () => NOW,
    firstCheckDelayMs: 60_000,
    log: (line) => lines.push(line),
  });
  await refresh.runOnce();
  assert.deepEqual(fetched, ['a', 'b', 'c']);
  // Every list is still stale (the fakes committed nothing), but each was
  // just tried: the next pass leaves them for a day instead of an hour.
  await refresh.runOnce();
  assert.deepEqual(fetched, ['a', 'b', 'c']);
  await refresh.close();

  assert.deepEqual(lines, [
    '[runtime-host] model list refreshed for connection a',
    '[runtime-host] model list refresh for connection b ended failed (auth)',
    '[runtime-host] model list refresh for connection c failed: socket hang up',
  ]);
});

test('passes do not overlap, and a closed refresh starts nothing new', async () => {
  let release: () => void = () => {};
  let calls = 0;
  const refresh = startHostModelInventoryRefresh({
    readCatalog: async () => ({
      connections: [
        connection('a', { modelsFetchedAt: 0 }),
        connection('b', { modelsFetchedAt: 1 }),
      ],
    }),
    fetchModels: async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { kind: 'committed' };
    },
    now: () => NOW,
    firstCheckDelayMs: 60_000,
    log: () => {},
  });
  const first = refresh.runOnce();
  const second = refresh.runOnce();
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  const closing = refresh.close();
  release();
  await closing;
  await first;
  // Closed while the first fetch was in flight: the second list was not started.
  assert.equal(calls, 1);
});
