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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { MAX_ATTACHMENT_BYTES } from '@maka/core/attachments';
import { type StorageRef } from '@maka/core/events';
import {
  createAttachmentByteReader,
  createAttachmentSizeReader,
  createReadImageSnapshotPlanner,
  createReadImageSnapshotter,
} from '../artifact-attachments.js';
import {
  createSqliteArtifactStoreWriteAuthority,
  type ArtifactAuthorityStore,
} from '../artifact-store.js';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function listArtifacts(store: ArtifactAuthorityStore, sessionId: string) {
  return (await store.listPage(sessionId, { offset: 0, limit: Number.MAX_SAFE_INTEGER })).records;
}

function readArtifactBinary(store: ArtifactAuthorityStore, artifactId: string) {
  return store.readBinaryInSession('session-1', artifactId);
}

describe('artifact attachment authority', () => {
  test('does not hydrate or size the retired context-image refs', async () => {
    await withStore(async (store) => {
      const reader = createAttachmentByteReader({ artifactStore: store, sessionId: 'session-1' });
      const sizes = createAttachmentSizeReader({ artifactStore: store, sessionId: 'session-1' });
      for (const ref of [sessionContextRef('ref-1'), sessionContextRef('ref-2', 'other-session')]) {
        assert.deepEqual(await reader(ref), { ok: false, reason: 'unsupported_ref_kind' });
        assert.deepEqual(await sizes(ref), { ok: false, reason: 'unsupported_ref_kind' });
      }
    });
  });

  test('resolves a live session ref and never forwards tombstoned bytes', async () => {
    await withStore(async (store) => {
      await store.create({
        id: 'image-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        name: 'image.png',
        kind: 'image',
        content: png,
        source: 'tool_result',
        now: 1,
      });
      const reader = createAttachmentByteReader({
        artifactStore: store,
        sessionId: 'session-1',
      });
      assert.deepEqual(await reader(sessionFileRef('image-1')), {
        ok: true,
        bytes: Buffer.from(png),
      });
      await store.deleteUserArtifactInSession('session-1', 'image-1');
      assert.deepEqual(await reader(sessionFileRef('image-1')), {
        ok: false,
        reason: 'not_found',
      });
      assert.deepEqual(await reader(sessionFileRef('image-1', 'other-session')), {
        ok: false,
        reason: 'session_mismatch',
      });
    });
  });

  test('rejects unsupported refs and applies the shared byte limit inside authority', async () => {
    await withStore(async (store) => {
      await store.create({
        id: 'large-image',
        sessionId: 'session-1',
        turnId: 'turn-1',
        name: 'large.png',
        kind: 'image',
        content: new Uint8Array(MAX_ATTACHMENT_BYTES + 1).fill(0x89),
        source: 'tool_result',
        now: 1,
      });
      const reader = createAttachmentByteReader({
        artifactStore: store,
        sessionId: 'session-1',
      });

      assert.deepEqual(await reader({ kind: 'workspace_file', relativePath: 'image.png' }), {
        ok: false,
        reason: 'unsupported_ref_kind',
      });
      assert.deepEqual(await reader(sessionFileRef('large-image')), {
        ok: false,
        reason: 'too_large',
      });
    });
  });

  test('passes through real store not-found and unsupported-mime failures', async () => {
    await withStore(async (store) => {
      const reader = createAttachmentByteReader({
        artifactStore: store,
        sessionId: 'session-1',
      });
      assert.deepEqual(await reader(sessionFileRef('missing')), {
        ok: false,
        reason: 'not_found',
      });

      await store.create({
        id: 'unknown-binary',
        sessionId: 'session-1',
        turnId: 'turn-1',
        name: 'unknown.bin',
        kind: 'file',
        content: Uint8Array.from([0, 1, 2, 3]),
        source: 'tool_result',
        now: 1,
      });
      assert.deepEqual(await reader(sessionFileRef('unknown-binary')), {
        ok: false,
        reason: 'unsupported_mime',
      });
    });
  });

  test('looks sizes up from the records without reading the stored bytes', async () => {
    await withStore(async (store, root) => {
      const record = await store.create({
        id: 'image-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        name: 'image.png',
        kind: 'image',
        content: png,
        source: 'tool_result_projection',
        now: 1,
      });
      const sizes = createAttachmentSizeReader({ artifactStore: store, sessionId: 'session-1' });
      const bytes = createAttachmentByteReader({ artifactStore: store, sessionId: 'session-1' });
      assert.deepEqual(await sizes(sessionFileRef('image-1')), { ok: true, bytes: png.byteLength });

      // With the stored file gone a read fails while the size still answers:
      // the lookup never opens the file.
      await rm(join(root, 'artifacts', record.relativePath));
      assert.equal((await bytes(sessionFileRef('image-1'))).ok, false);
      assert.deepEqual(await sizes(sessionFileRef('image-1')), { ok: true, bytes: png.byteLength });

      // The failures are the ones a read of the same ref would give first.
      assert.deepEqual(await sizes(sessionFileRef('missing')), { ok: false, reason: 'not_found' });
      assert.deepEqual(await sizes(sessionFileRef('image-1', 'other-session')), {
        ok: false,
        reason: 'session_mismatch',
      });
      assert.deepEqual(await sizes({ kind: 'workspace_file', relativePath: 'image.png' }), {
        ok: false,
        reason: 'unsupported_ref_kind',
      });
      assert.deepEqual(
        await createAttachmentSizeReader({
          artifactStore: store,
          sessionId: 'session-1',
          maxBytes: png.byteLength - 1,
        })(sessionFileRef('image-1')),
        { ok: false, reason: 'too_large' },
      );
    });
  });

  test('Read observations use the same Artifact byte and size readers after the source is purged', async () => {
    await withStore(async (store) => {
      const ref = await createReadImageSnapshotter(store)({
        sessionId: 'session-1',
        turnId: 'turn-1',
        name: 'observed.png',
        bytes: png,
        mimeType: 'image/png',
      });
      await store.copyConversationArtifacts({
        sourceSessionId: 'session-1',
        targetSessionId: 'branch',
        turnIds: ['turn-1'],
      });
      await store.purgeSessionArtifacts('session-1');
      await store.collectGarbage({ maxPaths: 100 });
      const owned = { ...ref, sessionId: 'branch' };
      const reader = createAttachmentByteReader({ artifactStore: store, sessionId: 'branch' });
      const sizes = createAttachmentSizeReader({ artifactStore: store, sessionId: 'branch' });
      assert.deepEqual(await reader(owned), { ok: true, bytes: Buffer.from(png) });
      assert.deepEqual(await sizes(owned), { ok: true, bytes: png.byteLength });
      assert.deepEqual(await reader(ref), { ok: false, reason: 'session_mismatch' });
    });
  });

  test('snapshotter rejects provider-unsafe images before publication', async () => {
    await withStore(async (store) => {
      await assert.rejects(
        createReadImageSnapshotter(store)({
          sessionId: 'session-1',
          turnId: 'turn-1',
          name: 'large.png',
          bytes: new Uint8Array(5 * 1024 * 1024 + 1),
          mimeType: 'image/png',
        }),
        /Image exceeds the 5MB model input limit/,
      );
      assert.deepEqual(await listArtifacts(store, 'session-1'), []);
    });
  });

  test('snapshotter reuses one content-addressed artifact for the same turn image', async () => {
    await withStore(async (store) => {
      const snapshot = createReadImageSnapshotter(store);
      const input = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        name: 'Tool Result image',
        bytes: Uint8Array.from([1, 2, 3]),
        mimeType: 'image/png',
      };

      const first = await snapshot(input);
      const repeated = await snapshot(input);

      assert.deepEqual(repeated, first);
      assert.equal((await listArtifacts(store, 'session-1')).length, 1);
    });
  });

  test('protects a durable projection image until its Session is purged', async () => {
    await withStore(async (store) => {
      const ref = await createReadImageSnapshotter(store)({
        sessionId: 'session-1',
        turnId: 'turn-1',
        name: 'Tool Result image',
        bytes: png,
        mimeType: 'image/png',
      });

      assert.equal(
        (await store.deleteUserArtifactInSession('session-1', ref.relativePath)).kind,
        'protected',
      );
      assert.equal((await readArtifactBinary(store, ref.relativePath)).ok, true);
      await store.purgeSessionArtifacts('session-1');
      assert.deepEqual(await readArtifactBinary(store, ref.relativePath), {
        ok: false,
        reason: 'not_found',
      });
    });
  });

  test('planner derives the final ref without publishing before commit', async () => {
    await withStore(async (store) => {
      // The local filesystem executor may return a Buffer, whose slice is
      // a shared view rather than the copy Uint8Array.slice would provide.
      const bytes = Buffer.from(png);
      const input = {
        sessionId: 'session-1',
        turnId: 'turn-1',
        name: 'Tool Result image',
        bytes,
        mimeType: 'image/png',
      };
      const plan = createReadImageSnapshotPlanner(store)(input);

      assert.deepEqual(await listArtifacts(store, 'session-1'), []);
      bytes[0] = 0;
      input.name = 'mutated after prepare';
      await Promise.all([plan.persist(), plan.persist()]);
      const published = await listArtifacts(store, 'session-1');
      assert.deepEqual(
        published.map((artifact) => artifact.id),
        [plan.ref.relativePath],
      );
      assert.equal(published[0]?.name, 'Tool Result image');
      assert.deepEqual(await readArtifactBinary(store, plan.ref.relativePath), {
        ok: true,
        base64: Buffer.from(png).toString('base64'),
        mimeType: 'image/png',
      });
    });
  });
});

function sessionFileRef(relativePath: string, sessionId = 'session-1'): StorageRef {
  return { kind: 'session_file', sessionId, relativePath };
}

function sessionContextRef(refId: string, sessionId = 'session-1'): StorageRef {
  return { kind: 'session_context', sessionId, refId };
}

async function withStore(
  run: (store: ArtifactAuthorityStore, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'maka-artifact-attachment-'));
  const authority = createSqliteArtifactStoreWriteAuthority(root);
  try {
    const { store } = authority;
    await run(store, root);
  } finally {
    authority.close();
    await rm(root, { recursive: true, force: true });
  }
}
