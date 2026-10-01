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
import { randomUUID } from 'node:crypto';
import { decodeTokenResponse } from '@maka/platform-protocol';
import type {
  ConsoleModel,
  ConsoleModelCatalog,
  ConsoleModelProviderDraft,
  ConsolePublished,
} from '../admin-console/types.js';
import {
  browserSignIn,
  type ConsoleBrowser,
  consoleCall,
  consoleSignIn,
  exchangeCode,
  type TestServer,
} from './support.js';

/**
 * Add a provider and publish `ids` from its model list, as the console does:
 * the stand-in provider lists them, the administrator selects them.
 */
export async function publish(
  server: TestServer,
  draft: ConsoleModelProviderDraft,
  ids: string[],
  browser?: ConsoleBrowser,
) {
  for (const id of ids) if (!server.catalogModels.includes(id)) server.catalogModels.push(id);
  const admin = browser ?? (await consoleSignIn(server, server.google, 'boss@relx.com'));
  const discovered = await consoleCall(server, admin, 'POST', '/model-providers/discover', {
    draft,
  });
  assert.equal(discovered.statusCode, 200, discovered.body);
  const catalog = discovered.json() as ConsoleModelCatalog;
  assert.equal(catalog.status, 'ready', discovered.body);
  if (catalog.status !== 'ready') throw new Error('not ready');
  const payload = {
    draft,
    publish: {
      snapshotId: catalog.snapshotId,
      selections: ids.map((id) => ({ id })),
      idempotencyKey: randomUUID(),
    },
  };
  const result = await consoleCall(server, admin, 'POST', '/model-providers', payload);
  assert.equal(result.statusCode, 200, result.body);
  const created = result.json() as ConsolePublished;
  const all = (await consoleCall(server, admin, 'GET', '/models')).json() as ConsoleModel[];
  return {
    admin,
    created,
    payload,
    catalog,
    models: ids.map((id) =>
      all.find((m) => m.provider.id === created.providerId && m.providerModel === id),
    ) as ConsoleModel[],
  };
}

export async function accessToken(server: TestServer, email = 'ada@relx.com') {
  const code = randomUUID();
  server.relx.answers.set(code, { provider: 'relx-sso', subject: email, email });
  const { redirect } = await browserSignIn(server, server.relx, code);
  return decodeTokenResponse(
    (await exchangeCode(server, redirect.searchParams.get('code') ?? '')).json(),
  ).access_token;
}

/** What the desktop sends beside the SDK's own request. */
export function modelHeaders(model: ConsoleModel, token: string) {
  return {
    authorization: `Bearer ${token}`,
    'x-maka-gateway-version': '1',
    'x-maka-model-id': model.id,
    'x-maka-client-version': '0.2.0',
  };
}

export const anthropicDraft = (name = 'Anthropic'): ConsoleModelProviderDraft => ({
  name,
  integration: 'anthropic',
  config: { baseUrl: `https://${name.toLowerCase()}.test/v1` },
  credential: { apiKey: `test-key-${name}` },
});
export const event = (v: unknown) => `data: ${JSON.stringify(v)}\n\n`;
export const anthropicStream = () =>
  [
    {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 1,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 300,
        },
      },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 42 },
    },
    { type: 'message_stop' },
  ]
    .map(event)
    .join('');
export const anthropicJson = () => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-6',
  content: [{ type: 'text', text: 'Hello' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: {
    input_tokens: 100,
    output_tokens: 42,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 300,
  },
});
