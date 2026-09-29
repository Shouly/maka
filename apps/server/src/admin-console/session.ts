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

// The admin console's browser sessions (design §3.2). An administrator signs
// in through the same identity providers as everyone, and the browser keeps a
// cookie: HttpOnly, SameSite=Lax, scoped to /admin, Secure on https. Only its
// hash is stored. Every change the page makes also carries the session's CSRF
// token in a header, which a page on another site cannot read or forge.
//
// Lax rather than Strict: the sign-in ends with a redirect chain that began
// at the identity provider, a cross-site navigation, and Strict would keep
// the new cookie off the first request to the console.

import type {} from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ServerContext } from '../context.js';
import { newId, newOpaqueToken, sha256Hex } from '../crypto/tokens.js';
import type { ConsoleSession } from './types.js';

/** The login transactions the console starts, told apart from the desktop's at the callback. */
export const ADMIN_CONSOLE_CLIENT_ID = 'maka-admin-console';
export const ADMIN_COOKIE = 'maka_admin';
export const ADMIN_PATH = '/admin';
/** A console sign-in lasts a working day; then the identity provider is asked again. */
export const ADMIN_SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
/** How stale `last_used_at` may get before a request writes it again. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface AdminPrincipal {
  readonly sessionId: string;
  readonly userId: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string | null;
}

/** Start a console session for someone just verified as an active administrator. */
export async function createAdminSession(
  ctx: ServerContext,
  input: {
    readonly userId: string;
    readonly provider: string;
    readonly ip: string | null;
    readonly userAgent: string | null;
  },
): Promise<{ readonly token: string; readonly sessionId: string; readonly expiresAt: Date }> {
  const now = ctx.now();
  const token = newOpaqueToken();
  const sessionId = newId();
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_LIFETIME_MS);
  await ctx.db
    .insertInto('admin_sessions')
    .values({
      id: sessionId,
      token_hash: sha256Hex(token),
      user_id: input.userId,
      csrf_token: newOpaqueToken(),
      provider: input.provider,
      created_at: now,
      last_used_at: now,
      expires_at: expiresAt,
      revoked_at: null,
      ip: input.ip,
      user_agent: input.userAgent?.slice(0, 300) ?? null,
    })
    .execute();
  return { token, sessionId, expiresAt };
}

/**
 * The administrator behind a request's cookie, or undefined. The person is
 * checked on every request, not only at sign-in: someone demoted or
 * deactivated is out of the console at once.
 */
export async function resolveAdminSession(
  ctx: ServerContext,
  request: FastifyRequest,
): Promise<AdminPrincipal | undefined> {
  const token = request.cookies[ADMIN_COOKIE];
  if (!token) return undefined;
  const now = ctx.now();
  const row = await ctx.db
    .selectFrom('admin_sessions')
    .innerJoin('users', 'users.id', 'admin_sessions.user_id')
    .select([
      'admin_sessions.id',
      'admin_sessions.user_id',
      'admin_sessions.csrf_token',
      'admin_sessions.expires_at',
      'admin_sessions.revoked_at',
      'admin_sessions.last_used_at',
      'users.email',
      'users.name',
      'users.profile_name',
      'users.avatar_url',
      'users.org_role',
      'users.status',
    ])
    .where('admin_sessions.token_hash', '=', sha256Hex(token))
    .executeTakeFirst();
  if (
    !row ||
    row.revoked_at ||
    row.expires_at.getTime() <= now.getTime() ||
    row.status !== 'active' ||
    row.org_role !== 'org_admin'
  ) {
    return undefined;
  }
  if (now.getTime() - row.last_used_at.getTime() > TOUCH_INTERVAL_MS) {
    await ctx.db
      .updateTable('admin_sessions')
      .set({ last_used_at: now })
      .where('id', '=', row.id)
      .execute();
  }
  return {
    sessionId: row.id,
    userId: row.user_id,
    csrfToken: row.csrf_token,
    expiresAt: row.expires_at,
    email: row.email,
    name: row.profile_name ?? row.name,
    avatarUrl: row.avatar_url,
  };
}

export async function revokeAdminSession(ctx: ServerContext, sessionId: string): Promise<void> {
  await ctx.db
    .updateTable('admin_sessions')
    .set({ revoked_at: ctx.now() })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .execute();
}

export function secureCookies(ctx: ServerContext): boolean {
  return ctx.config.publicUrl.startsWith('https:');
}

export function setAdminCookie(
  ctx: ServerContext,
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(ADMIN_COOKIE, token, {
    path: ADMIN_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(ctx),
    expires: expiresAt,
  });
}

export function clearAdminCookie(ctx: ServerContext, reply: FastifyReply): void {
  reply.clearCookie(ADMIN_COOKIE, {
    path: ADMIN_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(ctx),
  });
}

/**
 * Whether a change may go ahead: the CSRF token matches, and a browser that
 * says where the request came from says it came from this server.
 */
export function sameOriginChange(
  ctx: ServerContext,
  request: FastifyRequest,
  principal: AdminPrincipal,
  header: string,
): boolean {
  const sent = request.headers[header];
  if (typeof sent !== 'string' || sent !== principal.csrfToken) return false;
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== new URL(ctx.config.publicUrl).origin) return false;
  return true;
}

export function consoleSession(ctx: ServerContext, principal: AdminPrincipal): ConsoleSession {
  return {
    user: {
      id: principal.userId,
      email: principal.email,
      name: principal.name,
      ...(principal.avatarUrl ? { avatarUrl: principal.avatarUrl } : {}),
    },
    csrfToken: principal.csrfToken,
    serverUrl: ctx.config.publicUrl,
    expiresAt: principal.expiresAt.getTime(),
  };
}
