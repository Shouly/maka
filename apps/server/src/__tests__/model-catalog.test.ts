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
import { test } from 'node:test';
import { thinkingVariantsForModel } from '@maka/core/model-thinking';
import type {
  ConsoleModel,
  ConsoleModelCatalog,
  ConsoleModelProvider,
  ConsoleModelProviderDraft,
  ConsoleModelProviderDetail,
} from '../admin-console/types.js';
import { anthropicDraft, publish } from './gateway-support.js';
import { consoleCall, consoleSignIn, startTestServer } from './support.js';

type Ready = Extract<ConsoleModelCatalog, { status: 'ready' }>;

const openRouterDraft: ConsoleModelProviderDraft = {
  name: 'Router',
  integration: 'openrouter',
  config: {},
  credential: { apiKey: 'router-test' },
};

test('published reasoning controls match the desktop direct connections, off-only models included', async () => {
  const s = await startTestServer();
  try {
    for (const [integration, providerType, ids] of [
      ['anthropic', 'anthropic', ['claude-sonnet-4-5', 'claude-sonnet-4-6']],
      ['gemini', 'google', ['gemini-2.5-flash', 'gemini-3-flash-preview']],
    ] as const) {
      const p = await publish(
        s,
        { name: integration, integration, config: {}, credential: { apiKey: 'test-key' } },
        [...ids],
      );
      for (const model of p.models)
        assert.deepEqual(
          model.contract.capabilities.thinkingLevels,
          thinkingVariantsForModel(providerType, model.contract.sdkModelId),
        );
      assert.deepEqual(
        p.models.find((m) => m.contract.sdkModelId === ids[0])!.contract.capabilities
          .thinkingLevels,
        ['off'],
      );
    }
  } finally {
    await s.close();
  }
});

test('a provider and its models are saved in one go, the key sealed, a retried save answered once', async () => {
  const s = await startTestServer();
  try {
    const p = await publish(s, anthropicDraft(), ['claude-sonnet-4-6', 'claude-haiku-4-5']);
    assert.equal(p.models.length, 2);
    assert.ok(
      p.models.every((m) => m.id.startsWith('m_') && m.provider.id === p.created.providerId),
    );
    assert.equal(p.models[0]!.contract.apiProtocol, 'anthropic-messages');
    const listed = await consoleCall(s, p.admin, 'GET', '/model-providers');
    assert.ok(!listed.body.includes('test-key'), 'the key is never read back');
    const stored = await s.db.selectFrom('model_providers').selectAll().executeTakeFirstOrThrow();
    assert.ok(!stored.credential_sealed.includes('test-key'));
    assert.equal(
      JSON.parse(s.ctx.secrets.open(stored.credential_sealed, `model-provider:${stored.id}`))
        .apiKey,
      'test-key-Anthropic',
    );
    // The answer was lost: the same save again changes nothing and answers the same.
    const replay = await consoleCall(s, p.admin, 'POST', '/model-providers', p.payload);
    assert.deepEqual(replay.json(), p.created);
    assert.equal((await s.db.selectFrom('organization_models').select('id').execute()).length, 2);
    const reused = await consoleCall(s, p.admin, 'POST', '/model-providers', {
      ...p.payload,
      draft: { ...p.payload.draft, name: 'Changed' },
    });
    assert.equal(reused.statusCode, 409);
    assert.equal(reused.json().error.code, 'idempotency_conflict');
    const audit = await s.db.selectFrom('audit_events').select(['action', 'detail']).execute();
    assert.ok(audit.some((row) => row.action === 'model_provider.created'));
    assert.equal(audit.filter((row) => row.action === 'model.published').length, 2);
  } finally {
    await s.close();
  }
});

test('a provider is what it was added as: only its name, key and switch change', async () => {
  let refuse = false;
  const s = await startTestServer(
    {},
    {
      catalogFetch: async () =>
        refuse
          ? new Response('no', { status: 401 })
          : Response.json({ data: [{ id: 'claude-sonnet-4-6' }], has_more: false }),
    },
  );
  try {
    const p = await publish(s, anthropicDraft(), ['claude-sonnet-4-6']);
    const id = p.created.providerId;
    const get = async () =>
      (
        await consoleCall(s, p.admin, 'GET', `/model-providers/${id}`)
      ).json() as ConsoleModelProviderDetail;
    const moved = await consoleCall(s, p.admin, 'PATCH', `/model-providers/${id}`, {
      expectedRevision: (await get()).revision,
      config: { baseUrl: 'https://elsewhere.test/v1' },
    });
    assert.equal(moved.statusCode, 400, 'the address is fixed');
    refuse = true;
    const refused = await consoleCall(s, p.admin, 'PATCH', `/model-providers/${id}`, {
      expectedRevision: (await get()).revision,
      credential: { apiKey: 'wrong' },
    });
    assert.equal(refused.statusCode, 400);
    assert.equal(refused.json().error.code, 'credentials_rejected');
    refuse = false;
    const before = await get();
    const renamed = await consoleCall(s, p.admin, 'PATCH', `/model-providers/${id}`, {
      expectedRevision: before.revision,
      name: 'Company Anthropic',
      credential: { apiKey: 'new-key' },
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    assert.equal((renamed.json() as ConsoleModelProvider).name, 'Company Anthropic');
    const stale = await consoleCall(s, p.admin, 'PATCH', `/model-providers/${id}`, {
      expectedRevision: before.revision,
      enabled: false,
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error.code, 'revision_conflict');
    const inUse = await consoleCall(s, p.admin, 'DELETE', `/model-providers/${id}`, {
      expectedRevision: (await get()).revision,
    });
    assert.equal(inUse.statusCode, 409);
    assert.equal(inUse.json().error.code, 'provider_in_use');
    const model = p.models[0]!;
    assert.equal(
      (
        await consoleCall(s, p.admin, 'DELETE', `/models/${model.id}`, {
          expectedRevision: model.revision,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await consoleCall(s, p.admin, 'DELETE', `/model-providers/${id}`, {
          expectedRevision: (await get()).revision,
        })
      ).statusCode,
      200,
    );
    const audit = await s.db
      .selectFrom('audit_events')
      .select(['action', 'detail'])
      .where('action', '=', 'model_provider.updated')
      .executeTakeFirstOrThrow();
    assert.deepEqual(audit.detail.changed, ['name', 'credential']);
    assert.equal(audit.detail.name, 'Company Anthropic');
  } finally {
    await s.close();
  }
});

test('a provider left unnamed takes its integration name, made unique', async () => {
  const s = await startTestServer();
  try {
    const first = await publish(s, { ...openRouterDraft, name: undefined }, ['openai/gpt-5.4']);
    const second = await publish(
      s,
      { ...openRouterDraft, name: undefined, credential: { apiKey: 'other' } },
      ['openai/gpt-5.4'],
      first.admin,
    );
    assert.equal(first.created.providerName, 'OpenRouter');
    assert.equal(second.created.providerName, 'OpenRouter 2');
    // The same provider model under two providers is two organization models.
    assert.notEqual(first.models[0]!.id, second.models[0]!.id);
  } finally {
    await s.close();
  }
});

test('publishing reads a snapshot this administrator took of this account, not the page', async () => {
  const s = await startTestServer();
  try {
    s.catalogModels.push('claude-sonnet-4-6');
    const admin = await consoleSignIn(s, s.google, 'boss@relx.com');
    const draft = anthropicDraft();
    const snapshot = (
      await consoleCall(s, admin, 'POST', '/model-providers/discover', { draft })
    ).json() as Ready;
    const body = {
      draft,
      publish: {
        snapshotId: snapshot.snapshotId,
        selections: [{ id: 'claude-sonnet-4-6' }, { id: 'forged-model' }],
        idempotencyKey: randomUUID(),
      },
    };
    const forged = await consoleCall(s, admin, 'POST', '/model-providers', body);
    assert.equal(forged.statusCode, 409);
    assert.equal(forged.json().error.code, 'catalog_expired');
    assert.equal((await s.db.selectFrom('model_providers').select('id').execute()).length, 0);
    body.publish.selections = [{ id: 'claude-sonnet-4-6' }];
    body.publish.idempotencyKey = randomUUID();
    const otherKey = await consoleCall(s, admin, 'POST', '/model-providers', {
      ...body,
      draft: { ...draft, credential: { apiKey: 'different-key' } },
    });
    assert.equal(otherKey.json().error.code, 'catalog_expired');
    body.publish.idempotencyKey = randomUUID();
    s.advance(16 * 60 * 1000);
    const late = await consoleCall(s, admin, 'POST', '/model-providers', body);
    assert.equal(late.json().error.code, 'catalog_expired');
  } finally {
    await s.close();
  }
});

test('a saved provider lists again with what is already published, and publishes more', async () => {
  const s = await startTestServer();
  try {
    const p = await publish(s, anthropicDraft(), ['claude-sonnet-4-6']);
    s.catalogModels.push('claude-haiku-4-5');
    const id = p.created.providerId;
    const again = (
      await consoleCall(s, p.admin, 'POST', `/model-providers/${id}/discover`, {})
    ).json() as Ready;
    assert.equal(
      again.models.find((m) => m.id === 'claude-sonnet-4-6')?.publishedModelId,
      p.models[0]!.id,
    );
    assert.equal(
      again.models.find((m) => m.id === 'claude-haiku-4-5')?.publishedModelId,
      undefined,
    );
    const provider = (await consoleCall(s, p.admin, 'GET', `/model-providers/${id}`)).json();
    const more = await consoleCall(s, p.admin, 'POST', `/model-providers/${id}/publish`, {
      snapshotId: again.snapshotId,
      selections: [{ id: 'claude-sonnet-4-6' }, { id: 'claude-haiku-4-5' }],
      idempotencyKey: randomUUID(),
      expectedRevision: provider.revision,
    });
    assert.equal(more.statusCode, 200, more.body);
    assert.equal(more.json().modelIds[0], p.models[0]!.id, 'published once');
    const models = (await consoleCall(s, p.admin, 'GET', '/models')).json() as ConsoleModel[];
    assert.equal(models.length, 2);
  } finally {
    await s.close();
  }
});

test('OpenRouter lists several vendors over Chat, and honours what its list says a model lacks', async () => {
  const calls: string[] = [];
  const s = await startTestServer(
    {},
    {
      catalogFetch: async (url, init) => {
        calls.push(String(url));
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer router-test');
        return Response.json({
          data: [
            {
              id: 'anthropic/claude-sonnet-4.6',
              name: 'Claude Sonnet',
              context_length: 200000,
              supported_parameters: ['tools', 'reasoning'],
              architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            },
            {
              id: 'openai/gpt-5.4',
              name: 'GPT',
              supported_parameters: [],
              architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            },
            { id: '~openai/gpt-sol-latest', name: 'GPT Sol (latest)' },
            { id: 'image-only', architecture: { output_modalities: ['image'] } },
          ],
        });
      },
    },
  );
  try {
    const admin = await consoleSignIn(s, s.google, 'boss@relx.com');
    const result = await consoleCall(s, admin, 'POST', '/model-providers/discover', {
      draft: openRouterDraft,
    });
    const catalog = result.json() as Ready;
    assert.equal(catalog.status, 'ready', result.body);
    assert.deepEqual(
      catalog.models.map((m) => m.id),
      ['anthropic/claude-sonnet-4.6', 'openai/gpt-5.4', '~openai/gpt-sol-latest'],
    );
    assert.ok(catalog.models.every((m) => m.contract.profileId === 'openrouter-chat'));
    assert.equal(catalog.models[0]!.contract.capabilities.supportsTools, true);
    assert.equal(catalog.models[0]!.contract.capabilities.contextWindow, 200000);
    assert.equal(
      catalog.models[1]!.contract.capabilities.supportsTools,
      false,
      'listed without tools',
    );
    assert.equal(catalog.models[2]!.contract.sdkModelId, '~openai/gpt-sol-latest');
    assert.deepEqual(calls, ['https://openrouter.ai/api/v1/models/user']);
  } finally {
    await s.close();
  }
});

test('official OpenAI publishes chat models over Responses; a compatible service keeps its own list', async () => {
  const s = await startTestServer(
    {},
    {
      catalogFetch: async () =>
        Response.json({
          data: [
            { id: 'o3-pro' },
            { id: 'gpt-4.1' },
            { id: 'text-embedding-3-large' },
            { id: 'gpt-image-1' },
            { id: 'qwen-audio-chat' },
          ],
        }),
    },
  );
  try {
    const admin = await consoleSignIn(s, s.google, 'boss@relx.com');
    const official = (
      await consoleCall(s, admin, 'POST', '/model-providers/discover', {
        draft: { integration: 'openai', config: {}, credential: { apiKey: 'k' } },
      })
    ).json() as Ready;
    assert.deepEqual(
      official.models.map((m) => [m.id, m.contract.profileId]),
      [
        ['o3-pro', 'openai-responses'],
        ['gpt-4.1', 'openai-responses'],
      ],
    );
    const compatible = (
      await consoleCall(s, admin, 'POST', '/model-providers/discover', {
        draft: {
          integration: 'custom-responses',
          config: { baseUrl: 'https://llm.internal.test/v1' },
          credential: { apiKey: 'k' },
        },
      })
    ).json() as Ready;
    assert.equal(compatible.models.length, 5, 'no names sorted out for a compatible service');
    const qwen = compatible.models.find((m) => m.id === 'qwen-audio-chat')!;
    assert.equal(qwen.contract.profileId, 'compatible-responses');
    assert.equal(qwen.contract.capabilities.supportsTools, true, 'tools unless known not to');
    assert.equal(qwen.contract.capabilities.supportsReasoning, false);
  } finally {
    await s.close();
  }
});

test('Vertex AI lists the Claude and Gemini text models of Model Garden with the service account', async () => {
  const calls: { url: string; auth: string | null }[] = [];
  const s = await startTestServer(
    {},
    {
      vertexToken: async () => 'vertex-token',
      catalogFetch: async (url, init) => {
        calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
        const publisher = new URL(String(url)).pathname.split('/')[3];
        return Response.json(
          publisher === 'anthropic'
            ? {
                publisherModels: [
                  { name: 'publishers/anthropic/models/claude-sonnet-4-5', versionId: '20250929' },
                  { name: 'publishers/anthropic/models/claude-opus-4-6', versionId: '001' },
                ],
              }
            : {
                publisherModels: [
                  { name: 'publishers/google/models/gemini-2.5-pro' },
                  { name: 'publishers/google/models/gemini-embedding-001' },
                  { name: 'publishers/google/models/imagen-4.0-generate-001' },
                ],
              },
        );
      },
    },
  );
  try {
    const admin = await consoleSignIn(s, s.google, 'boss@relx.com');
    const catalog = (
      await consoleCall(s, admin, 'POST', '/model-providers/discover', {
        draft: {
          integration: 'vertex',
          config: { projectId: 'my-project', region: 'global' },
          credential: {
            serviceAccount: {
              type: 'service_account',
              client_email: 'x@my-project.iam.gserviceaccount.com',
              private_key: 'k',
            },
          },
        },
      })
    ).json() as Ready;
    assert.deepEqual(
      catalog.models.map((m) => [m.id, m.contract.apiProtocol]),
      [
        ['claude-sonnet-4-5@20250929', 'anthropic-messages'],
        ['claude-opus-4-6', 'anthropic-messages'],
        ['gemini-2.5-pro', 'google-generate'],
      ],
    );
    assert.ok(calls.every((call) => call.auth === 'Bearer vertex-token'));
    assert.ok(
      calls[0]!.url.startsWith(
        'https://aiplatform.googleapis.com/v1beta1/publishers/anthropic/models',
      ),
    );
  } finally {
    await s.close();
  }
});

test('one unreadable list entry does not hide the others', async () => {
  const s = await startTestServer(
    {},
    {
      catalogFetch: async () =>
        Response.json({
          data: [
            { id: 'openai/gpt-5.4' },
            null,
            { id: 42 },
            { id: 'bad\nmodel', name: 'secret-upstream-response' },
            { id: '~openai/gpt-sol-latest' },
          ],
        }),
    },
  );
  try {
    const admin = await consoleSignIn(s, s.google, 'boss@relx.com');
    const result = await consoleCall(s, admin, 'POST', '/model-providers/discover', {
      draft: openRouterDraft,
    });
    const catalog = result.json() as Ready;
    assert.deepEqual(
      catalog.models.map((m) => m.id),
      ['openai/gpt-5.4', '~openai/gpt-sol-latest'],
    );
    assert.equal(catalog.skippedModels, 3);
    assert.ok(!result.body.includes('secret-upstream-response'));
    assert.ok(!result.body.includes('router-test'));
  } finally {
    await s.close();
  }
});

test('a list that cannot be read says why, keeps no snapshot and shows nothing of the answer', async () => {
  let reply: () => Response = () => new Response();
  const s = await startTestServer({}, { catalogFetch: async () => reply() });
  try {
    const admin = await consoleSignIn(s, s.google, 'boss@relx.com');
    for (const [answer, reason] of [
      [() => Response.json({ data: [null, { id: 'bad\nmodel' }] }), 'invalid_response'],
      [() => Response.json({ data: {} }), 'invalid_response'],
      [() => new Response('{secret-upstream-response'), 'invalid_response'],
      [() => new Response('secret-upstream-response', { status: 401 }), 'credentials'],
      [() => new Response('secret-upstream-response', { status: 503 }), 'unavailable'],
    ] as const) {
      reply = answer;
      const result = await consoleCall(s, admin, 'POST', '/model-providers/discover', {
        draft: openRouterDraft,
      });
      assert.deepEqual(result.json(), { status: 'failed', reason });
      assert.ok(!result.body.includes('secret-upstream-response'));
    }
    assert.equal(
      (await s.db.selectFrom('provider_catalog_snapshots').select('id').execute()).length,
      0,
    );
  } finally {
    await s.close();
  }
});

test('a list that pages without end is refused, without the key in the answer', async () => {
  let calls = 0;
  const s = await startTestServer(
    {},
    {
      catalogFetch: async () => {
        calls++;
        return Response.json({
          data: [{ id: 'claude-sonnet-4-6', display_name: 'Sonnet' }],
          has_more: true,
          last_id: 'repeat',
        });
      },
    },
  );
  try {
    const admin = await consoleSignIn(s, s.google, 'boss@relx.com');
    const result = await consoleCall(s, admin, 'POST', '/model-providers/discover', {
      draft: anthropicDraft(),
    });
    assert.deepEqual(result.json(), { status: 'failed', reason: 'invalid_response' });
    assert.equal(calls, 2);
    assert.ok(!result.body.includes('test-key'));
  } finally {
    await s.close();
  }
});

test('desktops read only the models open to people, with their contracts', async () => {
  const s = await startTestServer();
  try {
    const p = await publish(s, anthropicDraft(), ['claude-sonnet-4-6', 'claude-haiku-4-5']);
    const [open, closed] = p.models;
    await consoleCall(s, p.admin, 'PATCH', `/models/${closed!.id}`, {
      expectedRevision: closed!.revision,
      enabled: false,
    });
    const { accessToken } = await import('./gateway-support.js');
    const token = await accessToken(s);
    const read = async () =>
      (
        await s.app.inject({
          method: 'GET',
          url: '/model/catalog',
          headers: { authorization: `Bearer ${token}`, 'x-maka-gateway-version': '1' },
        })
      ).json();
    const before = await read();
    assert.deepEqual(
      before.models.map((m: { id: string; availability: string }) => [m.id, m.availability]),
      [[open!.id, 'available']],
    );
    assert.equal(before.models[0].contract.sdkModelId, 'claude-sonnet-4-6');
    const provider = (
      await consoleCall(s, p.admin, 'GET', `/model-providers/${p.created.providerId}`)
    ).json();
    await consoleCall(s, p.admin, 'PATCH', `/model-providers/${p.created.providerId}`, {
      expectedRevision: provider.revision,
      enabled: false,
    });
    const after = await read();
    assert.equal(after.models[0].availability, 'provider_disabled');
    assert.notEqual(after.revision, before.revision);
  } finally {
    await s.close();
  }
});

test("a snapshot is only the reading administrator's, and keeping a provider alone still needs one", async () => {
  const s = await startTestServer({ bootstrapAdminEmails: ['boss@relx.com', 'ops@relx.com'] });
  try {
    s.catalogModels.push('claude-sonnet-4-6');
    const boss = await consoleSignIn(s, s.google, 'boss@relx.com');
    const ops = await consoleSignIn(s, s.google, 'ops@relx.com');
    const draft = anthropicDraft();
    const snapshot = (
      await consoleCall(s, boss, 'POST', '/model-providers/discover', { draft })
    ).json() as Ready;
    const save = (
      browser: typeof boss,
      selections: { id: string }[],
      snapshotId = snapshot.snapshotId,
    ) =>
      consoleCall(s, browser, 'POST', '/model-providers', {
        draft,
        publish: { snapshotId, selections, idempotencyKey: randomUUID() },
      });
    const other = await save(ops, [{ id: 'claude-sonnet-4-6' }]);
    assert.equal(other.json().error.code, 'catalog_expired');
    // No list read, no provider: having read it shows the key was taken.
    const unread = await save(boss, [], randomUUID());
    assert.equal(unread.json().error.code, 'catalog_expired');
    const kept = await save(boss, []);
    assert.equal(kept.statusCode, 200, kept.body);
    assert.deepEqual(kept.json().modelIds, []);
  } finally {
    await s.close();
  }
});

test('a long list can be published whole, and a list that never ends is refused', async () => {
  let page = 0;
  let endless = false;
  const many = Array.from({ length: 150 }, (_, i) => ({ id: `vendor/model-${i}` }));
  const s = await startTestServer(
    {},
    {
      catalogFetch: async () => {
        page++;
        return endless
          ? Response.json({
              data: [{ id: `m-${page}` }],
              has_more: true,
              last_id: `cursor-${page}`,
            })
          : Response.json({ data: many });
      },
    },
  );
  try {
    const admin = await consoleSignIn(s, s.google, 'boss@relx.com');
    const listed = (
      await consoleCall(s, admin, 'POST', '/model-providers/discover', { draft: openRouterDraft })
    ).json() as Ready;
    assert.equal(listed.models.length, 150);
    const all = await consoleCall(s, admin, 'POST', '/model-providers', {
      draft: openRouterDraft,
      publish: {
        snapshotId: listed.snapshotId,
        selections: listed.models.map(({ id }) => ({ id })),
        idempotencyKey: randomUUID(),
      },
    });
    assert.equal(all.statusCode, 200, all.body);
    assert.equal(all.json().modelIds.length, 150);
    endless = true;
    page = 0;
    const result = await consoleCall(s, admin, 'POST', '/model-providers/discover', {
      draft: anthropicDraft(),
    });
    assert.deepEqual(result.json(), { status: 'failed', reason: 'invalid_response' });
    assert.equal(page, 20, 'stops at the page limit');
  } finally {
    await s.close();
  }
});
