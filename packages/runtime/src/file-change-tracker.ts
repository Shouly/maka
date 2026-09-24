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

// Which files a session's file tools have read or written, and whether each
// still is as the model last saw it.
//
// One fact per file: the BASELINE (mtime, size) from the last time a file
// tool read or wrote it. A Write against a file whose baseline no longer
// matches is refused until a Read refreshes it — it would replace changes the
// model never saw. An Edit there still applies, since its old_string has to be
// in the file as it is now, and says the file changed. A file with no baseline
// — never read — may be written and edited; only NotebookEdit insists on a
// Read first. The last Read's range is kept too, so the same Read repeated in
// a turn is answered by pointing back at the first.
//
// Bounded like the ledger it replaces: least-recently-used eviction on both
// the sessions and the paths within one, because a long-lived host must not
// grow a set per session forever. Forgetting an entry costs one extra Read.

import { stat } from 'node:fs/promises';

/** `File has been modified since read…` — the Write/Edit refusal for a stale baseline. */
export const FILE_MODIFIED_SINCE_READ_MESSAGE =
  'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.';

export interface FileStatSnapshot {
  readonly mtimeMs: number;
  readonly size: number;
}

/** The filesystem the tracker looks at; a test hands in a fake. */
export interface FileChangeTrackerFs {
  /** `undefined` when the path does not exist or cannot be read. */
  stat(path: string): Promise<FileStatSnapshot | undefined>;
}

export const NODE_FILE_CHANGE_TRACKER_FS: FileChangeTrackerFs = {
  async stat(path) {
    try {
      const metadata = await stat(path);
      return metadata.isFile() ? { mtimeMs: metadata.mtimeMs, size: metadata.size } : undefined;
    } catch {
      return undefined;
    }
  },
};

interface TrackedFile {
  baseline: FileStatSnapshot | undefined;
  /** The range the last Read showed, and in which turn; cleared by a write. */
  lastRead?: { readonly turnId: string; readonly range: string };
}

const MAX_TRACKED_SESSIONS = 256;
const MAX_TRACKED_PATHS_PER_SESSION = 2048;

function sameSnapshot(a: FileStatSnapshot | undefined, b: FileStatSnapshot | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function evictOldest<K>(map: Map<K, unknown>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) return;
    map.delete(oldest.value);
  }
}

export class SessionFileChangeTracker {
  readonly #files = new Map<string, TrackedFile>();
  readonly #fs: FileChangeTrackerFs;

  constructor(fs: FileChangeTrackerFs = NODE_FILE_CHANGE_TRACKER_FS) {
    this.#fs = fs;
  }

  /** Whether a file tool has read or written this (canonical) path in the session. */
  has(path: string | undefined): boolean {
    return path !== undefined && this.#files.has(path);
  }

  /**
   * A Read: refresh the baseline. `read` names the range it showed and the
   * turn it ran in, for {@link isRepeatRead}.
   */
  async noteRead(
    path: string | undefined,
    read?: { readonly turnId: string; readonly range: string },
  ): Promise<void> {
    if (!path) return;
    const entry = this.#touch(path);
    entry.baseline = await this.#fs.stat(path);
    if (read) entry.lastRead = read;
    else delete entry.lastRead;
  }

  /** A Write, Edit or patch landed: refresh the baseline. */
  async noteWritten(path: string | undefined): Promise<void> {
    if (!path) return;
    const entry = this.#touch(path);
    entry.baseline = await this.#fs.stat(path);
    delete entry.lastRead;
  }

  /**
   * Whether a Read would show exactly what the last one did: the same range,
   * of a file unchanged since, in the same turn. Only within a turn — an
   * earlier turn's result may have been compacted out of the conversation,
   * and "refer to that earlier result" must never point at nothing.
   */
  async isRepeatRead(path: string | undefined, turnId: string, range: string): Promise<boolean> {
    if (!path) return false;
    const entry = this.#files.get(path);
    if (!entry?.lastRead || !entry.baseline) return false;
    if (entry.lastRead.turnId !== turnId || entry.lastRead.range !== range) return false;
    return sameSnapshot(entry.baseline, await this.#fs.stat(path));
  }

  /** Whether the file changed on disk since the session last read or wrote it. */
  async isChangedSince(path: string | undefined): Promise<boolean> {
    if (!path) return false;
    const entry = this.#files.get(path);
    if (!entry?.baseline) return false;
    const current = await this.#fs.stat(path);
    return current !== undefined && !sameSnapshot(entry.baseline, current);
  }

  /**
   * Refuse a write from a stale shape. Only a file the session has a baseline
   * for can be stale; a file it never looked at is written as it is, and a
   * file that has since vanished is the write's own business (it may be
   * recreating it).
   */
  async assertUnchanged(path: string | undefined): Promise<void> {
    if (!path) return;
    const entry = this.#files.get(path);
    if (!entry?.baseline) return;
    const current = await this.#fs.stat(path);
    if (current === undefined) return;
    if (!sameSnapshot(entry.baseline, current)) {
      throw new Error(FILE_MODIFIED_SINCE_READ_MESSAGE);
    }
  }

  #touch(path: string): TrackedFile {
    const existing = this.#files.get(path);
    if (existing) {
      // Re-inserting moves the path to the end: eviction is least-recently-used.
      this.#files.delete(path);
      this.#files.set(path, existing);
      return existing;
    }
    const created: TrackedFile = { baseline: undefined };
    this.#files.set(path, created);
    evictOldest(this.#files, MAX_TRACKED_PATHS_PER_SESSION);
    return created;
  }
}

/**
 * One tracker per session, shared by every tool set built for the process.
 * Keyed by session because the tools are built once and serve every session.
 */
export class FileChangeTrackerRegistry {
  readonly #sessions = new Map<string, SessionFileChangeTracker>();
  readonly #fs: FileChangeTrackerFs;

  constructor(fs: FileChangeTrackerFs = NODE_FILE_CHANGE_TRACKER_FS) {
    this.#fs = fs;
  }

  forSession(sessionId: string): SessionFileChangeTracker {
    const existing = this.#sessions.get(sessionId);
    if (existing) {
      this.#sessions.delete(sessionId);
      this.#sessions.set(sessionId, existing);
      return existing;
    }
    const created = new SessionFileChangeTracker(this.#fs);
    this.#sessions.set(sessionId, created);
    evictOldest(this.#sessions, MAX_TRACKED_SESSIONS);
    return created;
  }
}
