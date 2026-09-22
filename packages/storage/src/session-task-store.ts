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

import { resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  type SessionTask,
  type SessionTaskDocument,
  createSessionTask,
  emptySessionTaskDocument,
  normalizeSessionTaskDocument,
  updateSessionTask,
} from '@maka/core/session-task';
import {
  acquireOperationalStateDatabase,
  type OperationalStateDatabaseLease,
} from './operational-state-store.js';
import { ToolRefusal } from '@maka/core/events';
import { assertSafeSessionId } from './session-store.js';
import { chainWrite } from './write-queue.js';

// Schema 2 is the identified task list. Schema 1 was the whole-list Todo
// document in `workflow_session_task_documents`; nothing shipped on it, so the
// old table is dropped at migration time rather than read or converted.
const SESSION_TASK_DOCUMENT_SCHEMA_VERSION = 2;

interface StoredSessionTaskDocument {
  schemaVersion: typeof SESSION_TASK_DOCUMENT_SCHEMA_VERSION;
  nextId: number;
  items: SessionTask[];
}

export interface SessionTaskStore {
  /**
   * Return the initialized current document, persisting an empty one on the
   * first read so later reads and copies see the same row.
   */
  readOrBootstrap(sessionId: string): Promise<SessionTaskDocument>;
  /** Append one task and return the stored document with it. */
  createTask(
    sessionId: string,
    input: unknown,
  ): Promise<{ document: SessionTaskDocument; task: SessionTask }>;
  /** Apply one update, or delete the task when the status says so. */
  updateTask(
    sessionId: string,
    input: unknown,
  ): Promise<{ document: SessionTaskDocument; changed: readonly string[]; deleted: boolean }>;
  /** Initialize one conversation-copy target without overwriting conflicting state. */
  initializeCopy(input: {
    sourceSessionId: string;
    targetSessionId: string;
    copyCurrent: boolean;
  }): Promise<SessionTaskDocument>;
  /** Purge current state. */
  purgeSessionState(sessionId: string): Promise<void>;
}

export interface SqliteSessionTaskStore extends SessionTaskStore {
  ready(): Promise<void>;
  close(): void;
}

export function createSqliteSessionTaskStore(workspaceRoot: string): SqliteSessionTaskStore {
  return new SqliteSessionTaskStoreImpl(workspaceRoot);
}

class SqliteSessionTaskStoreImpl implements SqliteSessionTaskStore {
  readonly #lease: OperationalStateDatabaseLease;
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(workspaceRoot: string) {
    this.#lease = acquireOperationalStateDatabase(resolve(workspaceRoot));
  }

  ready(): Promise<void> {
    return Promise.resolve();
  }

  close(): void {
    this.#lease.close();
  }

  async readOrBootstrap(sessionId: string): Promise<SessionTaskDocument> {
    assertSafeSessionId(sessionId);
    let document: SessionTaskDocument | undefined;
    await this.#write(async () => {
      document = this.#lease.transaction('write', () => {
        const existing = readStoredDocument(this.#lease.database, sessionId);
        if (existing) return documentOf(existing);
        const initial = emptySessionTaskDocument();
        insertDocument(this.#lease.database, sessionId, storedOf(initial));
        return initial;
      });
    });
    return document!;
  }

  async createTask(
    sessionId: string,
    input: unknown,
  ): Promise<{ document: SessionTaskDocument; task: SessionTask }> {
    return this.#mutate(sessionId, (current) => {
      const created = createSessionTask(current, input as never, Date.now());
      if (!created.ok) throw new ToolRefusal(created.message, { class: 'SessionTaskRule' });
      return { document: created.value.document, result: { task: created.value.task } };
    }).then(({ document, result }) => ({ document, task: result.task }));
  }

  async updateTask(
    sessionId: string,
    input: unknown,
  ): Promise<{ document: SessionTaskDocument; changed: readonly string[]; deleted: boolean }> {
    return this.#mutate(sessionId, (current) => {
      const updated = updateSessionTask(current, input as never, Date.now());
      if (!updated.ok) throw new ToolRefusal(updated.message, { class: 'SessionTaskRule' });
      return {
        document: updated.value.document,
        result: { changed: updated.value.changed, deleted: updated.value.deleted },
      };
    }).then(({ document, result }) => ({ document, ...result }));
  }

  async initializeCopy(input: {
    sourceSessionId: string;
    targetSessionId: string;
    copyCurrent: boolean;
  }): Promise<SessionTaskDocument> {
    assertSafeSessionId(input.sourceSessionId);
    assertSafeSessionId(input.targetSessionId);
    if (input.sourceSessionId === input.targetSessionId) {
      throw new Error('SessionTask copy source and target must differ');
    }
    let document: SessionTaskDocument | undefined;
    await this.#write(async () => {
      document = this.#lease.transaction('write', () => {
        const source =
          (input.copyCurrent
            ? readStoredDocument(this.#lease.database, input.sourceSessionId)
            : undefined) ?? storedOf(emptySessionTaskDocument());
        const existing = readStoredDocument(this.#lease.database, input.targetSessionId);
        if (existing) {
          if (!sameDocument(existing, source)) {
            throw new Error('SessionTask copy target already has different state');
          }
          return documentOf(existing);
        }
        insertDocument(this.#lease.database, input.targetSessionId, source);
        return documentOf(source);
      });
    });
    return document!;
  }

  async purgeSessionState(sessionId: string): Promise<void> {
    assertSafeSessionId(sessionId);
    await this.#write(async () => {
      this.#lease.transaction('write', () => {
        this.#lease.database
          .prepare('DELETE FROM workflow_session_task_documents WHERE session_id = ?')
          .run(sessionId);
      });
    });
  }

  /** Read-modify-write inside one transaction, so two callers cannot interleave. */
  async #mutate<T>(
    sessionId: string,
    apply: (current: SessionTaskDocument) => { document: SessionTaskDocument; result: T },
  ): Promise<{ document: SessionTaskDocument; result: T }> {
    assertSafeSessionId(sessionId);
    let outcome: { document: SessionTaskDocument; result: T } | undefined;
    await this.#write(async () => {
      outcome = this.#lease.transaction('write', () => {
        const stored = readStoredDocument(this.#lease.database, sessionId);
        const current = stored ? documentOf(stored) : emptySessionTaskDocument();
        const applied = apply(current);
        upsertDocument(this.#lease.database, sessionId, storedOf(applied.document));
        return applied;
      });
    });
    return outcome!;
  }

  #write(operation: () => Promise<void>): Promise<void> {
    // Task documents are small and infrequently mutated. One queue makes
    // cross-Session initialization linearizable without lock ordering.
    return chainWrite(this.writeQueues, 'session-task', operation);
  }
}

function storedOf(document: SessionTaskDocument): StoredSessionTaskDocument {
  return {
    schemaVersion: SESSION_TASK_DOCUMENT_SCHEMA_VERSION,
    nextId: document.nextId,
    items: document.items.map((item) => ({ ...item })),
  };
}

function documentOf(stored: StoredSessionTaskDocument): SessionTaskDocument {
  return { nextId: stored.nextId, items: stored.items.map((item) => ({ ...item })) };
}

function sameDocument(left: StoredSessionTaskDocument, right: StoredSessionTaskDocument): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readStoredDocument(
  database: DatabaseSync,
  sessionId: string,
): StoredSessionTaskDocument | undefined {
  const row = database
    .prepare('SELECT record_json FROM workflow_session_task_documents WHERE session_id = ?')
    .get(sessionId) as { record_json?: unknown } | undefined;
  if (!row) return undefined;
  if (typeof row.record_json !== 'string') throw new Error('Invalid SessionTask document record');
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.record_json);
  } catch {
    throw new Error('Invalid SessionTask document JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid SessionTask document shape');
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== 'items' ||
    keys[1] !== 'nextId' ||
    keys[2] !== 'schemaVersion'
  ) {
    throw new Error('Invalid SessionTask document fields');
  }
  if (record.schemaVersion !== SESSION_TASK_DOCUMENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported SessionTask document schema: ${String(record.schemaVersion)}`);
  }
  if (
    typeof record.nextId !== 'number' ||
    !Number.isSafeInteger(record.nextId) ||
    record.nextId < 1
  ) {
    throw new Error('Invalid SessionTask document nextId');
  }
  // The rows this reads are the ones this file wrote, so in a healthy workspace
  // the check never fires. It is here because the IPC decoder runs the same one
  // (`protocol/session-task.ts`), and a durable edge that trusts what a wire
  // edge verifies has the two backwards: the row outlives the process, and a
  // document with a broken dependency graph renders a task blocked by an id
  // nothing can ever complete.
  const normalized = normalizeSessionTaskDocument({ nextId: record.nextId, items: record.items });
  if (!normalized.ok) throw new Error(`Invalid SessionTask document: ${normalized.message}`);
  return {
    schemaVersion: SESSION_TASK_DOCUMENT_SCHEMA_VERSION,
    nextId: normalized.value.nextId,
    items: [...normalized.value.items],
  };
}

function insertDocument(
  database: DatabaseSync,
  sessionId: string,
  document: StoredSessionTaskDocument,
): void {
  database
    .prepare(`
      INSERT INTO workflow_session_task_documents(session_id, record_json)
      VALUES (?, ?)
    `)
    .run(sessionId, JSON.stringify(document));
}

function upsertDocument(
  database: DatabaseSync,
  sessionId: string,
  document: StoredSessionTaskDocument,
): void {
  database
    .prepare(`
      INSERT INTO workflow_session_task_documents(session_id, record_json)
      VALUES (?, ?)
      ON CONFLICT(session_id) DO UPDATE SET record_json = excluded.record_json
    `)
    .run(sessionId, JSON.stringify(document));
}
