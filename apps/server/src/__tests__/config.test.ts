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
import { test } from 'node:test';
import { loadConfig } from '../config.js';

const base = {
  MAKA_SERVER_PUBLIC_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://x',
  MAKA_MASTER_KEY: Buffer.alloc(32, 1).toString('base64'),
  GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'secret',
};

test('a callback already registered with the provider can be reused, on this server only', () => {
  const config = loadConfig({
    ...base,
    GOOGLE_REDIRECT_URI: 'http://localhost:3000/auth/google/callback',
  });
  assert.equal(config.google?.callbackUrl, 'http://localhost:3000/auth/google/callback');
  assert.equal(loadConfig(base).google?.callbackUrl, undefined, 'default: /login/google/callback');
  assert.throws(
    () =>
      loadConfig({
        ...base,
        GOOGLE_REDIRECT_URI: 'https://y.offlinesass.com/auth/google/callback',
      }),
    /must be an address on MAKA_SERVER_PUBLIC_URL/,
  );
});

test('the email domain list is optional', () => {
  assert.deepEqual(loadConfig(base).allowedEmailDomains, []);
  assert.deepEqual(
    loadConfig({ ...base, MAKA_ALLOWED_EMAIL_DOMAINS: 'RELX.com, elsevier.com' })
      .allowedEmailDomains,
    ['relx.com', 'elsevier.com'],
  );
});

test('configuration refuses a server with no way to sign in, or a short master key', () => {
  const { GOOGLE_CLIENT_ID: _, GOOGLE_CLIENT_SECRET: __, ...noProvider } = base;
  assert.throws(() => loadConfig(noProvider), /identity provider/);
  assert.throws(() => loadConfig({ ...base, MAKA_MASTER_KEY: 'c2hvcnQ=' }), /exactly 32 bytes/);
});

test('the public address and RELX SSO endpoints are https, plain http only on this machine', () => {
  assert.equal(loadConfig(base).publicUrl, 'http://localhost:3000');
  assert.equal(
    loadConfig({ ...base, MAKA_SERVER_PUBLIC_URL: 'https://maka.relx.com/' }).publicUrl,
    'https://maka.relx.com',
  );
  assert.throws(
    () => loadConfig({ ...base, MAKA_SERVER_PUBLIC_URL: 'http://maka.relx.com' }),
    /https/,
  );
  assert.throws(
    () => loadConfig({ ...base, MAKA_SERVER_PUBLIC_URL: 'javascript:alert(1)' }),
    /https/,
  );
  const relx = {
    RELX_SSO_CLIENT_ID: 'id',
    RELX_SSO_CLIENT_SECRET: 'secret',
    RELX_SSO_AUTHORIZE_URL: 'https://sso.example/authorize',
    RELX_SSO_TOKEN_URL: 'https://sso.example/token',
    RELX_SSO_USERINFO_URL: 'https://sso.example/userinfo',
  };
  assert.equal(loadConfig({ ...base, ...relx }).relxSso?.tokenUrl, 'https://sso.example/token');
  assert.throws(
    () => loadConfig({ ...base, ...relx, RELX_SSO_TOKEN_URL: 'ftp://sso.example/token' }),
    /https/,
  );
});

test('half a provider is an error, not a provider left out', () => {
  assert.throws(
    () => loadConfig({ ...base, GOOGLE_CLIENT_SECRET: '' }),
    /Google is partly configured; also set GOOGLE_CLIENT_SECRET/,
  );
  assert.throws(
    () => loadConfig({ ...base, RELX_SSO_CLIENT_ID: 'id', RELX_SSO_CLIENT_SECRET: 'secret' }),
    /RELX SSO is partly configured/,
  );
});

test('forwarded addresses are believed only from configured proxies', () => {
  assert.equal(loadConfig(base).trustProxy, false);
  assert.equal(loadConfig({ ...base, MAKA_TRUST_PROXY: '1' }).trustProxy, 1);
  assert.equal(loadConfig({ ...base, MAKA_TRUST_PROXY: '10.0.0.0/8' }).trustProxy, '10.0.0.0/8');
});
