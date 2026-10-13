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

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { ArtifactRecord } from '@maka/core/artifacts';
import { stableJsonStringify } from '@maka/core/canonical-json';
import { decodeArtifactRecordJsons } from './artifact-metadata-codec.js';
import {
  acquireOperationalStateDatabase,
  type OperationalStateDatabaseLease,
} from './operational-state-store.js';

/** A read model only: resource metadata is stored once, not once per Session. */
export const ARTIFACT_RECORD_SELECT = `SELECT r.session_id, o.artifact_id,
  o.created_at, o.relative_path, o.size_bytes,
  json_set(o.record_json, '$.sessionId', r.session_id) AS record_json
  FROM artifact_records r JOIN artifact_objects o USING (artifact_id)`;

export interface ArtifactMetadataChanges {
  readonly upserts?: readonly ArtifactRecord[];
  readonly deleteIds?: readonly string[];
  readonly deleteReferences?: readonly { sessionId: string; artifactId: string }[];
  readonly deleteSessions?: readonly string[];
  readonly handoffs?: readonly ArtifactHandoff[];
  readonly copyHandoffs?: { sourceSessionId: string; targetSessionId: string };
  readonly taskOutputSnapshots?: readonly {
    sessionId: string;
    shellRunId: string;
    artifactId: string | null;
  }[];
}

interface ArtifactHandoff {
  readonly sessionId: string;
  readonly sourceSessionId: string;
  readonly artifactId: string;
}

export function encodeArtifactObject(record: ArtifactRecord): string {
  const { sessionId: _membership, ...resource } = record;
  return stableJsonStringify(resource);
}

export function createSqliteArtifactMetadataRepository(workspaceRoot: string) {
  return new SqliteArtifactMetadataRepository(workspaceRoot);
}

class SqliteArtifactMetadataRepository {
  readonly #lease: OperationalStateDatabaseLease;
  #closed = false;

  constructor(workspaceRoot: string) {
    this.#lease = acquireOperationalStateDatabase(resolve(workspaceRoot));
  }

  readAll(): ArtifactRecord[] {
    this.assertOpen();
    return decodeRows(
      this.#lease.database
        .prepare(`${ARTIFACT_RECORD_SELECT}
      ORDER BY o.created_at, o.artifact_id, r.session_id`)
        .all(),
    );
  }

  readSession(sessionId: string): ArtifactRecord[] {
    this.assertOpen();
    return decodeRows(
      this.#lease.database
        .prepare(`${ARTIFACT_RECORD_SELECT}
      WHERE r.session_id = ? ORDER BY o.created_at DESC, o.artifact_id`)
        .all(sessionId),
    );
  }

  readInSession(sessionId: string, artifactId: string): ArtifactRecord | undefined {
    this.assertOpen();
    return decodeRows(
      this.#lease.database
        .prepare(`${ARTIFACT_RECORD_SELECT}
      WHERE r.session_id = ? AND r.artifact_id = ?`)
        .all(sessionId, artifactId),
    )[0];
  }

  /** Internal keyset scan: no UI list revision or repeated count/hash of the Session. */
  scanSession(sessionId: string, afterArtifactId: string, limit: number): ArtifactRecord[] {
    this.assertOpen();
    return decodeRows(
      this.#lease.database
        .prepare(`${ARTIFACT_RECORD_SELECT}
      WHERE r.session_id = ? AND r.artifact_id > ? ORDER BY r.artifact_id LIMIT ?`)
        .all(sessionId, afterArtifactId, limit),
    );
  }

  hasHandoff(sessionId: string, sourceSessionId: string, artifactId: string): boolean {
    this.assertOpen();
    return !!this.#lease.database
      .prepare(`SELECT 1 FROM artifact_handoffs
        WHERE session_id = ? AND source_session_id = ? AND artifact_id = ?`)
      .get(sessionId, sourceSessionId, artifactId);
  }

  hasIdentity(artifactId: string): boolean {
    this.assertOpen();
    return !!this.#lease.database
      .prepare('SELECT 1 FROM artifact_objects WHERE artifact_id = ?')
      .get(artifactId);
  }

  hasMembership(artifactId: string): boolean {
    this.assertOpen();
    return !!this.#lease.database
      .prepare('SELECT 1 FROM artifact_records WHERE artifact_id = ? LIMIT 1')
      .get(artifactId);
  }

  readIdentity(artifactId: string, sessionId: string): ArtifactRecord | undefined {
    this.assertOpen();
    return decodeRows(
      this.#lease.database
        .prepare(`SELECT artifact_id, relative_path, created_at, size_bytes,
      ? AS session_id, json_set(record_json, '$.sessionId', ?) AS record_json
      FROM artifact_objects WHERE artifact_id = ?`)
        .all(sessionId, sessionId, artifactId),
    )[0];
  }

  /** Immutable objects make the sorted membership IDs a complete revision token. */
  private revision(sessionId: string): `sha256:${string}` {
    const hash = createHash('sha256');
    for (const row of this.#lease.database
      .prepare('SELECT artifact_id FROM artifact_records WHERE session_id = ? ORDER BY artifact_id')
      .all(sessionId))
      hash.update(String(row.artifact_id)).update('\0');
    return `sha256:${hash.digest('hex')}`;
  }

  readEntry(sessionId: string, artifactId: string) {
    this.assertOpen();
    return this.#lease.transaction('read', () => ({
      revision: this.revision(sessionId),
      record: this.readInSession(sessionId, artifactId) ?? null,
    }));
  }

  readPage(sessionId: string, offset: number, limit: number) {
    this.assertOpen();
    return this.#lease.transaction('read', () => ({
      revision: this.revision(sessionId),
      total: Number(
        this.#lease.database
          .prepare('SELECT COUNT(*) AS count FROM artifact_records WHERE session_id = ?')
          .get(sessionId)!.count,
      ),
      records: decodeRows(
        this.#lease.database
          .prepare(`${ARTIFACT_RECORD_SELECT}
        WHERE r.session_id = ? ORDER BY o.created_at DESC, o.artifact_id LIMIT ? OFFSET ?`)
          .all(sessionId, limit, offset),
      ),
    }));
  }

  applyChanges(changes: ArtifactMetadataChanges): void {
    this.assertOpen();
    this.#lease.transaction('write', () => {
      const database = this.#lease.database;
      const orphaned = new Set<string>();
      const remember = (rows: readonly Record<string, unknown>[]) => {
        for (const row of rows) orphaned.add(String(row.relative_path));
      };
      for (const sessionId of changes.deleteSessions ?? []) {
        remember(
          database.prepare(`${ARTIFACT_RECORD_SELECT} WHERE r.session_id = ?`).all(sessionId),
        );
        database
          .prepare('DELETE FROM session_task_output_snapshots WHERE session_id = ?')
          .run(sessionId);
        database.prepare('DELETE FROM artifact_records WHERE session_id = ?').run(sessionId);
        database.prepare('DELETE FROM artifact_handoffs WHERE session_id = ?').run(sessionId);
      }
      for (const ref of changes.deleteReferences ?? []) {
        remember(
          database
            .prepare(`${ARTIFACT_RECORD_SELECT} WHERE r.session_id = ? AND r.artifact_id = ?`)
            .all(ref.sessionId, ref.artifactId),
        );
        database
          .prepare('DELETE FROM artifact_records WHERE session_id = ? AND artifact_id = ?')
          .run(ref.sessionId, ref.artifactId);
      }
      for (const id of changes.deleteIds ?? []) {
        remember(
          database
            .prepare('SELECT relative_path FROM artifact_objects WHERE artifact_id = ?')
            .all(id),
        );
        database.prepare('DELETE FROM artifact_records WHERE artifact_id = ?').run(id);
      }
      const queue = database.prepare(`INSERT INTO artifact_gc_paths(relative_path)
        SELECT ? WHERE NOT EXISTS (
          SELECT 1 FROM artifact_objects o JOIN artifact_records r USING (artifact_id)
          WHERE o.relative_path = ?)
        ON CONFLICT(relative_path) DO NOTHING`);
      for (const path of orphaned) queue.run(path, path);
      const object = database.prepare(`INSERT INTO artifact_objects
        (artifact_id, relative_path, size_bytes, created_at, record_json)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(artifact_id) DO NOTHING`);
      const readObject = database.prepare(
        'SELECT record_json FROM artifact_objects WHERE artifact_id = ?',
      );
      const attach = database.prepare(`INSERT INTO artifact_records(session_id, artifact_id)
        VALUES (?, ?) ON CONFLICT(session_id, artifact_id) DO NOTHING`);
      for (const record of changes.upserts ?? []) {
        if (decodeArtifactRecordJsons([JSON.stringify(record)]).length !== 1)
          throw new Error('Invalid immutable Artifact metadata');
        const encoded = encodeArtifactObject(record);
        object.run(record.id, record.relativePath, record.sizeBytes, record.createdAt, encoded);
        if (readObject.get(record.id)?.record_json !== encoded)
          throw new Error(
            `Artifact ${record.id} already names different immutable content or metadata`,
          );
        attach.run(record.sessionId, record.id);
        database
          .prepare('DELETE FROM artifact_gc_paths WHERE relative_path = ?')
          .run(record.relativePath);
      }
      const handoff = database.prepare(`INSERT INTO artifact_handoffs VALUES (?, ?, ?)
        ON CONFLICT(session_id, source_session_id, artifact_id) DO NOTHING`);
      for (const receipt of changes.handoffs ?? [])
        handoff.run(receipt.sessionId, receipt.sourceSessionId, receipt.artifactId);
      if (changes.copyHandoffs) {
        database
          .prepare(`INSERT INTO artifact_handoffs
            SELECT ?, source_session_id, artifact_id FROM artifact_handoffs WHERE session_id = ?
            ON CONFLICT(session_id, source_session_id, artifact_id) DO NOTHING`)
          .run(changes.copyHandoffs.targetSessionId, changes.copyHandoffs.sourceSessionId);
      }
      const bind = database.prepare(`INSERT INTO session_task_output_snapshots VALUES (?, ?, ?)
        ON CONFLICT(session_id, shell_run_id) DO NOTHING`);
      for (const snapshot of changes.taskOutputSnapshots ?? []) {
        bind.run(snapshot.sessionId, snapshot.shellRunId, snapshot.artifactId);
        const stored = database
          .prepare(`SELECT artifact_id FROM session_task_output_snapshots
          WHERE session_id = ? AND shell_run_id = ?`)
          .get(snapshot.sessionId, snapshot.shellRunId);
        if (stored?.artifact_id !== snapshot.artifactId)
          throw new Error('Task output snapshot is immutable');
      }
    });
  }

  readTaskOutputSnapshot(sessionId: string, shellRunId: string): string | null | undefined {
    this.assertOpen();
    const row = this.#lease.database
      .prepare(
        'SELECT artifact_id FROM session_task_output_snapshots WHERE session_id = ? AND shell_run_id = ?',
      )
      .get(sessionId, shellRunId);
    return row ? (row.artifact_id === null ? null : String(row.artifact_id)) : undefined;
  }

  readTaskOutputSnapshots(sessionId: string): Map<string, string | null> {
    this.assertOpen();
    return new Map(
      this.#lease.database
        .prepare(
          'SELECT shell_run_id, artifact_id FROM session_task_output_snapshots WHERE session_id = ?',
        )
        .all(sessionId)
        .map((row) => [
          String(row.shell_run_id),
          row.artifact_id === null ? null : String(row.artifact_id),
        ]),
    );
  }

  queueUnreferencedPaths(paths: readonly string[]): void {
    this.assertOpen();
    this.#lease.transaction('write', () => {
      const insert = this.#lease.database.prepare(`INSERT INTO artifact_gc_paths(relative_path)
        VALUES (?) ON CONFLICT(relative_path) DO NOTHING`);
      for (const path of paths) insert.run(path);
    });
  }

  readGarbagePaths(after: string, limit: number): string[] {
    this.assertOpen();
    return this.#lease.database
      .prepare(`SELECT relative_path FROM artifact_gc_paths
      WHERE relative_path > ? ORDER BY relative_path LIMIT ?`)
      .all(after, limit)
      .map((row) => String(row.relative_path));
  }

  hasRelativePath(relativePath: string): boolean {
    this.assertOpen();
    return !!this.#lease.database
      .prepare(`SELECT 1 FROM artifact_objects o
      JOIN artifact_records r USING (artifact_id) WHERE o.relative_path = ? LIMIT 1`)
      .get(relativePath);
  }

  forgetGarbagePaths(relativePaths: readonly string[]): void {
    this.assertOpen();
    this.#lease.transaction('write', () => {
      const forget = this.#lease.database.prepare(
        'DELETE FROM artifact_gc_paths WHERE relative_path = ?',
      );
      for (const path of relativePaths) forget.run(path);
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#lease.close();
  }

  private assertOpen(): void {
    if (this.#closed) throw new Error('Artifact metadata repository is closed');
  }
}

function decodeRows(rows: readonly Record<string, unknown>[]): ArtifactRecord[] {
  const records = decodeArtifactRecordJsons(rows.map((row) => row.record_json));
  if (
    records.length !== rows.length ||
    records.some((record, index) => {
      const row = rows[index]!;
      return (
        record.id !== row.artifact_id ||
        record.sessionId !== row.session_id ||
        record.relativePath !== row.relative_path ||
        record.createdAt !== row.created_at ||
        record.sizeBytes !== row.size_bytes
      );
    })
  )
    throw new Error('Invalid immutable Artifact metadata');
  return records;
}
