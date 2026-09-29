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
import { ClientCapabilityInvocationError } from '../server/client-capability-invocation-broker.js';
import { OrganizationAccountUnavailableError } from '@maka/runtime/organization-model-fetch';
import {
  createHostOrganizationModelFetch,
  createHostOrganizationSession,
  type OrganizationAccountServiceCall,
} from '../server/organization-session.js';

const SERVER = 'https://maka.example.com';

function desktop(answers: Array<Record<string, unknown>>) {
  const calls: Array<{ method: string; input: Record<string, unknown> }> = [];
  const call: OrganizationAccountServiceCall = async (request) => {
    assert.equal(request.serviceId, 'organization_account');
    assert.equal(request.version, '1');
    calls.push({ method: request.method, input: request.input });
    const answer = answers.shift();
    if (!answer) throw new Error('no more answers');
    return answer;
  };
  return { call, calls };
}

const token = (accessToken: string, serverUrl = `${SERVER}/`) => ({
  kind: 'token',
  accessToken,
  serverUrl,
  clientVersion: '0.2.0',
});

test('the app is asked each time, and callers at the same moment share one question', async () => {
  const app = desktop([token('first'), token('second')]);
  const session = createHostOrganizationSession({ call: app.call });

  // The server's two spellings are one server.
  const [a, b] = await Promise.all([
    session.accessToken(SERVER),
    session.accessToken(`${SERVER}/`),
  ]);
  assert.equal(a.accessToken, 'first');
  assert.equal(b.accessToken, 'first');
  assert.equal(a.clientVersion, '0.2.0');
  assert.deepEqual(app.calls, [{ method: 'access_token', input: { forceRefresh: false } }]);

  // Nothing is kept: the app may have signed someone else in meanwhile.
  assert.equal((await session.accessToken(SERVER)).accessToken, 'second');
  assert.equal(app.calls.length, 2);
});

test('one caller stopping does not stop another waiting on the same answer', async () => {
  let answer!: (value: Record<string, unknown>) => void;
  const seen: Array<AbortSignal | undefined> = [];
  const session = createHostOrganizationSession({
    call: (request) => {
      seen.push(request.signal);
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
  });
  const stopped = new AbortController();
  const first = session.accessToken(SERVER, { signal: stopped.signal });
  const second = session.accessToken(SERVER, { signal: new AbortController().signal });
  // The shared question is nobody's to stop.
  assert.deepEqual(seen, [undefined]);
  stopped.abort(new Error('stopped'));
  await assert.rejects(first, /stopped/);
  answer(token('shared'));
  assert.equal((await second).accessToken, 'shared');
});

test('a forced refresh asks the app to refresh now', async () => {
  const app = desktop([token('first'), token('fresh')]);
  const session = createHostOrganizationSession({ call: app.call });
  await session.accessToken(SERVER);
  assert.equal((await session.accessToken(SERVER, { forceRefresh: true })).accessToken, 'fresh');
  assert.deepEqual(app.calls[1]?.input, { forceRefresh: true });
});

test('a token for another server is never sent to this one', async () => {
  const app = desktop([token('elsewhere', 'https://other.example.com')]);
  const session = createHostOrganizationSession({ call: app.call });
  await assert.rejects(
    session.accessToken(SERVER),
    (error) =>
      error instanceof OrganizationAccountUnavailableError && error.reason === 'server_mismatch',
  );
});

test('the app says why it has no token, and a Host with no app to ask says so', async () => {
  const signedOut = createHostOrganizationSession({
    call: desktop([{ kind: 'unavailable', reason: 'signed_out' }]).call,
  });
  await assert.rejects(
    signedOut.accessToken(SERVER),
    (error) =>
      error instanceof OrganizationAccountUnavailableError && error.reason === 'signed_out',
  );
  const noApp = createHostOrganizationSession({
    call: async () => {
      throw new ClientCapabilityInvocationError('capability_lost', 'no provider');
    },
  });
  await assert.rejects(
    noApp.accessToken(SERVER),
    (error) =>
      error instanceof OrganizationAccountUnavailableError && error.reason === 'not_offered',
  );
});

test('a refresh that fails says why, rather than the 401 it answered', async () => {
  const app = desktop([token('stale'), { kind: 'unavailable', reason: 'upgrade_required' }]);
  const signed = createHostOrganizationModelFetch({
    session: createHostOrganizationSession({ call: app.call }),
    serverUrl: SERVER,
    fetchFn: async () => new Response('no', { status: 401 }),
  });
  await assert.rejects(
    signed(`${SERVER}/model/anthropic/v1/messages`, { method: 'POST', body: '{}' }),
    (error) =>
      error instanceof OrganizationAccountUnavailableError && error.reason === 'upgrade_required',
  );
});

test('a gateway request carries the bearer token and the app version, never the SDK key', async () => {
  const app = desktop([token('first')]);
  const session = createHostOrganizationSession({ call: app.call });
  const seen: Headers[] = [];
  const fetchFn: typeof fetch = async (_url, init) => {
    seen.push(new Headers(init?.headers));
    return new Response('{}', { status: 200 });
  };
  const signed = createHostOrganizationModelFetch({ session, serverUrl: SERVER, fetchFn });
  await signed(`${SERVER}/model/anthropic/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': 'placeholder', 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(seen[0]?.get('authorization'), 'Bearer first');
  assert.equal(seen[0]?.get('x-api-key'), null);
  assert.equal(seen[0]?.get('x-maka-client-version'), '0.2.0');
  assert.equal(seen[0]?.get('content-type'), 'application/json');
});

test('a 401 is answered once with a refreshed token, and a second 401 goes back as it came', async () => {
  const app = desktop([token('stale'), token('fresh')]);
  const session = createHostOrganizationSession({ call: app.call });
  const tokens: string[] = [];
  const fetchFn: typeof fetch = async (_url, init) => {
    const bearer = new Headers(init?.headers).get('authorization') ?? '';
    tokens.push(bearer);
    return new Response(bearer === 'Bearer fresh' ? 'ok' : 'no', {
      status: bearer === 'Bearer fresh' ? 200 : 401,
    });
  };
  const signed = createHostOrganizationModelFetch({ session, serverUrl: SERVER, fetchFn });
  const response = await signed(`${SERVER}/model/anthropic/v1/messages`, {
    method: 'POST',
    body: '{"model":"m"}',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(tokens, ['Bearer stale', 'Bearer fresh']);

  // Refused again with the fresh token: that answer goes back as it came.
  const twice = desktop([token('stale'), token('fresh')]);
  let sent = 0;
  const refused = createHostOrganizationModelFetch({
    session: createHostOrganizationSession({ call: twice.call }),
    serverUrl: SERVER,
    fetchFn: async () => {
      sent += 1;
      return new Response('no', { status: 401 });
    },
  });
  assert.equal((await refused(`${SERVER}/model/catalog`)).status, 401);
  assert.equal(sent, 2);

  // Refreshed to the same token: the server's answer stands, no second try.
  const same = desktop([token('same'), token('same')]);
  const stuck = createHostOrganizationModelFetch({
    session: createHostOrganizationSession({ call: same.call }),
    serverUrl: SERVER,
    fetchFn: async () => new Response('no', { status: 401 }),
  });
  assert.equal((await stuck(`${SERVER}/model/catalog`)).status, 401);
  assert.equal(same.calls.length, 2);
});
