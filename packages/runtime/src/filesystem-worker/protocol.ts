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

import { z } from 'zod';
import { validateSandboxBoundaryExpansion } from '@maka/core/sandbox-boundary';

// v9 widens Grep again, to the ripgrep switches the tool now exposes: a
// `--type` filter, asymmetric context (`-A`/`-B`), an explicit line-number
// toggle, and a result `offset` for paging past a capped answer. The worker
// validates strictly, so a host that sends one of these to a v8 worker would be
// rejected with a schema error rather than a version mismatch — bumping the
// literal is what turns that into the handshake failure it actually is.
//
// v8 widened the search and write operations: Grep carries an output mode plus
// the ripgrep flags the tool now exposes (case folding, context lines,
// multiline), Glob answers with a `truncated` marker, Edit replaces more than
// one occurrence, and Write carries the read-before-overwrite decision as
// `allowOverwrite`. Host and worker are built from this file in one bundle, so
// the literal version is the handshake that stops a stale worker from
// answering a request whose fields it would silently ignore.
//
// v6 added the captured target identity (opaque decimal-string dev/ino) to
// FilesystemWorkerTarget, so the worker can compare-and-swap against the
// inode that was authorised at lock acquisition instead of only the path
// string. The identity is carried as strings because bigint cannot cross the
// JSON protocol boundary.
export const FILESYSTEM_WORKER_PROTOCOL_VERSION = 9 as const;

/** Ripgrep output shapes the Grep tool can ask the worker for. */
export const GREP_OUTPUT_MODES = ['content', 'files_with_matches', 'count'] as const;
export type GrepOutputMode = (typeof GREP_OUTPUT_MODES)[number];

/** The single authority on which operation kinds are writes. Shared by the
 * client (permission/identity decisions) and the worker (operation guards) so
 * the set cannot drift. */
export function operationAccess(kind: FilesystemWorkerOperation['kind']): 'read' | 'write' {
  return kind === 'write' || kind === 'apply_patch' || kind === 'edit' ? 'write' : 'read';
}

const path = z.string().min(1).max(4096);
const cwd = z.string().min(1).max(4096);

// Opaque identity strings: `String(stats.dev)` / `String(stats.ino)`. Decimal
// only so they survive JSON round-trips; compared for equality on the worker.
const decimalString = z.string().regex(/^\d+$/);
const FilesystemTargetIdentitySchema = z
  .object({ dev: decimalString, ino: decimalString })
  .strict();

const OperationBoundarySchema = z
  .object({
    filesystem: z
      .object({
        entries: z
          .array(
            z
              .object({
                path,
                access: z.enum(['read', 'write']),
                scope: z.enum(['exact', 'subtree']),
              })
              .strict(),
          )
          .max(32),
      })
      .strict()
      .optional(),
    network: z
      .object({ enabled: z.literal(true) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((profile, context) => {
    const validation = validateSandboxBoundaryExpansion(profile);
    if (!validation.ok) context.addIssue({ code: 'custom', message: validation.message });
  });

export const FilesystemWorkerTargetSchema = z
  .object({
    enforcementPath: path,
    access: z.enum(['read', 'write']),
    scope: z.enum(['exact', 'subtree']),
    targetType: z.enum(['file', 'directory', 'symlink', 'other', 'missing']),
    // The execution-time identity contract, one required field (no separate
    // T0 marker — a single three-state shape mirrors the client input, so an
    // illegal combination cannot be expressed on the wire):
    // - { dev, ino }: the T0 identity the worker must CAS against at T1.
    // - 'missing': T0 saw no target; a target present at execution time was
    //   created while the call waited and must fail.
    // - 'unchecked': the caller does not participate in CAS; the write
    //   proceeds without an identity comparison.
    identity: FilesystemTargetIdentitySchema.or(z.literal('missing')).or(z.literal('unchecked')),
  })
  .strict()
  .superRefine((target, context) => {
    if (target.targetType === 'missing' && typeof target.identity === 'object') {
      context.addIssue({
        code: 'custom',
        message: 'A missing target cannot carry an identity.',
      });
    }
  });

export const FilesystemWorkerOperationSchema = z.union([
  z
    .object({
      kind: z.literal('read'),
      cwd,
      path,
      offset: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('write'),
      cwd,
      path,
      content: z.string(),
      /**
       * Whether this call is allowed to replace an EXISTING file. The host
       * decides it (the session has seen the file through a file tool);
       * the worker only enforces it, so the guard cannot be skipped by a
       * caller that forgets to ask. Absent means "not allowed" — a stale
       * host that never learned about the flag cannot clobber unread files.
       */
      allowOverwrite: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('apply_patch'),
      cwd,
      path,
      action: z.enum(['create', 'update']),
      diff: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal('apply_patch'), cwd, path, action: z.literal('delete') }).strict(),
  z
    .object({
      kind: z.literal('edit'),
      cwd,
      path,
      oldString: z.string(),
      newString: z.string(),
      /** Replace every exact occurrence instead of requiring a unique one. */
      replaceAll: z.boolean().optional(),
      /**
       * Whether this session has already seen the file through a file tool.
       * The host decides it, the worker only enforces it, and absent means
       * "not allowed" — a stale host that never learned about the flag cannot
       * edit blind.
       */
      allowEdit: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('glob'),
      cwd,
      path,
      pattern: z.string().min(1),
      limit: z.number().int().positive().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('grep'),
      cwd,
      path,
      pattern: z.string(),
      glob: z.string().min(1).optional(),
      /** Ripgrep file-type filter (`--type`). */
      type: z.string().min(1).max(64).optional(),
      /** Ripgrep output shape; absent means `content`, the historical shape. */
      outputMode: z.enum(GREP_OUTPUT_MODES).optional(),
      /** Case-insensitive search (`-i`). */
      ignoreCase: z.boolean().optional(),
      /** Lines of context after each match (`-A`); content mode only. */
      after: z.number().int().nonnegative().optional(),
      /** Lines of context before each match (`-B`); content mode only. */
      before: z.number().int().nonnegative().optional(),
      /** Print line numbers (`-n`); content mode only, on unless explicitly false. */
      lineNumbers: z.boolean().optional(),
      /** Let the pattern span lines (`-U --multiline-dotall`). */
      multiline: z.boolean().optional(),
      maxCountPerFile: z.number().int().positive(),
      limit: z.number().int().positive(),
      /** Result lines to skip before `limit` applies, for paging. */
      offset: z.number().int().nonnegative().optional(),
      timeoutMs: z.number().int().positive(),
    })
    .strict(),
]);

export const FilesystemWorkerRequestSchema = z
  .object({
    version: z.literal(FILESYSTEM_WORKER_PROTOCOL_VERSION),
    requestId: z.string().min(1).max(256),
    operation: FilesystemWorkerOperationSchema,
    operationBoundary: OperationBoundarySchema,
    expectedTarget: FilesystemWorkerTargetSchema,
  })
  .strict();

export const FilesystemWorkerResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('read'), content: z.string() }).strict(),
  z
    .object({
      kind: z.literal('read_image'),
      base64: z.string(),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('write'),
      ok: z.literal(true),
      path: z.string(),
      bytes: z.number().int().nonnegative(),
      diff: z.string().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('apply_patch'), ok: z.literal(true), path: z.string() }).strict(),
  z
    .object({
      kind: z.literal('edit'),
      ok: z.literal(true),
      path: z.string(),
      replacements: z.number().int().positive(),
      matchedVia: z.enum(['exact', 'line-trimmed', 'whitespace', 'escape']),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      diff: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('glob'),
      files: z.array(z.string()),
      /** More files matched than the limit returned. */
      truncated: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('grep'),
      /**
       * Ripgrep's own output lines, one per array entry. The shape depends on
       * `mode`; the durable result keeps this field under its original name so
       * the existing UI renderer is unaffected by the added modes.
       */
      matches: z.array(z.string()),
      mode: z.enum(GREP_OUTPUT_MODES).optional(),
      /** More lines matched than `limit` returned. */
      truncated: z.boolean().optional(),
      /** How many matching lines were dropped by `limit`. */
      omitted: z.number().int().nonnegative().optional(),
    })
    .strict(),
]);

export const FilesystemWorkerErrorCodeSchema = z.enum([
  'invalid_request',
  'path_denied',
  'path_changed',
  'not_found',
  'edit_conflict',
  'grep_unavailable',
  // Write refused to replace a file this session has never read (#tool-6):
  // the model has to look before it overwrites.
  'write_unread_target',
  // Edit refused to change a file this session has never read: an edit written
  // from a remembered shape lands on text that is no longer there.
  'edit_unread_target',
  'sandbox_denied',
  'filesystem_denied',
  'filesystem_error',
  // The worker may have applied the mutation before it lost the ability to
  // report back (e.g. it wrote the file then the post-write identity check
  // found the on-path inode no longer matches the one it wrote). The host
  // treats this as an unknown outcome on disk, not a clean failure.
  'outcome_unknown',
  // The entry-delete path refuses directories outright (#2600): a directory
  // cannot be unlinked, only recursively removed — a different operation.
  'is_directory',
]);

/**
 * The refusal a Write gets when it would replace a file the session has never
 * looked at (`write_unread_target`). It lives beside the code rather than in
 * either backend: the worker and the host-local executor both raise it, and a
 * guard that reads differently depending on which one ran is a guard the model
 * cannot learn.
 */
export function unreadOverwriteMessage(path: string): string {
  return (
    `Refusing to overwrite ${path}: it exists and has not been read in this session. ` +
    'Read it first (or use Edit for a partial change), then write.'
  );
}

/**
 * The refusal an Edit gets when the session has never read the file
 * (`edit_unread_target`). Same reasoning as {@link unreadOverwriteMessage}, and
 * the same placement: both backends raise it, after the path has been resolved,
 * so a boundary violation is still reported as one.
 */
export function unreadEditMessage(path: string): string {
  return `Refusing to edit ${path}: it has not been read in this session. Read it first, then edit.`;
}

export const FilesystemWorkerResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      version: z.literal(FILESYSTEM_WORKER_PROTOCOL_VERSION),
      requestId: z.string().min(1).max(256),
      ok: z.literal(true),
      result: FilesystemWorkerResultSchema,
    })
    .strict(),
  z
    .object({
      version: z.literal(FILESYSTEM_WORKER_PROTOCOL_VERSION),
      requestId: z.string().min(1).max(256),
      ok: z.literal(false),
      error: z
        .object({
          code: FilesystemWorkerErrorCodeSchema,
          message: z.string(),
        })
        .strict(),
    })
    .strict(),
]);

export type FilesystemWorkerOperation = z.infer<typeof FilesystemWorkerOperationSchema>;

export function operationUsesDirectoryEntry(operation: FilesystemWorkerOperation): boolean {
  return (
    operation.kind === 'apply_patch' &&
    (operation.action === 'create' || operation.action === 'delete')
  );
}
export type FilesystemWorkerTarget = z.infer<typeof FilesystemWorkerTargetSchema>;
export type FilesystemWorkerRequest = z.infer<typeof FilesystemWorkerRequestSchema>;
export type FilesystemWorkerResult = z.infer<typeof FilesystemWorkerResultSchema>;
export type FilesystemWorkerErrorCode = z.infer<typeof FilesystemWorkerErrorCodeSchema>;
export type FilesystemWorkerResponse = z.infer<typeof FilesystemWorkerResponseSchema>;

export function parseFilesystemWorkerResponse(input: unknown): FilesystemWorkerResponse {
  return FilesystemWorkerResponseSchema.parse(input);
}
