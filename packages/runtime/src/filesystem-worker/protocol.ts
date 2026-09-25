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

// v11 numbers Read from 1: `offset` is the first line's number, a file that
// ends in a newline has an empty last line, and the answer carries
// `startLine`, `totalLines` and `beyondEnd` in place of `truncated`. A read
// larger than 256KB is refused. Grep searches hidden files, drops the
// per-file match cap and a required `limit`, and counts every file in count
// mode. Write and Edit drop `allowOverwrite` and
// `allowEdit`: a file the session never read may be written and edited, and
// Write reports whether it created the file.
//
// v10 moved Glob to ripgrep: an empty pattern lists every file, and the
// answer is root-relative paths, oldest first, with the full match count in
// `total` in place of the `truncated` marker.
//
// v9 widened Grep again, to the ripgrep switches the tool now exposes: a
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
export const FILESYSTEM_WORKER_PROTOCOL_VERSION = 11 as const;

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
    // A read from `/` is a Glob or Grep over the whole disk, which the session
    // may already do; only a grant may not name the root.
    const validation = validateSandboxBoundaryExpansion(profile, { allowReadRoot: true });
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
      /**
       * What is at this path — asked WITHOUT opening it.
       *
       * `read` answers the same question as a side effect, but it pays the
       * whole file to do it: the bytes are read and decoded before `limit`
       * narrows anything, and a path that is not a file at all either fails
       * late (a directory) or never returns (a FIFO has no writer, so the
       * open blocks). A caller that only needs to know whether a path is
       * deliverable, openable, or a directory asks this instead.
       */
      kind: z.literal('metadata'),
      cwd,
      path,
    })
    .strict(),
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
    })
    .strict(),
  z
    .object({
      kind: z.literal('glob'),
      cwd,
      path,
      // Empty lists every file.
      pattern: z.string(),
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
      /** Print only the matched parts (`-o`); content mode only. */
      onlyMatching: z.boolean().optional(),
      /** Let the pattern span lines (`-U --multiline-dotall`). */
      multiline: z.boolean().optional(),
      /** Result lines to return; absent returns them all. */
      limit: z.number().int().positive().optional(),
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

/** What `metadata` found, after following symlinks — never the link itself. */
export const FILESYSTEM_TARGET_KINDS = ['file', 'directory', 'other'] as const;

export const FilesystemWorkerResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('metadata'), targetType: z.enum(FILESYSTEM_TARGET_KINDS) }).strict(),
  z
    .object({
      kind: z.literal('read'),
      content: z.string(),
      /** Number of the first line returned, from 1. */
      startLine: z.number().int().positive(),
      /** Lines in the file; 0 for an empty file. */
      totalLines: z.number().int().nonnegative(),
      /** `offset` named a line past the end, so nothing was returned. */
      beyondEnd: z.boolean().optional(),
    })
    .strict(),
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
      /** The file did not exist before this write. */
      created: z.boolean(),
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
      matchedVia: z.enum(['exact', 'quotes']),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      diff: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('glob'),
      /** Relative to the search root, oldest first, at most the limit. */
      files: z.array(z.string()),
      /** Every match, listed or not. */
      total: z.number().int().nonnegative(),
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
      /** Count mode: occurrences and files over every line, before `limit`. */
      countTotal: z
        .object({
          occurrences: z.number().int().nonnegative(),
          files: z.number().int().nonnegative(),
        })
        .strict()
        .optional(),
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
