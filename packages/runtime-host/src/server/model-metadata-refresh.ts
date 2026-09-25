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

import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { bundledModelMetadata, installRefreshedModelMetadata } from '@maka/core/model-metadata';
import {
  fetchModelsDevProjection,
  MODELS_DEV_RESPONSE_MAX_BYTES,
  type ModelsDevMetadataProjection,
} from '@maka/core/models-dev-refresh';
import { redactSecrets } from '@maka/core/redaction';
import {
  createProxiedFetchTransport,
  type ProxiedFetchProxy,
  type ProxiedFetchTransport,
} from '@maka/runtime/network/scoped-fetch-transport';
import type { RuntimePolicyOperationCoordinator } from '@maka/storage/runtime-policy-stores';
import { toRuntimePolicyProxy } from './runtime-policy-proxy.js';

/** models.dev is a few megabytes; a slow link needs longer than a fast one to pull it. */
const MODELS_DEV_FETCH_TIMEOUT_MS = 30_000;
/** A failed attempt is retried after each of these, then left to the daily refresh. */
const RETRY_DELAYS_MS: readonly number[] = [5_000, 30_000, 5 * 60_000];
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** The status carries the failure's first line or so, not a stack. */
const STATUS_ERROR_MAX_LENGTH = 2_000;
/** A normal refresh retires hundreds of paths; the count is the signal, the names are a sample. */
const LOGGED_REMOVAL_SAMPLE = 20;

/** The last catalog this Host took, kept beside the connection catalog. */
export const MODEL_METADATA_CACHE_FILE = 'model-metadata-cache.json';

interface ModelMetadataCacheDocument {
  readonly schemaVersion: 1;
  /** When models.dev served this projection (unix ms). */
  readonly fetchedAt: number;
  /** sha256 of `JSON.stringify(metadata)`: a truncated or edited file is not installed. */
  readonly digest: string;
  readonly metadata: ModelsDevMetadataProjection;
}

/** Why an attempt did not go out; carried as `lastAttempt.error` of a skipped attempt. */
export type ModelMetadataSkipCode = 'privacy_mode' | 'proxy_credential_not_configured';

/** Where the metadata this Host answers with came from, and how its refresh is going. */
export interface ModelMetadataStatus {
  readonly active: 'bundled' | 'cache' | 'refreshed';
  /** When models.dev served the active table; null for the build's snapshot. */
  readonly fetchedAt: number | null;
  readonly lastAttempt: {
    readonly at: number;
    readonly outcome: 'changed' | 'unchanged' | 'failed' | 'skipped';
    readonly error?: string;
  } | null;
  readonly nextAttemptAt: number | null;
}

export interface HostModelMetadataRefreshInput {
  readonly policy: Pick<RuntimePolicyOperationCoordinator, 'resolveHostOutboundExecution'>;
  /** Announce the swap so attached clients re-read the connection catalog. */
  readonly publish: () => void;
  readonly createFetchTransport?: (proxy: ProxiedFetchProxy | null) => ProxiedFetchTransport;
  readonly timeoutMs?: number;
  /** The storage root the last good catalog is kept in; omitted, nothing persists. */
  readonly cacheRoot?: string;
  readonly retryDelaysMs?: readonly number[];
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

export interface HostModelMetadataRefresh {
  /** Resolves when the startup attempt has finished, however it ended. */
  readonly settled: Promise<void>;
  status(): ModelMetadataStatus;
  /** Attempt now, outside the schedule; resolves with the status it leaves. */
  refreshNow(): Promise<ModelMetadataStatus>;
  close(): Promise<void>;
}

/**
 * Install the last catalog this Host took, before anything reads metadata.
 *
 * This is what makes a model's facts stable across restarts: without it every
 * start began from the build's snapshot and the UI changed with each
 * startup's network luck. A missing, unreadable or tampered file is ignored
 * and the snapshot stands.
 */
export async function loadModelMetadataCache(
  cacheRoot: string,
  log: (line: string) => void = (line) => console.error(line),
): Promise<{ readonly fetchedAt: number; readonly metadata: ModelsDevMetadataProjection } | null> {
  let text: string;
  try {
    text = await readFile(join(cacheRoot, MODEL_METADATA_CACHE_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log(
        `[runtime-host] models.dev cache unreadable, using the bundled snapshot: ${describe(error)}`,
      );
    }
    return null;
  }
  try {
    if (text.length > MODELS_DEV_RESPONSE_MAX_BYTES)
      throw new Error('file exceeds the catalog bound');
    const document = JSON.parse(text) as Partial<ModelMetadataCacheDocument>;
    if (
      document.schemaVersion !== 1 ||
      typeof document.fetchedAt !== 'number' ||
      typeof document.digest !== 'string' ||
      !document.metadata ||
      typeof document.metadata !== 'object' ||
      digestOf(document.metadata) !== document.digest
    ) {
      throw new Error('file does not match its digest');
    }
    installRefreshedModelMetadata(document.metadata);
    return { fetchedAt: document.fetchedAt, metadata: document.metadata };
  } catch (error) {
    log(`[runtime-host] models.dev cache rejected, using the bundled snapshot: ${describe(error)}`);
    return null;
  }
}

/**
 * Keep this Host's model metadata current with models.dev.
 *
 * The Host is the only process that does this. Clients read Host-resolved
 * catalog entries, so a Host on a stale build still describes every model the
 * way the live catalog does.
 *
 * Attempts: one at startup, retried after 5 s, 30 s and 5 min when it fails,
 * then once a day. Each provider stands alone — one upstream renamed or
 * reshaped keeps the facts it had and is logged, and the rest are taken. A
 * refresh that lands is taken whole otherwise, including what upstream
 * stopped carrying: the snapshot is not a second opinion about a model
 * upstream still publishes. Clients are told only when the table changed.
 *
 * Every accepted table is written to the storage root, and the next start
 * installs it before the first read (`loadModelMetadataCache`), so the facts a
 * user sees survive a restart without the network. Privacy mode skips the
 * network attempt; the cached table still applies.
 */
export function startHostModelMetadataRefresh(
  input: HostModelMetadataRefreshInput,
  initial: {
    readonly fetchedAt: number;
    readonly metadata: ModelsDevMetadataProjection;
  } | null = null,
): HostModelMetadataRefresh {
  const now = input.now ?? Date.now;
  const log = input.log ?? ((line: string) => console.error(line));
  const retryDelays = input.retryDelaysMs ?? RETRY_DELAYS_MS;
  const interval = input.intervalMs ?? REFRESH_INTERVAL_MS;
  const abort = new AbortController();
  let current: ModelsDevMetadataProjection = initial?.metadata ?? bundledModelMetadata;
  let currentDigest = initial ? digestOf(initial.metadata) : undefined;
  let status: ModelMetadataStatus = {
    active: initial ? 'cache' : 'bundled',
    fetchedAt: initial?.fetchedAt ?? null,
    lastAttempt: null,
    nextAttemptAt: null,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let running: Promise<void> | undefined;

  const attempt = async (): Promise<void> => {
    const at = now();
    try {
      const outcome = await run(input, abort.signal, current, log);
      if (outcome.kind === 'skipped') {
        failures = 0;
        // A stable code, not prose: the client words it in the user's language.
        status = { ...status, lastAttempt: { at, outcome: 'skipped', error: outcome.code } };
        return;
      }
      failures = 0;
      const fetchedAt = now();
      const digest = digestOf(outcome.metadata);
      const changed = digest !== currentDigest;
      if (changed) {
        // Install before publishing: a client that re-reads on the frame must
        // find the refreshed catalog, not the one it already had.
        installRefreshedModelMetadata(outcome.metadata);
        current = outcome.metadata;
        currentDigest = digest;
        input.publish();
      }
      status = {
        ...status,
        active: 'refreshed',
        fetchedAt,
        lastAttempt: { at, outcome: changed ? 'changed' : 'unchanged' },
      };
      log(
        `[runtime-host] models.dev catalog refreshed (${changed ? 'changed' : 'unchanged'}, digest ${digest.slice(0, 12)})`,
      );
      if (input.cacheRoot)
        await writeCache(input.cacheRoot, outcome.metadata, fetchedAt, digest, log);
    } catch (error) {
      if (abort.signal.aborted) return;
      failures += 1;
      // The message itself, not a generalized category: the projection names
      // the provider and model it refused, and that is the whole diagnostic.
      const message = describe(error);
      status = {
        ...status,
        lastAttempt: { at, outcome: 'failed', error: message.slice(0, STATUS_ERROR_MAX_LENGTH) },
      };
      log(
        `[runtime-host] models.dev catalog refresh failed (attempt ${failures}), keeping the ${status.active} catalog: ${message}`,
      );
    }
  };

  const schedule = () => {
    if (abort.signal.aborted) return;
    const retrying = status.lastAttempt?.outcome === 'failed' && failures <= retryDelays.length;
    // Retries exhausted: the daily attempt starts a fresh round of them.
    if (!retrying) failures = 0;
    const delay = retrying ? retryDelays[failures - 1]! : interval;
    status = { ...status, nextAttemptAt: now() + delay };
    timer = setTimeout(() => {
      void runScheduled();
    }, delay);
    timer.unref?.();
  };

  const runScheduled = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    running ??= attempt().finally(() => {
      running = undefined;
      schedule();
    });
    return running;
  };

  const settled = runScheduled();
  return {
    settled,
    status: () => status,
    refreshNow: async () => {
      await (running ?? runScheduled());
      return status;
    },
    close: async () => {
      abort.abort(new Error('Runtime Host model metadata refresh closed'));
      if (timer) clearTimeout(timer);
      await running?.catch(() => {});
    },
  };
}

function removalSummary(paths: readonly string[]): string {
  const sample = paths.slice(0, LOGGED_REMOVAL_SAMPLE).join(', ');
  const rest = paths.length - LOGGED_REMOVAL_SAMPLE;
  return `models.dev no longer carries ${paths.length} path(s) the previous catalog described; adopting upstream: ${sample}${rest > 0 ? ` and ${rest} more` : ''}`;
}

async function run(
  input: HostModelMetadataRefreshInput,
  signal: AbortSignal,
  previous: ModelsDevMetadataProjection,
  log: (line: string) => void,
): Promise<
  | { readonly kind: 'fetched'; readonly metadata: ModelsDevMetadataProjection }
  | { readonly kind: 'skipped'; readonly code: ModelMetadataSkipCode }
> {
  const admission = await input.policy.resolveHostOutboundExecution();
  if (admission.kind !== 'ready') {
    const code: ModelMetadataSkipCode =
      admission.kind === 'privacy_mode' ? 'privacy_mode' : 'proxy_credential_not_configured';
    log(
      `[runtime-host] models.dev catalog refresh skipped: ${
        code === 'privacy_mode'
          ? 'privacy mode is active'
          : 'the network proxy credential is not configured'
      }`,
    );
    return { kind: 'skipped', code };
  }
  signal.throwIfAborted();
  const transport = (input.createFetchTransport ?? createProxiedFetchTransport)(
    toRuntimePolicyProxy(admission.networkProxy, admission.secretMaterial.networkProxy?.secret),
  );
  const timeout = AbortSignal.timeout(input.timeoutMs ?? MODELS_DEV_FETCH_TIMEOUT_MS);
  try {
    const metadata = await fetchModelsDevProjection({
      fetch: transport.fetch,
      signal: AbortSignal.any([signal, timeout]),
      previous,
      onRemovals: (paths) => log(`[runtime-host] ${removalSummary(paths)}`),
      onProviderRejected: (providerType, reason) =>
        log(
          `[runtime-host] models.dev provider ${providerType} rejected, keeping its previous facts: ${redactSecrets(reason)}`,
        ),
    });
    signal.throwIfAborted();
    return { kind: 'fetched', metadata };
  } finally {
    await transport.close();
  }
}

async function writeCache(
  cacheRoot: string,
  metadata: ModelsDevMetadataProjection,
  fetchedAt: number,
  digest: string,
  log: (line: string) => void,
): Promise<void> {
  const document: ModelMetadataCacheDocument = { schemaVersion: 1, fetchedAt, digest, metadata };
  const target = join(cacheRoot, MODEL_METADATA_CACHE_FILE);
  const staging = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(staging, `${JSON.stringify(document)}\n`, { mode: 0o600 });
    await rename(staging, target);
  } catch (error) {
    // The installed table is unaffected; only the next start loses it.
    log(`[runtime-host] models.dev cache could not be written: ${describe(error)}`);
  }
}

function digestOf(metadata: unknown): string {
  return createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
}

function describe(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}
