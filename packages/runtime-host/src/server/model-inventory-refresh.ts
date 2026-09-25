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

// Keeps discovered model lists fresh without the user pressing "refresh".
//
// A provider's own model list is the best source of what its models can do
// (the Codex backend names each model's reasoning levels and default), but it
// only reached the catalog when the user refreshed, tested or signed in. A
// list fetched weeks ago kept offering what was true then. This re-runs the
// same `connection.models.fetch` effect the Settings button runs, for every
// discovered list older than a day, one connection at a time.

import type { ConnectionCatalogSnapshot } from '@maka/core/runtime-policy';
import { providerSupportsModelDiscovery } from '@maka/core/llm-connections';
import { redactSecrets } from '@maka/core/redaction';

/** A discovered list older than this is fetched again. */
export const MODEL_INVENTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Lists fetched before this instant predate a fact discovery now stores (the
 * provider's reasoning levels, 2026-09-25), so they are stale regardless of
 * age. Move it forward whenever discovery starts keeping something new.
 */
export const MODEL_INVENTORY_FACTS_SINCE = Date.UTC(2026, 8, 25);

/** How often the Host looks for stale lists; each list still refreshes about daily. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Let startup finish before the first provider call. */
const FIRST_CHECK_DELAY_MS = 15 * 1000;

/** The connections whose discovered model list is due for a fetch, oldest first. */
export function staleModelInventories(
  snapshot: Pick<ConnectionCatalogSnapshot, 'connections'>,
  now: number,
): string[] {
  return snapshot.connections
    .filter(
      (connection) =>
        connection.enabled &&
        connection.modelSource === 'fetched' &&
        providerSupportsModelDiscovery(connection.providerType) &&
        isStale(connection.modelsFetchedAt ?? 0, now),
    )
    .sort((left, right) => (left.modelsFetchedAt ?? 0) - (right.modelsFetchedAt ?? 0))
    .map((connection) => connection.connectionId);
}

function isStale(fetchedAt: number, now: number): boolean {
  return fetchedAt < MODEL_INVENTORY_FACTS_SINCE || now - fetchedAt > MODEL_INVENTORY_MAX_AGE_MS;
}

export interface HostModelInventoryRefreshInput {
  readonly readCatalog: () => Promise<Pick<ConnectionCatalogSnapshot, 'connections'>>;
  /**
   * The `connection.models.fetch` effect, summarised: `committed` when a new
   * list landed, otherwise how it ended, for the log.
   */
  readonly fetchModels: (
    connectionId: string,
  ) => Promise<{ readonly kind: string; readonly detail?: string }>;
  readonly now?: () => number;
  readonly firstCheckDelayMs?: number;
  readonly checkIntervalMs?: number;
  readonly log?: (line: string) => void;
}

export interface HostModelInventoryRefresh {
  /** Run one pass now; resolves when every due list has been tried. */
  runOnce(): Promise<void>;
  close(): Promise<void>;
}

export function startHostModelInventoryRefresh(
  input: HostModelInventoryRefreshInput,
): HostModelInventoryRefresh {
  const now = input.now ?? Date.now;
  const log = input.log ?? ((line: string) => console.error(line));
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  // When this process last tried each connection, whatever the outcome. A
  // fetch that fails leaves `modelsFetchedAt` where it was, so without this a
  // connection that needs signing in again would be retried every hour.
  const attemptedAt = new Map<string, number>();

  const pass = async (): Promise<void> => {
    let due: string[];
    try {
      const at = now();
      due = staleModelInventories(await input.readCatalog(), at).filter(
        (connectionId) =>
          at - (attemptedAt.get(connectionId) ?? -Infinity) >= MODEL_INVENTORY_MAX_AGE_MS,
      );
    } catch (error) {
      log(`[runtime-host] model list refresh could not read the catalog: ${describe(error)}`);
      return;
    }
    for (const connectionId of due) {
      if (closed) return;
      attemptedAt.set(connectionId, now());
      try {
        const outcome = await input.fetchModels(connectionId);
        log(
          outcome.kind === 'committed'
            ? `[runtime-host] model list refreshed for connection ${connectionId}`
            : `[runtime-host] model list refresh for connection ${connectionId} ended ${outcome.kind}${
                outcome.detail ? ` (${outcome.detail})` : ''
              }`,
        );
      } catch (error) {
        log(
          `[runtime-host] model list refresh for connection ${connectionId} failed: ${describe(error)}`,
        );
      }
    }
  };

  const runOnce = (): Promise<void> => {
    running ??= pass().finally(() => {
      running = undefined;
    });
    return running;
  };

  const schedule = (delay: number) => {
    if (closed) return;
    timer = setTimeout(() => {
      void runOnce().finally(() => schedule(input.checkIntervalMs ?? CHECK_INTERVAL_MS));
    }, delay);
    timer.unref?.();
  };
  schedule(input.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS);

  return {
    runOnce,
    close: async () => {
      closed = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}

function describe(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}
