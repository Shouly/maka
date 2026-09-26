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

// Desktop sign-in (§4.2): OAuth 2.0 for native apps (RFC 8252) with PKCE
// (RFC 7636). The desktop app is a public client; it opens the system browser
// at /oauth/authorize with a loopback redirect, the person picks an identity
// provider, and the app exchanges the returned code — with its verifier — at
// /oauth/token.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DESKTOP_CLIENT_ID,
  type OAuthErrorResponse,
  type PlatformMe,
  type TokenResponse,
} from '@maka/platform-protocol';
import { recordAudit } from '../audit.js';
import type { ServerContext } from '../context.js';
import { newOpaqueToken, pkceChallenge, sha256Hex } from '../crypto/tokens.js';
import { authenticate } from '../http/common.js';
import { renderError, renderProviderChoice, requestLocale, sendHtml } from '../http/pages.js';
import type { AccessTokens } from './access-tokens.js';
import { resolveAccount } from './accounts.js';
import { IdentityRefused, type IdentityProvider } from './providers/types.js';
import {
  createSession,
  RefreshRejected,
  revokeByRefreshToken,
  revokeSessionRow,
  rotateRefreshToken,
} from './sessions.js';

const LOGIN_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 60 * 1000;
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/**
 * RFC 8252 §7.3: a loopback IP literal with any port, or the app's own URI
 * scheme (§7.1). `localhost` is refused: it can resolve elsewhere.
 */
export function isAllowedDesktopRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'maka:') return true;
  return (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === '[::1]') &&
    url.port !== ''
  );
}

function oauthError(reply: FastifyReply, error: OAuthErrorResponse['error'], description: string) {
  const body: OAuthErrorResponse = { error, error_description: description };
  return reply
    .status(error === 'invalid_client' ? 401 : 400)
    .header('cache-control', 'no-store')
    .send(body);
}

function redirectToClient(
  reply: FastifyReply,
  redirectUri: string,
  params: Record<string, string>,
) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return reply.redirect(url.toString(), 302);
}

function singleString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function registerIdentityRoutes(
  app: FastifyInstance,
  ctx: ServerContext,
  deps: {
    readonly providers: ReadonlyMap<string, IdentityProvider>;
    readonly accessTokens: AccessTokens;
  },
): void {
  const { providers, accessTokens } = deps;
  const callbackUrl = (providerId: string) =>
    providers.get(providerId)?.callbackUrl ??
    `${ctx.config.publicUrl}/login/${providerId}/callback`;

  app.get('/oauth/authorize', async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const locale = requestLocale(request);
    const redirectUri = singleString(query.redirect_uri);
    if (
      singleString(query.client_id) !== DESKTOP_CLIENT_ID ||
      !redirectUri ||
      !isAllowedDesktopRedirect(redirectUri)
    ) {
      return sendHtml(reply, 400, renderError(locale, 'Invalid sign-in request'));
    }
    const state = singleString(query.state);
    const challenge = singleString(query.code_challenge);
    const deviceName = singleString(query.device_name)?.slice(0, 100) ?? null;
    if (
      singleString(query.response_type) !== 'code' ||
      singleString(query.code_challenge_method) !== 'S256' ||
      !challenge ||
      !S256_CHALLENGE.test(challenge) ||
      !state ||
      state.length > 512
    ) {
      return redirectToClient(reply, redirectUri, {
        error: 'invalid_request',
        error_description: 'PKCE (S256), state and response_type=code are required',
        ...(state && state.length <= 512 ? { state } : {}),
      });
    }
    const id = newOpaqueToken();
    const now = ctx.now();
    await ctx.db
      .insertInto('login_transactions')
      .values({
        id,
        client_id: DESKTOP_CLIENT_ID,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        client_state: state,
        device_name: deviceName,
        provider: null,
        provider_state: null,
        nonce: null,
        expires_at: new Date(now.getTime() + LOGIN_TRANSACTION_TTL_MS),
        consumed_at: null,
        created_at: now,
      })
      .execute();
    // The desktop names the provider the person picked on its own sign-in
    // screen: go straight there. Without one (or with an unknown one), offer
    // the choice here.
    const chosen = providers.get(singleString(query.provider) ?? '');
    if (chosen) {
      const target = await startProvider(chosen, id);
      if (target) return reply.redirect(target, 302);
    }
    const choices = [...providers.values()].map((provider) => ({
      displayName: provider.displayName,
      href: `/login/${provider.id}/start?txn=${encodeURIComponent(id)}`,
    }));
    return sendHtml(reply, 200, renderProviderChoice(locale, choices));
  });

  /** Bind a transaction to a provider and return where to send the browser; undefined once expired. */
  async function startProvider(
    provider: IdentityProvider,
    txnId: string,
  ): Promise<string | undefined> {
    const providerState = newOpaqueToken();
    const nonce = newOpaqueToken();
    const updated = await ctx.db
      .updateTable('login_transactions')
      .set({ provider: provider.id, provider_state: providerState, nonce })
      .where('id', '=', txnId)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', ctx.now())
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) return undefined;
    return provider.authorizationUrl({
      state: providerState,
      nonce,
      redirectUri: callbackUrl(provider.id),
    });
  }

  app.get('/login/:provider/start', async (request, reply) => {
    const locale = requestLocale(request);
    const provider = providers.get((request.params as { provider: string }).provider);
    const txnId = singleString((request.query as Record<string, unknown>).txn);
    if (!provider || !txnId) {
      return sendHtml(reply, 400, renderError(locale, 'Invalid sign-in request'));
    }
    const target = await startProvider(provider, txnId);
    if (!target) return sendHtml(reply, 400, renderError(locale, 'This sign-in has expired'));
    return reply.redirect(target, 302);
  });

  async function handleCallback(
    provider: IdentityProvider | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const locale = requestLocale(request);
    const query = request.query as Record<string, unknown>;
    const providerState = singleString(query.state);
    if (!provider || !providerState)
      return sendHtml(reply, 400, renderError(locale, 'Invalid sign-in response'));
    const now = ctx.now();
    // Consume the transaction first: a callback is honoured once.
    const txn = await ctx.db
      .updateTable('login_transactions')
      .set({ consumed_at: now })
      .where('provider_state', '=', providerState)
      .where('provider', '=', provider.id)
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', now)
      .returningAll()
      .executeTakeFirst();
    if (!txn || !txn.nonce)
      return sendHtml(reply, 400, renderError(locale, 'This sign-in has expired'));
    const back = (params: Record<string, string>) =>
      redirectToClient(reply, txn.redirect_uri, { ...params, state: txn.client_state });
    const code = singleString(query.code);
    if (!code) {
      return back({ error: 'access_denied', error_description: 'provider_error' });
    }
    try {
      const identity = await provider.exchange({
        code,
        nonce: txn.nonce,
        redirectUri: callbackUrl(provider.id),
      });
      const account = await resolveAccount(ctx, identity);
      const authorizationCode = newOpaqueToken();
      await ctx.db
        .insertInto('authorization_codes')
        .values({
          code_hash: sha256Hex(authorizationCode),
          transaction_id: txn.id,
          user_id: account.userId,
          client_id: txn.client_id,
          redirect_uri: txn.redirect_uri,
          code_challenge: txn.code_challenge,
          provider: provider.id,
          device_name: txn.device_name,
          auth_time: now,
          expires_at: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS),
          used_at: null,
          created_at: now,
        })
        .execute();
      return back({ code: authorizationCode });
    } catch (error) {
      if (error instanceof IdentityRefused) {
        await recordAudit(
          ctx.db,
          {
            action: 'signin.refused',
            detail: { provider: provider.id, reason: error.reason },
            ip: request.ip,
          },
          now,
        );
        return back({ error: 'access_denied', error_description: error.reason });
      }
      request.log.error({ err: error }, 'sign-in callback failed');
      return back({ error: 'server_error', error_description: 'provider_error' });
    }
  }

  app.get('/login/:provider/callback', (request, reply) =>
    handleCallback(
      providers.get((request.params as { provider: string }).provider),
      request,
      reply,
    ),
  );
  // A callback already registered with the provider under another path, such
  // as relx-copilot's /auth/google/callback, is served here too.
  for (const provider of providers.values()) {
    if (!provider.callbackUrl) continue;
    const path = new URL(provider.callbackUrl).pathname;
    if (path !== `/login/${provider.id}/callback`) {
      app.get(path, (request, reply) => handleCallback(provider, request, reply));
    }
  }

  app.post('/oauth/token', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (singleString(body.client_id) !== DESKTOP_CLIENT_ID) {
      return oauthError(reply, 'invalid_client', 'Unknown client');
    }
    const grantType = singleString(body.grant_type);
    if (grantType === 'authorization_code') {
      const code = singleString(body.code);
      const verifier = singleString(body.code_verifier);
      const redirectUri = singleString(body.redirect_uri);
      if (!code || !verifier || !CODE_VERIFIER.test(verifier) || !redirectUri) {
        return oauthError(
          reply,
          'invalid_request',
          'code, code_verifier and redirect_uri are required',
        );
      }
      const now = ctx.now();
      const issued = await ctx.db.transaction().execute(async (tx) => {
        const row = await tx
          .selectFrom('authorization_codes')
          .selectAll()
          .where('code_hash', '=', sha256Hex(code))
          .forUpdate()
          .executeTakeFirst();
        if (!row) return undefined;
        if (row.used_at) {
          // A code redeemed twice was copied: the session it bought goes too
          // (RFC 6749 §4.1.2). Returning normally commits the revocation.
          if (row.session_id && (await revokeSessionRow(tx, row.session_id, 'code_reuse', now))) {
            await recordAudit(
              tx,
              {
                action: 'session.revoked',
                actorUserId: null,
                targetType: 'device_session',
                targetId: row.session_id,
                detail: { reason: 'code_reuse', userId: row.user_id },
                ip: request.ip,
              },
              now,
            );
          }
          return undefined;
        }
        if (row.expires_at.getTime() <= now.getTime()) return undefined;
        await tx
          .updateTable('authorization_codes')
          .set({ used_at: now })
          .where('code_hash', '=', row.code_hash)
          .execute();
        if (
          row.client_id !== DESKTOP_CLIENT_ID ||
          row.redirect_uri !== redirectUri ||
          pkceChallenge(verifier) !== row.code_challenge
        ) {
          return undefined;
        }
        const user = await tx
          .selectFrom('users')
          .select(['id', 'org_role', 'status'])
          .where('id', '=', row.user_id)
          .executeTakeFirstOrThrow();
        if (user.status !== 'active') return undefined;
        const session = await createSession(
          tx,
          {
            userId: user.id,
            clientId: row.client_id,
            deviceName: row.device_name,
            provider: row.provider,
            authTime: row.auth_time,
          },
          now,
        );
        await tx
          .updateTable('authorization_codes')
          .set({ session_id: session.sessionId })
          .where('code_hash', '=', row.code_hash)
          .execute();
        await recordAudit(
          tx,
          {
            action: 'session.created',
            actorUserId: user.id,
            targetType: 'device_session',
            targetId: session.sessionId,
            detail: { provider: row.provider, deviceName: row.device_name },
            ip: request.ip,
          },
          now,
        );
        return { session, orgRole: user.org_role };
      });
      if (!issued)
        return oauthError(reply, 'invalid_grant', 'The code is invalid, used or expired');
      return sendTokens(reply, issued.session, issued.orgRole);
    }
    if (grantType === 'refresh_token') {
      const refreshToken = singleString(body.refresh_token);
      if (!refreshToken) return oauthError(reply, 'invalid_request', 'refresh_token is required');
      try {
        const session = await rotateRefreshToken(ctx, refreshToken);
        return sendTokens(reply, session, session.orgRole);
      } catch (error) {
        if (error instanceof RefreshRejected) {
          return oauthError(reply, 'invalid_grant', `Sign in again (${error.reason})`);
        }
        throw error;
      }
    }
    return oauthError(reply, 'unsupported_grant_type', 'Use authorization_code or refresh_token');
  });

  async function sendTokens(
    reply: FastifyReply,
    session: { sessionId: string; userId: string; refreshToken: string; refreshExpiresAt: Date },
    orgRole: 'member' | 'org_admin',
  ) {
    const access = await accessTokens.issue({
      userId: session.userId,
      sessionId: session.sessionId,
      orgRole,
    });
    const body: TokenResponse = {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: access.expiresIn,
      refresh_token: session.refreshToken,
      refresh_expires_at: session.refreshExpiresAt.getTime(),
      session_id: session.sessionId,
    };
    return reply.header('cache-control', 'no-store').header('pragma', 'no-cache').send(body);
  }

  app.post('/oauth/revoke', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const token = singleString(body.token);
    if (token) await revokeByRefreshToken(ctx, token, request.ip);
    return reply.status(200).header('cache-control', 'no-store').send({});
  });

  app.get('/v1/me', async (request, reply) => {
    const principal = await authenticate(ctx, accessTokens, request, reply);
    if (!principal) return reply;
    const user = await ctx.db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'avatar_url', 'org_role'])
      .where('id', '=', principal.userId)
      .executeTakeFirstOrThrow();
    const me: PlatformMe = {
      id: user.id,
      email: user.email,
      name: user.name,
      ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}),
      orgRole: user.org_role,
    };
    return reply.header('cache-control', 'no-store').send(me);
  });
}
