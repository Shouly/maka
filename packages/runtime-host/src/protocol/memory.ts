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
 * The memory filesystem as a client sees it: the settings page lists files,
 * opens one, saves one, deletes one. Writes carry the same content-hash
 * version the model's tools carry, so the page and the model never overwrite
 * each other unseen.
 */

import { MEMORY_FILE_MAX_BYTES } from '@maka/core/memory-filesystem';
import {
  requireCount,
  requireExactRecord,
  requireShapedRecord,
  requireString,
  requireUtf8String,
} from './codec.js';
import { invalidProtocolFrame } from './errors.js';
import { defineOperation } from './operation-spec.js';

const QUERY_ERRORS = [
  'host_not_ready',
  'host_draining',
  'operation_unavailable',
  'invalid_request',
  'persistence_failed',
  'internal_failure',
] as const;
const MUTATE_ERRORS = [...QUERY_ERRORS, 'commit_outcome_unknown'] as const;

const MEMORY_PATH_MAX_CHARS = 200;
const VERSION_MAX_CHARS = 16;
const LIST_MAX_FILES = 1_000;

export interface MemoryFileProjection {
  readonly path: string;
  readonly byteLength: number;
  readonly updatedAt: number;
  readonly description: string | null;
  readonly aliases: readonly string[];
  readonly sources: readonly string[];
}

export interface MemoryDocumentProjection {
  readonly path: string;
  readonly content: string;
  readonly version: string;
  readonly byteLength: number;
  readonly updatedAt: number;
}

export type MemoryQueryInput =
  | { readonly kind: 'list' }
  | { readonly kind: 'read'; readonly path: string };

export type MemoryQueryResult =
  | {
      readonly kind: 'list';
      readonly enabled: boolean;
      readonly incognitoActive: boolean;
      readonly directoryPath: string;
      readonly files: readonly MemoryFileProjection[];
    }
  | { readonly kind: 'document'; readonly document: MemoryDocumentProjection | null };

export type MemoryMutateInput =
  | {
      readonly kind: 'write';
      readonly path: string;
      readonly content: string;
      readonly ifVersion: string;
    }
  | { readonly kind: 'delete'; readonly path: string; readonly ifVersion: string };

export type MemoryMutationRejectionReason =
  | 'exists'
  | 'not_found'
  | 'version_conflict'
  | 'oversize'
  | 'empty'
  | 'invalid_path'
  | 'disabled'
  | 'incognito';

export type MemoryMutateResult =
  | { readonly kind: 'written'; readonly version: string; readonly byteLength: number }
  | { readonly kind: 'deleted' }
  | {
      readonly kind: 'rejected';
      readonly reason: MemoryMutationRejectionReason;
      readonly current: MemoryDocumentProjection | null;
    };

export const MEMORY_OPERATION_SPECS = {
  'memory.query': defineOperation<
    MemoryQueryInput,
    MemoryQueryResult,
    (typeof QUERY_ERRORS)[number]
  >({
    mode: 'query',
    availability: 'ready',
    errors: QUERY_ERRORS,
    decodeInput: decodeMemoryQueryInput,
    decodeOutput: decodeMemoryQueryResult,
  }),
  'memory.mutate': defineOperation<
    MemoryMutateInput,
    MemoryMutateResult,
    (typeof MUTATE_ERRORS)[number]
  >({
    mode: 'command',
    availability: 'ready',
    errors: MUTATE_ERRORS,
    decodeInput: decodeMemoryMutateInput,
    decodeOutput: decodeMemoryMutateResult,
  }),
} as const;

function requirePath(value: unknown): string {
  return requireString(value, 'memory path', MEMORY_PATH_MAX_CHARS);
}

function requireVersion(value: unknown): string {
  return requireString(value, 'memory version', VERSION_MAX_CHARS);
}

function requireStringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw invalidProtocolFrame(`Invalid ${label}`);
  return value.map((item) => requireString(item, label, 256));
}

export function decodeMemoryQueryInput(value: unknown): MemoryQueryInput {
  const record = requireShapedRecord(value, 'memory query', ['kind'], ['path']);
  if (record.kind === 'list') {
    requireExactRecord(value, 'memory list query', ['kind']);
    return { kind: 'list' };
  }
  if (record.kind === 'read') {
    requireExactRecord(value, 'memory read query', ['kind', 'path']);
    return { kind: 'read', path: requirePath(record.path) };
  }
  throw invalidProtocolFrame('Invalid memory query kind');
}

function decodeFileProjection(value: unknown): MemoryFileProjection {
  const record = requireExactRecord(value, 'memory file', [
    'path',
    'byteLength',
    'updatedAt',
    'description',
    'aliases',
    'sources',
  ]);
  return {
    path: requirePath(record.path),
    byteLength: requireCount(record.byteLength, 'memory file byteLength'),
    updatedAt: requireCount(record.updatedAt, 'memory file updatedAt'),
    description:
      record.description === null
        ? null
        : requireString(record.description, 'memory description', 1_024),
    aliases: requireStringList(record.aliases, 'memory aliases'),
    sources: requireStringList(record.sources, 'memory sources'),
  };
}

function decodeDocumentProjection(value: unknown): MemoryDocumentProjection {
  const record = requireExactRecord(value, 'memory document', [
    'path',
    'content',
    'version',
    'byteLength',
    'updatedAt',
  ]);
  return {
    path: requirePath(record.path),
    content: requireUtf8String(record.content, 'memory content', MEMORY_FILE_MAX_BYTES),
    version: requireVersion(record.version),
    byteLength: requireCount(record.byteLength, 'memory document byteLength'),
    updatedAt: requireCount(record.updatedAt, 'memory document updatedAt'),
  };
}

export function decodeMemoryQueryResult(value: unknown): MemoryQueryResult {
  const record = requireShapedRecord(
    value,
    'memory query result',
    ['kind'],
    ['enabled', 'incognitoActive', 'directoryPath', 'files', 'document'],
  );
  if (record.kind === 'list') {
    requireExactRecord(value, 'memory list result', [
      'kind',
      'enabled',
      'incognitoActive',
      'directoryPath',
      'files',
    ]);
    if (typeof record.enabled !== 'boolean' || typeof record.incognitoActive !== 'boolean') {
      throw invalidProtocolFrame('Invalid memory list flags');
    }
    if (!Array.isArray(record.files) || record.files.length > LIST_MAX_FILES) {
      throw invalidProtocolFrame('Invalid memory file list');
    }
    return {
      kind: 'list',
      enabled: record.enabled,
      incognitoActive: record.incognitoActive,
      directoryPath: requireString(record.directoryPath, 'memory directory', 4_096),
      files: record.files.map(decodeFileProjection),
    };
  }
  if (record.kind === 'document') {
    requireExactRecord(value, 'memory document result', ['kind', 'document']);
    return {
      kind: 'document',
      document: record.document === null ? null : decodeDocumentProjection(record.document),
    };
  }
  throw invalidProtocolFrame('Invalid memory query result kind');
}

export function decodeMemoryMutateInput(value: unknown): MemoryMutateInput {
  const record = requireShapedRecord(
    value,
    'memory mutation',
    ['kind', 'path', 'ifVersion'],
    ['content'],
  );
  if (record.kind === 'write') {
    requireExactRecord(value, 'memory write', ['kind', 'path', 'content', 'ifVersion']);
    return {
      kind: 'write',
      path: requirePath(record.path),
      content: requireUtf8String(record.content, 'memory content', MEMORY_FILE_MAX_BYTES),
      ifVersion: requireVersion(record.ifVersion),
    };
  }
  if (record.kind === 'delete') {
    requireExactRecord(value, 'memory delete', ['kind', 'path', 'ifVersion']);
    return {
      kind: 'delete',
      path: requirePath(record.path),
      ifVersion: requireVersion(record.ifVersion),
    };
  }
  throw invalidProtocolFrame('Invalid memory mutation kind');
}

const REJECTION_REASONS: ReadonlySet<string> = new Set<MemoryMutationRejectionReason>([
  'exists',
  'not_found',
  'version_conflict',
  'oversize',
  'empty',
  'invalid_path',
  'disabled',
  'incognito',
]);

export function decodeMemoryMutateResult(value: unknown): MemoryMutateResult {
  const record = requireShapedRecord(
    value,
    'memory mutation result',
    ['kind'],
    ['version', 'byteLength', 'reason', 'current'],
  );
  if (record.kind === 'written') {
    requireExactRecord(value, 'memory written result', ['kind', 'version', 'byteLength']);
    return {
      kind: 'written',
      version: requireVersion(record.version),
      byteLength: requireCount(record.byteLength, 'memory written byteLength'),
    };
  }
  if (record.kind === 'deleted') {
    requireExactRecord(value, 'memory deleted result', ['kind']);
    return { kind: 'deleted' };
  }
  if (record.kind === 'rejected') {
    requireExactRecord(value, 'memory rejected result', ['kind', 'reason', 'current']);
    if (typeof record.reason !== 'string' || !REJECTION_REASONS.has(record.reason)) {
      throw invalidProtocolFrame('Invalid memory rejection reason');
    }
    return {
      kind: 'rejected',
      reason: record.reason as MemoryMutationRejectionReason,
      current: record.current === null ? null : decodeDocumentProjection(record.current),
    };
  }
  throw invalidProtocolFrame('Invalid memory mutation result kind');
}
