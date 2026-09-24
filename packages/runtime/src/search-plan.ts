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
// The ripgrep argument vectors, the head-limit arithmetic and the Glob walk
// therefore live here rather than being written twice.

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { GrepOutputMode } from './filesystem-worker/protocol.js';

/** How many Glob paths are listed; the rest are counted, not listed. */
export const GLOB_RESULT_LIMIT = 100;

/** How long one Glob lets ripgrep run. */
export const GLOB_TIMEOUT_MS = 20_000;

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
  /** Print only the matched parts of each line (`-o`); content mode only. */
  readonly onlyMatching?: boolean | undefined;
  readonly multiline?: boolean | undefined;
}

/** Version-control metadata Grep never searches, hidden files or not. */
const VCS_DIRECTORIES = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl'];

/**
 * The ripgrep argv for one search. `--` is always the last flag so an
 * option-like pattern ("-webkit-box", "--flag") is a pattern and not a
 * misparsed switch. Hidden files are searched, version-control directories
 * are not; `.gitignore` is ripgrep's to apply, which it does inside a git
 * repository only. A search of one file prints its lines without the path, as
 * ripgrep does by default.
 */
export function buildRipgrepArgs(input: RipgrepPlanInput): string[] {
  const args: string[] = ['--hidden'];
  for (const directory of VCS_DIRECTORIES) args.push('--glob', `!${directory}`);
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
    if (input.onlyMatching) args.push('-o');
    args.push('--no-heading');
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
  /** Count mode: occurrences and files over every line, before the limit. */
  readonly countTotal?: { readonly occurrences: number; readonly files: number };
}

/**
 * Split ripgrep's stdout into lines and apply the head limit; a missing limit
 * returns them all.
 *
 * `offset` pages past a window the caller has already seen, so `omitted` counts
 * only what lies BEYOND the returned window: lines the caller deliberately
 * skipped are not news, and reporting them as dropped would make every paged
 * call look truncated.
 */
export function applyGrepHeadLimit(
  stdout: string,
  limit: number | undefined,
  offset = 0,
  mode?: GrepOutputMode,
): GrepHeadLimitResult {
  const lines = stdout.split('\n').filter(Boolean);
  const start = Math.min(Math.max(Math.trunc(offset) || 0, 0), lines.length);
  const matches = lines.slice(start, limit === undefined ? undefined : start + limit);
  const omitted = lines.length - start - matches.length;
  return {
    matches,
    truncated: omitted > 0,
    omitted,
    ...(mode === 'count' ? { countTotal: countTotals(lines) } : {}),
  };
}

/** `path:count` lines summed: the totals the count answer states. */
function countTotals(lines: readonly string[]): { occurrences: number; files: number } {
  let occurrences = 0;
  for (const line of lines) {
    const count = Number(line.slice(line.lastIndexOf(':') + 1));
    if (Number.isFinite(count)) occurrences += count;
  }
  return { occurrences, files: lines.length };
}

/**
 * Grep lists matching files newest first, ties by name, and only then applies
 * the head limit, so a capped list keeps the most recently touched files.
 * ripgrep itself prints them in whatever order its threads finish.
 * A file that cannot be stat'd sorts oldest rather than failing the search.
 */
export async function orderGrepFilesNewestFirst(stdout: string): Promise<string> {
  const files = stdout.split('\n').filter(Boolean);
  const stamped = await Promise.all(
    files.map(async (file) => ({
      file,
      mtimeMs: await fs
        .stat(file)
        .then((stat) => stat.mtimeMs)
        .catch(() => 0),
    })),
  );
  stamped.sort(
    (left, right) => right.mtimeMs - left.mtimeMs || left.file.localeCompare(right.file),
  );
  return stamped.map((entry) => entry.file).join('\n');
}

/**
 * One ripgrep output line with its path spelled as the call wrote the search
 * root. ripgrep prints the path it was handed, which the search resolved
 * (`/tmp` → `/private/tmp` on macOS), so the resolved root is swapped back
 * for the written one. The root is either a directory, followed by a
 * separator, or the one file searched, followed by `:` (a match or count) or
 * `-` (a context line).
 */
export function respellSearchLine(line: string, resolvedRoot: string, writtenRoot: string): string {
  if (resolvedRoot === writtenRoot) return line;
  // Concatenated, never `join`ed: the rest of the line is matched text, which
  // path normalisation would rewrite (`http://` to `http:/`, `./` dropped).
  if (line.startsWith(`${resolvedRoot}${sep}`))
    return `${writtenRoot.endsWith(sep) ? writtenRoot.slice(0, -1) : writtenRoot}${line.slice(resolvedRoot.length)}`;
  if (line === resolvedRoot) return writtenRoot;
  if (line.startsWith(`${resolvedRoot}:`) || line.startsWith(`${resolvedRoot}-`))
    return `${writtenRoot}${line.slice(resolvedRoot.length)}`;
  return line;
}

const RIPGREP_INPUT_ERROR =
  /^rg: (?:regex parse error|error parsing glob|unrecognized file type|error parsing flag|compiled regex exceeds size limit)/m;

/**
 * Whether a ripgrep run answered the search. Exit 2 means some path failed,
 * not the search: an unreadable directory under the root still leaves every
 * other match in stdout, and those are the answer. It is a failure only when
 * nothing was printed and ripgrep refused the input itself — the pattern, a
 * glob, a type name.
 */
export function ripgrepAnswered(exitCode: number, printed: boolean, stderr: string): boolean {
  if (exitCode === 0 || exitCode === 1) return true;
  if (exitCode !== 2) return false;
  return printed || !RIPGREP_INPUT_ERROR.test(stderr);
}

/**
 * Grep's failure sentence. ripgrep refusing the pattern, a glob or a type
 * name is named as such; anything else is a search that failed.
 */
export function grepFailureMessage(stderr: string): string {
  const detail = stderr.trim();
  if (RIPGREP_INPUT_ERROR.test(detail)) {
    return `Search failed — ripgrep rejected the pattern, glob, or file type without searching:\n${detail}`;
  }
  return detail
    ? `Grep failed while searching files.\n${detail}`
    : 'Grep failed while searching files.';
}

/**
 * An absolute pattern names its own search directory, and it wins over
 * `path`: the literal segments before the first glob character become the
 * directory, the rest the pattern. A pattern with no glob character is a file
 * name under its parent. Relative patterns are left alone.
 */
export function splitAbsoluteGlobPattern(
  pattern: string,
): { readonly root: string; readonly pattern: string } | undefined {
  if (!isAbsolute(pattern)) return undefined;
  const glob = /[*?[{]/.exec(pattern);
  if (!glob) return { root: dirname(pattern), pattern: basename(pattern) };
  const literal = pattern.slice(0, glob.index);
  const cut = Math.max(literal.lastIndexOf('/'), literal.lastIndexOf(sep));
  if (cut === -1) return undefined;
  let root = cut === 0 ? '/' : literal.slice(0, cut);
  if (/^[A-Za-z]:$/.test(root)) root += sep;
  return { root, pattern: pattern.slice(cut + 1) };
}

/**
 * A pattern that repeats the end of its own search root — `docs/*.md` under
 * `…/docs` — means the root, not a `docs` directory inside it. When no such
 * directory exists, the repeated segments are dropped and the rest anchored
 * at the root.
 */
export async function anchorRepeatedGlobPrefix(root: string, pattern: string): Promise<string> {
  const segments = pattern.split('/');
  let literal = 0;
  while (
    literal < segments.length - 1 &&
    segments[literal] !== '' &&
    !/[*?[\]{}!]/.test(segments[literal] ?? '')
  )
    literal++;
  const rootSegments = root.split(/[\\/]+/).filter(Boolean);
  for (let count = literal; count > 0; count--) {
    const head = segments.slice(0, count);
    const tail = rootSegments.slice(-count);
    if (tail.length !== count || !head.every((segment, index) => segment === tail[index])) continue;
    return (await isRealDirectoryChain(root, head))
      ? pattern
      : `/${segments.slice(count).join('/')}`;
  }
  return pattern;
}

async function isRealDirectoryChain(root: string, segments: readonly string[]): Promise<boolean> {
  let cursor = root;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    try {
      const stat = await fs.lstat(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    } catch {
      return false;
    }
  }
  return segments.length > 0;
}

/** Glob's matches: paths relative to the search root. */
export interface GlobSearchResult {
  /** At most the requested limit, oldest first. */
  readonly files: string[];
  /** Every match, listed or not. */
  readonly total: number;
}

/** `stderr` names the paths ripgrep could not read, even on success. */
export type GlobSearchOutcome =
  | ({ readonly ok: true; readonly stderr: string } & GlobSearchResult)
  | { readonly ok: false; readonly reason: 'failed' | 'timeout'; readonly stderr: string };

export const GLOB_TIMEOUT_MESSAGE = `Ripgrep search timed out after ${GLOB_TIMEOUT_MS / 1000} seconds. The search may have matched files but did not complete in time. Try searching a more specific path or pattern.`;

const MAX_GLOB_STDERR_BYTES = 16 * 1024;

/**
 * Glob is ripgrep listing files: every file under the root, dotfiles and
 * ignored files included, symlinks neither listed nor followed,
 * case-sensitive, ascending by modification time. A pattern without a `/`
 * matches a file name at any depth; one with a `/` is anchored at the root.
 *
 * ripgrep anchors a slash glob only when it runs from the root and searches
 * `.`, so that is how it is launched. Only the first `limit` paths are kept;
 * the rest are counted as they stream past, so a huge tree costs a counter.
 */
export async function ripgrepGlob(input: {
  readonly executable: string;
  readonly root: string;
  readonly pattern: string;
  readonly limit: number;
  readonly abortSignal?: AbortSignal | undefined;
}): Promise<GlobSearchOutcome> {
  const pattern = await anchorRepeatedGlobPrefix(input.root, input.pattern);
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(
      input.executable,
      [
        '--files',
        '--null',
        '--glob',
        pattern,
        '--sort=modified',
        '--no-ignore',
        '--hidden',
        '--',
        '.',
      ],
      {
        cwd: input.root,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(input.abortSignal ? { signal: input.abortSignal } : {}),
      },
    );
    const files: string[] = [];
    let total = 0;
    let pending = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    const settle = (outcome: GlobSearchOutcome | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (outcome instanceof Error) reject(outcome);
      else resolvePromise(outcome);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ ok: false, reason: 'timeout', stderr: '' });
    }, GLOB_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => {
      let data = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk;
      let end = data.indexOf(0);
      while (end !== -1) {
        total++;
        if (files.length < input.limit)
          files.push(rootRelative(data.subarray(0, end).toString('utf8')));
        data = data.subarray(end + 1);
        end = data.indexOf(0);
      }
      // A path cut off by a failed run never gets its terminator and is not
      // counted.
      pending = Buffer.from(data);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]);
      if (stderr.length > MAX_GLOB_STDERR_BYTES)
        stderr = stderr.subarray(stderr.length - MAX_GLOB_STDERR_BYTES);
    });
    child.once('error', (error) => settle(error));
    child.once('close', (exitCode) => {
      const detail = stderr.toString('utf8').trim();
      settle(
        ripgrepAnswered(exitCode ?? 2, total > 0, detail)
          ? { ok: true, files, total, stderr: detail }
          : { ok: false, reason: 'failed', stderr: detail },
      );
    });
  });
}

function rootRelative(path: string): string {
  return path.startsWith(`.${sep}`) || path.startsWith('./') ? path.slice(2) : path;
}

/**
 * Glob where ripgrep cannot run — the Windows sandbox preview, which cannot
 * start a grandchild process, or a runtime without ripgrep. Node's walk
 * cannot match ripgrep's answer exactly (it follows the platform's case rule
 * and skips dotfiles), so this keeps what it can: slash-less patterns recurse,
 * only regular files answer, and the order and count are the same.
 */
export async function nodeGlob(input: {
  readonly root: string;
  readonly pattern: string;
  readonly limit: number;
}): Promise<GlobSearchResult> {
  const anchored = await anchorRepeatedGlobPrefix(input.root, input.pattern);
  // ripgrep only filters what it finds under the root, so `..` matches
  // nothing; Node's walk would follow it out of the root.
  if (anchored.split(/[\\/]/).includes('..')) return { files: [], total: 0 };
  const pattern =
    anchored === ''
      ? '**/*'
      : anchored.startsWith('/')
        ? anchored.slice(1)
        : anchored.includes('/')
          ? anchored
          : `**/${anchored}`;
  const stamped: { file: string; mtimeMs: number }[] = [];
  for await (const entry of fs.glob(pattern, { cwd: input.root, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const file = relative(input.root, path);
    if (file.startsWith('..') || isAbsolute(file)) continue;
    const mtimeMs = await fs
      .stat(path)
      .then((stat) => stat.mtimeMs)
      .catch(() => Number.NEGATIVE_INFINITY);
    stamped.push({ file, mtimeMs });
  }
  // Array sort is stable, so equal times keep the walk's order.
  stamped.sort((left, right) => left.mtimeMs - right.mtimeMs);
  return {
    files: stamped.slice(0, input.limit).map((entry) => entry.file),
    total: stamped.length,
  };
}
