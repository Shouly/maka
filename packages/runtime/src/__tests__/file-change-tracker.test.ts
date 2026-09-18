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
import { describe, test } from 'node:test';
import {
  FILE_MODIFIED_SINCE_READ_MESSAGE,
  type FileChangeTrackerFs,
  type FileStatSnapshot,
  FileChangeTrackerRegistry,
  SessionFileChangeTracker,
} from '../file-change-tracker.js';

/** A filesystem the test moves by hand. */
function fakeFs(): FileChangeTrackerFs & {
  files: Map<string, FileStatSnapshot>;
  touch(path: string, text: string): void;
} {
  const files = new Map<string, FileStatSnapshot>();
  let clock = 1_000;
  return {
    files,
    touch(path, text) {
      clock += 1;
      files.set(path, { mtimeMs: clock, size: text.length });
    },
    async stat(path) {
      return files.get(path);
    },
  };
}

describe('the file-change tracker', () => {
  test('a write from a stale baseline is refused until a read; unknown or vanished files are not its call', async () => {
    const fs = fakeFs();
    const tracker = new SessionFileChangeTracker(fs);
    fs.touch('/w/c.txt', 'written');
    await tracker.noteWritten('/w/c.txt');
    await tracker.assertUnchanged('/w/c.txt');
    fs.touch('/w/c.txt', 'written\nBASH_APPEND');
    await assert.rejects(tracker.assertUnchanged('/w/c.txt'), {
      message: FILE_MODIFIED_SINCE_READ_MESSAGE,
    });
    // Still stale after a second outside change; a read refreshes.
    fs.touch('/w/c.txt', 'written\nBASH_APPEND_2');
    await assert.rejects(tracker.assertUnchanged('/w/c.txt'));
    await tracker.noteRead('/w/c.txt');
    await tracker.assertUnchanged('/w/c.txt');
    // A read establishes a baseline too.
    fs.touch('/w/b.txt', 'made outside');
    await tracker.noteRead('/w/b.txt');
    fs.touch('/w/b.txt', 'made outside\nmore');
    await assert.rejects(tracker.assertUnchanged('/w/b.txt'));
    // Unknown to the session, or gone from disk: not this guard's call.
    await tracker.assertUnchanged('/w/never.txt');
    fs.files.delete('/w/c.txt');
    await tracker.assertUnchanged('/w/c.txt');
    assert.equal(tracker.has('/w/c.txt'), true);
    assert.equal(tracker.has('/w/never.txt'), false);
  });

  test('the registry hands out one tracker per session', () => {
    const registry = new FileChangeTrackerRegistry(fakeFs());
    assert.equal(registry.forSession('a'), registry.forSession('a'));
    assert.notEqual(registry.forSession('a'), registry.forSession('b'));
  });
});
