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
 * The six memory tools: list, read, write, str_replace, append, delete.
 *
 * Every write carries `if_version` — the token the last read or write of that
 * path returned, or the literal `new` — and every refusal hands the current
 * content back so the model can merge and retry in the same turn without
 * another read. Errors are thrown: the model sees them as error results, and
 * the text says what to do next.
 */

import {
  MEMORY_FILE_MAX_BYTES,
  MEMORY_FILE_NEAR_CAP_RATIO,
  MEMORY_NEW_VERSION,
  MEMORY_READ_MAX_PATHS,
  MemoryPathError,
  formatMemoryTimestamp,
  memoryFilePreview,
} from '@maka/core/memory-filesystem';
import { ToolRefusal } from '@maka/core/events';
import { TOOL_NAMES } from '@maka/core/tool-names';
import { z } from 'zod';
import type { MakaTool } from './tool-runtime.js';

export interface MemoryToolFileStat {
  readonly path: string;
  readonly byteLength: number;
  readonly updatedAt: number;
}

export interface MemoryToolFileRecord extends MemoryToolFileStat {
  readonly content: string;
  readonly version: string;
}

export type MemoryToolMutationResult =
  | {
      readonly kind: 'written';
      readonly created: boolean;
      readonly version: string;
      readonly byteLength: number;
    }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'exists'; readonly current: MemoryToolFileRecord }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'version_conflict'; readonly current: MemoryToolFileRecord }
  | { readonly kind: 'old_str_not_found'; readonly current: MemoryToolFileRecord }
  | {
      readonly kind: 'old_str_ambiguous';
      readonly matches: number;
      readonly current: MemoryToolFileRecord;
    }
  | { readonly kind: 'oversize'; readonly byteLength: number; readonly limit: number }
  | { readonly kind: 'empty' };

/** What the tools need from the store — the storage writer satisfies it structurally. */
export interface MemoryToolStore {
  list(input: { readonly pathPrefix?: string | null; readonly cursor?: string | null }): Promise<{
    readonly entries: readonly MemoryToolFileStat[];
    readonly nextCursor: string | null;
  }>;
  read(path: string): Promise<MemoryToolFileRecord | undefined>;
  write(input: {
    readonly path: string;
    readonly content: string;
    readonly ifVersion: string;
  }): Promise<MemoryToolMutationResult>;
  strReplace(input: {
    readonly path: string;
    readonly oldStr: string;
    readonly newStr: string;
    readonly ifVersion: string;
  }): Promise<MemoryToolMutationResult>;
  append(input: {
    readonly path: string;
    readonly content: string;
    readonly ifVersion: string;
  }): Promise<MemoryToolMutationResult>;
  delete(input: {
    readonly path: string;
    readonly ifVersion: string;
  }): Promise<
    Extract<MemoryToolMutationResult, { kind: 'deleted' | 'not_found' | 'version_conflict' }>
  >;
}

export type MemoryToolGate =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'disabled' | 'incognito' | 'draining' };

export interface MemoryToolDeps {
  readonly store: MemoryToolStore;
  /** Read at every call: the setting can change mid-session. */
  readonly gate: () => Promise<MemoryToolGate>;
}

/** The tools whose success means "this turn wrote memory" — the background pass skips such turns. */
export const MEMORY_MUTATING_TOOL_NAMES: ReadonlySet<string> = new Set([
  TOOL_NAMES.memoryWrite,
  TOOL_NAMES.memoryStrReplace,
  TOOL_NAMES.memoryAppend,
  TOOL_NAMES.memoryDelete,
]);

export function buildMemoryTools(deps: MemoryToolDeps): readonly MakaTool[] {
  return [
    buildMemoryListTool(deps),
    buildMemoryReadTool(deps),
    buildMemoryWriteTool(deps),
    buildMemoryStrReplaceTool(deps),
    buildMemoryAppendTool(deps),
    buildMemoryDeleteTool(deps),
  ];
}

/**
 * The PRIVACY paragraph the reference appends to the three tools that create
 * content — write, str_replace, append — and to no other. Copilot has no
 * save-time consent check, so the categories it names file as stated.
 */
const PRIVACY_PARAGRAPH =
  "PRIVACY: never file, for anyone, even if asked: government-ID, payment-card or financial-account numbers; immigration status; caste; a minor user's own age or date of birth; sexual history or activity; sexual, physical or other abuse; criminal history, violence or crime-victim status; suicide, self-harm or disordered eating; health or personality inferences the user did not state. Outside that list, stated health, sexual orientation, gender identity, race, ethnicity, religion, political beliefs, union membership, disability and finances follow your system prompt's privacy rules: write them as stated. Omissions get no placeholder or reworded form.";

const ifVersionSchema = z
  .string()
  .min(1)
  .describe(
    'Pass the 12-character version token from your most recent MemoryRead or MemoryWrite of this file. For a file that does not yet exist (not shown in the listing), pass the literal word new (without quotes). For any file already in the listing, MemoryRead it first to get its version token — the listing itself does not contain version tokens. Never invent a value.',
  );

export function buildMemoryListTool(deps: MemoryToolDeps): MakaTool {
  return {
    name: TOOL_NAMES.memoryList,
    displayName: 'List memory',
    activityKind: 'read',
    categoryHint: 'read',
    recoveryMode: 'idempotent',
    description:
      'List memory documents (optionally under a path prefix), sorted by path. Returns path, size, and last-updated time for each. Results are capped; use cursor to page through large stores, or narrow with path_prefix. Set include_preview=true to also get a one-line content preview per file. Use MemoryRead for full content.',
    parameters: z
      .object({
        path_prefix: z
          .string()
          .nullable()
          .optional()
          .describe(
            'Optional path prefix to filter results (e.g. /topics/ lists only docs under /topics/). Matching is directory-aligned: a bare prefix is treated as a directory (/topics and /topics/ are equivalent), and a file path matches nothing — use MemoryRead for a single file. Results are capped — narrow with a prefix or page with cursor for large stores.',
          ),
        include_preview: z
          .boolean()
          .optional()
          .describe(
            "If true, include a one-line preview of each file's content (the frontmatter ``description:`` value, or first non-empty body line if absent). Slower — requires reading every file. Use when deciding which files to MemoryRead.",
          ),
        cursor: z
          .string()
          .nullable()
          .optional()
          .describe(
            'Path of the last entry from a previous call. Returns entries after this path. Use with the same path_prefix to page through a large directory.',
          ),
      })
      .strict(),
    impl: async (args: {
      path_prefix?: string | null;
      include_preview?: boolean;
      cursor?: string | null;
    }) => {
      await admit(deps, TOOL_NAMES.memoryList);
      const page = await withPathErrors(TOOL_NAMES.memoryList, () =>
        deps.store.list({ pathPrefix: args.path_prefix ?? null, cursor: args.cursor ?? null }),
      );
      if (page.entries.length === 0) return '(empty)';
      const lines: string[] = [];
      for (const entry of page.entries) {
        lines.push(
          `${entry.path}  (${entry.byteLength} bytes, updated ${formatMemoryTimestamp(entry.updatedAt)})`,
        );
        if (args.include_preview) {
          const record = await deps.store.read(entry.path);
          lines.push(`  ${record ? memoryFilePreview(record.content) : ''}`);
        }
      }
      if (page.nextCursor !== null) {
        lines.push(`More files follow; pass cursor="${page.nextCursor}" to continue.`);
      }
      return lines.join('\n');
    },
  };
}

export function buildMemoryReadTool(deps: MemoryToolDeps): MakaTool {
  return {
    name: TOOL_NAMES.memoryRead,
    displayName: 'Read memory',
    activityKind: 'read',
    categoryHint: 'read',
    recoveryMode: 'idempotent',
    description:
      "Read one or more memory documents. Returns each document's content and last-updated time. Pass a list of paths to read several files in a single call instead of one call per file.",
    parameters: z
      .object({
        path: z
          .union([z.string(), z.array(z.string()).min(1).max(MEMORY_READ_MAX_PATHS)])
          .describe(
            `Path of the memory document to read (e.g. /topics/schedule.md), or a list of up to ${MEMORY_READ_MAX_PATHS} paths to read together in one call.`,
          ),
      })
      .strict(),
    impl: async (args: { path: string | readonly string[] }) => {
      await admit(deps, TOOL_NAMES.memoryRead);
      const paths = typeof args.path === 'string' ? [args.path] : args.path;
      if (paths.length === 1) {
        const record = await withPathErrors(TOOL_NAMES.memoryRead, () =>
          deps.store.read(paths[0]!),
        );
        if (!record) throw new Error(`${TOOL_NAMES.memoryRead} failed: not found`);
        return renderReadEnvelope(record);
      }
      const blocks: string[] = [];
      for (const path of paths) {
        let record: MemoryToolFileRecord | undefined;
        try {
          record = await deps.store.read(path);
        } catch (error) {
          if (!(error instanceof MemoryPathError)) throw error;
          blocks.push(
            `== ${path} ==\n<error>${TOOL_NAMES.memoryRead} failed: ${error.message}</error>`,
          );
          continue;
        }
        blocks.push(
          record
            ? `== ${path} ==\n${renderReadEnvelope(record)}`
            : `== ${path} ==\n<error>${TOOL_NAMES.memoryRead} failed: not found</error>`,
        );
      }
      return blocks.join('\n\n');
    },
  };
}

function renderReadEnvelope(record: MemoryToolFileRecord): string {
  return `[updated: ${formatMemoryTimestamp(record.updatedAt)}] [version: ${record.version}] (pass as if_version on your next ${TOOL_NAMES.memoryWrite} to this path)\n${record.content}`;
}

export function buildMemoryWriteTool(deps: MemoryToolDeps): MakaTool {
  return {
    name: TOOL_NAMES.memoryWrite,
    displayName: 'Write memory',
    activityKind: 'edit',
    categoryHint: 'custom_tool',
    executionSemantics: 'exclusive_step',
    recoveryMode: 'idempotent',
    description: `Create or update a memory document with full content. Overwrites if the path already exists: content replaces the ENTIRE document — this is not an append or a patch. Include every existing line you intend to keep; any line you omit is deleted. Use this to save durable patterns you learn about the user — not today's specific events. Always pass if_version: the version token from your most recent MemoryRead or MemoryWrite of this path, or the literal word new (without quotes) for a file that does not yet exist. The listing shows paths but not version tokens, so for any file already there you must MemoryRead it first. Writes with if_version=new to an existing path are rejected so you can't overwrite content you haven't seen. Both the rejection and a version conflict return the current content so you can merge and retry. The result includes the new version token for follow-up writes. ${PRIVACY_PARAGRAPH}`,
    parameters: z
      .object({
        path: z
          .string()
          .describe('Path of the document to create or update (e.g. /topics/schedule.md).'),
        content: z
          .string()
          .describe(
            'Full text content to write (UTF-8). Replaces the entire document — any line you omit is deleted. Empty or whitespace-only content is rejected. Size-capped; oversized writes are rejected with the byte limit in the error.',
          ),
        if_version: ifVersionSchema,
      })
      .strict(),
    impl: async (args: { path: string; content: string; if_version: string }) => {
      await admit(deps, TOOL_NAMES.memoryWrite);
      const result = await withPathErrors(TOOL_NAMES.memoryWrite, () =>
        deps.store.write({ path: args.path, content: args.content, ifVersion: args.if_version }),
      );
      return renderMutation(TOOL_NAMES.memoryWrite, args.path, result);
    },
  };
}

export function buildMemoryStrReplaceTool(deps: MemoryToolDeps): MakaTool {
  return {
    name: TOOL_NAMES.memoryStrReplace,
    displayName: 'Edit memory',
    activityKind: 'edit',
    categoryHint: 'custom_tool',
    executionSemantics: 'exclusive_step',
    recoveryMode: 'idempotent',
    description: `Edit a memory document by replacing one exact text match. old_str must match the file content in exactly one place, including whitespace and newlines — zero or multiple matches are rejected (widen old_str with surrounding text until it is unique). new_str replaces it; pass an empty new_str to delete the matched text. Cheaper than MemoryWrite for small edits — you send only the text that changes, not the whole file. Always pass if_version: the version token from your most recent MemoryRead or MemoryWrite of this path; edits require one, so MemoryRead the file first if you do not have it. A version conflict or a failed match returns the current content so you can retry in one turn. The result includes the new version token for follow-up edits. ${PRIVACY_PARAGRAPH}`,
    parameters: z
      .object({
        path: z
          .string()
          .describe('Path of the memory document to edit (e.g. /topics/schedule.md).'),
        old_str: z
          .string()
          .min(1)
          .describe(
            'Exact text to replace. Must match the file content in exactly one place, including whitespace and newlines — the edit is rejected on zero or multiple matches. Make it unique by including surrounding text.',
          ),
        new_str: z
          .string()
          .describe('Replacement text. Pass an empty string to delete the matched text.'),
        if_version: z
          .string()
          .min(1)
          .describe(
            'Pass the 12-character version token from your most recent MemoryRead or MemoryWrite of this file. Required — if you do not have one, MemoryRead the file first. Never invent a value.',
          ),
      })
      .strict(),
    impl: async (args: { path: string; old_str: string; new_str: string; if_version: string }) => {
      await admit(deps, TOOL_NAMES.memoryStrReplace);
      const result = await withPathErrors(TOOL_NAMES.memoryStrReplace, () =>
        deps.store.strReplace({
          path: args.path,
          oldStr: args.old_str,
          newStr: args.new_str,
          ifVersion: args.if_version,
        }),
      );
      return renderMutation(TOOL_NAMES.memoryStrReplace, args.path, result);
    },
  };
}

export function buildMemoryAppendTool(deps: MemoryToolDeps): MakaTool {
  return {
    name: TOOL_NAMES.memoryAppend,
    displayName: 'Append memory',
    activityKind: 'edit',
    categoryHint: 'custom_tool',
    executionSemantics: 'exclusive_step',
    recoveryMode: 'idempotent',
    description: `Add text to the end of a memory document without resending its content. The appended text is placed on a new line after the existing content. Cheaper than MemoryWrite for adding a fact to an existing file — you send only the addition. Always pass if_version: the version token from your most recent MemoryRead or MemoryWrite of this path, or the literal word new (without quotes) to create the file. Appends with if_version=new to an existing path are rejected and return the current content so you can retry with its version. Do not append a fact the file already states — update it with MemoryStrReplace instead; files are size-capped, so prefer editing and condensing over repeated appends. The result includes the new version token. ${PRIVACY_PARAGRAPH}`,
    parameters: z
      .object({
        path: z
          .string()
          .describe('Path of the memory document to append to (e.g. /topics/schedule.md).'),
        content: z
          .string()
          .min(1)
          .describe(
            'Text to add at the end of the file (UTF-8). A newline separates it from the existing content. The merged file is size-capped; oversized results are rejected with the byte limit in the error.',
          ),
        if_version: ifVersionSchema,
      })
      .strict(),
    impl: async (args: { path: string; content: string; if_version: string }) => {
      await admit(deps, TOOL_NAMES.memoryAppend);
      const result = await withPathErrors(TOOL_NAMES.memoryAppend, () =>
        deps.store.append({ path: args.path, content: args.content, ifVersion: args.if_version }),
      );
      return renderMutation(TOOL_NAMES.memoryAppend, args.path, result);
    },
  };
}

export function buildMemoryDeleteTool(deps: MemoryToolDeps): MakaTool {
  return {
    name: TOOL_NAMES.memoryDelete,
    displayName: 'Delete memory',
    activityKind: 'edit',
    categoryHint: 'custom_tool',
    executionSemantics: 'exclusive_step',
    recoveryMode: 'idempotent',
    description:
      "Delete a memory document. You must pass if_version from a prior MemoryRead of the same path — this proves you've seen what you're deleting and catches concurrent changes. Use ONLY when the user explicitly asks to delete or forget an entire file or subject; for removing a single line, use MemoryWrite with that line removed instead. Never delete proactively to clean up, deduplicate, or because a file looks stale.",
    parameters: z
      .object({
        path: z
          .string()
          .describe('Path of the memory document to delete (e.g. /topics/old-hobby.md).'),
        if_version: z
          .string()
          .min(1)
          .describe(
            "Concurrency token from the most recent MemoryRead of this path (shown as ``[version: <token>]`` in the read result). Required: deletes are irrecoverable, so you must read the file first and pass its current version to prove you've seen what you're removing. Never invent a value — use only a token returned by a prior tool call.",
          ),
      })
      .strict(),
    impl: async (args: { path: string; if_version: string }) => {
      await admit(deps, TOOL_NAMES.memoryDelete);
      const result = await withPathErrors(TOOL_NAMES.memoryDelete, () =>
        deps.store.delete({ path: args.path, ifVersion: args.if_version }),
      );
      return renderMutation(TOOL_NAMES.memoryDelete, args.path, result);
    },
  };
}

async function admit(deps: MemoryToolDeps, toolName: string): Promise<void> {
  const gate = await deps.gate();
  if (gate.allowed) return;
  const why =
    gate.reason === 'incognito'
      ? 'off in incognito'
      : gate.reason === 'draining'
        ? 'unavailable while Copilot shuts down'
        : 'turned off in Settings';
  throw new Error(`${toolName} failed: memory is ${why}; nothing was read or saved.`);
}

async function withPathErrors<T>(toolName: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof MemoryPathError) throw new Error(`${toolName} failed: ${error.message}`);
    throw error;
  }
}

function currentContentBlock(current: MemoryToolFileRecord): string {
  return `Current version: ${current.version}. Current content follows.\n---\n${current.content}`;
}

function renderMutation(toolName: string, path: string, result: MemoryToolMutationResult): string {
  switch (result.kind) {
    case 'written': {
      const lines = [
        `${result.created ? 'Created' : 'Saved'} ${path} (version: ${result.version}, ${result.byteLength} of ${MEMORY_FILE_MAX_BYTES} bytes).`,
      ];
      if (result.byteLength >= MEMORY_FILE_MAX_BYTES * MEMORY_FILE_NEAR_CAP_RATIO) {
        lines.push(
          'This file is nearly full. Reorganize rather than trim: merge overlapping points, drop stale detail, or move a grown topic into its own file, leaving real headroom for later updates.',
        );
      }
      return lines.join('\n');
    }
    case 'deleted':
      return `Deleted ${path}.`;
    // Every branch below is the store working correctly and saying no, with
    // the reason and the way forward. Thrown as plain Errors they reached the
    // transcript as `failed` — the grade for something broken, in danger red —
    // and the renderer had to sniff which one it was with a regex over this
    // very text. `result.kind` is the vocabulary; it travels as the class.
    //
    // `summary` exists because four of these hand the MODEL the file's current
    // content so it can merge and retry in the same turn. That is right for
    // the model and wrong for a row header, which would show the reader 512
    // characters of their own memory file.
    case 'exists':
      throw new ToolRefusal(
        `${toolName} failed: ${path} already exists — if_version must be its version token, not ${MEMORY_NEW_VERSION}. ${currentContentBlock(result.current)}`,
        {
          class: result.kind,
          summary: `${path} already exists — read it first, then write with its version token.`,
        },
      );
    case 'not_found':
      throw new ToolRefusal(
        toolName === TOOL_NAMES.memoryStrReplace || toolName === TOOL_NAMES.memoryDelete
          ? `${toolName} failed: ${path} does not exist.`
          : `${toolName} failed: ${path} does not exist — pass if_version ${MEMORY_NEW_VERSION} to create it.`,
        { class: result.kind, summary: `${path} does not exist.` },
      );
    case 'version_conflict':
      throw new ToolRefusal(
        `${toolName} failed: version conflict on ${path} — it changed since you read it. Merge your change into the current content and retry with the current version. ${currentContentBlock(result.current)}`,
        {
          class: result.kind,
          summary: `${path} changed since it was read; the change is being merged and retried.`,
        },
      );
    case 'old_str_not_found':
      throw new ToolRefusal(
        `${toolName} failed: old_str not found in ${path} — it must match the file content exactly, including whitespace and newlines. ${currentContentBlock(result.current)}`,
        {
          class: result.kind,
          summary: `The text to replace was not found in ${path}.`,
        },
      );
    case 'old_str_ambiguous':
      throw new ToolRefusal(
        `${toolName} failed: old_str matches ${result.matches} places in ${path} — widen it with surrounding text until it matches exactly once. ${currentContentBlock(result.current)}`,
        {
          class: result.kind,
          summary: `The text to replace appears ${result.matches} times in ${path}.`,
        },
      );
    case 'oversize':
      throw new ToolRefusal(
        `${toolName} failed: the file would be ${result.byteLength} bytes; the limit is ${result.limit} bytes. Condense it — merge overlapping points, drop stale detail, or split the topic — and retry.`,
        { class: result.kind },
      );
    case 'empty':
      throw new ToolRefusal(`${toolName} failed: content is empty; nothing was saved.`, {
        class: result.kind,
      });
  }
}
