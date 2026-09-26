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

// HTTP plumbing shared by every route: the error body, bearer
// authentication, and the client-version gate (§10).

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  CLIENT_VERSION_HEADER,
  type OrgRole,
  type PlatformErrorBody,
  type PlatformErrorCode,
  versionAtLeast,
} from '@maka/platform-protocol';
import type { ServerContext } from '../context.js';
import type { AccessTokens } from '../identity/access-tokens.js';

export interface Principal {
  readonly userId: string;
  readonly sessionId: string;
  readonly orgRole: OrgRole;
}

export function sendPlatformError(
  reply: FastifyReply,
  status: number,
  code: PlatformErrorCode,
  message: string,
  extra: Omit<PlatformErrorBody['error'], 'code' | 'message'> = {},
): FastifyReply {
  const body: PlatformErrorBody = { error: { code, message, ...extra } };
  return reply.status(status).header('cache-control', 'no-store').send(body);
}

/**
 * The signed-in person behind a request, or undefined after answering 401.
 *
 * Beyond the token's signature, the session and the account are checked on
 * every call: a revoked device or a deactivated person stops at once instead
 * of when the token expires.
 */
/** The person behind an access token, with the session and account checked; undefined otherwise. */
export async function resolvePrincipal(
  ctx: ServerContext,
  accessTokens: AccessTokens,
  token: string,
): Promise<Principal | undefined> {
  const claims = token ? await accessTokens.verify(token) : undefined;
  if (!claims) return undefined;
  const row = await ctx.db
    .selectFrom('device_sessions')
    .innerJoin('users', 'users.id', 'device_sessions.user_id')
    .select(['device_sessions.revoked_at', 'users.status', 'users.org_role'])
    .where('device_sessions.id', '=', claims.sessionId)
    .where('device_sessions.user_id', '=', claims.userId)
    .executeTakeFirst();
  if (!row || row.revoked_at || row.status !== 'active') return undefined;
  return { userId: claims.userId, sessionId: claims.sessionId, orgRole: row.org_role };
}

export async function authenticate(
  ctx: ServerContext,
  accessTokens: AccessTokens,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Principal | undefined> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  const principal = await resolvePrincipal(ctx, accessTokens, token);
  if (principal) return principal;
  reply.header('www-authenticate', 'Bearer');
  sendPlatformError(reply, 401, 'unauthenticated', 'Sign in again');
  return undefined;
}

/** Refuse a desktop app older than the server supports, with a reason it can show. */
export function clientVersionGate(ctx: ServerContext) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const minimum = ctx.config.minimumClientVersion;
    const version = request.headers[CLIENT_VERSION_HEADER];
    if (!minimum || typeof version !== 'string') return;
    if (!versionAtLeast(version, minimum)) {
      const message = `Update Maka to ${minimum} or later`;
      // The model gateway answers in its protocol's error shape (§5.1).
      if (request.url.startsWith('/model/')) {
        await reply
          .status(426)
          .header('cache-control', 'no-store')
          .send({
            type: 'error',
            error: { type: 'invalid_request_error', message },
            maka: { code: 'upgrade_required' },
          });
        return;
      }
      await sendPlatformError(reply, 426, 'upgrade_required', message, {
        minimumClientVersion: minimum,
      });
    }
  };
}
