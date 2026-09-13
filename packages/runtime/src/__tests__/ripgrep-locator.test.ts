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
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import {
  RIPGREP_PATH_ENV,
  resolveRipgrepPath,
  ripgrepCandidates,
  ripgrepExecutableName,
} from '../ripgrep-locator.js';

test('the bundled copy is tried before PATH, then the package-manager prefixes', () => {
  const candidates = ripgrepCandidates(
    {
      [RIPGREP_PATH_ENV]: '/app/Resources/bin/rg',
      PATH: ['/usr/bin', '/home/me/bin'].join(delimiter),
    },
    'darwin',
  );
  assert.deepEqual(candidates, [
    '/app/Resources/bin/rg',
    '/usr/bin/rg',
    '/home/me/bin/rg',
    '/opt/homebrew/bin/rg',
    '/usr/local/bin/rg',
  ]);
});

test('Windows looks for rg.exe and has no Unix prefixes', () => {
  assert.equal(ripgrepExecutableName('win32'), 'rg.exe');
  const candidates = ripgrepCandidates({ PATH: ['C:\\tools', 'D:\\bin'].join(delimiter) }, 'win32');
  // Path joining follows the host (the tests run on every platform), so only
  // the shape is pinned: every candidate is an rg.exe and none is a Unix prefix.
  assert.ok(candidates.length >= 2);
  assert.ok(candidates.every((candidate) => candidate.endsWith('rg.exe')));
  assert.ok(
    candidates.every((candidate) => !candidate.startsWith('/opt') && !candidate.startsWith('/usr')),
  );
});

test('an empty or blank MAKA_RIPGREP_PATH is ignored; a blank PATH yields only the prefixes', () => {
  assert.deepEqual(ripgrepCandidates({ [RIPGREP_PATH_ENV]: '  ', PATH: '' }, 'linux'), [
    '/opt/homebrew/bin/rg',
    '/usr/local/bin/rg',
    '/usr/bin/rg',
  ]);
});

test('resolution takes the first executable candidate and skips the rest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'maka-rg-'));
  try {
    const bundled = join(root, 'bundled', 'rg');
    const onPath = join(root, 'path', 'rg');
    await writeFile(join(root, 'missing-marker'), '');
    await Promise.all([
      writeFile(bundled, '#!/bin/sh\n', { mode: 0o755 }).catch(async () => {
        await (await import('node:fs/promises')).mkdir(join(root, 'bundled'), { recursive: true });
        await writeFile(bundled, '#!/bin/sh\n', { mode: 0o755 });
      }),
    ]);
    await (await import('node:fs/promises')).mkdir(join(root, 'path'), { recursive: true });
    await writeFile(onPath, '#!/bin/sh\n', { mode: 0o755 });
    // A bundled path that is not executable falls through to PATH.
    await chmod(bundled, 0o644);
    assert.equal(
      await resolveRipgrepPath({ [RIPGREP_PATH_ENV]: bundled, PATH: join(root, 'path') }, 'linux'),
      await realpath(onPath),
    );
    await chmod(bundled, 0o755);
    assert.equal(
      await resolveRipgrepPath({ [RIPGREP_PATH_ENV]: bundled, PATH: join(root, 'path') }, 'linux'),
      await realpath(bundled),
    );
    assert.equal(
      await resolveRipgrepPath({ PATH: join(root, 'nowhere') }, 'linux' as NodeJS.Platform),
      process.platform === 'win32' ? undefined : await resolveRipgrepPath({ PATH: '' }, 'linux'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
