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

import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

interface WorkspaceReservation {
  readonly cwd: string;
  readonly initialized: boolean;
}

/** Desktop owns allocation; the Session's persisted cwd owns the directory thereafter. */
export function createProjectlessWorkspaces(options: {
  readonly root: string;
  /** An empty context for global Skill discovery before a Session exists. */
  readonly previewRoot: string;
  /** Durable reservations for replayable background creation requests. */
  readonly reservationsRoot: string;
  readonly now?: () => Date;
}) {
  const pending = new Map<string, Promise<string>>();

  async function nextPath(): Promise<string> {
    const root = await ensureDirectory(options.root);
    const date = options.now?.() ?? new Date();
    const day = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    return join(await ensureDirectory(join(root, day)), `task-${randomUUID()}`);
  }

  async function reserved(key: string): Promise<string> {
    const records = await ensureDirectory(options.reservationsRoot);
    const file = join(records, `${createHash('sha256').update(key).digest('hex')}.json`);
    let raw: string | undefined;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const record: WorkspaceReservation = raw === undefined
      ? { cwd: await nextPath(), initialized: false }
      : JSON.parse(raw);
    if (
      !record ||
      typeof record.cwd !== 'string' ||
      !isAbsolute(record.cwd) ||
      typeof record.initialized !== 'boolean'
    ) {
      throw new Error('Invalid task workspace reservation');
    }
    const root = await existingDirectory(options.root);
    const child = relative(root, record.cwd);
    if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
      throw new Error('Invalid task workspace reservation');
    }
    if (record.initialized) {
      // A replay must not recreate a deleted workspace or undo the user's file changes.
      await existingDirectory(dirname(record.cwd));
      return existingDirectory(record.cwd);
    }
    // Reserve before creation; publish only after the directory exists.
    if (raw === undefined) await writeReservation(file, record);
    await ensureDirectory(dirname(record.cwd));
    await ensureDirectory(record.cwd);
    await writeReservation(file, { ...record, initialized: true });
    return record.cwd;
  }

  return {
    preview: () => ensureDirectory(options.previewRoot),
    async create(requestKey?: string): Promise<string> {
      if (requestKey !== undefined) {
        const existing = pending.get(requestKey);
        if (existing) return existing;
        const allocation = reserved(requestKey);
        pending.set(requestKey, allocation);
        try {
          return await allocation;
        } finally {
          pending.delete(requestKey);
        }
      }
      const cwd = await nextPath();
      await mkdir(cwd);
      return cwd;
    },
  };
}

async function ensureDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('The task workspace root must be an absolute path');
  await mkdir(path, { recursive: true });
  return existingDirectory(path);
}

async function existingDirectory(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('The task workspace root must be a directory, not a symbolic link');
  }
  return realpath(path);
}

async function writeReservation(file: string, record: WorkspaceReservation): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(record), { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
