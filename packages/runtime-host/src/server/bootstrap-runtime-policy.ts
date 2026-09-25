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

import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderType } from '@maka/core/llm-connections';
import type { ConnectionCatalogEntry } from '@maka/core/runtime-policy';
import type { RuntimePolicyStoresWriter } from '@maka/storage/runtime-policy-stores';

const JOURNAL_FILE = '.runtime-host-bootstrap.json';
interface BootstrapEnvironment {
  readonly ANTHROPIC_API_KEY?: string;
  readonly DEEPSEEK_API_KEY?: string;
  readonly DEEPSEEK_BASE_URL?: string;
  readonly OPENAI_API_KEY?: string;
}

interface BootstrapSeed {
  readonly slug: string;
  readonly name: string;
  readonly providerType: ProviderType;
  readonly enabledModelIds: readonly string[];
  readonly baseUrl?: string;
  readonly secret: string;
}

interface BootstrapJournal {
  readonly version: 1;
  readonly state: 'initializing';
}

/**
 * Imports a credential from the environment on first start, before Runtime Host
 * accepts clients. Without one the catalog starts empty and the user adds a
 * Connection.
 */
export async function ensureBootstrapRuntimePolicy(input: {
  readonly workspaceRoot: string;
  readonly stores: RuntimePolicyStoresWriter;
  readonly environment?: BootstrapEnvironment;
  readonly onDeferredError?: (error: unknown) => void;
}): Promise<void> {
  const journalPath = join(input.workspaceRoot, JOURNAL_FILE);
  const resuming = await readJournal(journalPath);
  const initialCatalog = await input.stores.connectionCatalog.getSnapshot();
  if (!resuming && initialCatalog.connections.length > 0) return;
  const seed = bootstrapSeed(input.environment ?? process.env);
  // A resumed start whose catalog holds anything but this seed was finished by
  // the user; there is nothing left to import.
  if (!seed || initialCatalog.connections.some(({ slug }) => slug !== seed.slug)) {
    await rm(journalPath, { force: true });
    return;
  }
  if (!resuming) await writeJournal(journalPath);
  let connection: ConnectionCatalogEntry;
  try {
    const ensured = await ensureConnection(input.stores, seed);
    connection = ensured.connection;
    try {
      await ensureCredential(input.stores, connection, seed.secret);
    } catch (error) {
      if (ensured.created) await removeFailedBootstrapConnection(input.stores, connection);
      throw error;
    }
  } catch (error) {
    // A credential the environment cannot supply is reported, not retried in
    // place; the next start tries the import again.
    input.onDeferredError?.(error);
    await rm(journalPath, { force: true });
    return;
  }
  // Outside the deferral: a default that failed to land leaves the journal, so
  // the next start resumes here instead of keeping a Connection no send uses.
  await setDefaultIfMissing(input.stores, connection, seed.enabledModelIds[0]!);
  await rm(journalPath, { force: true });
}

function bootstrapSeed(environment: BootstrapEnvironment): BootstrapSeed | undefined {
  const deepseek = environment.DEEPSEEK_API_KEY?.trim();
  const anthropic = environment.ANTHROPIC_API_KEY?.trim();
  const openai = environment.OPENAI_API_KEY?.trim();
  if (deepseek) {
    return {
      slug: 'env-deepseek',
      name: 'DeepSeek (env)',
      providerType: 'deepseek',
      enabledModelIds: ['deepseek-flash'],
      baseUrl: environment.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
      secret: deepseek,
    };
  }
  if (anthropic) {
    return {
      slug: 'env-anthropic',
      name: 'Anthropic (env)',
      providerType: 'anthropic',
      enabledModelIds: ['claude-sonnet-4-5-20250929'],
      secret: anthropic,
    };
  }
  if (openai) {
    return {
      slug: 'env-openai',
      name: 'OpenAI (env)',
      providerType: 'openai',
      enabledModelIds: ['gpt-4o-mini'],
      secret: openai,
    };
  }
  return undefined;
}

async function ensureConnection(
  stores: RuntimePolicyStoresWriter,
  seed: BootstrapSeed,
): Promise<{ readonly connection: ConnectionCatalogEntry; readonly created: boolean }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const catalog = await stores.connectionCatalog.getSnapshot();
    const existing = catalog.connections.find(({ slug }) => slug === seed.slug);
    if (existing) {
      if (existing.providerType !== seed.providerType) {
        throw new Error(`Bootstrap Connection slug conflict: ${seed.slug}`);
      }
      return { connection: existing, created: false };
    }
    const created = await stores.connectionCatalog.create({
      expectedCatalogRevision: catalog.revision,
      connection: {
        slug: seed.slug,
        name: seed.name,
        providerType: seed.providerType,
        ...(seed.baseUrl === undefined ? {} : { baseUrl: seed.baseUrl }),
        enabled: true,
        enabledModelIds: seed.enabledModelIds,
      },
    });
    if (created.kind === 'committed') {
      const connection = created.snapshot.connections.find(({ slug }) => slug === seed.slug);
      if (!connection) throw new Error('Bootstrap commit omitted its Connection');
      return { connection, created: true };
    }
  }
  throw new Error(`Bootstrap Connection could not be created: ${seed.slug}`);
}

async function removeFailedBootstrapConnection(
  stores: RuntimePolicyStoresWriter,
  connection: ConnectionCatalogEntry,
): Promise<void> {
  const removed = await stores.connectionCatalog.remove({
    expected: { connectionId: connection.connectionId, revision: connection.revision },
  });
  if (removed.kind !== 'committed') {
    throw new Error(`Failed Bootstrap Connection could not be removed: ${removed.kind}`);
  }
}

async function ensureCredential(
  stores: RuntimePolicyStoresWriter,
  connection: ConnectionCatalogEntry,
  secret: string,
): Promise<void> {
  const locator = {
    scope: 'connection' as const,
    connectionId: connection.connectionId,
    kind: 'api_key' as const,
  };
  const current = await stores.credentialVault.getStatus(locator);
  if (current.kind === 'connection_not_found') {
    throw new Error('Bootstrap credential refers to a missing Connection');
  }
  if (current.status.configured) return;
  const committed = await stores.credentialVault.set({ locator, expected: null, secret });
  if (committed.kind !== 'committed') {
    throw new Error(`Bootstrap credential could not be stored: ${committed.kind}`);
  }
}

async function setDefaultIfMissing(
  stores: RuntimePolicyStoresWriter,
  connection: ConnectionCatalogEntry,
  modelId: string,
): Promise<void> {
  const catalog = await stores.connectionCatalog.getSnapshot();
  if (catalog.defaultTarget !== null) return;
  const committed = await stores.connectionCatalog.setDefaultTarget({
    expectedCatalogRevision: catalog.revision,
    target: { connectionId: connection.connectionId, modelId },
  });
  if (committed.kind !== 'committed') {
    throw new Error(`Bootstrap default target could not be stored: ${committed.kind}`);
  }
}

async function readJournal(path: string): Promise<BootstrapJournal | null> {
  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null;
    throw error;
  }
  const value = JSON.parse(contents) as Partial<BootstrapJournal>;
  if (value.version !== 1 || value.state !== 'initializing') {
    throw new Error('Invalid Runtime Host bootstrap journal');
  }
  return { version: 1, state: 'initializing' };
}

async function writeJournal(path: string): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ version: 1, state: 'initializing' } satisfies BootstrapJournal)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
