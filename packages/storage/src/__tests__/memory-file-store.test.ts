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
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { MEMORY_FILE_MAX_BYTES, memoryFileVersion } from '@maka/core/memory-filesystem';
import {
  openInteractiveMemoryFileStoreForWrite,
  type InteractiveMemoryFileStoreWriter,
} from '../memory-file-store.js';
import { resolveStorageRoot, tryAcquireInteractiveRootOwner } from '../root-authority.js';
import {
  removeTrackedControlDirectories,
  trackControlDirectory,
} from './fixtures/control-directory-hygiene.js';

after(removeTrackedControlDirectories);

const FOOD = [
  '---',
  'name: food',
  'description: what they eat',
  'sources: [chat]',
  '---',
  '',
  '- [stated] drinks coffee every morning',
  '',
].join('\n');

async function withStore(
  run: (store: InteractiveMemoryFileStoreWriter, root: string) => Promise<void>,
): Promise<void> {
  const base = await mkdtemp(join(tmpdir(), 'maka-memory-file-store-'));
  const root = join(base, 'interactive');
  const capability = trackControlDirectory(
    await resolveStorageRoot({ path: root, kind: 'interactive' }),
  );
  const owner = await tryAcquireInteractiveRootOwner(capability);
  assert.ok(owner);
  if (!owner) return;
  try {
    await run(await openInteractiveMemoryFileStoreForWrite(owner.lease), root);
  } finally {
    await owner.close();
    await rm(base, { recursive: true, force: true });
  }
}

test('a new file is created with if_version new, then guarded by its content hash', async () => {
  await withStore(async (store, root) => {
    const written = await store.write({ path: '/topics/food.md', content: FOOD, ifVersion: 'new' });
    assert.equal(written.kind, 'written');
    if (written.kind !== 'written') return;
    assert.equal(written.created, true);
    assert.equal(written.version, memoryFileVersion(FOOD));
    assert.match(written.version, /^[0-9a-f]{12}$/);
    assert.equal(await readFile(join(root, 'memory', 'topics', 'food.md'), 'utf8'), FOOD);
    // No temp file is left behind.
    assert.deepEqual(await readdir(join(root, 'memory', 'topics')), ['food.md']);

    // `new` on an existing path is refused and hands the current content back.
    const again = await store.write({ path: '/topics/food.md', content: 'x', ifVersion: 'new' });
    assert.equal(again.kind, 'exists');
    if (again.kind === 'exists') assert.equal(again.current.content, FOOD);

    // A stale token is refused the same way.
    const stale = await store.write({
      path: '/topics/food.md',
      content: 'x',
      ifVersion: 'deadbeefdead',
    });
    assert.equal(stale.kind, 'version_conflict');

    // The right token replaces the whole file.
    const replaced = await store.write({
      path: '/topics/food.md',
      content: 'replaced',
      ifVersion: written.version,
    });
    assert.equal(replaced.kind, 'written');
    assert.equal((await store.read('/topics/food.md'))?.content, 'replaced');
  });
});

test('str_replace needs exactly one match, and append lands on a new line', async () => {
  await withStore(async (store) => {
    const written = await store.write({ path: '/topics/food.md', content: FOOD, ifVersion: 'new' });
    if (written.kind !== 'written') assert.fail(written.kind);

    const missing = await store.strReplace({
      path: '/topics/food.md',
      oldStr: 'tea',
      newStr: 'x',
      ifVersion: written.version,
    });
    assert.equal(missing.kind, 'old_str_not_found');
    const ambiguous = await store.strReplace({
      path: '/topics/food.md',
      oldStr: '-',
      newStr: 'x',
      ifVersion: written.version,
    });
    assert.equal(ambiguous.kind, 'old_str_ambiguous');
    if (ambiguous.kind === 'old_str_ambiguous') assert.equal(ambiguous.matches, 7);
    // Nothing changed on the failures.
    assert.equal((await store.read('/topics/food.md'))?.version, written.version);

    const edited = await store.strReplace({
      path: '/topics/food.md',
      oldStr: '- [stated] drinks coffee every morning',
      newStr: '- [stated] drinks tea now (previously coffee)',
      ifVersion: written.version,
    });
    assert.equal(edited.kind, 'written');
    if (edited.kind !== 'written') return;
    const appended = await store.append({
      path: '/topics/food.md',
      content: '- [stated] no cilantro',
      ifVersion: edited.version,
    });
    assert.equal(appended.kind, 'written');
    const record = await store.read('/topics/food.md');
    assert.ok(
      record?.content.endsWith(
        '- [stated] drinks tea now (previously coffee)\n- [stated] no cilantro',
      ),
    );

    // Append can also create.
    const created = await store.append({
      path: '/areas/oncall.md',
      content: '- [stated] on call this week',
      ifVersion: 'new',
    });
    assert.equal(created.kind, 'written');
    if (created.kind === 'written') assert.equal(created.created, true);
    // But an edit cannot.
    assert.equal(
      (
        await store.strReplace({
          path: '/people/nobody.md',
          oldStr: 'a',
          newStr: 'b',
          ifVersion: 'abc',
        })
      ).kind,
      'not_found',
    );
  });
});

test('delete needs the version from a read, and removes the file', async () => {
  await withStore(async (store) => {
    const written = await store.write({ path: '/people/sam.md', content: 'sam', ifVersion: 'new' });
    if (written.kind !== 'written') assert.fail(written.kind);
    assert.equal(
      (await store.delete({ path: '/people/sam.md', ifVersion: 'wrong' })).kind,
      'version_conflict',
    );
    assert.equal(
      (await store.delete({ path: '/people/sam.md', ifVersion: written.version })).kind,
      'deleted',
    );
    assert.equal(await store.read('/people/sam.md'), undefined);
    assert.equal(
      (await store.delete({ path: '/people/sam.md', ifVersion: written.version })).kind,
      'not_found',
    );
  });
});

test('listing is sorted, prefix-filtered, paged by cursor, and skips names the tools cannot address', async () => {
  await withStore(async (store, root) => {
    for (const path of ['/topics/food.md', '/profile.md', '/people/sam.md', '/topics/commute.md']) {
      await store.write({ path, content: `# ${path}`, ifVersion: 'new' });
    }
    await writeFile(join(root, 'memory', 'topics', 'odd name.md'), 'ignored');
    await writeFile(join(root, 'memory', 'notes.txt'), 'ignored');

    const all = await store.list();
    assert.deepEqual(
      all.entries.map((entry) => entry.path),
      ['/people/sam.md', '/profile.md', '/topics/commute.md', '/topics/food.md'],
    );
    assert.equal(all.nextCursor, null);

    const topics = await store.list({ pathPrefix: '/topics/' });
    assert.deepEqual(
      topics.entries.map((entry) => entry.path),
      ['/topics/commute.md', '/topics/food.md'],
    );
    // Directory-aligned: `/topics` means `/topics/`; `/top` is no directory
    // here, and a file path names no directory at all.
    assert.equal((await store.list({ pathPrefix: '/topics' })).entries.length, 2);
    assert.equal((await store.list({ pathPrefix: '/top' })).entries.length, 0);
    assert.deepEqual((await store.list({ pathPrefix: '/topics/food.md' })).entries, []);

    const first = await store.list({ limit: 3 });
    assert.equal(first.entries.length, 3);
    assert.equal(first.nextCursor, '/topics/commute.md');
    const second = await store.list({ limit: 3, cursor: first.nextCursor });
    assert.deepEqual(
      second.entries.map((entry) => entry.path),
      ['/topics/food.md'],
    );
    assert.equal(second.nextCursor, null);

    const snapshot = await store.snapshot();
    assert.equal(snapshot.files.length, 4);
    assert.match(snapshot.revision, /^[0-9a-f]{16}$/);
    await store.write({
      path: '/topics/food.md',
      content: 'changed',
      ifVersion: memoryFileVersion('# /topics/food.md'),
    });
    assert.notEqual((await store.snapshot()).revision, snapshot.revision);
  });
});

test('content limits: empty is refused, and so is a file past the cap', async () => {
  await withStore(async (store) => {
    assert.equal(
      (await store.write({ path: '/a.md', content: '  \n', ifVersion: 'new' })).kind,
      'empty',
    );
    const oversize = await store.write({
      path: '/a.md',
      content: 'x'.repeat(MEMORY_FILE_MAX_BYTES + 1),
      ifVersion: 'new',
    });
    assert.equal(oversize.kind, 'oversize');
    if (oversize.kind === 'oversize') assert.equal(oversize.limit, MEMORY_FILE_MAX_BYTES);
    await assert.rejects(
      store.write({ path: '/../escape.md', content: 'x', ifVersion: 'new' }),
      /not allowed/,
    );
    await assert.rejects(store.read('topics/food.md'), /must start with/);
  });
});
