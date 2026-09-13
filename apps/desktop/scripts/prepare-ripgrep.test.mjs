#!/usr/bin/env node
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
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  isPinned,
  readRipgrepManifest,
  ripgrepAsset,
  ripgrepBinaryName,
  ripgrepTarget,
} from './prepare-ripgrep.mjs';

test('the manifest names an asset with a well-formed digest for every platform the app ships on', () => {
  const entry = readRipgrepManifest();
  assert.match(entry.version, /^\d+\.\d+\.\d+$/u);
  for (const target of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64', 'linux-arm64']) {
    const asset = ripgrepAsset(entry, target);
    assert.ok(asset.url.startsWith(`https://github.com/${entry.repo}/releases/download/${entry.version}/`));
    assert.ok(asset.archive.includes(entry.version), asset.archive);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/u);
  }
  assert.throws(() => ripgrepAsset(entry, 'freebsd-x64'), /names no ripgrep asset/u);
});

test('targets are platform-arch, and only Windows gets an .exe', () => {
  assert.equal(ripgrepTarget('darwin', 'arm64'), 'darwin-arm64');
  assert.equal(ripgrepBinaryName('win32-x64'), 'rg.exe');
  assert.equal(ripgrepBinaryName('linux-arm64'), 'rg');
});

test('a binary without a matching pin is fetched again', () => {
  const root = mkdtempSync(join(tmpdir(), 'maka-rg-pin-'));
  try {
    const entry = readRipgrepManifest();
    const binary = join(root, 'rg');
    writeFileSync(binary, 'not really rg');
    // No stamp beside it: not pinned, whatever the bytes are.
    assert.equal(isPinned(entry, 'darwin-arm64', binary), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
