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

/**
 * The Host's one authority over the memory filesystem: it binds the six tools
 * for the model, renders the `<user_memory_snapshot>` the prompt carries, and
 * answers the settings page. All three read the same store under the same
 * policy gate, so what the page shows is what the model sees.
 */

import {
  MEMORY_PREFERENCES_PATH,
  MEMORY_PROFILE_PATH,
  MemoryPathError,
  parseMemoryFrontmatter,
  renderUserMemorySnapshot,
} from '@maka/core/memory-filesystem';
import type { RuntimePolicy, RuntimePolicySnapshot } from '@maka/core/runtime-policy';
import { buildMemoryTools, type MemoryToolGate } from '@maka/runtime/memory-tools';
import type { MakaTool } from '@maka/runtime/tool-runtime';
import {
  authenticateInteractiveMemoryFileStoreWriter,
  type InteractiveMemoryFileStoreWriter,
  type MemoryFileRecord,
  type MemoryMutationResult,
} from '@maka/storage/memory-file-store';
import type { RuntimePolicyReader } from '@maka/storage/runtime-policy-stores';
import type {
  MemoryDocumentProjection,
  MemoryMutateInput,
  MemoryMutateResult,
  MemoryQueryInput,
  MemoryQueryResult,
  OperationOutcome,
} from '../protocol/index.js';
import type { MemoryOperationHandlerMap } from './operation-dispatcher.js';

export interface HostMemoryPromptProjection {
  /** Null when memory is off for this session; otherwise changes with any file. */
  readonly revision: string | null;
  readonly body?: string;
}

export interface HostMemoryCoordinatorDeps {
  readonly store: InteractiveMemoryFileStoreWriter;
  readonly runtimePolicy: RuntimePolicyReader;
}

export function memoryGateForPolicy(policy: RuntimePolicy): MemoryToolGate {
  if (policy.privacy.incognitoActive) return { allowed: false, reason: 'incognito' };
  if (!policy.memory.enabled) return { allowed: false, reason: 'disabled' };
  return { allowed: true };
}

export class HostMemoryCoordinator {
  readonly handlers: MemoryOperationHandlerMap = {
    'memory.query': (input) => this.#query(input),
    'memory.mutate': (input) => this.#mutate(input),
  };

  readonly #store: InteractiveMemoryFileStoreWriter;
  readonly #runtimePolicy: RuntimePolicyReader;
  readonly #tools: readonly MakaTool[];
  #draining = false;

  constructor(deps: HostMemoryCoordinatorDeps) {
    this.#store = authenticateInteractiveMemoryFileStoreWriter(deps.store);
    this.#runtimePolicy = deps.runtimePolicy;
    this.#tools = buildMemoryTools({ store: this.#store, gate: () => this.gate() });
  }

  /** The six tools, gated at every call by the current policy. */
  get tools(): readonly MakaTool[] {
    return this.#tools;
  }

  async gate(): Promise<MemoryToolGate> {
    if (this.#draining) return { allowed: false, reason: 'draining' };
    return memoryGateForPolicy((await this.#runtimePolicy.getSnapshot()).policy);
  }

  /** The `<user_memory_snapshot>` block for a run, or nothing when memory is off. */
  async readPromptProjection(policy: RuntimePolicySnapshot): Promise<HostMemoryPromptProjection> {
    if (!memoryGateForPolicy(policy.policy).allowed) return { revision: null };
    const snapshot = await this.#store.snapshot();
    const byPath = new Map(snapshot.files.map((file) => [file.path, file]));
    const body = renderUserMemorySnapshot({
      profile: byPath.get(MEMORY_PROFILE_PATH)?.content ?? null,
      preferences: byPath.get(MEMORY_PREFERENCES_PATH)?.content ?? null,
      listing: snapshot.files.map((file) => ({
        path: file.path,
        byteLength: file.byteLength,
        updatedAt: file.updatedAt,
        frontmatter: parseMemoryFrontmatter(file.content),
      })),
    });
    return { revision: snapshot.revision, body };
  }

  beginDrain(): void {
    this.#draining = true;
  }

  async close(): Promise<void> {
    this.beginDrain();
  }

  async #query(input: MemoryQueryInput): Promise<OperationOutcome<'memory.query'>> {
    if (this.#draining) return hostDraining();
    try {
      if (input.kind === 'list') {
        const policy = (await this.#runtimePolicy.getSnapshot()).policy;
        const snapshot = await this.#store.snapshot();
        return {
          ok: true,
          result: {
            kind: 'list',
            enabled: policy.memory.enabled,
            incognitoActive: policy.privacy.incognitoActive,
            directoryPath: this.#store.directoryPath,
            files: snapshot.files.map((file) => {
              const frontmatter = parseMemoryFrontmatter(file.content);
              return {
                path: file.path,
                byteLength: file.byteLength,
                updatedAt: file.updatedAt,
                description: frontmatter.description,
                aliases: frontmatter.aliases,
                sources: frontmatter.sources,
              };
            }),
          },
        };
      }
      const record = await this.#store.read(input.path);
      return {
        ok: true,
        result: { kind: 'document', document: record ? projectDocument(record) : null },
      };
    } catch (error) {
      return failure(error);
    }
  }

  async #mutate(input: MemoryMutateInput): Promise<OperationOutcome<'memory.mutate'>> {
    if (this.#draining) return hostDraining();
    try {
      // The page writes under the same switch as the model: a user who turned
      // memory off should not find the page quietly filing on their behalf.
      const gate = await this.gate();
      if (!gate.allowed) {
        if (gate.reason === 'draining') return hostDraining();
        return { ok: true, result: { kind: 'rejected', reason: gate.reason, current: null } };
      }
      const outcome =
        input.kind === 'write'
          ? await this.#store.write({
              path: input.path,
              content: input.content,
              ifVersion: input.ifVersion,
            })
          : await this.#store.delete({ path: input.path, ifVersion: input.ifVersion });
      return { ok: true, result: projectMutation(outcome) };
    } catch (error) {
      if (error instanceof MemoryPathError) {
        return { ok: true, result: { kind: 'rejected', reason: 'invalid_path', current: null } };
      }
      return failure(error);
    }
  }
}

function projectDocument(record: MemoryFileRecord): MemoryDocumentProjection {
  return {
    path: record.path,
    content: record.content,
    version: record.version,
    byteLength: record.byteLength,
    updatedAt: record.updatedAt,
  };
}

function projectMutation(outcome: MemoryMutationResult): MemoryMutateResult {
  switch (outcome.kind) {
    case 'written':
      return { kind: 'written', version: outcome.version, byteLength: outcome.byteLength };
    case 'deleted':
      return { kind: 'deleted' };
    case 'exists':
    case 'version_conflict':
    case 'old_str_not_found':
    case 'old_str_ambiguous':
      return {
        kind: 'rejected',
        reason: outcome.kind === 'exists' ? 'exists' : 'version_conflict',
        current: projectDocument(outcome.current),
      };
    case 'not_found':
    case 'oversize':
    case 'empty':
      return { kind: 'rejected', reason: outcome.kind, current: null };
  }
}

function hostDraining(): OperationOutcome<'memory.query'> & OperationOutcome<'memory.mutate'> {
  return { ok: false, error: { code: 'host_draining', message: 'Runtime Host is draining' } };
}

function failure(
  error: unknown,
): OperationOutcome<'memory.query'> & OperationOutcome<'memory.mutate'> {
  return {
    ok: false,
    error: {
      code: 'persistence_failed',
      message: error instanceof Error ? error.message : 'Memory operation failed',
    },
  };
}
