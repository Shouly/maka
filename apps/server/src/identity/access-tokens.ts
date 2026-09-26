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

// Access tokens: ES256 JWTs the gateway and sandboxed engines can verify on
// their own (§4.3). Signing keys are generated on first start, stored sealed,
// and published at /.well-known/jwks.json.

import {
  type CryptoKey,
  createLocalJWKSet,
  errors as joseErrors,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JSONWebKeySet,
  type JWK,
  jwtVerify,
  SignJWT,
} from 'jose';
import type { OrgRole } from '@maka/platform-protocol';
import type { ServerContext } from '../context.js';
import { newId } from '../crypto/tokens.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const ACCESS_TOKEN_AUDIENCE = 'maka-platform';
/** Unknown key ids reload the key set at most this often. */
const KEY_RELOAD_INTERVAL_MS = 60 * 1000;

export interface AccessTokenClaims {
  readonly userId: string;
  readonly sessionId: string;
  readonly orgRole: OrgRole;
}

interface ActiveKey {
  readonly kid: string;
  readonly privateKey: CryptoKey;
}

export class AccessTokens {
  #active: ActiveKey | undefined;
  #jwks: JSONWebKeySet | undefined;
  #reloadedAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly ctx: ServerContext) {}

  /** Load the newest signing key, creating the first one if none exists. */
  async initialize(): Promise<void> {
    let row = await this.#newestKeyRow();
    if (!row) {
      const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
      const kid = newId();
      const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' };
      const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: 'ES256' };
      await this.ctx.db
        .insertInto('signing_keys')
        .values({
          kid,
          public_jwk: JSON.stringify(publicJwk),
          private_jwk_sealed: this.ctx.secrets.seal(
            JSON.stringify(privateJwk),
            `signing-key:${kid}`,
          ),
          created_at: this.ctx.now(),
          retired_at: null,
        })
        .execute();
      row = await this.#newestKeyRow();
      if (!row) throw new Error('The signing key was not stored');
    }
    let sealedJwk: string;
    try {
      sealedJwk = this.ctx.secrets.open(row.private_jwk_sealed, `signing-key:${row.kid}`);
    } catch {
      throw new Error(
        'The stored signing key cannot be opened: MAKA_MASTER_KEY is not the key this database was set up with',
      );
    }
    const privateJwk = JSON.parse(sealedJwk) as JWK;
    this.#active = {
      kid: row.kid,
      privateKey: (await importJWK(privateJwk, 'ES256')) as CryptoKey,
    };
    await this.#loadJwks();
  }

  async jwks(): Promise<JSONWebKeySet> {
    return this.#jwks ?? (await this.#loadJwks());
  }

  async issue(claims: AccessTokenClaims): Promise<{ token: string; expiresIn: number }> {
    const active = this.#active;
    if (!active) throw new Error('AccessTokens.initialize() was not called');
    const issuedAt = Math.floor(this.ctx.now().getTime() / 1000);
    const token = await new SignJWT({ sid: claims.sessionId, role: claims.orgRole })
      .setProtectedHeader({ alg: 'ES256', kid: active.kid, typ: 'at+jwt' })
      .setIssuer(this.ctx.config.publicUrl)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setSubject(claims.userId)
      .setJti(newId())
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
      .sign(active.privateKey);
    return { token, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  /** The claims of a valid token, or undefined for anything else. */
  async verify(token: string): Promise<AccessTokenClaims | undefined> {
    try {
      return await this.#verifyWith(await this.jwks(), token);
    } catch (error) {
      // Only an unknown key id is worth a reload — one minted by another
      // instance after this one loaded — and at most once a minute, so a
      // stream of junk tokens cannot turn into a stream of queries.
      if (!(error instanceof joseErrors.JWKSNoMatchingKey)) return undefined;
      const now = this.ctx.now().getTime();
      if (now - this.#reloadedAt < KEY_RELOAD_INTERVAL_MS) return undefined;
      this.#reloadedAt = now;
      try {
        return await this.#verifyWith(await this.#loadJwks(), token);
      } catch {
        return undefined;
      }
    }
  }

  async #verifyWith(jwks: JSONWebKeySet, token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: this.ctx.config.publicUrl,
      audience: ACCESS_TOKEN_AUDIENCE,
      algorithms: ['ES256'],
      typ: 'at+jwt',
      currentDate: this.ctx.now(),
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      (payload.role !== 'member' && payload.role !== 'org_admin')
    ) {
      throw new Error('Malformed access token claims');
    }
    return { userId: payload.sub, sessionId: payload.sid, orgRole: payload.role };
  }

  async #newestKeyRow() {
    return this.ctx.db
      .selectFrom('signing_keys')
      .selectAll()
      .where('retired_at', 'is', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  async #loadJwks(): Promise<JSONWebKeySet> {
    const rows = await this.ctx.db
      .selectFrom('signing_keys')
      .select('public_jwk')
      .where('retired_at', 'is', null)
      .execute();
    this.#jwks = { keys: rows.map((row) => row.public_jwk as JWK) };
    return this.#jwks;
  }
}
