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

// Signing in to the admin console: the desktop's login transaction and
// identity providers, ending in a browser session instead of a code. The
// transaction is marked with the console's client id, so the provider's one
// registered callback serves both (identity/routes.ts hands it over here).
//
// The sign-in page itself is the console's (it draws the provider buttons in
// the design system); a sign-in that does not end in a session goes back to
// it with the reason, which the page says in its own words.
//
// The desktop's PKCE ties its sign-in to the app that began it; the console's
// is tied to the browser instead, by a short-lived cookie scoped to the
// callback whose hash the transaction keeps. A callback link opened in
// another browser signs no one in there.

import type { FastifyReply, FastifyRequest } from 'fastify';
import { recordAudit } from '../audit.js';
import type { ServerContext } from '../context.js';
import { newOpaqueToken, sha256Hex } from '../crypto/tokens.js';
import { resolveAccount } from '../identity/accounts.js';
import { beginProviderSignIn, providerCallbackUrl } from '../identity/provider-sign-in.js';
import { IdentityRefused, type IdentityProvider } from '../identity/providers/types.js';
import type { ConsoleSignInFailure } from './types.js';
import {
  ADMIN_CONSOLE_CLIENT_ID,
  ADMIN_PATH,
  createAdminSession,
  secureCookies,
  setAdminCookie,
} from './session.js';

const LOGIN_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const LOGIN_BINDING_COOKIE = 'maka_admin_login';
/** Only for resolving a path: a result on any other origin left the server. */
const PATH_BASE = 'http://console.invalid';

/**
 * A console path to come back to after signing in, resolved (`..`, `\`,
 * encoding) the way the browser will; anything else lands on the console's
 * start.
 */
export function consoleReturnPath(value: unknown): string {
  const start = `${ADMIN_PATH}/`;
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 512) return start;
  let url: URL;
  try {
    url = new URL(value, PATH_BASE);
  } catch {
    return start;
  }
  const path = url.pathname;
  if (
    url.origin !== PATH_BASE ||
    !path.startsWith(start) ||
    path.startsWith(`${ADMIN_PATH}/api/`) ||
    path.startsWith(`${ADMIN_PATH}/login`)
  ) {
    return start;
  }
  return `${path}${url.search}`;
}

/** The binding cookie reaches only the provider's callback. */
function bindingCookiePath(ctx: ServerContext, provider: IdentityProvider): string {
  return new URL(providerCallbackUrl(ctx, provider)).pathname;
}

/** The sign-in page, with why the last attempt failed and where to go after. */
export function consoleLoginPath(options: {
  readonly failure?: ConsoleSignInFailure;
  readonly next?: string;
}): string {
  const query = new URLSearchParams();
  if (options.failure) query.set('error', options.failure);
  if (options.next && options.next !== `${ADMIN_PATH}/`) query.set('next', options.next);
  const search = query.toString();
  return `${ADMIN_PATH}/login${search ? `?${search}` : ''}`;
}

/** Start a console sign-in at the provider the person picked on the sign-in page. */
export async function startConsoleSignIn(
  ctx: ServerContext,
  reply: FastifyReply,
  provider: IdentityProvider,
  next: unknown,
): Promise<FastifyReply> {
  const returnPath = consoleReturnPath(next);
  const id = newOpaqueToken();
  const binding = newOpaqueToken();
  const now = ctx.now();
  await ctx.db
    .insertInto('login_transactions')
    .values({
      id,
      client_id: ADMIN_CONSOLE_CLIENT_ID,
      redirect_uri: returnPath,
      // In place of a PKCE challenge: the hash of the browser's binding cookie.
      code_challenge: sha256Hex(binding),
      client_state: '',
      device_name: null,
      provider: null,
      provider_state: null,
      nonce: null,
      expires_at: new Date(now.getTime() + LOGIN_TRANSACTION_TTL_MS),
      consumed_at: null,
      created_at: now,
    })
    .execute();
  const target = await beginProviderSignIn(ctx, provider, id);
  if (!target) {
    return reply.redirect(consoleLoginPath({ failure: 'expired', next: returnPath }), 302);
  }
  reply.setCookie(LOGIN_BINDING_COOKIE, binding, {
    path: bindingCookiePath(ctx, provider),
    httpOnly: true,
    // Lax: the provider sends the browser back with a top-level GET.
    sameSite: 'lax',
    secure: secureCookies(ctx),
    maxAge: LOGIN_TRANSACTION_TTL_MS / 1000,
  });
  return reply.redirect(target, 302);
}

/** The provider's answer to a console sign-in: a session for an active administrator, the sign-in page with a reason for anyone else. */
export async function completeConsoleSignIn(
  ctx: ServerContext,
  request: FastifyRequest,
  reply: FastifyReply,
  input: {
    readonly provider: IdentityProvider;
    readonly transaction: {
      readonly redirectUri: string;
      readonly nonce: string;
      /** The hash of the binding cookie given to the browser that started it. */
      readonly binding: string;
    };
    readonly code: string | undefined;
  },
): Promise<FastifyReply> {
  const next = consoleReturnPath(input.transaction.redirectUri);
  const fail = (failure: ConsoleSignInFailure) =>
    reply.redirect(consoleLoginPath({ failure, next }), 302);
  const presented = request.cookies[LOGIN_BINDING_COOKIE];
  reply.clearCookie(LOGIN_BINDING_COOKIE, {
    path: bindingCookiePath(ctx, input.provider),
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookies(ctx),
  });
  if (!presented || sha256Hex(presented) !== input.transaction.binding) return fail('expired');
  if (!input.code) return fail('cancelled');
  const now = ctx.now();
  let account: Awaited<ReturnType<typeof resolveAccount>>;
  try {
    const identity = await input.provider.exchange({
      code: input.code,
      nonce: input.transaction.nonce,
      redirectUri: providerCallbackUrl(ctx, input.provider),
    });
    account = await resolveAccount(ctx, identity);
  } catch (error) {
    if (error instanceof IdentityRefused) {
      await recordAudit(
        ctx.db,
        {
          action: 'admin.signin_refused',
          detail: { provider: input.provider.id, reason: error.reason, via: 'admin-console' },
          ip: request.ip,
        },
        now,
      );
      return fail(error.reason);
    }
    request.log.error({ err: error }, 'admin console sign-in failed');
    return fail('provider_error');
  }
  if (account.orgRole !== 'org_admin') {
    await recordAudit(
      ctx.db,
      {
        action: 'admin.signin_refused',
        actorUserId: account.userId,
        targetType: 'user',
        targetId: account.userId,
        detail: { provider: input.provider.id, reason: 'not_admin', via: 'admin-console' },
        ip: request.ip,
      },
      now,
    );
    return fail('not_admin');
  }
  const session = await createAdminSession(ctx, {
    userId: account.userId,
    provider: input.provider.id,
    ip: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  });
  await recordAudit(
    ctx.db,
    {
      action: 'admin.signed_in',
      actorUserId: account.userId,
      targetType: 'admin_session',
      targetId: session.sessionId,
      detail: { provider: input.provider.id, via: 'admin-console' },
      ip: request.ip,
    },
    now,
  );
  setAdminCookie(ctx, reply, session.token, session.expiresAt);
  return reply.redirect(next, 302);
}
