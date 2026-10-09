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
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBoundedFileBytes } from '../file-bounded-bytes.js';

async function withFile(run: (file: string, root: string) => Promise<void>) {
  const root = await fs.mkdtemp(join(tmpdir(), 'maka-delivery-bytes-'));
  try {
    await run(join(root, 'test.bin'), root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('bounded delivery preserves binary and empty files and refuses oversize bytes', async () => {
  await withFile(async (file) => {
    const bytes = Buffer.from([0, 255, 254, 128, 10]);
    await fs.writeFile(file, bytes);
    assert.deepEqual(Buffer.from(await readBoundedFileBytes(file, bytes.length)), bytes);
    await assert.rejects(readBoundedFileBytes(file, bytes.length - 1), /size limit/);
    await fs.writeFile(file, '');
    assert.equal((await readBoundedFileBytes(file, 0)).length, 0);
    await assert.rejects(readBoundedFileBytes(file, -1), /Invalid file byte limit/);
  });
});

test('bounded delivery refuses directories and FIFOs without blocking', {
  timeout: 5_000,
}, async () => {
  await withFile(async (file, root) => {
    await assert.rejects(readBoundedFileBytes(root, 10), /not a regular file/);
    if (process.platform !== 'win32') {
      execFileSync('mkfifo', [file]);
      await assert.rejects(readBoundedFileBytes(file, 10), /not a regular file/);
    }
  });
});

test('bounded delivery honours cancellation before reading', async () => {
  await withFile(async (file) => {
    await fs.writeFile(file, 'readable');
    await assert.rejects(readBoundedFileBytes(file, 100, AbortSignal.abort()), {
      name: 'AbortError',
    });
  });
});

test('bounded delivery rejects a file rewritten during the read', async (t) => {
  await withFile(async (file) => {
    await fs.writeFile(file, Buffer.alloc(2 * 1024 * 1024, 0x61));
    const originalOpen = fs.open;
    const patched = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
      const handle = await originalOpen(...args);
      if (args[0] === file) {
        const read = handle.read.bind(handle);
        let changed = false;
        handle.read = (async (...params: Parameters<typeof handle.read>) => {
          const result = await read(...params);
          if (!changed) {
            changed = true;
            await fs.truncate(file, 0);
          }
          return result;
        }) as typeof handle.read;
      }
      return handle;
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(readBoundedFileBytes(file, 3 * 1024 * 1024), /changed while being read/);
    } finally {
      patched.mock.restore();
      syncBuiltinESMExports();
    }
  });
});
