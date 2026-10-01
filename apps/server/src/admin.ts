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

// Administration from the command line, beside the admin console (design
// §3.2): people, model providers, models, quotas, usage. Reads the same environment
// as the server. The changes are administration.ts's, the console's own, so
// the same rules hold and the same audit entries are written.
//
//   node dist/admin.js <group> <command> [options]

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import {
  type AdminActor,
  AdminRefused,
  setQuota,
  unlinkIdentity,
  updateUser,
} from './administration.js';
import { loadConfig } from './config.js';
import type { ServerContext } from './context.js';
import { localSecretBox } from './crypto/secret-box.js';
import { connectPostgres } from './db/database.js';
import { migrateToLatest } from './db/migrations.js';
import {
  createModelProvider,
  listModelProviders,
  listModels,
  modelProviderById,
  updateModel,
  updateModelProvider,
} from './model-management.js';
import { discoverModels, validatedDraft } from './admin-console/model-catalog.js';
import { randomUUID } from 'node:crypto';
import type { Database } from './db/schema.js';
import { z } from 'zod';

const USAGE = `Usage: node dist/admin.js <group> <command> [options]

  users list
  users role <email> member|org_admin
  users deactivate <email>            (signs every device out at once)
  users activate <email>
  users links <email>                 (which provider accounts sign in as this person)
  users unlink <email> <provider>     (after a sign-in was refused as identity_conflict:
                                       the next sign-in from that provider links afresh;
                                       devices signed in through it are signed out)
  providers list
  providers add --integration <id> [--name <name>] --config '<json>' --credential-file <path>
                --models <comma-separated provider model ids, as the provider lists them>
                (the credential file holds {"apiKey": "…"}, or for vertex
                 {"serviceAccount": <the downloaded service-account key JSON>})
  providers enable|disable <provider id>
  models list
  models enable|disable <model ID>
  quotas list
  quotas set --scope user_default|user [--email <e>] --period week|month --limit <units>
  usage summary [--days <n>]
`;

class UsageError extends Error {}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === '') throw new UsageError(`Missing ${what}`);
  return value;
}

function json(value: string | undefined, what: string): Record<string, unknown> {
  if (value === undefined) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new UsageError(`${what} must be a JSON object`);
  }
}

async function userByEmail(db: Kysely<Database>, email: string) {
  const user = await db
    .selectFrom('users')
    .selectAll()
    .where('email', '=', email.toLowerCase())
    .executeTakeFirst();
  if (!user) throw new UsageError(`No user with email ${email}`);
  return user;
}

/** A number option: finite, not negative, whole when asked. */
function numberOption(
  value: string | undefined,
  what: string,
  fallback: number,
  integer = false,
): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    throw new UsageError(`${what} must be a non-negative ${integer ? 'whole number' : 'number'}`);
  }
  return parsed;
}

export async function runAdmin(
  ctx: ServerContext,
  argv: readonly string[],
  out: (line: string) => void,
): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      integration: { type: 'string' },
      models: { type: 'string' },
      config: { type: 'string' },
      'credential-file': { type: 'string' },
      scope: { type: 'string' },
      email: { type: 'string' },
      period: { type: 'string' },
      limit: { type: 'string' },
      days: { type: 'string' },
    },
  });
  const [group, command, subject, extra] = positionals;
  const { db } = ctx;
  const now = ctx.now();
  const actor: AdminActor = { userId: null, via: 'admin-cli' };

  switch (`${group} ${command}`) {
    case 'users list': {
      const rows = await db
        .selectFrom('users')
        .select(['email', 'name', 'org_role', 'status', 'last_login_at'])
        .orderBy('email')
        .execute();
      for (const row of rows) {
        out(
          `${row.email}\t${row.name}\t${row.org_role}\t${row.status}\t${row.last_login_at?.toISOString() ?? '-'}`,
        );
      }
      return;
    }
    case 'users role': {
      const role = need(extra, 'role');
      if (role !== 'member' && role !== 'org_admin')
        throw new UsageError('role must be member or org_admin');
      const user = await userByEmail(db, need(subject, 'email'));
      await updateUser(ctx, actor, user.id, { orgRole: role });
      out(`${user.email} is now ${role}`);
      return;
    }
    case 'users deactivate':
    case 'users activate': {
      const user = await userByEmail(db, need(subject, 'email'));
      const status = command === 'deactivate' ? 'deactivated' : 'active';
      await updateUser(ctx, actor, user.id, { status });
      out(`${user.email} is ${status}`);
      return;
    }
    case 'users links': {
      const user = await userByEmail(db, need(subject, 'email'));
      const rows = await db
        .selectFrom('identity_links')
        .select(['provider', 'subject', 'created_at'])
        .where('user_id', '=', user.id)
        .orderBy('provider')
        .execute();
      for (const row of rows)
        out(`${row.provider}\t${row.subject}\t${row.created_at.toISOString()}`);
      return;
    }
    case 'users unlink': {
      const user = await userByEmail(db, need(subject, 'email'));
      const provider = need(extra, 'provider');
      await unlinkIdentity(ctx, actor, user.id, provider);
      out(`${user.email} is no longer linked to ${provider}`);
      return;
    }
    case 'providers list': {
      for (const provider of await listModelProviders(ctx))
        out(
          `${provider.id}\t${provider.name}\t${provider.integration}\t${provider.enabled ? 'enabled' : 'disabled'}\t${provider.modelCount} models`,
        );
      return;
    }
    case 'providers add': {
      const draftInput = {
        integration: need(values.integration, '--integration'),
        ...(values.name ? { name: values.name } : {}),
        config: json(values.config, '--config'),
        credential: json(
          await readFile(need(values['credential-file'], '--credential-file'), 'utf8'),
          'credential',
        ),
      };
      const ids = need(values.models, '--models')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      // The models come from the provider's own list, as in the console.
      const catalog = await discoverModels(ctx, actor, validatedDraft(draftInput), { fetch });
      if (catalog.status !== 'ready')
        throw new UsageError(`The provider's model list could not be read (${catalog.reason})`);
      const unknown = ids.filter((id) => !catalog.models.some((model) => model.id === id));
      if (unknown.length > 0)
        throw new UsageError(`Not in the provider's model list: ${unknown.join(', ')}`);
      const result = await createModelProvider(ctx, actor, {
        draft: draftInput,
        publish: {
          snapshotId: catalog.snapshotId,
          selections: ids.map((id) => ({ id })),
          idempotencyKey: randomUUID(),
        },
      });
      out(
        `Added ${result.providerName} (${result.providerId}) with ${result.modelIds.length} models`,
      );
      return;
    }
    case 'providers enable':
    case 'providers disable': {
      const row = await modelProviderById(ctx, need(subject, 'provider id'));
      await updateModelProvider(
        ctx,
        actor,
        row.id,
        { expectedRevision: row.revision, enabled: command === 'enable' },
        { fetch },
      );
      out(`${row.name} ${command}d`);
      return;
    }
    case 'models list': {
      for (const m of await listModels(ctx))
        out(
          `${m.id}\t${m.displayName}\t${m.provider.name}\t${m.providerModel}\t${m.enabled ? 'enabled' : 'disabled'}`,
        );
      return;
    }
    case 'models enable':
    case 'models disable': {
      const model = (await listModels(ctx)).find((m) => m.id === subject);
      if (!model) throw new UsageError('Model not found');
      await updateModel(ctx, actor, model.id, {
        expectedRevision: model.revision,
        enabled: command === 'enable',
      });
      out(`${model.displayName} ${command}d`);
      return;
    }
    case 'quotas list': {
      const rows = await db
        .selectFrom('quotas')
        .leftJoin('users', 'users.id', 'quotas.scope_id')
        .select(['quotas.scope', 'quotas.period', 'quotas.limit_units', 'users.email'])
        .execute();
      for (const row of rows)
        out(`${row.scope}\t${row.email ?? '(everyone)'}\t${row.period}\t${row.limit_units}`);
      return;
    }
    case 'quotas set': {
      const scope = need(values.scope, '--scope');
      if (scope !== 'user_default' && scope !== 'user')
        throw new UsageError('scope must be user_default or user');
      const period = need(values.period, '--period');
      if (period !== 'week' && period !== 'month')
        throw new UsageError('period must be week or month');
      const limit = Number(need(values.limit, '--limit'));
      if (!Number.isFinite(limit) || limit < 0)
        throw new UsageError('limit must be a non-negative number');
      await setQuota(
        ctx,
        actor,
        scope === 'user'
          ? { scope, userId: (await userByEmail(db, need(values.email, '--email'))).id }
          : { scope },
        period,
        limit,
      );
      out(`Quota ${scope} ${period}: ${limit}`);
      return;
    }
    case 'usage summary': {
      const days = numberOption(values.days, '--days', 7);
      const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      const rows = await db
        .selectFrom('model_usage')
        .innerJoin('users', 'users.id', 'model_usage.user_id')
        .select([
          'users.email',
          'model_usage.model_id',
          sql<number>`count(*)`.as('requests'),
          sql<number>`sum(model_usage.input_tokens)`.as('input'),
          sql<number>`sum(model_usage.output_tokens)`.as('output'),
          sql<number>`round(sum(model_usage.weighted_units)::numeric, 1)`.as('units'),
        ])
        .where('model_usage.at', '>=', since)
        .groupBy(['users.email', 'model_usage.model_id'])
        .orderBy('units', 'desc')
        .execute();
      out(`Since ${since.toISOString()}`);
      for (const row of rows)
        out(
          `${row.email}\t${row.model_id}\t${row.requests} requests\t${row.input} in\t${row.output} out\t${row.units} units`,
        );
      return;
    }
    default:
      throw new UsageError(USAGE);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  const config = loadConfig(process.env);
  const db = connectPostgres(config.databaseUrl);
  try {
    await migrateToLatest(db);
    await runAdmin(
      { config, db, secrets: localSecretBox(config.masterKey), now: () => new Date() },
      process.argv.slice(2),
      (line) => console.log(line),
    );
  } catch (error) {
    console.error(
      error instanceof UsageError || error instanceof AdminRefused
        ? error.message
        : error instanceof z.ZodError
          ? `Invalid input: ${error.issues.map((issue) => `${issue.path.join('.') || 'value'} ${issue.message}`).join('; ')}`
          : error,
    );
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}
