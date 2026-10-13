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
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { ArtifactRecord } from '@maka/core/artifacts';
import { OPERATIONAL_STATE_DATABASE_NAME } from '../operational-state-store.js';
import { createSqliteArtifactMetadataRepository } from '../sqlite-artifact-metadata.js';

test('Artifact descriptors are immutable and membership admission is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'maka-artifact-metadata-delta-'));
  const repository = createSqliteArtifactMetadataRepository(root);
  let inspector: DatabaseSync | undefined;
  try {
    const unchanged = artifactRecord('unchanged');
    const updated = artifactRecord('updated');
    const removed = artifactRecord('removed');
    repository.applyChanges({ upserts: [unchanged, updated, removed] });

    inspector = new DatabaseSync(join(root, OPERATIONAL_STATE_DATABASE_NAME));
    inspector.exec(`
      CREATE TABLE artifact_write_audit(kind TEXT NOT NULL);
      CREATE TRIGGER artifact_write_audit_insert AFTER INSERT ON artifact_records
      BEGIN INSERT INTO artifact_write_audit VALUES ('insert'); END;
      CREATE TRIGGER artifact_write_audit_update AFTER UPDATE ON artifact_records
      BEGIN INSERT INTO artifact_write_audit VALUES ('update'); END;
      CREATE TRIGGER artifact_write_audit_delete AFTER DELETE ON artifact_records
      BEGIN INSERT INTO artifact_write_audit VALUES ('delete'); END;
    `);

    assert.throws(
      () => repository.applyChanges({ upserts: [{ ...updated, summary: 'changed' }] }),
      /different immutable/,
    );
    repository.applyChanges({
      upserts: [unchanged, updated, artifactRecord('added')],
      deleteIds: [removed.id],
    });

    const writes = inspector
      .prepare('SELECT kind, count(*) AS count FROM artifact_write_audit GROUP BY kind')
      .all() as Array<{ kind: string; count: number }>;
    assert.deepEqual(
      writes.map(({ kind, count }) => ({ kind, count })),
      [
        { kind: 'delete', count: 1 },
        { kind: 'insert', count: 1 },
      ],
    );
    assert.deepEqual(
      repository
        .readAll()
        .map(({ id, summary }) => ({ id, summary }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      [
        { id: 'added', summary: undefined },
        { id: 'unchanged', summary: undefined },
        { id: 'updated', summary: undefined },
      ],
    );

    inspector.exec(`
      DROP TRIGGER artifact_write_audit_insert;
      DROP TRIGGER artifact_write_audit_update;
      DROP TRIGGER artifact_write_audit_delete;
      DROP TABLE artifact_write_audit;
    `);
  } finally {
    inspector?.close();
    repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Artifact metadata corruption is rejected rather than silently losing memberships', async () => {
  const root = await mkdtemp(join(tmpdir(), 'maka-artifact-metadata-unsupported-'));
  const repository = createSqliteArtifactMetadataRepository(root);
  let inspector: DatabaseSync | undefined;
  try {
    const supported = artifactRecord('supported');
    repository.applyChanges({ upserts: [supported] });

    const unsupported = {
      ...artifactRecord('unsupported'),
      source: 'retired_artifact_source',
    };
    inspector = new DatabaseSync(join(root, OPERATIONAL_STATE_DATABASE_NAME));
    inspector
      .prepare('INSERT INTO artifact_objects VALUES (?, ?, ?, ?, ?)')
      .run(
        unsupported.id,
        unsupported.relativePath,
        unsupported.sizeBytes,
        unsupported.createdAt,
        JSON.stringify(unsupported),
      );
    inspector
      .prepare('INSERT INTO artifact_records VALUES (?, ?)')
      .run(unsupported.sessionId, unsupported.id);
    assert.throws(() => repository.readAll(), /Invalid immutable Artifact metadata/);
  } finally {
    inspector?.close();
    repository.close();
    await rm(root, { recursive: true, force: true });
  }
});

function blobPath(text: string): string {
  const hash = createHash('sha256').update(text).digest('hex');
  return `blobs/sha256/${hash.slice(0, 2)}/${hash}`;
}

function artifactRecord(id: string): ArtifactRecord {
  return {
    id,
    sessionId: 'session-1',
    turnId: 'turn-1',
    createdAt: 1,
    name: `${id}.txt`,
    kind: 'file',
    sizeBytes: id.length,
    relativePath: blobPath(id),
    source: 'tool_result',
  };
}
