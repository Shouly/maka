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

// What a memory tool row says, read back from the six tools' own results.
//
// The memory tools answer the model in plain text — a listing line per file,
// a read envelope with its version token, one sentence per write — and the
// transcript shows the reader the memory, not the protocol. So this module
// parses those texts into the pieces a row draws and keeps the handshake out:
// version tokens, `if_version` hints and cursor lines never reach a row.
//
// Pure, so every reading is a plain Node test. The React side is
// `tools/renderers/MemoryResult.tsx`.

import { TOOL_NAMES } from '@maka/core/tool-names';
import type { ToolActivityItem } from '@maka/ui';
import { durableResultOf } from './tool-delivery-results.js';

/** The action a memory tool is, which is what the row's verb follows. */
export type MemoryToolVerb = 'search' | 'read' | 'save' | 'update' | 'delete';

const VERB_BY_TOOL: ReadonlyMap<string, MemoryToolVerb> = new Map([
  [TOOL_NAMES.memoryList, 'search'],
  [TOOL_NAMES.memoryRead, 'read'],
  [TOOL_NAMES.memoryWrite, 'save'],
  [TOOL_NAMES.memoryStrReplace, 'update'],
  [TOOL_NAMES.memoryAppend, 'update'],
  [TOOL_NAMES.memoryDelete, 'delete'],
]);

export function memoryToolVerb(toolName: string): MemoryToolVerb | undefined {
  return VERB_BY_TOOL.get(toolName);
}

export function isMemoryTool(item: Pick<ToolActivityItem, 'toolName'>): boolean {
  return VERB_BY_TOOL.has(item.toolName);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The call's arguments: the durable set, or the live preview until it lands. */
export function memoryArgsOf(
  item: Pick<ToolActivityItem, 'args' | 'argsPreview'>,
): Record<string, unknown> {
  return asRecord(item.args) ?? asRecord(item.argsPreview) ?? {};
}

/**
 * The paths a call names. MemoryRead takes one path or a list; MemoryList
 * takes a prefix, which is a directory rather than a file but is still where
 * the call looked.
 */
export function memoryPathsOf(item: Pick<ToolActivityItem, 'args' | 'argsPreview'>): string[] {
  const args = memoryArgsOf(item);
  const path = args.path ?? args.path_prefix;
  if (typeof path === 'string') return path.length > 0 ? [path] : [];
  if (Array.isArray(path)) {
    return path.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  }
  return [];
}

/** `/topics/food.md` → `food.md`. */
export function memoryBasename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/**
 * `/areas/design-system.md` → `Areas › Design System`.
 *
 * The raw path in a narrow column truncates to `/areas/design-sys…`, which
 * says less than it costs. Memory is the user's own; it reads as a directory
 * of subjects, not as a filesystem.
 */
export function memoryBreadcrumb(path: string): string {
  return path
    .replace(/\.md$/iu, '')
    .split('/')
    .filter(Boolean)
    .map((segment) =>
      segment
        .split(/[-_]/u)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    )
    .join(' › ');
}

/** A memory tool's result as the text it is, or nothing when it is not text. */
export function memoryResultText(item: ToolActivityItem): string | undefined {
  const result = durableResultOf(item);
  return result?.kind === 'text' ? result.text : undefined;
}

export interface MemoryListEntry {
  readonly path: string;
  readonly byteLength: number;
  /** Epoch milliseconds, when the listing's timestamp parsed. */
  readonly updatedAt: number | undefined;
  readonly preview?: string;
}

const LIST_LINE = /^(\/\S*)\s+\((\d+) bytes, updated (.+?)\)\s*$/u;
const LIST_MORE = /^More files follow;/u;

/**
 * A MemoryList result: `path  (N bytes, updated <iso>)` per file, an
 * indented preview line under it when one was asked for. The paging line at
 * the end is the model's business and is dropped.
 */
export function parseMemoryListResult(text: string | undefined): MemoryListEntry[] {
  if (!text) return [];
  const entries: MemoryListEntry[] = [];
  for (const line of text.split('\n')) {
    const match = LIST_LINE.exec(line);
    if (match) {
      const parsed = Date.parse(match[3]!);
      entries.push({
        path: match[1]!,
        byteLength: Number(match[2]),
        updatedAt: Number.isNaN(parsed) ? undefined : parsed,
      });
      continue;
    }
    if (LIST_MORE.test(line)) continue;
    const last = entries.at(-1);
    if (line.startsWith('  ') && last && line.trim().length > 0) {
      entries[entries.length - 1] = { ...last, preview: line.trim() };
    }
  }
  return entries;
}

export interface MemoryReadDocument {
  /** Present in the multi-path form, where each block is headed by its path. */
  readonly path?: string;
  readonly updatedAt: number | undefined;
  /** The file as the user would see it; empty when the read failed. */
  readonly body: string;
  /** The error text a multi-path read carried for this path. */
  readonly error?: string;
}

const READ_HEADER = /^\[updated:\s*([^\]]*)\][^\n]*\n?/u;
const READ_BLOCK_HEADER = /^== (\/\S+) ==$/u;
const READ_BLOCK_ERROR = /^<error>([\s\S]*?)<\/error>$/u;

function parseReadEnvelope(text: string): Pick<MemoryReadDocument, 'updatedAt' | 'body'> {
  const match = READ_HEADER.exec(text);
  if (!match) return { updatedAt: undefined, body: text.trim() };
  const parsed = Date.parse(match[1]!.trim());
  return {
    updatedAt: Number.isNaN(parsed) ? undefined : parsed,
    body: text.slice(match[0].length).trim(),
  };
}

/**
 * A MemoryRead result: one envelope, or `== path ==` blocks for a list of
 * paths. The envelope's first line is the tool's metadata — the update time
 * the row shows, and the version token it does not.
 */
export function parseMemoryReadResult(text: string | undefined): MemoryReadDocument[] {
  if (!text) return [];
  const lines = text.split('\n');
  const blocks: { path: string; lines: string[] }[] = [];
  for (const line of lines) {
    const header = READ_BLOCK_HEADER.exec(line);
    if (header) {
      blocks.push({ path: header[1]!, lines: [] });
      continue;
    }
    blocks.at(-1)?.lines.push(line);
  }
  if (blocks.length === 0) {
    const envelope = parseReadEnvelope(text);
    return envelope.body.length > 0 ? [envelope] : [];
  }
  return blocks.map((block) => {
    const content = block.lines.join('\n').trim();
    const failed = READ_BLOCK_ERROR.exec(content);
    if (failed) return { path: block.path, updatedAt: undefined, body: '', error: failed[1]! };
    return { path: block.path, ...parseReadEnvelope(content) };
  });
}

/** The two refusals the model answers by merging and writing again. */
const MEMORY_SOFT_CONFLICT_CLASSES: ReadonlySet<string> = new Set(['version_conflict', 'exists']);

/**
 * A version conflict, or `new` on a path that exists, is not a failure in the
 * user's sense: the result hands the model the current content and it merges
 * and retries in the same turn. Such a row is not marked, or a self-healing
 * handshake would look like an accident.
 *
 * Read from the failure envelope, not from the result text. The text is
 * exactly what a live frame omits, so the regex this used to run could not
 * answer until the turn ended: the same write was drawn as a red failure while
 * it ran and as "merging…" once the transcript landed. The class rides the
 * event, so both phases now agree — and the renderer is out of the business of
 * guessing a failure's kind from its prose, which is the rule that removed
 * `memoryErrorKind`.
 *
 * MemoryDelete is the exception: it is the one tool the rules keep from
 * retrying on its own (read again, then decide), so its conflict is final and
 * the row must not sit on "Deleting…" forever.
 */
export function isMemorySoftConflict(item: ToolActivityItem): boolean {
  // The family check is not redundant: a class is a short token and these two
  // are generic words. Without it this predicate would silence a failure on
  // any tool that ever reports `version_conflict`, which is not what its name
  // promises — the merge-and-retry handshake is memory's.
  if (!isMemoryTool(item) || item.toolName === TOOL_NAMES.memoryDelete) return false;
  const failureClass = item.failure?.class;
  return failureClass !== undefined && MEMORY_SOFT_CONFLICT_CLASSES.has(failureClass);
}

/**
 * Whether opening a memory row shows anything: the content, not the handshake.
 *
 * A failed row is no longer decided here — `canExpandTool` opens every failure
 * before it asks. The six regexes that used to guess which failure it was, and
 * the six translated phrases they chose between, are gone with it: the reason
 * arrives as text on the failure envelope now, so the reader gets what memory
 * actually said instead of the nearest of six guesses (and "no space left on
 * device", matching none of them, used to read "Memory action failed" with the
 * real message unreachable).
 */
export function memoryCanExpand(item: ToolActivityItem): boolean {
  const verb = memoryToolVerb(item.toolName);
  if (!verb) return false;
  const args = memoryArgsOf(item);
  switch (verb) {
    case 'search':
      return parseMemoryListResult(memoryResultText(item)).length > 0;
    case 'read':
      return parseMemoryReadResult(memoryResultText(item)).some((doc) => doc.body.length > 0);
    case 'save':
      return typeof args.content === 'string' && args.content.length > 0;
    case 'update':
      if (item.toolName === TOOL_NAMES.memoryAppend) {
        return typeof args.content === 'string' && args.content.length > 0;
      }
      // A replace is drawn from its arguments, which are only whole once the
      // call has settled; live, the preview is bounded and may cut either side.
      if (item.status === 'running') return false;
      return (
        (typeof args.old_str === 'string' && args.old_str.length > 0) ||
        (typeof args.new_str === 'string' && args.new_str.length > 0)
      );
    case 'delete':
      return false;
  }
}
