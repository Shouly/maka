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
import {
  migrateSqliteArtifactDatabase,
  SQLITE_ARTIFACT_SCHEMA_VERSION,
} from '../../sqlite-artifact-schema.js';

/**
 * Test fixture construction only, NOT an application migration. Tests of other
 * schema scopes use the released database's workflow/Session rows, but replace
 * its unrelated sample Artifact with the current, empty resource schema. The
 * original binary fixture is never modified; unsupported Artifact formats are rejected.
 */
export function installCurrentArtifactFixture(database: DatabaseSync): void {
  database.exec('DROP TABLE artifact_records');
  migrateSqliteArtifactDatabase(database);
  database
    .prepare("UPDATE operational_schema_migrations SET version = ? WHERE scope = 'artifact'")
    .run(SQLITE_ARTIFACT_SCHEMA_VERSION);
}
