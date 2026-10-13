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
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import {
  authenticateInteractiveArtifactStoreWriter,
  openInteractiveArtifactStoreForWrite,
  type InteractiveArtifactStoreWriter,
} from '../artifact-stores.js';
import { ARTIFACT_WRITER_LOCK_FILE } from '../artifact-writer-lock.js';
import {
  resolveStorageRoot,
  StorageRootAuthorityError,
  tryAcquireInteractiveRootOwner,
  type StorageRootLease,
} from '../root-authority.js';
import {
  removeTrackedControlDirectories,
  trackControlDirectory,
} from './fixtures/control-directory-hygiene.js';

after(removeTrackedControlDirectories);

for (const unrelated of [0, 1000, 12000]) {
  test(`chunk reads use one indexed membership, independent of ${unrelated} unrelated memberships`, async (t) => {
    await withOwner(async (_owner, root, store) => {
      const record = await store.create(artifactInput('output', 'bounded bytes'));
      const db = new DatabaseSync(join(root, 'runtime.sqlite'));
      try {
        db.exec('BEGIN');
        const insert = db.prepare('INSERT INTO artifact_records VALUES (?, ?)');
        for (let i = 0; i < unrelated; i++) insert.run(`other-${i}`, record.id);
        db.exec('COMMIT');
        const queries: string[] = [];
        const prepare = DatabaseSync.prototype.prepare;
        const spy = t.mock.method(
          DatabaseSync.prototype,
          'prepare',
          function (this: DatabaseSync, sql: string) {
            if (sql.includes('json_set(o.record_json')) {
              assert.match(sql, /WHERE r.session_id = \? AND r.artifact_id = \?/);
              queries.push(sql);
            }
            return prepare.call(this, sql);
          },
        );
        for (let i = 0; i < 10; i++) {
          const result = await store.readChunkInSession('session-1', 'output', {
            offset: 0,
            maxBytes: 32 * 1024,
          });
          assert.equal(result.ok, true);
          if (result.ok) assert.equal(Buffer.from(result.bytes).toString(), 'bounded bytes');
        }
        spy.mock.restore();
        assert.equal(queries.length, 10);
        const plan = db
          .prepare(
            'EXPLAIN QUERY PLAN SELECT artifact_id FROM artifact_records WHERE session_id = ? AND artifact_id = ?',
          )
          .all('session-1', record.id);
        assert.match(JSON.stringify(plan), /SEARCH.*INDEX/);
        assert.equal(db.prepare('SELECT count(*) AS n FROM artifact_objects').get()?.n, 1);
      } finally {
        db.close();
      }
    });
  });
}

test('GC pages are bounded and never scan or decode resource metadata', async (t) => {
  await withOwner(async (_owner, root, store) => {
    const db = new DatabaseSync(join(root, 'runtime.sqlite'));
    try {
      db.exec(`WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<12000)
        INSERT INTO artifact_gc_paths SELECT 'blobs/sha256/00/' || printf('%064d', n) FROM numbers`);
      const prepare = DatabaseSync.prototype.prepare;
      const spy = t.mock.method(
        DatabaseSync.prototype,
        'prepare',
        function (this: DatabaseSync, sql: string) {
          assert.doesNotMatch(sql, /json_set|SELECT record_json/);
          return prepare.call(this, sql);
        },
      );
      const result = await store.collectGarbage({ maxPaths: 3 });
      spy.mock.restore();
      assert.equal(result.processedPaths, 3);
      assert.equal(result.failedPaths, 0);
      assert.ok(result.nextAfter);
      assert.equal(db.prepare('SELECT count(*) AS n FROM artifact_gc_paths').get()?.n, 11997);
    } finally {
      db.close();
    }
  });
});

test('resource callbacks protect file lifetime until the read completes', async () => {
  await withOwner(async (_owner, root, store) => {
    const record = await store.create(artifactInput('held', 'still readable'));
    const entered = deferred();
    const release = deferred();
    const reading = store.withReadableFile('session-1', record.id, async (path) => {
      entered.resolve();
      await release.promise;
      return readFile(path, 'utf8');
    });
    await entered.promise;
    let deleted = false;
    const deletion = store.purgeSessionArtifacts('session-1').then(async () => {
      await store.collectGarbage({ maxPaths: 100 });
      deleted = true;
    });
    await setImmediate();
    assert.equal(deleted, false);
    release.resolve();
    assert.equal(await reading, 'still readable');
    await deletion;
    await assert.rejects(stat(join(root, 'artifacts', record.relativePath)), { code: 'ENOENT' });
  });
});

test('re-delivery shares bytes but creates an independent immutable business resource', async () => {
  await withOwner(async (_owner, _root, store) => {
    const original = await store.create(artifactInput('original', 'same bytes'));
    const [delivery] = await store.createBatch([
      { ...artifactInput('delivery', ''), source: 'user_delivery', reuseArtifactId: original.id },
    ]);
    assert.notEqual(delivery!.id, original.id);
    assert.equal(delivery!.relativePath, original.relativePath);
    await assert.rejects(
      store.createBatch([
        { ...artifactInput('foreign', ''), sessionId: 'other', reuseArtifactId: original.id },
      ]),
      /not found in this Session/,
    );
    await assert.rejects(
      store.createBatch([
        { ...artifactInput('oversize', ''), reuseArtifactId: original.id, maxBytes: 1 },
      ]),
      /size limit/,
    );
  });
});

test('requires authentic leases and writer facades', async () => {
  await assert.rejects(
    openInteractiveArtifactStoreForWrite({} as StorageRootLease<'interactive', 'write'>),
    invalidLease,
  );
  assert.throws(
    () => authenticateInteractiveArtifactStoreWriter({} as InteractiveArtifactStoreWriter),
    invalidLease,
  );
});

test('one writer per lease; deletion is scoped and survives reopen', async () => {
  await withOwner(async (owner, root, store) => {
    assert.strictEqual(await openInteractiveArtifactStoreForWrite(owner.lease), store);
    assert.strictEqual(authenticateInteractiveArtifactStoreWriter(store), store);
    await store.create(artifactInput('deleted', 'delete me'));
    assert.equal((await store.deleteUserArtifactInSession('other', 'deleted')).kind, 'not_found');
    assert.equal((await store.deleteUserArtifactInSession('session-1', 'deleted')).kind, 'deleted');
    assert.equal(
      (await store.deleteUserArtifactInSession('session-1', 'deleted')).kind,
      'not_found',
    );
    await assert.rejects(stat(join(root, ARTIFACT_WRITER_LOCK_FILE)), { code: 'ENOENT' });
    store.close();
    const reopened = await openInteractiveArtifactStoreForWrite(owner.lease);
    try {
      assert.equal((await reopened.getInSession('session-1', 'deleted')).record, null);
    } finally {
      reopened.close();
    }
  });
});

test('root close drains accepted writes and revokes subsequent operations', async () => {
  await withOwner(async (owner, _root, store) => {
    const accepted = store.create(artifactInput('accepted', new Uint8Array(8 * 1024 * 1024)));
    await owner.close();
    assert.equal((await accepted).id, 'accepted');
    await assert.rejects(store.listPage('session-1', { offset: 0, limit: 1 }), invalidLease);
  });
});

test('publication snapshots caller-owned bytes and metadata', async () => {
  await withOwner(async (_owner, _root, store) => {
    const bytes = Uint8Array.from([0x73, 0x61, 0x66, 0x65]);
    const input = artifactInput('accepted', bytes);
    const pending = store.create(input);
    input.id = 'changed';
    input.sessionId = 'changed';
    bytes.fill(0x78);
    assert.equal((await pending).id, 'accepted');
    assert.deepEqual(await store.readTextInSession('session-1', 'accepted'), {
      ok: true,
      text: 'safe',
    });
  });
});

function artifactInput(id: string, content: string | Uint8Array) {
  return {
    id,
    sessionId: 'session-1',
    turnId: 'turn-1',
    name: `${id}.txt`,
    kind: 'file' as const,
    content,
    source: 'tool_result' as const,
    now: 1,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function invalidLease(error: unknown): boolean {
  return error instanceof StorageRootAuthorityError && error.code === 'invalid_lease';
}
async function withOwner(
  run: (
    owner: NonNullable<Awaited<ReturnType<typeof tryAcquireInteractiveRootOwner>>>,
    root: string,
    store: InteractiveArtifactStoreWriter,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'maka-artifact-authority-'));
  const owner = await tryAcquireInteractiveRootOwner(
    trackControlDirectory(await resolveStorageRoot({ path: root, kind: 'interactive' })),
  );
  assert.ok(owner);
  const store = await openInteractiveArtifactStoreForWrite(owner.lease);
  try {
    await run(owner, root, store);
  } finally {
    store.close();
    await owner.close();
    await rm(root, { recursive: true, force: true });
  }
}
