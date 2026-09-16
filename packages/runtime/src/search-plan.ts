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

// packages/runtime/src/search-plan.ts
// How Grep and Glob turn tool arguments into work, shared by the two backends.
//
// Grep and Glob each run in two places — the sandboxed filesystem worker and
// the host-local workspace executor — and the two must answer identically, or
// the tool's contract changes with the boundary the session happens to carry.
// The ripgrep argument vector, the head-limit arithmetic and the newest-first
// ordering therefore live here rather than being written twice.

import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import type { GrepOutputMode } from './filesystem-worker/protocol.js';

/**
 * The ceiling on Grep result lines regardless of what the caller asked for.
 * `head_limit: 0` means "no limit of mine", not "no limit at all": a single
 * unbounded search must not be able to spend a whole context window.
 */
export const GREP_HARD_LINE_CAP = 2_000;

/**
 * How many glob matches are collected before ordering. Newest-first is a
 * property of the whole match set, so the walk has to over-collect past the
 * returned limit; this bounds how far.
 */
export const GLOB_SCAN_CAP = 2_000;

export interface RipgrepPlanInput {
  readonly pattern: string;
  readonly path: string;
  readonly mode: GrepOutputMode;
  readonly glob?: string | undefined;
  /** Ripgrep `--type` name ("js", "py", "rust", …). */
  readonly type?: string | undefined;
  readonly ignoreCase?: boolean | undefined;
  /** Lines of context after each match (`-A`); content mode only. */
  readonly after?: number | undefined;
  /** Lines of context before each match (`-B`); content mode only. */
  readonly before?: number | undefined;
  /** Print line numbers (`-n`); content mode only, on unless explicitly false. */
  readonly lineNumbers?: boolean | undefined;
  readonly multiline?: boolean | undefined;
  readonly maxCountPerFile: number;
}

/**
 * The ripgrep argv for one search. `--` is always the last flag so an
 * option-like pattern ("-webkit-box", "--flag") is a pattern and not a
 * misparsed switch, and `--with-filename` is forced so a single-file search
 * prints the same `path:...` shape a directory search does.
 */
export function buildRipgrepArgs(input: RipgrepPlanInput): string[] {
  const args: string[] = [];
  if (input.ignoreCase) args.push('-i');
  if (input.multiline) args.push('-U', '--multiline-dotall');
  if (input.glob) args.push('--glob', input.glob);
  if (input.type) args.push('--type', input.type);
  if (input.mode === 'files_with_matches') {
    args.push('--files-with-matches');
  } else if (input.mode === 'count') {
    // Per-file occurrence counts, not per-file matching-line counts: the
    // model asked how often the pattern appears.
    args.push('--count-matches', '--with-filename');
  } else {
    // Line numbers are the default in content mode — `path:line:text` is the
    // shape the tool advertises — and only an explicit `-n: false` drops them.
    if (input.lineNumbers !== false) args.push('-n');
    args.push('--no-heading', '--with-filename', `--max-count=${input.maxCountPerFile}`);
    args.push(...contextArgs(input.before, input.after));
  }
  args.push('--', input.pattern, input.path);
  return args;
}

/**
 * `-C n` when both sides ask for the same window, `-B`/`-A` when they differ.
 * The collapsed form is what a person writes and what a reader recognises; the
 * split form exists because ripgrep has no single flag for an asymmetric one.
 */
function contextArgs(before: number | undefined, after: number | undefined): string[] {
  if (before === undefined && after === undefined) return [];
  if (before === after) return before && before > 0 ? ['-C', String(before)] : [];
  const args: string[] = [];
  if (before !== undefined && before > 0) args.push('-B', String(before));
  if (after !== undefined && after > 0) args.push('-A', String(after));
  return args;
}

export interface GrepHeadLimitResult {
  readonly matches: string[];
  readonly truncated: boolean;
  readonly omitted: number;
}

/**
 * Split ripgrep's stdout into lines and apply the head limit.
 *
 * `offset` pages past a window the caller has already seen, so `omitted` counts
 * only what lies BEYOND the returned window: lines the caller deliberately
 * skipped are not news, and reporting them as dropped would make every paged
 * call look truncated.
 */
export function applyGrepHeadLimit(stdout: string, limit: number, offset = 0): GrepHeadLimitResult {
  const lines = stdout.split('\n').filter(Boolean);
  const start = Math.min(Math.max(Math.trunc(offset) || 0, 0), lines.length);
  const matches = lines.slice(start, start + limit);
  const omitted = lines.length - start - matches.length;
  return { matches, truncated: omitted > 0, omitted };
}

/**
 * Keep the `limit` most recently modified matches and answer with them
 * OLDEST first, so the freshest file is the last line of the result.
 *
 * The two halves are deliberately different orders: the cap has to keep the
 * newest matches (dropping them would be dropping the answer), while the
 * printed order puts the newest at the end, where the reader's eye already is
 * after a long list.
 *
 * Paths come back absolute. A relative path is only meaningful next to the
 * search root, which the result does not carry, and every other tool that
 * consumes one — Read, Edit, the interface's file links — wants it absolute.
 *
 * A file whose mtime cannot be read (deleted between the walk and the stat,
 * or unreadable) sorts oldest rather than failing the call: a search result is
 * worth more than a perfect order. Ties keep the walk's own order, so a tree
 * written in one operation still reads deterministically.
 */
export async function orderGlobMatchesByRecency(
  base: string,
  files: readonly string[],
  limit: number,
): Promise<{ files: string[]; truncated: boolean }> {
  const ordered = await sortByModifiedTime(base, files);
  const kept = ordered.slice(0, limit);
  kept.reverse();
  return { files: kept.map((file) => resolve(base, file)), truncated: ordered.length > limit };
}

async function sortByModifiedTime(base: string, files: readonly string[]): Promise<string[]> {
  const stamped: { file: string; mtimeMs: number; index: number }[] = [];
  const CONCURRENCY = 64;
  for (let start = 0; start < files.length; start += CONCURRENCY) {
    const batch = files.slice(start, start + CONCURRENCY);
    const stats = await Promise.all(
      batch.map(async (file) => {
        try {
          return (await fs.stat(resolve(base, file))).mtimeMs;
        } catch {
          return Number.NEGATIVE_INFINITY;
        }
      }),
    );
    for (const [offset, file] of batch.entries()) {
      stamped.push({
        file,
        mtimeMs: stats[offset] ?? Number.NEGATIVE_INFINITY,
        index: start + offset,
      });
    }
  }
  stamped.sort((left, right) =>
    left.mtimeMs === right.mtimeMs ? left.index - right.index : right.mtimeMs - left.mtimeMs,
  );
  return stamped.map((entry) => entry.file);
}
