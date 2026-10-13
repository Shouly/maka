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

import type { DatabaseSync } from 'node:sqlite';

export const SQLITE_ARTIFACT_SCHEMA_VERSION = 7;

/** A fresh format, not a migration or a destructive reset of earlier workspaces. */
export function migrateSqliteArtifactDatabase(db: DatabaseSync): void {
  const existing = db
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'artifact_records'")
    .get();
  if (existing) {
    const registry = db
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'operational_schema_migrations'",
      )
      .get();
    const version = registry
      ? db
          .prepare("SELECT version FROM operational_schema_migrations WHERE scope = 'artifact'")
          .get()?.version
      : undefined;
    if (version !== SQLITE_ARTIFACT_SCHEMA_VERSION)
      throw new Error(
        'Unsupported Artifact storage format; create a new workspace. Existing data was not changed.',
      );
    // The authority's exact schema check detects corruption without repairing it.
    return;
  }
  db.exec(`
    CREATE TABLE artifact_objects (
      artifact_id TEXT PRIMARY KEY,
      relative_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      record_json TEXT NOT NULL
    );
    CREATE INDEX artifact_objects_relative_path ON artifact_objects(relative_path);
    CREATE INDEX artifact_objects_created_order ON artifact_objects(created_at, artifact_id);

    CREATE TABLE artifact_records (
      session_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL REFERENCES artifact_objects(artifact_id),
      PRIMARY KEY (session_id, artifact_id)
    );
    CREATE INDEX artifact_records_artifact_id ON artifact_records(artifact_id);

    -- A completed hand-back outlives removal of the receiver's membership or
    -- the source Session. It is evidence, not an ownership grant or a Blob pin.
    CREATE TABLE artifact_handoffs (
      session_id TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      PRIMARY KEY (session_id, source_session_id, artifact_id)
    );

    CREATE TABLE artifact_gc_paths (
      relative_path TEXT PRIMARY KEY
    );

    CREATE TABLE session_task_output_snapshots (
      session_id TEXT NOT NULL,
      shell_run_id TEXT NOT NULL,
      artifact_id TEXT,
      PRIMARY KEY (session_id, shell_run_id),
      FOREIGN KEY (session_id, artifact_id)
        REFERENCES artifact_records(session_id, artifact_id) ON DELETE CASCADE
    );
  `);
}
