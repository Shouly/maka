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

// Where a tool result too long to show goes instead.
//
// A tool result stays in the model's context exactly as it was produced, so a
// tool bounds its own output once, when the result is made. What does not fit
// is saved here and the model is given the path: it reads the file with Read
// or searches it with Grep when it needs the rest. One folder per Session,
// made when the Session first saves something and removed with the Session.
// Folders are private to the user (0700) and files too (0600): the root is in
// the temp directory, which other users may share.

import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, rm, rmdir, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { estimateTokens } from './context-budget-helpers.js';

/** A saved result past this many bytes keeps only its start. */
export const TOOL_RESULT_FILE_MAX_BYTES = 64 * 1024 * 1024;

const PRIVATE_FOLDER = 0o700;
const PRIVATE_FILE = 0o600;

/**
 * Every id reaches a path join, and the Session one reaches a recursive
 * delete, so none is taken on trust: a separator or a `..` would write or
 * delete outside the root.
 */
const PATH_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/u;

function segment(value: string, what: string): string {
  if (!PATH_SEGMENT.test(value)) throw new Error(`Unsafe ${what} for a tool result path`);
  return value;
}

/**
 * Where a tool result too long to show is saved on this machine, one folder
 * per Session. The temp directory, for the reason background task output lives
 * there: every permission mode reads it. The desktop opens a saved result only
 * from inside this folder.
 */
export function toolResultRoot(): string {
  return join(tmpdir(), 'maka', 'tool-results');
}

/** `<root>/<sessionId>`: the one folder a Session's saved results go in. */
export function toolResultSessionFolder(root: string, sessionId: string): string {
  return join(root, segment(sessionId, 'Session id'));
}

/** `<root>/<sessionId>/<name>.txt`. */
export function toolResultFilePath(root: string, sessionId: string, name: string): string {
  return join(toolResultSessionFolder(root, sessionId), `${segment(name, 'file name')}.txt`);
}

/**
 * A name for one saved result. Never the tool call id: a provider can use the
 * same id twice, and the second result must not land on the first.
 */
export function newToolResultFileName(): string {
  return randomUUID();
}

/**
 * Where a running command keeps one stream of its output until it is known
 * whether it will be saved: `<root>/<name>.<stream>.partial`, outside every
 * Session folder, so a run that saves nothing leaves no folder behind.
 */
export function toolResultWorkingFilePath(
  root: string,
  name: string,
  stream: 'stdout' | 'stderr',
): string {
  return join(root, `${segment(name, 'file name')}.${stream}.partial`);
}

/** Make `root` if it is missing, private to the user. */
export async function makeToolResultRoot(root: string): Promise<void> {
  await mkdir(root, { recursive: true, mode: PRIVATE_FOLDER });
}

/** A working file untouched for this long was left by a process that ended under its run. */
export const STALE_WORKING_FILE_MS = 24 * 60 * 60 * 1000;
const WORKING_FILE_NAME = /^[A-Za-z0-9_-]{1,128}\.(?:stdout|stderr)\.partial$/u;
const sweptRoots = new Map<string, Promise<void>>();

/**
 * Remove the working files a crashed process left in `root`, once per root in
 * this process; every later call answers with the same sweep. Only files
 * untouched for {@link STALE_WORKING_FILE_MS} go: another app on this machine
 * can share the root, and the files of its running commands are newer.
 */
export function sweepStaleWorkingFiles(root: string): Promise<void> {
  let sweep = sweptRoots.get(root);
  if (!sweep) {
    sweep = removeWorkingFilesOlderThan(root, Date.now() - STALE_WORKING_FILE_MS);
    sweptRoots.set(root, sweep);
  }
  return sweep;
}

/** Remove the working files in `root` last written before `before` (ms since the epoch). Never rejects. */
export async function removeWorkingFilesOlderThan(root: string, before: number): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !WORKING_FILE_NAME.test(entry.name)) return;
      const path = join(root, entry.name);
      const stats = await lstat(path).catch(() => undefined);
      if (stats?.isFile() && stats.mtimeMs < before) {
        await rm(path, { force: true }).catch(() => undefined);
      }
    }),
  );
}

/** A new working file, private to the user; an existing one is never written through. */
export function workingFileOptions(): { flags: 'wx'; mode: number } {
  return { flags: 'wx', mode: PRIVATE_FILE };
}

export interface SavedToolResult {
  readonly path: string;
  /** Characters the file holds. */
  readonly chars: number;
  /**
   * The file does not hold all of the text: only its start was kept at the
   * size limit, or, for a command's output, a line too long to keep was left
   * out.
   */
  readonly truncated: boolean;
}

/**
 * A tool still running when its Session is retired must not make the folder
 * again after the purge, while a Session that takes the same id later (the
 * WorkHub coordination Session's id is fixed) saves as any other. So a tool
 * takes a ticket when it starts, and a save is refused when the folder was
 * purged after its ticket. Purges are numbered in order; the most recent
 * {@link PURGED_FOLDERS_KEPT} purged folders are remembered, with the number
 * each was purged at.
 */
let purgeCount = 0;
const purgedFolders = new Map<string, number>();
const PURGED_FOLDERS_KEPT = 1_000;

/** Taken when a tool starts, for each save it makes; see {@link writeToolResultFile}. */
export function toolResultSaveTicket(): number {
  return purgeCount;
}

function purgedSince(folder: string, ticket: number): boolean {
  return (purgedFolders.get(folder) ?? Number.NEGATIVE_INFINITY) > ticket;
}

/**
 * Create the saved result at `path` and fill it with `write`. The file is new
 * and private; its Session folder is made if missing. When `write` fails, or
 * the Session was purged after `ticket` (by default, after this call) and
 * before the file is finished, the file is removed, and so is the folder when
 * this made it, and the call throws.
 */
export async function writeToolResultFile<T>(
  path: string,
  write: (handle: FileHandle) => Promise<T>,
  ticket = toolResultSaveTicket(),
): Promise<T> {
  const folder = dirname(path);
  if (purgedSince(folder, ticket)) throw new Error('The Session was retired');
  const made = await mkdir(folder, { recursive: true, mode: PRIVATE_FOLDER });
  let handle: FileHandle | undefined;
  let created = false;
  try {
    handle = await open(path, 'wx', PRIVATE_FILE);
    created = true;
    const value = await write(handle);
    await handle.close();
    handle = undefined;
    // A purge that ran while this was written removed or will remove the
    // folder; whatever this made after it goes too.
    if (purgedSince(folder, ticket)) throw new Error('The Session was retired');
    return value;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    // Only a file this call created: one that was already there is not its own.
    if (created) await rm(path, { force: true }).catch(() => undefined);
    if (made !== undefined || purgedSince(folder, ticket)) {
      // Only an empty folder goes: another result may have been saved there.
      await rmdir(folder).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Write `text` to `path`, keeping at most {@link TOOL_RESULT_FILE_MAX_BYTES}
 * of it. `ticket` is the one the tool took when it started.
 */
export async function saveToolResultText(
  path: string,
  text: string,
  ticket = toolResultSaveTicket(),
): Promise<SavedToolResult> {
  const kept = truncateUtf8(text, TOOL_RESULT_FILE_MAX_BYTES);
  await writeToolResultFile(path, (handle) => handle.writeFile(kept, 'utf8'), ticket);
  return { path, chars: kept.length, truncated: kept.length < text.length };
}

/** Drop every saved result of a Session, when the Session itself is retired. */
export async function purgeSessionToolResultFiles(root: string, sessionId: string): Promise<void> {
  const folder = toolResultSessionFolder(root, sessionId);
  // Marked before the delete starts, so a save that has not yet made the
  // folder never makes it, and one that has cleans up after itself.
  purgeCount++;
  purgedFolders.delete(folder);
  purgedFolders.set(folder, purgeCount);
  if (purgedFolders.size > PURGED_FOLDERS_KEPT) {
    purgedFolders.delete(purgedFolders.keys().next().value!);
  }
  await rm(folder, { recursive: true, force: true });
}

/**
 * The sentence that stands in for a saved result: how long it is, where it is,
 * and how to get at it.
 */
export function savedToolResultNotice(saved: SavedToolResult): string {
  const read = 'read it with Read or search it with Grep.';
  return saved.truncated
    ? `Output too long to show. Its first ${formatCount(saved.chars)} characters (${TOOL_RESULT_FILE_MAX_BYTES / (1024 * 1024)} MiB) are saved to ${saved.path}; ${read}`
    : `Output too long to show (${formatCount(saved.chars)} characters). The full output is saved to ${saved.path}; ${read}`;
}

/** Tokens a text is estimated at: its UTF-8 bytes over four. */
export function estimateTextTokens(text: string): number {
  return estimateTokens(Buffer.byteLength(text, 'utf8'));
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** The longest start of `text` that fits `maxBytes` of UTF-8, never splitting a character. */
export function truncateUtf8(text: string, maxBytes: number): string {
  // A UTF-16 unit is at most three UTF-8 bytes, and at least one.
  if (text.length * 3 <= maxBytes) return text;
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) return text;
  // Back up over continuation bytes (10xxxxxx) to the start of a character.
  let end = Math.max(0, maxBytes);
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

/**
 * The first `maxChars` UTF-16 units of `text`, or fewer: a cut never leaves
 * half a surrogate pair at the end, even one `text` itself ends with.
 */
export function sliceAtCharacter(text: string, maxChars: number): string {
  let end = Math.max(0, Math.min(maxChars, text.length));
  if (end > 0 && isHighSurrogate(text.charCodeAt(end - 1))) end--;
  return end === text.length ? text : text.slice(0, end);
}

/**
 * The last `maxChars` UTF-16 units of `text`, or fewer: a cut never leaves
 * half a surrogate pair at the start, even one `text` itself starts with.
 */
export function sliceEndAtCharacter(text: string, maxChars: number): string {
  let start = Math.max(0, text.length - Math.max(0, maxChars));
  if (start < text.length && isLowSurrogate(text.charCodeAt(start))) start++;
  return start === 0 ? text : text.slice(start);
}

export function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
