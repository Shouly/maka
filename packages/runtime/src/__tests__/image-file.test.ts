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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isWorkspaceImage, readWorkspaceImage, validateImageBytes } from '../image-file.js';
import { executeFilesystemOperation } from '../filesystem-worker/operations.js';
import { LocalWorkspaceExecutor } from '../workspace-executor.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

for (const route of ['workspace', 'worker'] as const) {
  for (const name of ['image.png', 'image', 'image.bin']) {
    test(`a ${route} Read returns a PNG named ${name} as an image`, async (t) => {
      const root = await realpath(await mkdtemp(join(tmpdir(), 'maka-image-name-')));
      t.after(() => rm(root, { recursive: true, force: true }));
      const path = join(root, name);
      await writeFile(path, ONE_PIXEL_PNG);
      if (route === 'workspace') {
        const file = await new LocalWorkspaceExecutor().readFile({ cwd: root, path });
        assert.ok('bytes' in file, 'PNG bytes must not become a UTF-8 text read');
        assert.deepEqual(Buffer.from(file.bytes), ONE_PIXEL_PNG);
      } else {
        const file = await executeFilesystemOperation(
          { kind: 'read', cwd: root, path },
          { filesystem: { entries: [{ path: root, access: 'read', scope: 'subtree' }] } },
        );
        assert.equal(file.kind, 'read_image');
        if (file.kind === 'read_image') assert.equal(file.base64, ONE_PIXEL_PNG.toString('base64'));
      }
    });
  }
}

test('text without an image extension stays text, and an unreadable file is left to the text path', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'maka-image-sniff-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'notes');
  for (const content of ['', 'short', '中文🙂首行\nsecond line\nlast']) {
    await writeFile(path, content);
    assert.equal(await isWorkspaceImage(path), false);
  }
  assert.deepEqual(
    await new LocalWorkspaceExecutor().readFile({ cwd: root, path, offset: 2, limit: 1 }),
    { content: 'second line', startLine: 2, totalLines: 3 },
  );
  assert.equal(await isWorkspaceImage(join(root, 'missing')), false);
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    await chmod(path, 0o000);
    assert.equal(await isWorkspaceImage(path), false);
    await chmod(path, 0o600);
  }
});

test('validateImageBytes rejects image signatures without parseable dimensions', () => {
  assert.throws(
    () => validateImageBytes(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')),
    /dimensions/i,
  );
});

test('validateImageBytes accepts a valid one-pixel image', () => {
  assert.deepEqual(validateImageBytes(ONE_PIXEL_PNG), {
    bytes: ONE_PIXEL_PNG,
    mimeType: 'image/png',
  });
});

test('validateImageBytes rejects non-positive image dimensions', () => {
  const png = Buffer.from(ONE_PIXEL_PNG);
  png.writeUInt32BE(0, 16);

  assert.throws(() => validateImageBytes(png), /dimensions/i);
});

test('readWorkspaceImage rejects images whose dimensions exceed the model input limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'maka-image-file-'));
  const path = join(root, 'oversized.png');
  const png = Buffer.alloc(33);
  Buffer.from('\x89PNG\r\n\x1a\n', 'latin1').copy(png);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(8001, 16);
  png.writeUInt32BE(8001, 20);
  png[24] = 8;
  png[25] = 6;
  await writeFile(path, png);

  try {
    await assert.rejects(readWorkspaceImage(path), /dimensions.*downscale/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
