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
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, test, type TestContext } from 'node:test';
import {
  ARTIFACT_ENTITY_ID_MAX_CHARS,
  ARTIFACT_TURN_KEY_MAX_CHARS,
  type ArtifactRecord,
} from '@maka/core/artifacts';
import {
  ARTIFACT_TEXT_PREVIEW_LIMIT_BYTES,
  type ArtifactAuthorityStore,
  type ArtifactStoreWriteAuthority,
  type CreateArtifactInput,
  createSqliteArtifactStoreWriteAuthority,
  isSafeRelativeArtifactPath,
  resolveArtifactPath,
  sanitizeArtifactName,
} from '../artifact-store.js';
import { withArtifactWriterLock } from '../artifact-writer-lock.js';
import { acquireOperationalStateDatabase } from '../operational-state-store.js';
import { createSqliteArtifactMetadataRepository } from '../sqlite-artifact-metadata.js';

const artifactStoreClosersByRoot = new Map<string, Set<() => void>>();

function trackArtifactStoreCloser(root: string, close: () => void): void {
  const closers = artifactStoreClosersByRoot.get(root) ?? new Set<() => void>();
  closers.add(close);
  artifactStoreClosersByRoot.set(root, closers);
}

function createArtifactStore(root: string): ArtifactAuthorityStore {
  const authority = createSqliteArtifactStoreWriteAuthority(root);
  trackArtifactStoreCloser(root, () => authority.close());
  return authority.store;
}

async function listArtifacts(store: ArtifactAuthorityStore, sessionId: string) {
  return (await store.listPage(sessionId, { offset: 0, limit: Number.MAX_SAFE_INTEGER })).records;
}

async function getArtifact(
  store: ArtifactAuthorityStore,
  artifactId: string,
  sessionId = 'session-1',
) {
  return (await store.getInSession(sessionId, artifactId)).record;
}

function readArtifactText(
  store: ArtifactAuthorityStore,
  artifactId: string,
  sessionId = 'session-1',
) {
  return store.readTextInSession(sessionId, artifactId);
}

function readArtifactBinary(
  store: ArtifactAuthorityStore,
  artifactId: string,
  sessionId = 'session-1',
) {
  return store.readBinaryInSession(sessionId, artifactId);
}

function createArtifactStoreWriteAuthority(root: string): ArtifactStoreWriteAuthority {
  const authority = createSqliteArtifactStoreWriteAuthority(root);
  trackArtifactStoreCloser(root, () => authority.close());
  return authority;
}

function closeArtifactStores(root: string): void {
  const closers = artifactStoreClosersByRoot.get(root);
  artifactStoreClosersByRoot.delete(root);
  if (!closers) return;
  for (const close of [...closers].reverse()) close();
}

describe('SQLite Artifact store', () => {
  test('hand-back receipts survive deletion, reopen, branch and source removal without pinning bytes', async () => {
    await withWorkspace(async (root) => {
      let store = createArtifactStore(root);
      const report = await store.create({
        ...artifactInput('report', 'delivered bytes', 1),
        sessionId: 'child',
        source: 'user_delivery',
      });
      await store.create({
        ...artifactInput('input', 'private input', 1),
        sessionId: 'child',
        source: 'user_upload',
      });
      const handoff = {
        sourceSessionId: 'child',
        targetSessionId: 'parent',
        artifactIds: ['report', 'report', 'input', 'missing'],
      };
      assert.deepEqual(await store.retainChildArtifacts(handoff), ['report']);
      assert.deepEqual(await store.retainChildArtifacts(handoff), ['report']);
      assert.deepEqual(await store.deleteUserArtifactInSession('parent', 'report'), {
        kind: 'deleted',
      });
      store.close();
      store = createArtifactStore(root);
      assert.deepEqual(await store.retainChildArtifacts(handoff), []);
      assert.equal(await store.getRecordInSession('parent', 'report'), undefined);
      await store.copyConversationArtifacts({
        sourceSessionId: 'parent',
        targetSessionId: 'branch',
        turnIds: [],
      });
      assert.deepEqual(
        await store.retainChildArtifacts({ ...handoff, targetSessionId: 'branch' }),
        [],
      );
      // Another receiver and a genuinely new delivery are independent hand-backs.
      assert.deepEqual(await store.retainChildArtifacts({ ...handoff, targetSessionId: 'other' }), [
        'report',
      ]);
      await store.create({
        ...artifactInput('report-2', 'new delivery', 2),
        sessionId: 'child',
        source: 'user_delivery',
      });
      assert.deepEqual(
        await store.retainChildArtifacts({ ...handoff, artifactIds: ['report', 'report-2'] }),
        ['report-2'],
      );
      await store.purgeSessionArtifacts('child');
      assert.deepEqual(await store.retainChildArtifacts({ ...handoff, targetSessionId: 'other' }), [
        'report',
      ]);
      assert.deepEqual(await store.retainChildArtifacts(handoff), []);
      await store.deleteUserArtifactInSession('other', 'report');
      await store.collectGarbage({ maxPaths: 100 });
      await assert.rejects(stat(join(root, 'artifacts', report.relativePath)), { code: 'ENOENT' });
      const lease = acquireOperationalStateDatabase(root);
      try {
        assert.ok(
          lease.database
            .prepare('SELECT 1 FROM artifact_handoffs WHERE session_id = ?')
            .get('parent'),
        );
        await store.purgeSessionArtifacts('parent');
        assert.equal(
          lease.database
            .prepare('SELECT 1 FROM artifact_handoffs WHERE session_id = ?')
            .get('parent'),
          undefined,
        );
      } finally {
        lease.close();
      }
    });
  });

  test('hand-back membership and receipt roll back together and a retry can commit', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      for (const id of ['a', 'b'])
        await store.create({
          ...artifactInput(id, id, 1),
          sessionId: 'child',
          source: 'user_delivery',
        });
      const lease = acquireOperationalStateDatabase(root);
      const input = {
        sourceSessionId: 'child',
        targetSessionId: 'parent',
        artifactIds: ['a', 'b'],
      };
      try {
        lease.database.exec(`CREATE TRIGGER fail_handoff AFTER INSERT ON artifact_handoffs
          WHEN NEW.artifact_id = 'b' BEGIN SELECT RAISE(ABORT, 'handoff fault'); END`);
        await assert.rejects(store.retainChildArtifacts(input), /handoff fault/);
        assert.equal((await store.listPage('parent', { offset: 0, limit: 10 })).total, 0);
        assert.equal(
          lease.database.prepare('SELECT count(*) AS n FROM artifact_handoffs').get()!.n,
          0,
        );
        lease.database.exec('DROP TRIGGER fail_handoff');
        assert.deepEqual(await store.retainChildArtifacts(input), ['a', 'b']);
        assert.equal(
          lease.database.prepare('SELECT count(*) AS n FROM artifact_handoffs').get()!.n,
          2,
        );
      } finally {
        lease.close();
      }
    });
  });

  test('a batch publishes ordered records only after all payloads are ready', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const observer = createArtifactStore(root);
      const records = await store.createBatch([
        { ...artifactInput('batch-a', '', 1), name: 'same.txt', readContent: async () => 'first' },
        {
          ...artifactInput('batch-b', '', 2),
          name: 'same.txt',
          readContent: async () => {
            assert.equal((await listArtifacts(observer, 'session-1')).length, 0);
            return 'second';
          },
        },
      ]);
      assert.deepEqual(
        records.map((record) => record.id),
        ['batch-a', 'batch-b'],
      );
      assert.deepEqual(await readArtifactText(observer, 'batch-a'), { ok: true, text: 'first' });
      assert.deepEqual(await readArtifactText(observer, 'batch-b'), { ok: true, text: 'second' });
    });
  });

  test('a late batch read failure rolls back files and records, including after reopen', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      await assert.rejects(
        store.createBatch([
          { ...artifactInput('batch-a', '', 1), readContent: async () => 'first' },
          {
            ...artifactInput('batch-b', '', 2),
            readContent: async () => {
              throw new Error('source refused');
            },
          },
        ]),
        /source refused/,
      );
      assert.deepEqual(await listArtifacts(createArtifactStore(root), 'session-1'), []);
      await store.collectGarbage({ maxPaths: 100 });
      await assert.rejects(stat(join(root, 'artifacts', blobPath('first'))), { code: 'ENOENT' });
    });
  });

  test('a batch storage failure removes staged files and preserves pre-existing paths', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const collision = join(root, 'artifacts', blobPath('second'));
      await mkdir(collision, { recursive: true });
      await assert.rejects(
        store.createBatch([
          { ...artifactInput('batch-a', '', 1), readContent: async () => 'first' },
          { ...artifactInput('batch-b', '', 2), readContent: async () => 'second' },
        ]),
        /different content/,
      );
      assert.deepEqual(await listArtifacts(createArtifactStore(root), 'session-1'), []);
      await store.collectGarbage({ maxPaths: 100 });
      await assert.rejects(stat(join(root, 'artifacts', blobPath('first'))), { code: 'ENOENT' });
      assert.ok((await stat(collision)).isDirectory());
    });
  });

  test('a process crash after bytes are durable exposes no partial batch and is reclaimed after reopen', {
    timeout: 15000,
  }, async () => {
    await withWorkspace(async (root) => {
      const child = fork(new URL('./fixtures/artifact-batch-crash.js', import.meta.url), [root], {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      try {
        const message = await Promise.race([
          once(child, 'message', { signal: AbortSignal.timeout(10000) }),
          once(child, 'exit').then(() => {
            throw new Error('Crash fixture exited before staging');
          }),
        ]);
        assert.deepEqual(message[0], { phase: 'staged' });
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
        const store = createArtifactStore(root);
        assert.equal((await store.listPage('session-1', { offset: 0, limit: 10 })).total, 0);
        const path = join(root, 'artifacts', blobPath('durable but unreferenced'));
        assert.equal(await readFile(path, 'utf8'), 'durable but unreferenced');
        await store.collectGarbage({ maxPaths: 100 });
        await assert.rejects(stat(path), { code: 'ENOENT' });
        assert.ok(await store.create(artifactInput('first', 'successful retry', 1)));
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    });
  });

  test('immutable blob publication refuses a planted symlink even to equal in-root bytes', async (t) => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const path = join(root, 'artifacts', blobPath('equal bytes'));
      await mkdir(dirname(path), { recursive: true });
      const sibling = join(dirname(path), 'untracked.txt');
      await writeFile(sibling, 'equal bytes');
      if (!(await createSymlinkOrSkip(t, sibling, path, 'file'))) return;
      await assert.rejects(
        store.create(artifactInput('linked', 'equal bytes', 1)),
        /different content/,
      );
      assert.equal((await store.listPage('session-1', { offset: 0, limit: 10 })).total, 0);
      await store.collectGarbage({ maxPaths: 100 });
      assert.equal(await readFile(sibling, 'utf8'), 'equal bytes');
    });
  });

  test('branch membership and task-output snapshots publish atomically and idempotently', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const record = await store.create({
        ...artifactInput('snapshot', 'frozen output', 1),
        source: 'saved_tool_output',
        taskOutputSnapshotOf: 'sr_task',
      });
      await store.freezeMissingTaskOutput('target', 'sr_task');
      const copy = () =>
        store.copyConversationArtifacts({
          sourceSessionId: 'session-1',
          targetSessionId: 'target',
          turnIds: [],
          taskOutputIds: ['sr_task'],
        });
      await assert.rejects(copy(), /snapshot is immutable/);
      assert.equal((await store.listPage('target', { offset: 0, limit: 10 })).total, 0);
      assert.equal((await store.readTaskOutputSnapshots('target')).get('sr_task'), null);
      await store.purgeSessionArtifacts('target');
      assert.equal((await store.readTaskOutputSnapshots('target')).size, 0);
      await copy();
      await copy();
      assert.equal((await store.readTaskOutputSnapshots('target')).get('sr_task'), record.id);
      await store.purgeSessionArtifacts('session-1');
      await store.collectGarbage({ maxPaths: 100 });
      assert.deepEqual(await store.readTextInSession('target', record.id), {
        ok: true,
        text: 'frozen output',
      });
    });
  });

  test('a batch validates every identity before reading or publishing any content', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      let reads = 0;
      const readContent = async () => {
        reads += 1;
        return 'bytes';
      };
      const input = { ...artifactInput('duplicate', '', 1), readContent };
      await assert.rejects(store.createBatch([input, input]), /Duplicate Artifact identity/);
      assert.equal(reads, 0);
      await store.create(artifactInput('existing', 'original', 1));
      await assert.rejects(
        store.createBatch([{ ...input, id: 'existing' }]),
        /requires new identities/,
      );
      assert.equal(reads, 0);
      assert.deepEqual(await readArtifactText(store, 'existing'), { ok: true, text: 'original' });
    });
  });
  test('creates a missing workspace root before acquiring the writer lock', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'maka-artifact-missing-root-'));
    const root = join(parent, 'nested', 'workspace');
    try {
      const created = await createArtifactStore(root).create(
        artifactInput('missing-root', 'created', 1),
      );

      assert.equal((await stat(root)).isDirectory(), true);
      assert.equal(created.id, 'missing-root');
      assert.deepEqual(
        (await listArtifacts(createArtifactStore(root), 'session-1')).map((record) => record.id),
        ['missing-root'],
      );
    } finally {
      closeArtifactStores(root);
      await rm(parent, { recursive: true, force: true });
    }
  });

  test('publishes stable identities and persists canonical records', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const first = await store.create(artifactInput('artifact-1', '# Notes', 100));
      const second = await store.create({
        ...artifactInput('artifact-2', 'diff --git a/a b/a', 200),
        name: 'patch.diff',
        kind: 'diff',
        source: 'tool_result',
      });

      assert.equal(first.relativePath, blobPath('# Notes'));
      assert.equal(first.sizeBytes, 7);
      assert.deepEqual(
        (await listArtifacts(store, 'session-1')).map((record) => record.id),
        ['artifact-2', 'artifact-1'],
      );
      assert.deepEqual(await readArtifactText(store, first.id), { ok: true, text: '# Notes' });

      const reopened = createArtifactStore(root);
      assert.deepEqual(await getArtifact(reopened, second.id), second);
      await assert.rejects(
        () => reopened.create(artifactInput('artifact-1', 'replacement', 300)),
        /Artifact artifact-1 already exists/,
      );
      assert.deepEqual(await readArtifactText(reopened, 'artifact-1'), {
        ok: true,
        text: '# Notes',
      });
    });
  });

  test('lists only live Artifacts committed by one exact Turn', async () => {
    await withWorkspace(async (root) => {
      const authority = createArtifactStoreWriteAuthority(root);
      const { store } = authority;
      await store.create({ ...artifactInput('turn-a-new', 'new', 30), turnId: 'turn-a' });
      await store.create({ ...artifactInput('turn-b', 'other turn', 20), turnId: 'turn-b' });
      await store.create({
        ...artifactInput('turn-a-old', 'old', 10),
        turnId: 'turn-a',
      });
      await store.create({
        ...artifactInput('other-session', 'other session', 40),
        sessionId: 'session-2',
        turnId: 'turn-a',
      });

      assert.deepEqual(
        (await store.listTurnArtifacts('session-1', 'turn-a')).map((record) => record.id),
        ['turn-a-new', 'turn-a-old'],
      );
      await store.deleteUserArtifactInSession('session-1', 'turn-a-new');
      assert.deepEqual(
        (await store.listTurnArtifacts('session-1', 'turn-a')).map((record) => record.id),
        ['turn-a-old'],
      );
    });
  });

  test('persists and reopens bounded synthetic turn keys', async () => {
    await withWorkspace(async (root) => {
      for (const [id, turnId] of [
        ['history-artifact', 'history-compact:42'],
        ['synthesis-artifact', 'synthesis-cache:43'],
      ] as const) {
        const input = { ...artifactInput(id, 'compacted', 1), turnId };
        const created = await createArtifactStore(root).create(input);
        assert.equal(created.turnId, input.turnId);
        assert.equal(
          (await getArtifact(createArtifactStore(root), created.id))?.turnId,
          input.turnId,
        );
      }

      for (const turnId of [
        '',
        'history-compact:\n1',
        'synthesis-cache:\u007f1',
        'x'.repeat(ARTIFACT_TURN_KEY_MAX_CHARS + 1),
      ]) {
        await assert.rejects(
          () =>
            createArtifactStore(root).create({
              ...artifactInput(`invalid-${turnId.length}`, 'invalid', 2),
              turnId,
            }),
          /bounded opaque turn key/,
        );
      }
    });
  });

  test('owns stable session revisions across paging, reopen, mutations, and no-ops', async () => {
    await withWorkspace(async (root) => {
      const authority = createArtifactStoreWriteAuthority(root);
      const { store } = authority;
      const empty = await store.listPage('session-1', { offset: 0, limit: 2 });
      assert.equal(empty.total, 0);
      assert.deepEqual(empty.records, []);
      assert.equal((await store.getInSession('session-1', 'missing')).revision, empty.revision);
      assert.equal(
        (await store.listPage('another-empty-session', { offset: 0, limit: 1 })).revision,
        empty.revision,
      );

      const firstInput = artifactInput('first', 'first', 10);
      await store.create(firstInput);
      await store.create(artifactInput('second', 'second', 20));
      const created = await store.listPage('session-1', { offset: 0, limit: 1 });
      assert.equal(created.total, 2);
      assert.deepEqual(
        created.records.map((record) => record.id),
        ['second'],
      );
      assert.equal((await store.getInSession('session-1', 'first')).revision, created.revision);

      const reopenedAuthority = createArtifactStoreWriteAuthority(root);
      const reopenedPage = await reopenedAuthority.store.listPage('session-1', {
        offset: 0,
        limit: 2,
      });
      assert.equal(reopenedPage.revision, created.revision);
      assert.deepEqual(
        reopenedPage.records.map((record) => record.id),
        ['second', 'first'],
      );

      await store.create({
        ...artifactInput('other-session', 'other', 30),
        sessionId: 'session-2',
      });
      assert.equal(
        (await store.listPage('session-1', { offset: 0, limit: 2 })).revision,
        created.revision,
      );
      await store.create(firstInput);
      assert.equal(
        (await store.listPage('session-1', { offset: 0, limit: 2 })).revision,
        created.revision,
      );

      await store.create(artifactInput('revision-race', 'race', 25));
      const deletedResult = await store.deleteUserArtifactInSession('session-1', 'first');
      assert.equal(deletedResult.kind, 'deleted');
      const deleted = await store.listPage('session-1', { offset: 0, limit: 3 });
      assert.notEqual(deleted.revision, created.revision);
      assert.equal(
        deleted.records.find((record) => record.id === 'first'),
        undefined,
      );
      assert.equal(
        (await store.deleteUserArtifactInSession('session-1', 'first')).kind,
        'not_found',
      );
      assert.equal(
        (await store.listPage('session-1', { offset: 0, limit: 3 })).revision,
        deleted.revision,
      );

      await store.create(firstInput);
      const revived = await store.listPage('session-1', { offset: 0, limit: 3 });
      assert.notEqual(revived.revision, deleted.revision);
      assert.equal(revived.records.find((record) => record.id === 'first')?.id, 'first');

      await store.purgeSessionArtifacts('session-1');
      const purged = await store.listPage('session-1', { offset: 0, limit: 2 });
      assert.equal(purged.revision, empty.revision);
      assert.equal(purged.total, 0);
    });
  });

  test('copies an exact turn-scoped Artifact snapshot and purges only the target Session', async () => {
    await withWorkspace(async (root) => {
      const authority = createArtifactStoreWriteAuthority(root);
      const { store } = authority;
      const retained = await store.create({
        ...artifactInput('retained-artifact', 'retained', 10),
        turnId: 'turn-retained',
        mimeType: 'text/plain',
      });
      const deleted = await store.create({
        ...artifactInput('deleted-artifact', 'deleted', 11),
        turnId: 'turn-retained',
      });
      await store.deleteUserArtifactInSession('session-1', deleted.id);
      await store.create({
        ...artifactInput('later-artifact', 'later', 20),
        turnId: 'turn-later',
      });

      const copied = await store.copyConversationArtifacts({
        sourceSessionId: 'session-1',
        targetSessionId: 'session-copy',
        turnIds: ['turn-retained'],
      });
      const copiedId = retained.id;
      assert.ok(copied.artifactIds.has(copiedId));
      assert.equal(copied.artifactIds.has(deleted.id), false);
      assert.equal(copiedId, retained.id);
      const target = await listArtifacts(store, 'session-copy');
      assert.equal(target.length, 1);
      assert.equal(target[0]?.id, copiedId);
      assert.equal(target[0]?.turnId, retained.turnId);
      assert.equal(retained.relativePath, target[0]?.relativePath);
      assert.deepEqual(await readArtifactText(store, copiedId!, 'session-copy'), {
        ok: true,
        text: 'retained',
      });

      await store.purgeSessionArtifacts('session-copy');
      assert.deepEqual(await listArtifacts(store, 'session-copy'), []);
      assert.deepEqual(
        (await listArtifacts(store, 'session-1')).map((record) => record.id).sort(),
        ['later-artifact', 'retained-artifact'],
      );
    });
  });

  test('historical Artifact references survive repeated copies and independent deletion', async () => {
    await withWorkspace(async (root) => {
      let { store } = createArtifactStoreWriteAuthority(root);
      const original = await store.create({
        ...artifactInput('historical-id', 'original bytes', 10),
        source: 'user_delivery',
      });
      const first = await store.copyConversationArtifacts({
        sourceSessionId: 'session-1',
        targetSessionId: 'first-copy',
        turnIds: [original.turnId],
      });
      const firstId = original.id;
      assert.ok(first.artifactIds.has(firstId));
      await store.copyConversationArtifacts({
        sourceSessionId: 'first-copy',
        targetSessionId: 'second-copy',
        turnIds: [],
        includeArtifactIds: [original.id],
      });
      await store.purgeSessionArtifacts('session-1');
      store.close();
      ({ store } = createArtifactStoreWriteAuthority(root));
      for (const sessionId of ['first-copy', 'second-copy']) {
        assert.deepEqual(await store.readTextInSession(sessionId, original.id), {
          ok: true,
          text: 'original bytes',
        });
        assert.equal((await store.getInSession(sessionId, original.id)).record?.id, original.id);
      }
      assert.deepEqual(await store.readTextInSession('second-copy', firstId), {
        ok: true,
        text: 'original bytes',
      });
      assert.equal((await store.getInSession('unrelated', original.id)).record, null);
      await assert.rejects(
        store.create({ ...artifactInput(original.id, 'replacement', 11), sessionId: 'first-copy' }),
        /already exists/,
      );
      assert.deepEqual(await store.deleteUserArtifactInSession('first-copy', original.id), {
        kind: 'deleted',
      });
      assert.deepEqual(await store.readTextInSession('first-copy', original.id), {
        ok: false,
        reason: 'not_found',
      });
      assert.deepEqual(await store.readTextInSession('second-copy', original.id), {
        ok: true,
        text: 'original bytes',
      });
    });
  });

  test('copies child Artifacts only after formal hand-back committed source ownership', async () => {
    await withWorkspace(async (root) => {
      const authority = createArtifactStoreWriteAuthority(root);
      const { store } = authority;
      await store.create({
        ...artifactInput('child-artifact', 'child result', 10),
        sessionId: 'child-session',
        turnId: 'child-turn',
      });

      const before = await store.copyConversationArtifacts({
        sourceSessionId: 'session-1',
        targetSessionId: 'not-handed-back',
        turnIds: [],
        includeArtifactIds: ['child-artifact'],
      });
      assert.equal(before.artifactIds.size, 0);
      await store.copyConversationArtifacts({
        sourceSessionId: 'child-session',
        targetSessionId: 'session-1',
        turnIds: [],
        includeArtifactIds: ['child-artifact'],
      });
      const copied = await store.copyConversationArtifacts({
        sourceSessionId: 'session-1',
        targetSessionId: 'session-copy',
        turnIds: ['turn-retained'],
        includeArtifactIds: ['child-artifact'],
      });

      const copiedId = 'child-artifact';
      assert.ok(copied.artifactIds.has(copiedId));
      assert.ok(copiedId);
      assert.deepEqual(await readArtifactText(store, copiedId, 'session-copy'), {
        ok: true,
        text: 'child result',
      });
      assert.equal((await getArtifact(store, copiedId, 'session-copy'))?.sessionId, 'session-copy');
      assert.equal(
        (await getArtifact(store, 'child-artifact', 'child-session'))?.sessionId,
        'child-session',
      );
    });
  });

  test('includes explicit same-Session Artifacts outside the copied turns', async () => {
    await withWorkspace(async (root) => {
      const authority = createArtifactStoreWriteAuthority(root);
      const { store } = authority;
      await store.create({
        ...artifactInput('retained-artifact', 'retained', 10),
        turnId: 'turn-retained',
      });
      // A user upload carries the uploadId sentinel as its turnId, so it is
      // never a member of the copied conversation turns.
      const upload = await store.create({
        ...artifactInput('attachment-upload', 'uploaded bytes', 11),
        turnId: 'upload-sentinel',
        source: 'user_upload',
      });

      const withoutInclude = await store.copyConversationArtifacts({
        sourceSessionId: 'session-1',
        targetSessionId: 'session-copy',
        turnIds: ['turn-retained'],
      });
      assert.equal(withoutInclude.artifactIds.has(upload.id), false);

      const withInclude = await store.copyConversationArtifacts({
        sourceSessionId: 'session-1',
        targetSessionId: 'session-copy-2',
        turnIds: ['turn-retained'],
        includeArtifactIds: [upload.id],
      });
      const copiedUploadId = upload.id;
      assert.ok(withInclude.artifactIds.has(copiedUploadId));
      assert.ok(copiedUploadId);
      assert.deepEqual(await readArtifactText(store, copiedUploadId, 'session-copy-2'), {
        ok: true,
        text: 'uploaded bytes',
      });
      assert.equal(
        (await getArtifact(store, copiedUploadId, 'session-copy-2'))?.sessionId,
        'session-copy-2',
      );
      // Unknown include ids are a no-op, not an error.
      const withUnknown = await store.copyConversationArtifacts({
        sourceSessionId: 'session-1',
        targetSessionId: 'session-copy-3',
        turnIds: ['turn-retained'],
        includeArtifactIds: ['does-not-exist'],
      });
      assert.equal(withUnknown.artifactIds.has('does-not-exist'), false);
    });
  });

  test('user deletion respects the current artifact source while owner cleanup remains possible', async () => {
    await withWorkspace(async (root) => {
      const authority = createArtifactStoreWriteAuthority(root);
      const { store } = authority;
      const input = artifactInput('current-policy', 'replaceable', 1);
      await store.create(input);
      await store.deleteUserArtifactInSession(input.sessionId, input.id);
      await store.create({
        ...input,
        id: 'protected-id',
        content: 'protected replacement',
        source: 'deep_research',
      });

      input.id = 'protected-id';
      assert.equal(
        (await store.deleteUserArtifactInSession(input.sessionId, input.id)).kind,
        'protected',
      );
      assert.equal((await getArtifact(store, input.id))?.source, 'deep_research');
      assert.deepEqual(await store.readTextInSession(input.sessionId, input.id), {
        ok: true,
        text: 'protected replacement',
      });
      assert.deepEqual(await store.deleteUserArtifactInSession('different-session', input.id), {
        kind: 'not_found',
      });

      await store.purgeSessionArtifacts(input.sessionId);
      assert.deepEqual(await store.deleteUserArtifactInSession(input.sessionId, input.id), {
        kind: 'not_found',
      });
    });
  });

  test('sanitizes adversarial names idempotently across reopen and stable-id retry', async () => {
    const names = [
      '-.gitignore',
      '  . a',
      `${'a'.repeat(119)}- trailing`,
      `${'b'.repeat(119)}. trailing`,
      `${'c'.repeat(119)}  trailing`,
      `${'.-'.repeat(80)}report.txt`,
      `${'d'.repeat(120)}---`,
    ];
    for (const name of names) {
      const sanitized = sanitizeArtifactName(name);
      assert.equal(sanitizeArtifactName(sanitized), sanitized, name);
      assert.ok(sanitized.length > 0 && sanitized.length <= 120, name);
      assert.doesNotMatch(sanitized, /^[ .-]|[ .-]$/, name);
    }
    assert.equal(sanitizeArtifactName('-.gitignore'), 'gitignore');
    assert.equal(sanitizeArtifactName('  . a'), 'a');

    await withWorkspace(async (root) => {
      for (const [index, name] of names.entries()) {
        const input = {
          ...artifactInput(`adversarial-${index}`, `payload-${index}`, index + 1),
          name,
        };
        const created = await createArtifactStore(root).create(input);
        const reopened = createArtifactStore(root);

        assert.deepEqual(await listArtifacts(reopened, input.sessionId), [
          created,
          ...(await listArtifacts(reopened, input.sessionId)).filter(
            (record) => record.id !== created.id,
          ),
        ]);
        assert.deepEqual(await getArtifact(reopened, created.id), created);
        assert.deepEqual(await readArtifactText(reopened, created.id), {
          ok: true,
          text: input.content,
        });
        assert.deepEqual(await reopened.create(input), created);
      }
    });
  });

  test('rejects metadata names the writer cannot produce without poisoning later writes', async () => {
    for (const name of ['short ', 'embedded\ttab', 'embedded\nnewline']) {
      await withWorkspace(async (root) => {
        await assert.rejects(
          writeArtifactMetadata(root, [
            canonicalRecord({ id: 'invalid-name', sessionId: 'session-1', name, sizeBytes: 0 }),
          ]),
          /Invalid immutable Artifact metadata/,
        );
        const store = createArtifactStore(root);
        assert.deepEqual(await listArtifacts(store, 'session-1'), []);
        assert.equal(
          (await store.create(artifactInput('replacement', 'kept', 1))).id,
          'replacement',
        );
      });
    }
  });

  test('does not split a surrogate pair at the persisted name boundary', async () => {
    await withWorkspace(async (root) => {
      const input = {
        ...artifactInput('unicode-boundary', 'boundary', 1),
        name: `${'a'.repeat(119)}😀tail`,
      };
      assert.equal(sanitizeArtifactName(input.name), 'a'.repeat(119));

      const created = await createArtifactStore(root).create(input);
      assert.equal(created.name, 'a'.repeat(119));
      const authority = createArtifactStoreWriteAuthority(root);
      const reopened = authority.store;
      assert.deepEqual(await reopened.create(input), created);
      assert.deepEqual(await readArtifactText(reopened, created.id), {
        ok: true,
        text: input.content,
      });
    });
  });

  test('persists complete canonical deep-research records', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const report = await store.create({
        id: 'research-report',
        sessionId: 'session-1',
        turnId: 'turn-report',
        name: 'report.html',
        kind: 'html',
        content: '<h1>Research</h1>',
        mimeType: 'text/html',
        source: 'deep_research',
        summary: 'Canonical research report',
        deepResearchRole: 'report',
        now: 100,
      });

      const reopened = createArtifactStore(root);
      assert.deepEqual(await getArtifact(reopened, report.id), report);
      assert.deepEqual(await readArtifactText(reopened, report.id), {
        ok: true,
        text: '<h1>Research</h1>',
      });
    });
  });

  test('exact live replay returns the canonical record without rewriting or accepting conflicts', async () => {
    await withWorkspace(async (root) => {
      const input = deepResearchArtifactInput('stable-replay', '# Durable result');
      const first = await createArtifactStore(root).create(input);
      const metadataPath = join(root, 'artifacts', 'metadata.jsonl');
      await assert.rejects(() => stat(metadataPath), { code: 'ENOENT' });

      const replayed = await createArtifactStore(root).create(input);
      assert.deepEqual(replayed, first);
      await assert.rejects(() => stat(metadataPath), { code: 'ENOENT' });
      assert.deepEqual(await readArtifactText(createArtifactStore(root), first.id), {
        ok: true,
        text: '# Durable result',
      });

      await assert.rejects(
        () =>
          createArtifactStore(root).create({
            ...input,
            content: '# Mutated result',
          }),
        /already exists with different metadata or content/,
      );
      assert.equal(Buffer.byteLength(input.content), Buffer.byteLength('# Mutated result'));
      await assert.rejects(
        () =>
          createArtifactStore(root).create({
            ...input,
            summary: 'Different summary',
          }),
        /already exists with different metadata or content/,
      );
      await assert.rejects(() => stat(metadataPath), { code: 'ENOENT' });
    });
  });

  test('a stable id can be created again after physical deletion', async () => {
    await withWorkspace(async (root) => {
      const input = deepResearchArtifactInput('stable-revive', '# Revivable');
      const store = createArtifactStore(root);
      const first = await store.create(input);
      await store.deleteOwnedArtifactInSession(input.sessionId, first.id, input.source);
      assert.equal(await getArtifact(store, first.id), null);

      const recreated = await createArtifactStore(root).create(input);
      assert.deepEqual({ ...recreated, createdAt: first.createdAt }, first);
      assert.deepEqual(await readArtifactText(createArtifactStore(root), first.id), {
        ok: true,
        text: '# Revivable',
      });
    });
  });

  test('serializes concurrent creates without dropping metadata', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const ids = Array.from({ length: 12 }, (_, index) => `artifact-${index}`);
      await Promise.all(ids.map((id, index) => store.create(artifactInput(id, id, index + 1))));

      const reopened = createArtifactStore(root);
      const rows = await listArtifacts(reopened, 'session-1');
      assert.deepEqual(rows.map((record) => record.id).sort(), ids.sort());
      await assert.rejects(() => stat(join(root, 'artifacts', 'metadata.jsonl')), {
        code: 'ENOENT',
      });
    });
  });

  test('serializes independent SQLite stores without dropping metadata', async () => {
    await withWorkspace(async (root) => {
      const first = createArtifactStore(root);
      const second = createArtifactStore(root);
      await Promise.all([
        first.create(artifactInput('independent-first', 'first', 1)),
        second.create(artifactInput('independent-second', 'second', 2)),
      ]);

      const rows = await listArtifacts(createArtifactStore(root), 'session-1');
      assert.deepEqual(rows.map((record) => record.id).sort(), [
        'independent-first',
        'independent-second',
      ]);
    });
  });

  test('snapshots mutable create input and bytes before waiting for the writer lock', async () => {
    await withWorkspace(async (root) => {
      let releaseLock!: () => void;
      let lockAcquired!: () => void;
      const acquired = new Promise<void>((resolve) => {
        lockAcquired = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseLock = resolve;
      });
      const holder = withArtifactWriterLock(root, async () => {
        lockAcquired();
        await release;
      });
      await acquired;

      const bytes = Uint8Array.from([0x73, 0x61, 0x66, 0x65]);
      const input: CreateArtifactInput = {
        id: 'accepted-id',
        sessionId: 'session-1',
        turnId: 'turn-1',
        name: 'accepted.bin',
        kind: 'file',
        content: bytes,
        mimeType: 'application/octet-stream',
        source: 'tool_result',
        summary: 'accepted summary',
        now: 7,
      };
      const accepted = createArtifactStore(root).create(input);

      input.id = 'mutated-id';
      input.sessionId = 'mutated-session';
      input.turnId = 'mutated-turn';
      input.name = 'mutated.txt';
      input.kind = 'diff';
      input.content = 'mutated content';
      input.mimeType = 'text/plain';
      input.source = 'tool_result';
      input.summary = 'mutated summary';
      input.now = 99;
      bytes.fill(0x78);
      releaseLock();
      await holder;

      const record = await accepted;
      assert.deepEqual(record, {
        id: 'accepted-id',
        sessionId: 'session-1',
        turnId: 'turn-1',
        createdAt: 7,
        name: 'accepted.bin',
        kind: 'file',
        relativePath: blobPath('safe'),
        sizeBytes: 4,
        mimeType: 'application/octet-stream',
        source: 'tool_result',
        summary: 'accepted summary',
      });
      assert.deepEqual(
        await readFile(join(root, 'artifacts', record.relativePath)),
        Buffer.from('safe'),
      );
      const reopened = createArtifactStore(root);
      assert.deepEqual(await getArtifact(reopened, record.id), record);
      assert.deepEqual(await listArtifacts(reopened, 'session-1'), [record]);
      assert.equal(await getArtifact(reopened, 'mutated-id'), null);
    });
  });

  test('refreshes a loaded SQLite store after another instance commits metadata', async () => {
    await withWorkspace(async (root) => {
      const stale = createArtifactStore(root);
      const writer = createArtifactStore(root);
      await stale.create(artifactInput('first', 'first', 1));
      assert.deepEqual(
        (await listArtifacts(stale, 'session-1')).map((record) => record.id),
        ['first'],
      );

      await writer.create(artifactInput('second', 'second', 2));

      assert.deepEqual(
        (await listArtifacts(stale, 'session-1')).map((record) => record.id),
        ['second', 'first'],
      );
      assert.equal((await getArtifact(stale, 'second'))?.id, 'second');
      assert.deepEqual(await readArtifactText(stale, 'second'), { ok: true, text: 'second' });
    });
  });

  test('does not publish a payload after the SQLite metadata repository closes', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      await store.create(artifactInput('published', 'kept', 1));
      store.close();

      await assert.rejects(
        () => store.create(artifactInput('rejected', 'not durable', 2)),
        /Artifact metadata repository is closed/,
      );
      await assert.rejects(
        () => readFile(join(root, 'artifacts', 'session-1', 'rejected-rejected.txt')),
        { code: 'ENOENT' },
      );
      const reopened = createArtifactStore(root);
      assert.equal(await getArtifact(reopened, 'rejected'), null);
    });
  });

  test('legacy publication residue cannot block stable-id creation', async () => {
    await withWorkspace(async (root) => {
      const residue = await createPublicationResidue(root, 'stable-retry', 'retry.txt', 'old');
      const authority = createArtifactStoreWriteAuthority(root);
      const { store } = authority;
      const retried = await store.create({
        ...artifactInput('stable-retry', 'new', 1),
        name: 'retry.txt',
      });
      assert.equal(retried.id, 'stable-retry');
      assert.deepEqual(await readArtifactText(store, retried.id), { ok: true, text: 'new' });
      assert.equal(await readFile(residue.stagingPath, 'utf8'), 'old');
    });
  });

  test('stable-id creation leaves untracked legacy paths untouched', async () => {
    await withWorkspace(async (root) => {
      const input = {
        ...artifactInput('target-orphan', 'orphan bytes', 1),
        name: 'report.txt',
      };
      const orphanPath = join(root, 'artifacts', 'session-1', 'target-orphan-report.txt');
      await mkdir(dirname(orphanPath), { recursive: true });
      await writeFile(orphanPath, input.content, { flag: 'wx' });

      const bare = createArtifactStore(root);
      const adopted = await bare.create(input);
      assert.equal(adopted.name, 'report.txt');
      assert.equal(adopted.relativePath, blobPath('orphan bytes'));
      assert.deepEqual(await readArtifactText(createArtifactStore(root), adopted.id), {
        ok: true,
        text: input.content,
      });
    });
  });

  test('invalid path identities and turn keys cannot block later artifact writes', async () => {
    const invalidIdentities = [
      { field: 'id', value: 'a'.repeat(ARTIFACT_ENTITY_ID_MAX_CHARS + 1) },
      { field: 'id', value: '.' },
      { field: 'sessionId', value: 'session/bad' },
      { field: 'turnId', value: 'turn\nid' },
      { field: 'turnId', value: 'x'.repeat(ARTIFACT_TURN_KEY_MAX_CHARS + 1) },
    ] as const;

    for (const { field, value } of invalidIdentities) {
      await withWorkspace(async (root) => {
        await assert.rejects(
          writeArtifactMetadata(root, [recordWithIdentity(field, value)]),
          /Invalid immutable Artifact metadata/,
        );
        const store = createArtifactStore(root);
        assert.deepEqual(await listArtifacts(store, 'session-1'), []);
        assert.equal(
          (await store.create(artifactInput('replacement', 'kept', 1))).id,
          'replacement',
        );
      });
    }
  });

  test('legacy purge-intent residue cannot block later writes', async () => {
    await withWorkspace(async (root) => {
      const intentPath = join(root, 'artifacts', '.artifact-purge-intent.json');
      await mkdir(dirname(intentPath), { recursive: true });
      await writeFile(intentPath, 'not valid json', 'utf8');

      const authority = createArtifactStoreWriteAuthority(root);
      const record = await authority.store.create(artifactInput('after-retired-purge', 'kept', 1));

      assert.equal(record.id, 'after-retired-purge');
      assert.equal(await readFile(intentPath, 'utf8'), 'not valid json');
    });
  });

  test('user delete removes membership and garbage collection reclaims the bytes', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const record = await store.create(artifactInput('artifact-1', '<h1>Report</h1>', 1));

      await store.deleteUserArtifactInSession(record.sessionId, record.id);
      await store.collectGarbage({ maxPaths: 100 });
      await store.deleteUserArtifactInSession(record.sessionId, record.id);
      await store.collectGarbage({ maxPaths: 100 });
      assert.deepEqual(await listArtifacts(store, 'session-1'), []);
      assert.equal(await getArtifact(store, record.id), null);
      await assert.rejects(() => stat(join(root, 'artifacts', record.relativePath)), {
        code: 'ENOENT',
      });
    });
  });

  test('failed garbage collection retains cleanup obligations across reopen', async (t) => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const first = await store.create(artifactInput('first', 'first', 1));
      const second = await store.create(artifactInput('second', 'second', 2));
      await store.purgeSessionArtifacts('session-1');
      const target = await fsPromises.realpath(join(root, 'artifacts', second.relativePath));
      const unlink = fsPromises.unlink;
      const injected = t.mock.method(
        fsPromises,
        'unlink',
        async (path: Parameters<typeof unlink>[0]) => {
          if (path === target)
            throw Object.assign(new Error('injected unlink failure'), { code: 'EIO' });
          return unlink(path);
        },
      );
      syncBuiltinESMExports();
      try {
        assert.equal((await store.collectGarbage({ maxPaths: 100 })).failedPaths, 1);
      } finally {
        injected.mock.restore();
        syncBuiltinESMExports();
      }
      store.close();
      const reopened = createArtifactStore(root);
      assert.deepEqual(await listArtifacts(reopened, 'session-1'), []);
      assert.equal((await reopened.collectGarbage({ maxPaths: 100 })).failedPaths, 0);
      for (const record of [first, second])
        await assert.rejects(stat(join(root, 'artifacts', record.relativePath)), {
          code: 'ENOENT',
        });
    });
  });

  test('garbage collection refuses a symlink escape after membership deletion', async (t) => {
    const outsideRoot = await mkdtemp(join(tmpdir(), 'maka-artifact-outside-'));
    try {
      await withWorkspace(async (root) => {
        const artifactRoot = join(root, 'artifacts');
        const safeRecord = canonicalRecord({
          id: 'safe',
          sessionId: 'session-1',
          name: 'safe.txt',
          sizeBytes: 4,
        });
        const escapedRecord = canonicalRecord({
          id: 'escaped',
          sessionId: 'linked',
          name: 'victim.txt',
          sizeBytes: 8,
        });
        await mkdir(dirname(join(artifactRoot, safeRecord.relativePath)), { recursive: true });
        await writeFile(join(artifactRoot, safeRecord.relativePath), 'safe', 'utf8');
        const externalPath = join(outsideRoot, basename(escapedRecord.relativePath));
        await writeFile(externalPath, 'external', 'utf8');
        if (
          !(await createSymlinkOrSkip(
            t,
            outsideRoot,
            dirname(join(artifactRoot, escapedRecord.relativePath)),
            'dir',
          ))
        )
          return;
        await writeArtifactMetadata(root, [safeRecord, escapedRecord]);

        const store = createArtifactStore(root);
        await store.deleteUserArtifactInSession(escapedRecord.sessionId, escapedRecord.id);
        assert.equal((await store.collectGarbage({ maxPaths: 100 })).failedPaths, 1);

        assert.equal(await readFile(externalPath, 'utf8'), 'external');
        assert.equal(await readFile(join(artifactRoot, safeRecord.relativePath), 'utf8'), 'safe');
        assert.equal((await getArtifact(store, safeRecord.id))?.id, safeRecord.id);
        assert.equal(await getArtifact(store, escapedRecord.id, escapedRecord.sessionId), null);
      });
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  test('purge unlinks a final symlink without deleting its in-root target', async (t) => {
    await withWorkspace(async (root) => {
      const artifactRoot = join(root, 'artifacts');
      const record = canonicalRecord({
        id: 'linked',
        sessionId: 'session-1',
        name: 'linked.txt',
        sizeBytes: 11,
      });
      const sessionRoot = dirname(join(artifactRoot, record.relativePath));
      await mkdir(sessionRoot, { recursive: true });
      const targetPath = join(sessionRoot, 'target.txt');
      const linkPath = join(artifactRoot, record.relativePath);
      await writeFile(targetPath, 'keep target', 'utf8');
      if (!(await createSymlinkOrSkip(t, 'target.txt', linkPath, 'file'))) return;
      await writeArtifactMetadata(root, [record]);

      const store = createArtifactStore(root);
      await store.deleteUserArtifactInSession(record.sessionId, record.id);
      await store.collectGarbage({ maxPaths: 100 });

      assert.equal(await readFile(targetPath, 'utf8'), 'keep target');
      await assert.rejects(() => stat(linkPath), { code: 'ENOENT' });
      assert.equal(await getArtifact(store, record.id), null);
    });
  });

  test('purge preserves a payload inode still referenced by a non-target canonical record', async () => {
    await withWorkspace(async (root) => {
      const artifactRoot = join(root, 'artifacts');
      const first = canonicalRecord({
        id: 'first',
        sessionId: 'session-1',
        name: 'first.txt',
        sizeBytes: 12,
      });
      const second = canonicalRecord({
        id: 'second',
        sessionId: 'session-1',
        name: 'second.txt',
        sizeBytes: 12,
      });
      const firstPath = join(artifactRoot, first.relativePath);
      const secondPath = join(artifactRoot, second.relativePath);
      await mkdir(dirname(firstPath), { recursive: true });
      await writeFile(firstPath, 'shared bytes', 'utf8');
      await mkdir(dirname(secondPath), { recursive: true });
      await link(firstPath, secondPath);
      await writeArtifactMetadata(root, [first, second]);
      const firstStat = await stat(firstPath);
      const secondStat = await stat(secondPath);
      assert.equal(firstStat.ino, secondStat.ino);

      const store = createArtifactStore(root);
      await store.deleteUserArtifactInSession(first.sessionId, first.id);
      await store.collectGarbage({ maxPaths: 100 });

      await assert.rejects(() => stat(firstPath), { code: 'ENOENT' });
      assert.equal(await readFile(secondPath, 'utf8'), 'shared bytes');
      assert.equal((await getArtifact(store, second.id))?.id, second.id);
      assert.deepEqual(await readArtifactText(store, second.id), {
        ok: true,
        text: 'shared bytes',
      });
    });
  });

  test('case-distinct logical identities share bytes without filesystem case aliases', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const lower = await store.create(artifactInput('case', 'shared bytes', 1));
      const upper = await store.create(artifactInput('CASE', 'shared bytes', 1));
      assert.equal(lower.relativePath, upper.relativePath);
      assert.equal(lower.relativePath, lower.relativePath.toLowerCase());
      await store.deleteUserArtifactInSession(lower.sessionId, lower.id);
      await store.collectGarbage({ maxPaths: 100 });
      assert.deepEqual(await readArtifactText(store, upper.id), { ok: true, text: 'shared bytes' });
    });
  });

  test('a planted shared-blob symlink is unreadable and GC never deletes its destination', async (t) => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const first = await store.create(artifactInput('first', 'shared bytes', 1));
      const second = await store.create(artifactInput('second', 'shared bytes', 1));
      const path = join(root, 'artifacts', first.relativePath);
      const target = join(dirname(path), 'target.txt');
      await writeFile(target, 'keep destination');
      await rm(path);
      if (!(await createSymlinkOrSkip(t, target, path, 'file'))) return;
      await store.deleteUserArtifactInSession(first.sessionId, first.id);
      await store.collectGarbage({ maxPaths: 100 });
      assert.equal((await lstat(path)).isSymbolicLink(), true);
      assert.deepEqual(await readArtifactText(store, second.id), {
        ok: false,
        reason: 'not_allowed',
      });
      await store.deleteUserArtifactInSession(second.sessionId, second.id);
      await store.collectGarbage({ maxPaths: 100 });
      assert.equal(await readFile(target, 'utf8'), 'keep destination');
      await assert.rejects(lstat(path), { code: 'ENOENT' });
    });
  });

  test('durable attachment reads report physically deleted bytes as missing', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await store.create({ ...artifactInput('image', png, 1), name: 'image.png', kind: 'image' });
      await store.deleteUserArtifactInSession('session-1', 'image');

      assert.deepEqual(await readArtifactBinary(store, 'image'), {
        ok: false,
        reason: 'not_found',
      });
      assert.deepEqual(
        await store.readDurableAttachmentBinary({
          artifactId: 'image',
          sessionId: 'other-session',
        }),
        { ok: false, reason: 'not_found' },
      );
      assert.deepEqual(
        await store.readDurableAttachmentBinary({
          artifactId: 'image',
          sessionId: 'session-1',
        }),
        { ok: false, reason: 'not_found' },
      );
    });
  });

  test('enforces preview limits and sniffed binary MIME types', async () => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      await store.create(
        artifactInput('large', 'x'.repeat(ARTIFACT_TEXT_PREVIEW_LIMIT_BYTES + 1), 1),
      );
      await store.create({
        ...artifactInput('unknown', Uint8Array.from([0, 1, 2, 3]), 2),
        name: 'unknown.bin',
      });

      assert.deepEqual(await readArtifactText(store, 'large'), { ok: false, reason: 'too_large' });
      assert.deepEqual(await readArtifactBinary(store, 'unknown'), {
        ok: false,
        reason: 'unsupported_mime',
      });
    });
  });

  test('persists canonical entity identities at the shared 128-character boundary', async () => {
    await withWorkspace(async (root) => {
      const boundaryId = 'a'.repeat(ARTIFACT_ENTITY_ID_MAX_CHARS);
      const store = createArtifactStore(root);
      const record = await store.create({
        id: boundaryId,
        sessionId: boundaryId,
        turnId: boundaryId,
        name: 'boundary.txt',
        kind: 'file',
        content: 'boundary',
        source: 'tool_result',
        now: 1,
      });

      assert.equal(record.id.length, ARTIFACT_ENTITY_ID_MAX_CHARS);
      assert.deepEqual(
        await getArtifact(createArtifactStore(root), boundaryId, boundaryId),
        record,
      );
      assert.deepEqual(await listArtifacts(createArtifactStore(root), boundaryId), [record]);
    });
  });

  test('create rejects invalid path identities and bounded turn keys', async () => {
    const invalidInputs = [
      {
        expected: /Artifact id must be a canonical entity ID/,
        input: { ...artifactInput('a'.repeat(ARTIFACT_ENTITY_ID_MAX_CHARS + 1), 'no', 1) },
      },
      {
        expected: /Artifact id must be a canonical entity ID/,
        input: { ...artifactInput('.', 'no', 1) },
      },
      {
        expected: /Artifact sessionId must be a canonical entity ID/,
        input: { ...artifactInput('valid', 'no', 1), sessionId: 'session/bad' },
      },
      {
        expected: /Artifact turnId must be a bounded opaque turn key/,
        input: { ...artifactInput('valid', 'no', 1), turnId: '' },
      },
      {
        expected: /Artifact turnId must be a bounded opaque turn key/,
        input: { ...artifactInput('valid', 'no', 1), turnId: 'turn\nid' },
      },
      {
        expected: /Artifact turnId must be a bounded opaque turn key/,
        input: {
          ...artifactInput('valid', 'no', 1),
          turnId: 'x'.repeat(ARTIFACT_TURN_KEY_MAX_CHARS + 1),
        },
      },
    ] as const;

    for (const { expected, input } of invalidInputs) {
      await withWorkspace(async (root) => {
        await assert.rejects(() => createArtifactStore(root).create(input), expected);
        await assert.rejects(() => stat(join(root, 'artifacts')), { code: 'ENOENT' });
      });
    }
  });

  test('keeps relative path resolution inside the artifact root', async () => {
    assert.equal(isSafeRelativeArtifactPath('session-1/artifact.txt'), true);
    for (const value of ['', '/tmp/file', '../file', 'session/../file', 'file:///tmp/a']) {
      assert.equal(isSafeRelativeArtifactPath(value), false, value);
    }
    assert.equal(sanitizeArtifactName(' ../unsafe:name?.txt '), 'unsafe-name-.txt');

    await withWorkspace(async (root) => {
      assert.deepEqual(
        await resolveArtifactPath({
          artifactRoot: join(root, 'artifacts'),
          relativePath: '../outside',
        }),
        { ok: false, reason: 'not_allowed' },
      );
    });
  });

  test('resolve and read reject a canonical payload that escapes through a symlink', async (t) => {
    const outsideRoot = await mkdtemp(join(tmpdir(), 'maka-artifact-read-outside-'));
    try {
      await withWorkspace(async (root) => {
        const artifactRoot = join(root, 'artifacts');
        const record = canonicalRecord({
          id: 'escaped',
          sessionId: 'session-1',
          name: 'secret.txt',
          sizeBytes: 6,
        });
        await mkdir(dirname(join(artifactRoot, record.relativePath)), { recursive: true });
        const outsidePath = join(outsideRoot, 'secret.txt');
        await writeFile(outsidePath, 'secret', 'utf8');
        if (
          !(await createSymlinkOrSkip(
            t,
            outsidePath,
            join(artifactRoot, record.relativePath),
            'file',
          ))
        ) {
          return;
        }
        await writeArtifactMetadata(root, [record]);

        assert.deepEqual(
          await resolveArtifactPath({
            artifactRoot,
            relativePath: record.relativePath,
          }),
          { ok: false, reason: 'not_allowed' },
        );
        assert.deepEqual(await readArtifactText(createArtifactStore(root), record.id), {
          ok: false,
          reason: 'not_allowed',
        });
      });
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  test('create path and identity failures leave no payload or metadata', async (t) => {
    await withWorkspace(async (root) => {
      const store = createArtifactStore(root);
      await assert.rejects(
        () => store.create({ ...artifactInput('bad/id', 'no', 1) }),
        /Artifact id must be a canonical entity ID/,
      );
      await assert.rejects(
        () =>
          store.create({
            ...artifactInput('invalid-role', 'no', 1),
            deepResearchRole: 'invalid' as never,
          }),
        /Invalid Artifact deep-research role/,
      );
      await assert.rejects(() => stat(join(root, 'artifacts')), { code: 'ENOENT' });
    });

    const outsideRoot = await mkdtemp(join(tmpdir(), 'maka-artifact-create-outside-'));
    try {
      await withWorkspace(async (root) => {
        const artifactRoot = join(root, 'artifacts');
        await mkdir(artifactRoot, { recursive: true });
        if (!(await createSymlinkOrSkip(t, outsideRoot, join(artifactRoot, 'blobs'), 'dir'))) {
          return;
        }

        await assert.rejects(
          () => createArtifactStore(root).create(artifactInput('escaped', 'must not write', 1)),
          /(?:target directory|root) must be a real directory/,
        );
        assert.deepEqual(await readdir(outsideRoot), []);
        await assert.rejects(() => stat(join(artifactRoot, 'metadata.jsonl')), {
          code: 'ENOENT',
        });
        assert.deepEqual((await readdir(artifactRoot)).sort(), ['blobs']);
      });
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });
});

function artifactInput(id: string, content: string | Uint8Array, now: number) {
  return {
    id,
    sessionId: 'session-1',
    turnId: 'turn-1',
    name: `${id}.txt`,
    kind: 'file' as const,
    content,
    source: 'tool_result' as const,
    now,
  };
}

function deepResearchArtifactInput(id: string, content: string) {
  return {
    id,
    sessionId: 'session-1',
    turnId: 'turn-1',
    name: 'research.md',
    kind: 'file' as const,
    content,
    mimeType: 'text/markdown',
    source: 'deep_research' as const,
    summary: 'Stable research artifact',
    deepResearchRole: 'source' as const,
  };
}

function canonicalRecord(input: {
  id: string;
  sessionId: string;
  name: string;
  sizeBytes: number;
}): ArtifactRecord {
  return {
    id: input.id,
    sessionId: input.sessionId,
    turnId: 'turn-1',
    createdAt: 1,
    name: input.name,
    kind: 'file',
    relativePath: blobPath(input.id),
    sizeBytes: input.sizeBytes,
    source: 'tool_result',
  };
}

function recordWithIdentity(field: 'id' | 'sessionId' | 'turnId', value: string): ArtifactRecord {
  const record = canonicalRecord({
    id: 'artifact-1',
    sessionId: 'session-1',
    name: 'artifact.txt',
    sizeBytes: 0,
  });
  return { ...record, [field]: value };
}

async function writeArtifactMetadata(
  root: string,
  records: readonly ArtifactRecord[],
): Promise<string> {
  const repository = createSqliteArtifactMetadataRepository(root);
  try {
    repository.applyChanges({ upserts: records });
  } finally {
    repository.close();
  }
  return join(root, 'runtime.sqlite');
}

async function createSymlinkOrSkip(
  t: TestContext,
  target: string,
  path: string,
  type: 'file' | 'dir',
): Promise<boolean> {
  try {
    await symlink(target, path, type);
    return true;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES')) {
      t.skip('Windows symlink creation requires elevated privileges or Developer Mode');
      return false;
    }
    throw error;
  }
}

async function createPublicationResidue(
  root: string,
  id: string,
  name: string,
  content: string,
  sessionId = 'session-1',
): Promise<{ stagingPath: string; targetPath: string }> {
  const sessionDirectory = join(root, 'artifacts', sessionId);
  await mkdir(sessionDirectory, { recursive: true });
  const targetPath = join(sessionDirectory, `${id}-${name}`);
  const stagingPath = publicationStagingPath(targetPath);
  await writeFile(stagingPath, content, { flag: 'wx' });
  await link(stagingPath, targetPath);
  return { stagingPath, targetPath };
}

async function holdArtifactWriterLock(
  root: string,
): Promise<{ release: () => void; finished: Promise<void> }> {
  let release!: () => void;
  let acquired!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const finished = withArtifactWriterLock(root, async () => {
    acquired();
    await gate;
  });
  await entered;
  return { release, finished };
}

function publicationStagingPath(targetPath: string): string {
  const hash = createHash('sha256').update(basename(targetPath)).digest('hex');
  return join(
    dirname(targetPath),
    `.artifact-publish.${hash}.00000000-0000-4000-8000-000000000000.tmp`,
  );
}

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'maka-artifact-store-'));
  try {
    await run(root);
  } finally {
    closeArtifactStores(root);
    await rm(root, { recursive: true, force: true });
  }
}

function blobPath(content: string): string {
  const hash = createHash('sha256').update(content).digest('hex');
  return `blobs/sha256/${hash.slice(0, 2)}/${hash}`;
}
