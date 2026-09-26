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

// The audit log: who did what, when, from where (§10). Written in the same
// transaction as the change it records wherever there is one.

import type { Kysely, Transaction } from 'kysely';
import type { Database } from './db/schema.js';

export interface AuditEntry {
  readonly action: string;
  readonly actorUserId?: string | null;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly detail?: Record<string, unknown>;
  readonly ip?: string;
}

export async function recordAudit(
  db: Kysely<Database> | Transaction<Database>,
  entry: AuditEntry,
  at: Date,
): Promise<void> {
  await db
    .insertInto('audit_events')
    .values({
      at,
      action: entry.action,
      actor_user_id: entry.actorUserId ?? null,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      detail: JSON.stringify(entry.detail ?? {}),
      ip: entry.ip ?? null,
    })
    .execute();
}
