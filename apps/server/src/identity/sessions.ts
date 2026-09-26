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

// Device sessions and their refresh tokens (§4.3).
//
// A session is one signed-in desktop. Its refresh tokens rotate on every use;
// presenting one that was already exchanged means it was copied, so the whole
// session is revoked — except within a short grace after the exchange while
// its successor is still unused: that is the same desktop retrying a response
// it never received, and it gets a fresh successor instead of a sign-out. No refresh outlives the sign-in at the identity provider
// by more than seven days: without SCIM, that is what locks out someone who
// has left, because they can no longer sign in there.

import type { Kysely, Transaction } from 'kysely';
import { recordAudit } from '../audit.js';
import type { ServerContext } from '../context.js';
import { newId, newOpaqueToken, sha256Hex } from '../crypto/tokens.js';
import type { Database } from '../db/schema.js';

export const SIGN_IN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** How long an exchanged refresh token may be retried while its successor is unused. */
export const REFRESH_RETRY_GRACE_MS = 60 * 1000;

export interface NewSession {
  readonly userId: string;
  readonly clientId: string;
  readonly deviceName: string | null;
  readonly provider: string;
  readonly authTime: Date;
}

export interface IssuedRefresh {
  readonly sessionId: string;
  readonly userId: string;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

export interface RotatedRefresh extends IssuedRefresh {
  /** Read with the rotation, so nothing after the commit can fail the exchange. */
  readonly orgRole: 'member' | 'org_admin';
}

export class RefreshRejected extends Error {
  constructor(readonly reason: 'unknown' | 'reused' | 'revoked' | 'expired' | 'deactivated') {
    super(`Refresh token rejected: ${reason}`);
  }
}

export async function createSession(
  db: Transaction<Database>,
  session: NewSession,
  now: Date,
): Promise<IssuedRefresh> {
  const sessionId = newId();
  const refreshExpiresAt = new Date(session.authTime.getTime() + SIGN_IN_LIFETIME_MS);
  await db
    .insertInto('device_sessions')
    .values({
      id: sessionId,
      user_id: session.userId,
      client_id: session.clientId,
      device_name: session.deviceName,
      provider: session.provider,
      auth_time: session.authTime,
      created_at: now,
      last_used_at: now,
      revoked_at: null,
      revoke_reason: null,
    })
    .execute();
  const refreshToken = await insertRefreshToken(db, sessionId, refreshExpiresAt, now);
  return { sessionId, userId: session.userId, refreshToken, refreshExpiresAt };
}

/** Exchange a refresh token for its successor. */
export async function rotateRefreshToken(
  ctx: ServerContext,
  refreshToken: string,
): Promise<RotatedRefresh> {
  const now = ctx.now();
  const outcome = await ctx.db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', sha256Hex(refreshToken))
      .forUpdate()
      .executeTakeFirst();
    if (!row) return rejected('unknown');
    // Only the session row is locked: deactivating a user locks `users` and
    // then `device_sessions`, and taking both here in the other order could
    // deadlock with it.
    const session = await tx
      .selectFrom('device_sessions')
      .innerJoin('users', 'users.id', 'device_sessions.user_id')
      .select([
        'device_sessions.id',
        'device_sessions.user_id',
        'device_sessions.revoked_at',
        'users.status',
        'users.org_role',
      ])
      .where('device_sessions.id', '=', row.session_id)
      .forUpdate('device_sessions')
      .executeTakeFirstOrThrow();
    if (row.rotated_at && (await isRetry(tx, row, session.revoked_at, now))) {
      // The successor never reached the desktop; it is retired unused.
      await tx.deleteFrom('refresh_tokens').where('token_hash', '=', row.successor_hash!).execute();
    } else if (row.rotated_at) {
      if (!session.revoked_at) {
        await revokeSessionRow(tx, session.id, 'refresh_token_reuse', now);
        await recordAudit(
          tx,
          {
            action: 'session.revoked',
            actorUserId: null,
            targetType: 'device_session',
            targetId: session.id,
            detail: { reason: 'refresh_token_reuse', userId: session.user_id },
          },
          now,
        );
      }
      return rejected('reused');
    }
    if (session.revoked_at) return rejected('revoked');
    if (session.status !== 'active') return rejected('deactivated');
    if (row.expires_at.getTime() <= now.getTime()) return rejected('expired');
    const next = await insertRefreshToken(tx, session.id, row.expires_at, now);
    await tx
      .updateTable('refresh_tokens')
      .set({ rotated_at: row.rotated_at ?? now, successor_hash: sha256Hex(next) })
      .where('token_hash', '=', row.token_hash)
      .execute();
    await tx
      .updateTable('device_sessions')
      .set({ last_used_at: now })
      .where('id', '=', session.id)
      .execute();
    const issued: RotationOutcome = {
      kind: 'issued',
      issued: {
        sessionId: session.id,
        userId: session.user_id,
        refreshToken: next,
        refreshExpiresAt: row.expires_at,
        orgRole: session.org_role,
      },
    };
    return issued;
  });
  // The rejection is thrown only after the transaction commits, so a reuse
  // revocation is not rolled back by the error that reports it.
  if (outcome.kind === 'rejected') throw new RefreshRejected(outcome.reason);
  return outcome.issued;
}

/**
 * An exchanged token presented again within the grace, for a live session,
 * while the token that replaced it has not been used: the desktop never got
 * the answer (a dropped response, a crash before it saved the new token).
 */
async function isRetry(
  tx: Transaction<Database>,
  row: { rotated_at: Date | null; successor_hash: string | null },
  sessionRevokedAt: Date | null,
  now: Date,
): Promise<boolean> {
  if (!row.rotated_at || !row.successor_hash || sessionRevokedAt) return false;
  if (now.getTime() - row.rotated_at.getTime() > REFRESH_RETRY_GRACE_MS) return false;
  const successor = await tx
    .selectFrom('refresh_tokens')
    .select('rotated_at')
    .where('token_hash', '=', row.successor_hash)
    .forUpdate()
    .executeTakeFirst();
  return successor !== undefined && successor.rotated_at === null;
}

type RotationOutcome =
  | { readonly kind: 'issued'; readonly issued: RotatedRefresh }
  | { readonly kind: 'rejected'; readonly reason: RefreshRejected['reason'] };

function rejected(reason: RefreshRejected['reason']): RotationOutcome {
  return { kind: 'rejected', reason };
}

/** Sign a device out. Unknown or already-used tokens are ignored (RFC 7009). */
export async function revokeByRefreshToken(
  ctx: ServerContext,
  refreshToken: string,
  ip?: string,
): Promise<void> {
  const now = ctx.now();
  await ctx.db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom('refresh_tokens')
      .innerJoin('device_sessions', 'device_sessions.id', 'refresh_tokens.session_id')
      .select(['refresh_tokens.session_id', 'device_sessions.user_id'])
      .where('token_hash', '=', sha256Hex(refreshToken))
      .executeTakeFirst();
    if (row && (await revokeSessionRow(tx, row.session_id, 'signed_out', now))) {
      await recordAudit(
        tx,
        {
          action: 'session.revoked',
          actorUserId: row.user_id,
          targetType: 'device_session',
          targetId: row.session_id,
          detail: { reason: 'signed_out' },
          ...(ip ? { ip } : {}),
        },
        now,
      );
    }
  });
}

/** Revoke a live session; false when it was already revoked. */
export async function revokeSessionRow(
  db: Kysely<Database> | Transaction<Database>,
  sessionId: string,
  reason: string,
  now: Date,
): Promise<boolean> {
  const result = await db
    .updateTable('device_sessions')
    .set({ revoked_at: now, revoke_reason: reason })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

async function insertRefreshToken(
  db: Transaction<Database>,
  sessionId: string,
  expiresAt: Date,
  now: Date,
): Promise<string> {
  const token = newOpaqueToken();
  await db
    .insertInto('refresh_tokens')
    .values({
      token_hash: sha256Hex(token),
      session_id: sessionId,
      expires_at: expiresAt,
      rotated_at: null,
      successor_hash: null,
      created_at: now,
    })
    .execute();
  return token;
}
