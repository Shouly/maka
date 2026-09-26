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

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { localSecretBox } from '../crypto/secret-box.js';
import { googleProvider } from '../identity/providers/google.js';
import { relxSsoProvider } from '../identity/providers/relx-sso.js';
import { type FetchLike, IdentityRefused } from '../identity/providers/types.js';

const NOW = new Date('2026-09-26T08:00:00Z');

async function googleWith(
  claims: Record<string, unknown>,
  options: { audience?: string; allowedDomains?: readonly string[] } = {},
) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const idToken = await new SignJWT({ nonce: 'n-1', email_verified: true, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer('https://accounts.google.com')
    .setAudience(options.audience ?? 'google-client')
    .setSubject('google-sub')
    .setIssuedAt(Math.floor(NOW.getTime() / 1000))
    .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 300)
    .sign(privateKey);
  const requests: { url: string; body: string }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    requests.push({ url: String(input), body: String(init?.body ?? '') });
    return Response.json({ id_token: idToken });
  };
  const provider = googleProvider({
    clientId: 'google-client',
    clientSecret: 'google-secret',
    allowedDomains: options.allowedDomains ?? ['relx.com'],
    fetch: fetchImpl,
    keys: createLocalJWKSet({ keys: [jwk] }),
    now: () => NOW,
  });
  return { provider, requests };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof IdentityRefused, String(error));
    return error.reason;
  }
  assert.fail('expected a refusal');
}

const exchangeInput = {
  code: 'c',
  nonce: 'n-1',
  redirectUri: 'https://maka.test/login/google/callback',
};

test('Google: a verified Workspace email of an allowed domain signs in', async () => {
  const { provider, requests } = await googleWith({
    email: 'Ada@relx.com',
    hd: 'relx.com',
    name: 'Ada',
  });
  const identity = await provider.exchange(exchangeInput);
  assert.deepEqual(identity, {
    provider: 'google',
    subject: 'google-sub',
    email: 'ada@relx.com',
    name: 'Ada',
  });
  assert.equal(requests[0]?.url, 'https://oauth2.googleapis.com/token');
  assert.match(requests[0]?.body ?? '', /client_secret=google-secret/);
  const url = new URL(
    provider.authorizationUrl({ state: 's', nonce: 'n', redirectUri: exchangeInput.redirectUri }),
  );
  assert.equal(url.searchParams.get('hd'), 'relx.com');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
});

test('Google: without a domain list, whoever Google lets through signs in', async () => {
  const { provider } = await googleWith(
    { email: 'ada@relx.com', hd: 'relx.com' },
    { allowedDomains: [] },
  );
  assert.equal((await provider.exchange(exchangeInput)).email, 'ada@relx.com');
  const url = new URL(
    provider.authorizationUrl({ state: 's', nonce: 'n', redirectUri: exchangeInput.redirectUri }),
  );
  assert.equal(url.searchParams.has('hd'), false);
  // A verified email is still required.
  const unverified = await googleWith(
    { email: 'ada@relx.com', email_verified: false },
    { allowedDomains: [] },
  );
  assert.equal(await refusal(unverified.provider.exchange(exchangeInput)), 'email_not_verified');
  // A personal Google account never gets in, fence or not: its token has no Workspace domain.
  const personal = await googleWith({ email: 'ada@relx.com' }, { allowedDomains: [] });
  assert.equal(await refusal(personal.provider.exchange(exchangeInput)), 'domain_not_allowed');
});

test('Google: personal accounts, other domains, unverified emails and foreign tokens are refused', async () => {
  // A personal Google account registered with a company address has no `hd`.
  assert.equal(
    await refusal((await googleWith({ email: 'ada@relx.com' })).provider.exchange(exchangeInput)),
    'domain_not_allowed',
  );
  assert.equal(
    await refusal(
      (await googleWith({ email: 'ada@evil.example', hd: 'evil.example' })).provider.exchange(
        exchangeInput,
      ),
    ),
    'domain_not_allowed',
  );
  assert.equal(
    await refusal(
      (
        await googleWith({ email: 'ada@relx.com', hd: 'relx.com', email_verified: false })
      ).provider.exchange(exchangeInput),
    ),
    'email_not_verified',
  );
  assert.equal(
    await refusal(
      (
        await googleWith({ email: 'ada@relx.com', hd: 'relx.com', nonce: 'other' })
      ).provider.exchange(exchangeInput),
    ),
    'provider_error',
  );
  assert.equal(
    await refusal(
      (
        await googleWith({ email: 'ada@relx.com', hd: 'relx.com' }, { audience: 'someone-else' })
      ).provider.exchange(exchangeInput),
    ),
    'provider_error',
  );
});

function relxWith(answers: { token?: unknown; userinfo?: unknown; tokenStatus?: number }) {
  const requests: { method: string; url: URL; headers: Record<string, string> }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    requests.push({
      method: init?.method ?? 'GET',
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    });
    if (url.pathname === '/oauth2.0/accessToken') {
      return Response.json(answers.token ?? { access_token: 'relx-access' }, {
        status: answers.tokenStatus ?? 200,
      });
    }
    return Response.json(
      answers.userinfo ?? { code: 10000, data: { uid: 42, name: 'Ada ', email: 'Ada@relx.com' } },
    );
  };
  const provider = relxSsoProvider({
    clientId: 'relx-client',
    clientSecret: 'relx-secret',
    authorizeUrl: 'https://sso.relx.test/oauth2.0/authorize',
    tokenUrl: 'https://sso.relx.test/oauth2.0/accessToken',
    userinfoUrl: 'https://sso.relx.test/oauth2.0/res',
    allowedDomains: ['relx.com'],
    fetch: fetchImpl,
  });
  return { provider, requests };
}

test('RELX SSO: GET for the token, POST for user info, uid as the subject', async () => {
  const { provider, requests } = relxWith({});
  const identity = await provider.exchange({
    code: 'c-1',
    nonce: 'unused',
    redirectUri: 'https://maka.test/login/relx-sso/callback',
  });
  assert.deepEqual(identity, {
    provider: 'relx-sso',
    subject: '42',
    email: 'ada@relx.com',
    name: 'Ada',
  });
  const [token, info] = requests;
  assert.equal(token?.method, 'GET');
  assert.equal(token?.url.searchParams.get('client_secret'), 'relx-secret');
  assert.equal(token?.url.searchParams.get('grant_type'), 'authorization_code');
  assert.equal(token?.url.searchParams.get('code'), 'c-1');
  assert.equal(info?.method, 'POST');
  assert.equal(info?.headers.authorization, 'Bearer relx-access');
  const url = new URL(
    provider.authorizationUrl({ state: 's', nonce: 'n', redirectUri: 'https://maka.test/cb' }),
  );
  assert.equal(url.searchParams.get('scope'), 'uid,name,email');
});

test('RELX SSO: errors and foreign domains are refused', async () => {
  assert.equal(
    await refusal(
      relxWith({ token: { error: 'invalid_grant' } }).provider.exchange({
        code: 'c',
        nonce: '',
        redirectUri: 'x',
      }),
    ),
    'provider_error',
  );
  assert.equal(
    await refusal(
      relxWith({ tokenStatus: 500 }).provider.exchange({ code: 'c', nonce: '', redirectUri: 'x' }),
    ),
    'provider_error',
  );
  assert.equal(
    await refusal(
      relxWith({ userinfo: { code: 40001, msg: 'expired' } }).provider.exchange({
        code: 'c',
        nonce: '',
        redirectUri: 'x',
      }),
    ),
    'provider_error',
  );
  assert.equal(
    await refusal(
      relxWith({
        userinfo: { code: 10000, data: { uid: 'x', email: 'a@evil.example' } },
      }).provider.exchange({
        code: 'c',
        nonce: '',
        redirectUri: 'x',
      }),
    ),
    'domain_not_allowed',
  );
});

test('sealed secrets open only with the same key and context', () => {
  const box = localSecretBox(new Uint8Array(randomBytes(32)));
  const sealed = box.seal('upstream-api-key', 'upstream:1');
  assert.notEqual(
    sealed,
    box.seal('upstream-api-key', 'upstream:1'),
    'every seal uses a fresh data key',
  );
  assert.equal(box.open(sealed, 'upstream:1'), 'upstream-api-key');
  assert.throws(() => box.open(sealed, 'upstream:2'));
  assert.throws(() => localSecretBox(new Uint8Array(randomBytes(32))).open(sealed, 'upstream:1'));
});
