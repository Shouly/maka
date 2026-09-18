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
 * The memory filesystem on disk: `<storage root>/memory/<path>`, one Markdown
 * file per memory path, user-visible and user-editable in place.
 *
 * Every file's version is the hash of its content, so a version token proves
 * the caller has seen exactly what it is about to change — the optimistic
 * lock the six memory tools and the background pass all write through. Every
 * mutation is a temp-file-and-rename under one serialized lane per store, so
 * an in-turn write and the background pass never interleave inside a file.
 */

import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import {
  MEMORY_FILE_MAX_BYTES,
  MEMORY_LIST_PAGE_SIZE,
  MEMORY_NEW_VERSION,
  applyMemoryAppend,
  applyMemoryStrReplace,
  memoryFileByteLength,
  memoryFileVersion,
  normalizeMemoryPath,
  normalizeMemoryPathPrefix,
} from '@maka/core/memory-filesystem';
import {
  assertStorageRootLease,
  runWithStorageRootLease,
  type StorageRootLease,
} from './root-authority.js';
import { SerializedOperationLane } from './serialized-operation-lane.js';
import { syncDirectory, syncFile } from './stable-storage.js';

export const MEMORY_DIRECTORY = 'memory';

export interface MemoryFileStat {
  readonly path: string;
  readonly byteLength: number;
  readonly updatedAt: number;
}

export interface MemoryFileRecord extends MemoryFileStat {
  readonly content: string;
  readonly version: string;
}

export interface MemoryListInput {
  readonly pathPrefix?: string | null;
  /** The last path of the previous page. */
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface MemoryListResult {
  readonly entries: readonly MemoryFileStat[];
  /** Present when the page was cut; pass it back as `cursor`. */
  readonly nextCursor: string | null;
}

export type MemoryMutationResult =
  | {
      readonly kind: 'written';
      readonly created: boolean;
      readonly version: string;
      readonly byteLength: number;
    }
  | { readonly kind: 'deleted' }
  /** `if_version: new` on a path that already exists. */
  | { readonly kind: 'exists'; readonly current: MemoryFileRecord }
  /** A version token for a path that does not exist. */
  | { readonly kind: 'not_found' }
  | { readonly kind: 'version_conflict'; readonly current: MemoryFileRecord }
  | { readonly kind: 'old_str_not_found'; readonly current: MemoryFileRecord }
  | {
      readonly kind: 'old_str_ambiguous';
      readonly matches: number;
      readonly current: MemoryFileRecord;
    }
  | { readonly kind: 'oversize'; readonly byteLength: number; readonly limit: number }
  | { readonly kind: 'empty' };

export interface MemorySnapshot {
  /** Changes whenever any file's content, or the set of files, changes. */
  readonly revision: string;
  readonly files: readonly MemoryFileRecord[];
}

export interface InteractiveMemoryFileStoreWriter {
  readonly kind: 'interactive';
  readonly access: 'write';
  readonly [writerBrand]: true;
  /** Absolute path of the memory directory, for opening it in the file manager. */
  readonly directoryPath: string;
  list(input?: MemoryListInput): Promise<MemoryListResult>;
  read(path: string): Promise<MemoryFileRecord | undefined>;
  snapshot(): Promise<MemorySnapshot>;
  write(input: {
    readonly path: string;
    readonly content: string;
    readonly ifVersion: string;
  }): Promise<MemoryMutationResult>;
  strReplace(input: {
    readonly path: string;
    readonly oldStr: string;
    readonly newStr: string;
    readonly ifVersion: string;
  }): Promise<MemoryMutationResult>;
  append(input: {
    readonly path: string;
    readonly content: string;
    readonly ifVersion: string;
  }): Promise<MemoryMutationResult>;
  delete(input: {
    readonly path: string;
    readonly ifVersion: string;
  }): Promise<
    Extract<MemoryMutationResult, { kind: 'deleted' | 'not_found' | 'version_conflict' }>
  >;
}

const writerBrand: unique symbol = Symbol('InteractiveMemoryFileStoreWriter');
const writers = new WeakSet<object>();
const writerByLease = new WeakMap<object, InteractiveMemoryFileStoreWriter>();

export function authenticateInteractiveMemoryFileStoreWriter(
  store: InteractiveMemoryFileStoreWriter,
): InteractiveMemoryFileStoreWriter {
  if (!writers.has(store)) {
    throw new Error('Memory file store facade was not opened by this module');
  }
  return store;
}

export async function openInteractiveMemoryFileStoreForWrite(
  lease: StorageRootLease<'interactive', 'write'>,
): Promise<InteractiveMemoryFileStoreWriter> {
  await assertStorageRootLease(lease, 'interactive', 'write');
  const existing = writerByLease.get(lease);
  if (existing) return existing;
  const lane = new SerializedOperationLane(<T>(operation: (root: string) => Promise<T>) =>
    runWithStorageRootLease(lease, 'interactive', 'write', operation),
  );
  const inLane = <T>(operation: (directory: string) => Promise<T>): Promise<T> =>
    lane.run(async (root) => {
      const directory = join(root, MEMORY_DIRECTORY);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      return operation(directory);
    });
  const facade: InteractiveMemoryFileStoreWriter = Object.freeze({
    kind: 'interactive' as const,
    access: 'write' as const,
    [writerBrand]: true as const,
    directoryPath: join(lease.canonicalPath, MEMORY_DIRECTORY),
    list: (input: MemoryListInput = {}) => inLane((directory) => listFiles(directory, input)),
    read: (path: string) => inLane((directory) => readRecord(directory, normalizeMemoryPath(path))),
    snapshot: () => inLane((directory) => snapshotFiles(directory)),
    write: (input: Parameters<InteractiveMemoryFileStoreWriter['write']>[0]) =>
      inLane((directory) => writeFile(directory, input)),
    strReplace: (input: Parameters<InteractiveMemoryFileStoreWriter['strReplace']>[0]) =>
      inLane((directory) => strReplaceFile(directory, input)),
    append: (input: Parameters<InteractiveMemoryFileStoreWriter['append']>[0]) =>
      inLane((directory) => appendFile(directory, input)),
    delete: (input: Parameters<InteractiveMemoryFileStoreWriter['delete']>[0]) =>
      inLane((directory) => deleteFile(directory, input)),
  });
  writers.add(facade);
  writerByLease.set(lease, facade);
  return facade;
}

function diskPath(directory: string, memoryPath: string): string {
  return join(directory, ...memoryPath.slice(1).split('/'));
}

async function readRecord(
  directory: string,
  memoryPath: string,
): Promise<MemoryFileRecord | undefined> {
  const path = diskPath(directory, memoryPath);
  let content: string;
  let updatedAt: number;
  try {
    const [bytes, stats] = await Promise.all([readFile(path), stat(path)]);
    if (!stats.isFile()) return undefined;
    content = bytes.toString('utf8');
    updatedAt = Math.floor(stats.mtimeMs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return {
    path: memoryPath,
    content,
    version: memoryFileVersion(content),
    byteLength: memoryFileByteLength(content),
    updatedAt,
  };
}

async function walk(directory: string): Promise<readonly MemoryFileStat[]> {
  const found: MemoryFileStat[] = [];
  const pending: string[] = [directory];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const memoryPath = `/${relative(directory, entryPath).split(sep).join('/')}`;
      try {
        normalizeMemoryPath(memoryPath);
      } catch {
        // A file the user dropped in with a name the tools cannot address is
        // theirs to keep; it just does not appear to the model.
        continue;
      }
      const stats = await stat(entryPath);
      found.push({
        path: memoryPath,
        byteLength: stats.size,
        updatedAt: Math.floor(stats.mtimeMs),
      });
    }
  }
  return found.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
}

async function listFiles(directory: string, input: MemoryListInput): Promise<MemoryListResult> {
  const prefix = normalizeMemoryPathPrefix(input.pathPrefix);
  if (prefix === null) return { entries: [], nextCursor: null };
  const limit = Math.max(1, Math.min(input.limit ?? MEMORY_LIST_PAGE_SIZE, MEMORY_LIST_PAGE_SIZE));
  const all = (await walk(directory)).filter(
    (entry) => prefix === '/' || entry.path.startsWith(prefix),
  );
  const cursor = input.cursor ?? null;
  const after = cursor === null ? all : all.filter((entry) => entry.path > cursor);
  const page = after.slice(0, limit);
  return {
    entries: page,
    nextCursor: after.length > limit ? page.at(-1)!.path : null,
  };
}

async function snapshotFiles(directory: string): Promise<MemorySnapshot> {
  const files: MemoryFileRecord[] = [];
  for (const entry of await walk(directory)) {
    const record = await readRecord(directory, entry.path);
    if (record) files.push(record);
  }
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${file.path}\0${file.version}\0`);
  return { revision: hash.digest('hex').slice(0, 16), files };
}

async function persist(directory: string, memoryPath: string, content: string): Promise<void> {
  const target = diskPath(directory, memoryPath);
  const parent = dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = join(parent, `.${memoryPath.split('/').at(-1)}.${process.pid}.tmp`);
  const handle = await open(temporary, 'w', 0o600);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  await syncFile(target);
  await syncDirectory(parent);
}

function admitContent(
  content: string,
): Extract<MemoryMutationResult, { kind: 'oversize' | 'empty' }> | undefined {
  if (content.trim().length === 0) return { kind: 'empty' };
  const byteLength = memoryFileByteLength(content);
  if (byteLength > MEMORY_FILE_MAX_BYTES) {
    return { kind: 'oversize', byteLength, limit: MEMORY_FILE_MAX_BYTES };
  }
  return undefined;
}

async function writeFile(
  directory: string,
  input: { readonly path: string; readonly content: string; readonly ifVersion: string },
): Promise<MemoryMutationResult> {
  const memoryPath = normalizeMemoryPath(input.path);
  const refused = admitContent(input.content);
  if (refused) return refused;
  const current = await readRecord(directory, memoryPath);
  if (input.ifVersion === MEMORY_NEW_VERSION) {
    if (current) return { kind: 'exists', current };
  } else {
    if (!current) return { kind: 'not_found' };
    if (current.version !== input.ifVersion) return { kind: 'version_conflict', current };
  }
  await persist(directory, memoryPath, input.content);
  return {
    kind: 'written',
    created: current === undefined,
    version: memoryFileVersion(input.content),
    byteLength: memoryFileByteLength(input.content),
  };
}

async function strReplaceFile(
  directory: string,
  input: {
    readonly path: string;
    readonly oldStr: string;
    readonly newStr: string;
    readonly ifVersion: string;
  },
): Promise<MemoryMutationResult> {
  const memoryPath = normalizeMemoryPath(input.path);
  const current = await readRecord(directory, memoryPath);
  if (!current) return { kind: 'not_found' };
  if (current.version !== input.ifVersion) return { kind: 'version_conflict', current };
  const edited = applyMemoryStrReplace(current.content, input.oldStr, input.newStr);
  if (!edited.ok) {
    return edited.reason === 'not_found'
      ? { kind: 'old_str_not_found', current }
      : { kind: 'old_str_ambiguous', matches: edited.matches, current };
  }
  const refused = admitContent(edited.content);
  if (refused) return refused;
  await persist(directory, memoryPath, edited.content);
  return {
    kind: 'written',
    created: false,
    version: memoryFileVersion(edited.content),
    byteLength: memoryFileByteLength(edited.content),
  };
}

async function appendFile(
  directory: string,
  input: { readonly path: string; readonly content: string; readonly ifVersion: string },
): Promise<MemoryMutationResult> {
  const memoryPath = normalizeMemoryPath(input.path);
  if (input.content.length === 0) return { kind: 'empty' };
  const current = await readRecord(directory, memoryPath);
  if (input.ifVersion === MEMORY_NEW_VERSION) {
    if (current) return { kind: 'exists', current };
  } else {
    if (!current) return { kind: 'not_found' };
    if (current.version !== input.ifVersion) return { kind: 'version_conflict', current };
  }
  const content = applyMemoryAppend(current?.content ?? '', input.content);
  const refused = admitContent(content);
  if (refused) return refused;
  await persist(directory, memoryPath, content);
  return {
    kind: 'written',
    created: current === undefined,
    version: memoryFileVersion(content),
    byteLength: memoryFileByteLength(content),
  };
}

async function deleteFile(
  directory: string,
  input: { readonly path: string; readonly ifVersion: string },
): Promise<Extract<MemoryMutationResult, { kind: 'deleted' | 'not_found' | 'version_conflict' }>> {
  const memoryPath = normalizeMemoryPath(input.path);
  const current = await readRecord(directory, memoryPath);
  if (!current) return { kind: 'not_found' };
  if (current.version !== input.ifVersion) return { kind: 'version_conflict', current };
  const target = diskPath(directory, memoryPath);
  await rm(target, { force: true });
  await syncDirectory(dirname(target));
  return { kind: 'deleted' };
}
