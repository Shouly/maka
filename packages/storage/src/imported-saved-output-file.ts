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

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { syncDirectoryChain } from './stable-storage.js';

export interface PublishImportedSavedOutputFileInput {
  readonly from: string;
  readonly to: string;
  readonly stateRoot: string;
  /** Synchronous ownership registration, before any post-publication IO. */
  onCreated(path: string): void;
  /** Accept an identical existing file, or throw the caller's conflict error. */
  onExisting(): Promise<void>;
}

export interface ImportedSavedOutputFileHandle {
  writeFile(bytes: Uint8Array): Promise<void>;
  chmod(mode: number): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface ImportedSavedOutputFileDependencies {
  open(path: string, flags: 'wx', mode: number): Promise<ImportedSavedOutputFileHandle>;
  link(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
  randomUUID(): string;
  syncDirectoryChain(directory: string, root: string): Promise<void>;
}

const defaultDependencies: ImportedSavedOutputFileDependencies = {
  open,
  link,
  unlink,
  randomUUID,
  syncDirectoryChain,
};

/**
 * Publish complete, private bytes without replacing a destination. The caller
 * validates the managed parent directories and owns rollback after publication.
 * A crash before publication leaves only a uniquely named working file, which
 * neither blocks a retry nor matches a saved output's exported file name.
 */
export async function publishImportedSavedOutputFile(
  input: PublishImportedSavedOutputFileInput,
  dependencies: Partial<ImportedSavedOutputFileDependencies> = {},
): Promise<void> {
  const deps = { ...defaultDependencies, ...dependencies };
  const staging = join(dirname(input.to), `.${basename(input.to)}.${deps.randomUUID()}.import.tmp`);
  let stagingCreated = false;
  try {
    const output = await deps.open(staging, 'wx', 0o600);
    stagingCreated = true;
    try {
      await copySavedOutput(input.from, output);
      if (process.platform !== 'win32') await output.chmod(0o600);
      await output.sync();
      await output.close();
    } catch (error) {
      await output.close().catch(() => {});
      throw error;
    }

    try {
      await deps.link(staging, input.to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await input.onExisting();
      return;
    }
    // Even a directory sync can fail. The importing transaction must already
    // know this file belongs to its attempt when any later operation fails.
    input.onCreated(input.to);
    await deps.syncDirectoryChain(dirname(input.to), input.stateRoot);
  } finally {
    // An exclusive open that failed did not give us ownership of its path.
    if (stagingCreated) await deps.unlink(staging).catch(() => {});
  }
}

/** Stream the hydrated bundle's immutable file; no additional size limit or full-file buffer. */
async function copySavedOutput(from: string, output: ImportedSavedOutputFileHandle): Promise<void> {
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK;
  const source = await open(from, constants.O_RDONLY | noFollow);
  try {
    const before = await source.stat({ bigint: true });
    if (!before.isFile()) throw new Error('Imported saved output is not a regular file');
    let copied = 0n;
    for await (const chunk of source.createReadStream({ autoClose: false })) {
      const bytes = chunk as Buffer;
      copied += BigInt(bytes.byteLength);
      if (copied > before.size) throw new Error('Imported saved output changed while being read');
      await output.writeFile(bytes);
    }
    const after = await source.stat({ bigint: true });
    if (copied !== before.size || after.size !== before.size || after.mtimeNs !== before.mtimeNs) {
      throw new Error('Imported saved output changed while being read');
    }
  } finally {
    await source.close();
  }
}
