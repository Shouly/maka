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
import test from 'node:test';
import { MAX_ATTACHMENT_DROP_COUNT } from '@maka/core/attachments';
import { withoutDroppedFolders } from '../../renderer/lib/dropped-folders.js';

const file = (name: string) => new File(['x'], name);

test('leaves the folders out of a drop and keeps the files beside them', async () => {
  const files = [file('a.txt'), file('Project'), file('b.png')];
  const checked = await withoutDroppedFolders(files, async () => [false, true, false]);
  assert.equal(checked.kind, 'checked');
  if (checked.kind !== 'checked') return;
  assert.deepEqual(
    checked.accepted.map((entry) => entry.name),
    ['a.txt', 'b.png'],
  );
  assert.equal(checked.folders, 1);
});

test('a drop that cannot be classified stages as before', async () => {
  const files = [file('a.txt'), file('b.txt')];
  for (const detect of [
    async () => {
      throw new Error('main unavailable');
    },
    async () => [],
  ]) {
    const checked = await withoutDroppedFolders(files, detect);
    assert.deepEqual(checked, { kind: 'checked', accepted: files, folders: 0 });
  }
});

test('a drop too large to check stages nothing and asks nobody', async () => {
  let asked = false;
  const checked = await withoutDroppedFolders(
    Array.from({ length: MAX_ATTACHMENT_DROP_COUNT + 1 }, (_, index) => file(`${index}.txt`)),
    async (files) => {
      asked = true;
      return files.map(() => false);
    },
  );
  assert.deepEqual(checked, { kind: 'too_many' });
  assert.equal(asked, false);
});
