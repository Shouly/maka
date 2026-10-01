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

// The organization's model providers and the models published from them
// (design §3–§4, §11). A provider is an account: what it is (integration,
// address, project) is fixed when it is added; its name, key and switch can
// change. A model is one provider model under that provider, with the
// contract it was published under, and never moves to another provider.
// Every change bumps the changed item's revision, which the page sends back
// to change it again, and the catalog's revision, which tells desktops.

import { createHash } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import { z } from 'zod';
import { decodeExecutionContract, MODEL_INTEGRATIONS } from '@maka/core/model-gateway';
import { type AdminActor, AdminRefused } from './administration.js';
import {
  type CatalogDeps,
  canonical,
  credentialRefused,
  fingerprint,
  MODEL_LIMIT,
  type ProviderDraft,
  storedDraft,
  validatedDraft,
} from './admin-console/model-catalog.js';
import type {
  ConsoleModel,
  ConsoleModelProvider,
  ConsoleModelProviderDetail,
  ConsolePublished,
} from './admin-console/types.js';
import { recordAudit } from './audit.js';
import type { ServerContext } from './context.js';
import { newId } from './crypto/tokens.js';
import type { Database } from './db/schema.js';
import {
  type ModelProviderRow,
  sealCredential,
  validateProviderCredential,
} from './gateway/model-providers.js';

type Tx = Transaction<Database>;

const uuid = z.string().uuid();
const revision = z.number().int().positive();
const publishSchema = z.strictObject({
  snapshotId: uuid,
  // As many as a list can hold: "select all" on a long list is a normal choice.
  selections: z.array(z.strictObject({ id: z.string().min(1).max(200) })).max(MODEL_LIMIT),
  idempotencyKey: uuid,
});
const MUTATION_TTL_MS = 24 * 60 * 60 * 1000;

const actorId = (actor: AdminActor) => actor.userId ?? 'cli';
const conflict = () =>
  new AdminRefused(409, 'This was changed elsewhere; reload and try again', 'revision_conflict');

/** Desktops refresh their model list when this moves. */
async function catalogChanged(tx: Tx): Promise<void> {
  await tx
    .updateTable('model_catalog_state')
    .set({ revision: sql`revision + 1` })
    .where('id', '=', 1)
    .execute();
}

async function audit(
  tx: Tx,
  ctx: ServerContext,
  actor: AdminActor,
  action: string,
  target: { readonly type: 'model_provider' | 'model'; readonly id: string },
  detail: Record<string, unknown>,
): Promise<void> {
  await recordAudit(
    tx,
    {
      action,
      actorUserId: actor.userId,
      targetType: target.type,
      targetId: target.id,
      detail: { ...detail, via: actor.via },
      ...(actor.ip ? { ip: actor.ip } : {}),
    },
    ctx.now(),
  );
}

/**
 * Run a create or publish once per idempotency key: the same key and the
 * same request return the first answer (a retry after a lost response); the
 * same key with a different request is refused.
 */
async function once<T extends Record<string, unknown>>(
  ctx: ServerContext,
  actor: AdminActor,
  key: string,
  request: unknown,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  const requestHash = createHash('sha256').update(canonical(request)).digest('hex');
  return ctx.db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${`admin-mutation:${key}`}))`.execute(tx);
    const prior = await tx
      .selectFrom('admin_mutations')
      .selectAll()
      .where('id', '=', key)
      .executeTakeFirst();
    if (prior) {
      if (prior.actor_id !== actorId(actor) || prior.fingerprint !== requestHash)
        throw new AdminRefused(
          409,
          'This request key was used for another change',
          'idempotency_conflict',
        );
      return prior.result as T;
    }
    const result = await run(tx);
    await tx
      .insertInto('admin_mutations')
      .values({
        id: key,
        actor_id: actorId(actor),
        fingerprint: requestHash,
        result: JSON.stringify(result),
      })
      .execute();
    return result;
  });
}

function summary(row: ModelProviderRow, modelCount: number): ConsoleModelProvider {
  return {
    id: row.id,
    name: row.name,
    integration: row.integration,
    config: row.config,
    enabled: row.enabled,
    modelCount,
    revision: row.revision,
    updatedAt: row.updated_at.getTime(),
  };
}

async function modelCounts(ctx: ServerContext | { db: Tx }): Promise<Map<string, number>> {
  const rows = await ctx.db
    .selectFrom('organization_models')
    .select(['model_provider_id', sql<number>`count(*)`.as('count')])
    .groupBy('model_provider_id')
    .execute();
  return new Map(rows.map((row) => [row.model_provider_id, Number(row.count)]));
}

export async function listModelProviders(ctx: ServerContext): Promise<ConsoleModelProvider[]> {
  const rows = await ctx.db.selectFrom('model_providers').selectAll().orderBy('name').execute();
  const counts = await modelCounts(ctx);
  return rows.map((row) => summary(row, counts.get(row.id) ?? 0));
}

export async function modelProviderById(ctx: ServerContext, id: string): Promise<ModelProviderRow> {
  const row = uuid.safeParse(id).success
    ? await ctx.db.selectFrom('model_providers').selectAll().where('id', '=', id).executeTakeFirst()
    : undefined;
  if (!row) throw new AdminRefused(404, 'No such model provider', 'not_found');
  return row;
}

export async function modelProviderDetail(
  ctx: ServerContext,
  id: string,
): Promise<ConsoleModelProviderDetail> {
  const row = await modelProviderById(ctx, id);
  const models = await listModels(ctx, row.id);
  return { ...summary(row, models.length), models };
}

/** The requested name, or the next free "name 2", "name 3"…: a default name must not collide. */
async function freeName(tx: Tx, wanted: string): Promise<string> {
  const taken = new Set(
    (
      await tx
        .selectFrom('model_providers')
        .select('name')
        .where((eb) => eb.or([eb('name', '=', wanted), eb('name', 'like', `${wanted} %`)]))
        .execute()
    ).map((row) => row.name),
  );
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n++) if (!taken.has(`${wanted} ${n}`)) return `${wanted} ${n}`;
}

/**
 * The selected models, from a snapshot this administrator read of this very
 * account. Asked even when nothing is selected: having read the list is what
 * shows the provider took the key.
 */
async function selectedFromSnapshot(
  tx: Tx,
  ctx: ServerContext,
  actor: AdminActor,
  draft: ProviderDraft,
  publish: z.infer<typeof publishSchema>,
  provider?: ModelProviderRow,
) {
  const snapshot = await tx
    .selectFrom('provider_catalog_snapshots')
    .selectAll()
    .where('id', '=', publish.snapshotId)
    .executeTakeFirst();
  if (
    !snapshot ||
    snapshot.actor_id !== actorId(actor) ||
    snapshot.expires_at <= ctx.now() ||
    snapshot.fingerprint !== fingerprint(ctx, draft, provider)
  )
    throw new AdminRefused(409, 'Read the model list again', 'catalog_expired');
  const ids = publish.selections.map((selection) => selection.id);
  if (new Set(ids).size !== ids.length) throw new AdminRefused(400, 'Select each model once');
  return ids.map((id) => {
    const candidate = snapshot.models.find((model) => model.id === id);
    if (!candidate) throw new AdminRefused(409, `${id} is not in the list read`, 'catalog_expired');
    decodeExecutionContract(candidate.contract);
    return candidate;
  });
}

/** Publish the selected models under the provider; one already published stays as it is. */
async function publishInto(
  tx: Tx,
  ctx: ServerContext,
  actor: AdminActor,
  provider: ModelProviderRow,
  selected: Awaited<ReturnType<typeof selectedFromSnapshot>>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const model of selected) {
    const existing = await tx
      .selectFrom('organization_models')
      .select('id')
      .where('model_provider_id', '=', provider.id)
      .where('provider_model', '=', model.id)
      .executeTakeFirst();
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const id = `m_${newId().replaceAll('-', '')}`;
    await tx
      .insertInto('organization_models')
      .values({
        id,
        model_provider_id: provider.id,
        provider_model: model.id,
        display_name: model.displayName,
        contract: JSON.stringify(model.contract),
        cost_weight: 1,
        enabled: true,
        sort_order: 0,
        revision: 1,
        updated_at: ctx.now(),
      })
      .execute();
    await audit(
      tx,
      ctx,
      actor,
      'model.published',
      { type: 'model', id },
      {
        name: model.displayName,
        provider: provider.name,
        providerModel: model.id,
      },
    );
    ids.push(id);
  }
  if (ids.length > 0) await catalogChanged(tx);
  return ids;
}

export async function createModelProvider(
  ctx: ServerContext,
  actor: AdminActor,
  input: unknown,
): Promise<ConsolePublished> {
  const body = z.strictObject({ draft: z.unknown(), publish: publishSchema }).parse(input);
  const draft = validatedDraft(body.draft);
  return once(
    ctx,
    actor,
    body.publish.idempotencyKey,
    { account: fingerprint(ctx, draft), name: draft.name ?? null, publish: body.publish },
    async (tx) => {
      const selected = await selectedFromSnapshot(tx, ctx, actor, draft, body.publish);
      const id = newId();
      const name = await freeName(tx, draft.name || MODEL_INTEGRATIONS[draft.integration].label);
      const row = await tx
        .insertInto('model_providers')
        .values({
          id,
          name,
          integration: draft.integration,
          config: JSON.stringify(draft.config),
          credential_sealed: sealCredential(ctx, id, draft.credential),
          enabled: true,
          revision: 1,
          updated_at: ctx.now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(
        tx,
        ctx,
        actor,
        'model_provider.created',
        { type: 'model_provider', id },
        {
          name,
          integration: draft.integration,
        },
      );
      const modelIds = await publishInto(tx, ctx, actor, row, selected);
      return { providerId: id, providerName: name, modelIds };
    },
  );
}

export async function publishToProvider(
  ctx: ServerContext,
  actor: AdminActor,
  id: string,
  input: unknown,
): Promise<ConsolePublished> {
  const body = publishSchema.extend({ expectedRevision: revision }).strict().parse(input);
  const { expectedRevision, ...publish } = body;
  await modelProviderById(ctx, id);
  return once(ctx, actor, publish.idempotencyKey, { id, body }, async (tx) => {
    const row = await tx
      .selectFrom('model_providers')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AdminRefused(404, 'No such model provider', 'not_found');
    if (row.revision !== expectedRevision) throw conflict();
    const selected = await selectedFromSnapshot(
      tx,
      ctx,
      actor,
      storedDraft(ctx, row),
      publish,
      row,
    );
    const modelIds = await publishInto(tx, ctx, actor, row, selected);
    return { providerId: id, providerName: row.name, modelIds };
  });
}

/** Rename, replace the key (if the provider takes it), switch on or off. */
export async function updateModelProvider(
  ctx: ServerContext,
  actor: AdminActor,
  id: string,
  input: unknown,
  deps: CatalogDeps,
): Promise<ConsoleModelProvider> {
  const patch = z
    .strictObject({
      expectedRevision: revision,
      name: z.string().trim().min(1).max(100).optional(),
      credential: z.record(z.string(), z.unknown()).optional(),
      enabled: z.boolean().optional(),
    })
    .parse(input);
  const current = await modelProviderById(ctx, id);
  const credential = patch.credential
    ? validateProviderCredential(current.integration, patch.credential)
    : undefined;
  // Asked of the provider before anything is locked. The stored key is not
  // opened: replacing it is the way out when it no longer opens.
  const draft = { integration: current.integration, name: current.name, config: current.config };
  if (credential && (await credentialRefused({ ...draft, credential }, deps)))
    throw new AdminRefused(400, 'The provider refused this key', 'credentials_rejected');
  return ctx.db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom('model_providers')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AdminRefused(404, 'No such model provider', 'not_found');
    if (row.revision !== patch.expectedRevision) throw conflict();
    const changed = [
      ...(patch.name !== undefined && patch.name !== row.name ? ['name'] : []),
      ...(credential ? ['credential'] : []),
      ...(patch.enabled !== undefined && patch.enabled !== row.enabled ? ['enabled'] : []),
    ];
    if (changed.length === 0) return summary(row, (await modelCounts({ db: tx })).get(id) ?? 0);
    if (changed.includes('name')) {
      const holder = await tx
        .selectFrom('model_providers')
        .select('id')
        .where('name', '=', patch.name!)
        .where('id', '<>', id)
        .executeTakeFirst();
      if (holder) throw new AdminRefused(409, 'Another provider has this name', 'name_taken');
    }
    const updated = await tx
      .updateTable('model_providers')
      .set({
        name: patch.name ?? row.name,
        ...(credential ? { credential_sealed: sealCredential(ctx, id, credential) } : {}),
        enabled: patch.enabled ?? row.enabled,
        revision: row.revision + 1,
        updated_at: ctx.now(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    // Names and switches show in desktops' lists; a key does not.
    if (changed.some((field) => field !== 'credential')) await catalogChanged(tx);
    await audit(
      tx,
      ctx,
      actor,
      'model_provider.updated',
      { type: 'model_provider', id },
      {
        name: updated.name,
        changed,
      },
    );
    return summary(updated, (await modelCounts({ db: tx })).get(id) ?? 0);
  });
}

/** Only a provider no model is published from: delete those first. */
export async function deleteModelProvider(
  ctx: ServerContext,
  actor: AdminActor,
  id: string,
  input: unknown,
): Promise<void> {
  const { expectedRevision } = z.strictObject({ expectedRevision: revision }).parse(input);
  await modelProviderById(ctx, id);
  await ctx.db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom('model_providers')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AdminRefused(404, 'No such model provider', 'not_found');
    if (row.revision !== expectedRevision) throw conflict();
    const inUse = await tx
      .selectFrom('organization_models')
      .select('id')
      .where('model_provider_id', '=', id)
      .executeTakeFirst();
    if (inUse)
      throw new AdminRefused(409, 'Delete the models of this provider first', 'provider_in_use');
    await tx.deleteFrom('model_providers').where('id', '=', id).execute();
    await audit(
      tx,
      ctx,
      actor,
      'model_provider.deleted',
      { type: 'model_provider', id },
      {
        name: row.name,
        integration: row.integration,
      },
    );
  });
}

export async function listModels(ctx: ServerContext, providerId?: string): Promise<ConsoleModel[]> {
  const rows = await ctx.db
    .selectFrom('organization_models')
    .innerJoin('model_providers', 'model_providers.id', 'organization_models.model_provider_id')
    .selectAll('organization_models')
    .select([
      'model_providers.name as provider_name',
      'model_providers.integration as provider_integration',
      'model_providers.enabled as provider_enabled',
    ])
    .$if(providerId !== undefined, (query) =>
      query.where('organization_models.model_provider_id', '=', providerId!),
    )
    .orderBy('organization_models.sort_order')
    .orderBy('organization_models.display_name')
    .execute();
  return rows.map(
    (row): ConsoleModel => ({
      id: row.id,
      displayName: row.display_name,
      contract: row.contract,
      availability: row.provider_enabled ? 'available' : 'provider_disabled',
      costWeight: row.cost_weight,
      enabled: row.enabled,
      sortOrder: row.sort_order,
      revision: row.revision,
      provider: {
        id: row.model_provider_id,
        name: row.provider_name,
        integration: row.provider_integration,
        enabled: row.provider_enabled,
      },
      providerModel: row.provider_model,
      updatedAt: row.updated_at.getTime(),
    }),
  );
}

async function modelById(ctx: ServerContext, id: string): Promise<ConsoleModel> {
  const model = (await listModels(ctx)).find((entry) => entry.id === id);
  if (!model) throw new AdminRefused(404, 'No such model', 'not_found');
  return model;
}

/** Name, allowance weight, order and whether people can pick it; never what it runs on. */
export async function updateModel(
  ctx: ServerContext,
  actor: AdminActor,
  id: string,
  input: unknown,
): Promise<ConsoleModel> {
  const patch = z
    .strictObject({
      expectedRevision: revision,
      displayName: z.string().trim().min(1).max(150).optional(),
      costWeight: z.number().finite().nonnegative().max(10000).optional(),
      enabled: z.boolean().optional(),
      sortOrder: z.number().int().min(0).max(100000).optional(),
    })
    .parse(input);
  await ctx.db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom('organization_models')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AdminRefused(404, 'No such model', 'not_found');
    if (row.revision !== patch.expectedRevision) throw conflict();
    const next = {
      display_name: patch.displayName ?? row.display_name,
      cost_weight: patch.costWeight ?? row.cost_weight,
      enabled: patch.enabled ?? row.enabled,
      sort_order: patch.sortOrder ?? row.sort_order,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter(
      (key) => next[key] !== row[key],
    );
    if (changed.length === 0) return;
    await tx
      .updateTable('organization_models')
      .set({ ...next, revision: row.revision + 1, updated_at: ctx.now() })
      .where('id', '=', id)
      .execute();
    await catalogChanged(tx);
    await audit(
      tx,
      ctx,
      actor,
      'model.updated',
      { type: 'model', id },
      {
        name: next.display_name,
        changed,
      },
    );
  });
  return modelById(ctx, id);
}

/** People can no longer pick it; its usage stays, recorded under its id. */
export async function deleteModel(
  ctx: ServerContext,
  actor: AdminActor,
  id: string,
  input: unknown,
): Promise<void> {
  const { expectedRevision } = z.strictObject({ expectedRevision: revision }).parse(input);
  await ctx.db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom('organization_models')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AdminRefused(404, 'No such model', 'not_found');
    if (row.revision !== expectedRevision) throw conflict();
    await tx.deleteFrom('organization_models').where('id', '=', id).execute();
    await catalogChanged(tx);
    await audit(
      tx,
      ctx,
      actor,
      'model.deleted',
      { type: 'model', id },
      {
        name: row.display_name,
        providerModel: row.provider_model,
      },
    );
  });
}

/** Expired model-list snapshots, and idempotency answers older than a day. */
export async function purgeModelAdministration(
  ctx: ServerContext,
): Promise<{ snapshots: number; mutations: number }> {
  const now = ctx.now();
  const snapshots = await ctx.db
    .deleteFrom('provider_catalog_snapshots')
    .where('expires_at', '<=', now)
    .executeTakeFirst();
  const mutations = await ctx.db
    .deleteFrom('admin_mutations')
    .where('created_at', '<', new Date(now.getTime() - MUTATION_TTL_MS))
    .executeTakeFirst();
  return {
    snapshots: Number(snapshots.numDeletedRows),
    mutations: Number(mutations.numDeletedRows),
  };
}
