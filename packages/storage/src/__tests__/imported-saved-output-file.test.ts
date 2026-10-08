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

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  publishImportedSavedOutputFile,
  type ImportedSavedOutputFileHandle,
  type PublishImportedSavedOutputFileInput,
} from '../imported-saved-output-file.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'maka-import-output-publication-'));
  const from = join(root, 'source.txt');
  const to = join(root, 'state', 'tool-results', 'session', 'result.txt');
  const bytes = Buffer.alloc(256 * 1024, 0x61);
  bytes.write('complete output', bytes.length - 15);
  await writeFile(from, bytes);
  await mkdir(dirname(to), { recursive: true, mode: 0o700 });
  const created: string[] = [];
  const input: PublishImportedSavedOutputFileInput = {
    from,
    to,
    stateRoot: join(root, 'state'),
    onCreated: (path) => created.push(path),
    onExisting: async () => {
      if (!(await readFile(to)).equals(bytes)) {
        throw Object.assign(new Error('Saved output conflicts'), { code: 'conflict' });
      }
    },
  };
  return {
    root,
    from,
    to,
    bytes,
    created,
    input,
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

test('publishes complete private bytes and registers ownership before syncing directories', async () => {
  const f = await fixture();
  try {
    await publishImportedSavedOutputFile(f.input, {
      syncDirectoryChain: async () => {
        assert.deepEqual(f.created, [f.to]);
        assert.deepEqual(await readFile(f.to), f.bytes);
      },
    });
    assert.deepEqual(await readdir(dirname(f.to)), [basename(f.to)]);
    if (process.platform !== 'win32') assert.equal((await stat(f.to)).mode & 0o777, 0o600);
  } finally {
    await f.dispose();
  }
});

test('a partially written staging file is removed and the retry succeeds', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      publishImportedSavedOutputFile(f.input, {
        open: async (path, flags, mode): Promise<ImportedSavedOutputFileHandle> => {
          const handle = await open(path, flags, mode);
          return {
            writeFile: async (bytes) => {
              await handle.writeFile(bytes.subarray(0, 4));
              throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
            },
            chmod: (mode) => handle.chmod(mode),
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      }),
      { code: 'ENOSPC' },
    );
    assert.deepEqual(f.created, []);
    assert.deepEqual(await readdir(dirname(f.to)), []);
    await publishImportedSavedOutputFile(f.input);
    assert.deepEqual(await readFile(f.to), f.bytes);
  } finally {
    await f.dispose();
  }
});

test('a post-publication sync failure leaves a complete file already registered for rollback', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      publishImportedSavedOutputFile(f.input, {
        syncDirectoryChain: async () => {
          assert.deepEqual(f.created, [f.to]);
          throw Object.assign(new Error('Directory sync failed'), { code: 'EIO' });
        },
      }),
      { code: 'EIO' },
    );
    assert.deepEqual(await readFile(f.to), f.bytes);
    assert.deepEqual(await readdir(dirname(f.to)), [basename(f.to)]);
    // The importing transaction owns this rollback; its retry can then publish.
    for (const path of f.created) await rm(path);
    f.created.length = 0;
    await publishImportedSavedOutputFile(f.input);
    assert.deepEqual(await readFile(f.to), f.bytes);
  } finally {
    await f.dispose();
  }
});

test('accepts an identical existing file without taking rollback ownership', async () => {
  const f = await fixture();
  try {
    await writeFile(f.to, f.bytes);
    const before = await stat(f.to);
    await publishImportedSavedOutputFile(f.input);
    assert.deepEqual(f.created, []);
    assert.equal((await stat(f.to)).ino, before.ino);
    assert.deepEqual(await readFile(f.to), f.bytes);
    assert.deepEqual(await readdir(dirname(f.to)), [basename(f.to)]);
  } finally {
    await f.dispose();
  }
});

test('preserves a conflicting existing file, including a partial file left by an older importer', async () => {
  const f = await fixture();
  try {
    await writeFile(f.to, 'old partial output');
    await assert.rejects(publishImportedSavedOutputFile(f.input), { code: 'conflict' });
    assert.deepEqual(f.created, []);
    assert.equal(await readFile(f.to, 'utf8'), 'old partial output');
    assert.deepEqual(await readdir(dirname(f.to)), [basename(f.to)]);
  } finally {
    await f.dispose();
  }
});

test('a leftover working file does not block publication or get removed by another attempt', async () => {
  const f = await fixture();
  try {
    const previous = join(dirname(f.to), `.${basename(f.to)}.previous-attempt.import.tmp`);
    await writeFile(previous, 'unfinished');
    await publishImportedSavedOutputFile(f.input);
    assert.deepEqual(await readFile(f.to), f.bytes);
    assert.equal(await readFile(previous, 'utf8'), 'unfinished');
    assert.deepEqual(
      (await readdir(dirname(f.to))).sort(),
      [basename(previous), basename(f.to)].sort(),
    );
  } finally {
    await f.dispose();
  }
});

test('does not delete a staging name it failed to create exclusively', async () => {
  const f = await fixture();
  try {
    const existing = join(dirname(f.to), `.${basename(f.to)}.collision.import.tmp`);
    await writeFile(existing, 'belongs to another attempt');
    await assert.rejects(
      publishImportedSavedOutputFile(f.input, { randomUUID: () => 'collision' }),
      { code: 'EEXIST' },
    );
    assert.equal(await readFile(existing, 'utf8'), 'belongs to another attempt');
    await assert.rejects(stat(f.to), { code: 'ENOENT' });
    assert.deepEqual(f.created, []);
  } finally {
    await f.dispose();
  }
});
