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
// §3.2): people, upstreams, models, quotas, usage. Reads the same environment
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
  addModelRoute,
  createModel,
  createUpstream,
  setQuota,
  unlinkIdentity,
  updateModel,
  updateUpstream,
  updateUser,
} from './administration.js';
import { loadConfig } from './config.js';
import type { ServerContext } from './context.js';
import { localSecretBox } from './crypto/secret-box.js';
import { connectPostgres } from './db/database.js';
import { migrateToLatest } from './db/migrations.js';
import type { ConsoleUpstreamKind } from './admin-console/types.js';
import type { Database } from './db/schema.js';

const USAGE = `Usage: node dist/admin.js <group> <command> [options]

  users list
  users role <email> member|org_admin
  users deactivate <email>            (signs every device out at once)
  users activate <email>
  users links <email>                 (which provider accounts sign in as this person)
  users unlink <email> <provider>     (after a sign-in was refused as identity_conflict:
                                       the next sign-in from that provider links afresh;
                                       devices signed in through it are signed out)
  upstreams list
  upstreams add --name <n> --kind anthropic|vertex|openrouter --config '<json>' --credential-file <path>
               anthropic: config {"baseUrl"?}, credential file {"apiKey": "..."}
               vertex:    config {"projectId", "region"}, credential file {"serviceAccount": <the GCP key JSON>}
  upstreams enable|disable <name>
  models list
  models add --id <id> --protocol anthropic --name <display name>
             [--capabilities '<json>'] [--cost-weight <n>] [--sort <n>]
  models route --model <id> --upstream <name> --upstream-model <name> [--priority <n>]
  models enable|disable <id>
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      kind: { type: 'string' },
      config: { type: 'string' },
      'credential-file': { type: 'string' },
      id: { type: 'string' },
      protocol: { type: 'string' },
      capabilities: { type: 'string' },
      'cost-weight': { type: 'string' },
      sort: { type: 'string' },
      model: { type: 'string' },
      upstream: { type: 'string' },
      'upstream-model': { type: 'string' },
      priority: { type: 'string' },
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
    case 'upstreams list': {
      const rows = await db
        .selectFrom('upstreams')
        .select(['name', 'kind', 'config', 'enabled'])
        .orderBy('name')
        .execute();
      for (const row of rows)
        out(
          `${row.name}\t${row.kind}\t${JSON.stringify(row.config)}\t${row.enabled ? 'enabled' : 'disabled'}`,
        );
      return;
    }
    case 'upstreams add': {
      const name = need(values.name, '--name');
      const kind = need(values.kind, '--kind') as ConsoleUpstreamKind;
      const config = json(values.config, '--config');
      const credentialText = (
        await readFile(need(values['credential-file'], '--credential-file'), 'utf8')
      ).trim();
      let credential: unknown;
      try {
        credential = JSON.parse(credentialText);
      } catch {
        throw new UsageError('The credential file must hold JSON');
      }
      if (!isRecord(config) || !isRecord(credential)) {
        throw new UsageError('The config and the credential must be JSON objects');
      }
      await createUpstream(ctx, actor, { name, kind, config, credential });
      out(`Added upstream ${name} (${kind})`);
      return;
    }
    case 'upstreams enable':
    case 'upstreams disable': {
      const upstream = await db
        .selectFrom('upstreams')
        .select('id')
        .where('name', '=', need(subject, 'name'))
        .executeTakeFirst();
      if (!upstream) throw new UsageError(`No upstream named ${subject}`);
      await updateUpstream(ctx, actor, upstream.id, { enabled: command === 'enable' });
      out(`${subject} ${command}d`);
      return;
    }
    case 'models list': {
      const models = await db
        .selectFrom('models')
        .selectAll()
        .orderBy('sort_order')
        .orderBy('id')
        .execute();
      const routes = await db
        .selectFrom('model_routes')
        .innerJoin('upstreams', 'upstreams.id', 'model_routes.upstream_id')
        .select([
          'model_routes.model_id',
          'upstreams.name',
          'model_routes.upstream_model',
          'model_routes.priority',
        ])
        .orderBy('model_routes.priority')
        .execute();
      for (const model of models) {
        const via = routes
          .filter((route) => route.model_id === model.id)
          .map((route) => `${route.name}:${route.upstream_model}`)
          .join(' > ');
        out(
          `${model.id}\t${model.protocol}\t${model.display_name}\t${model.enabled ? 'enabled' : 'disabled'}\t${via || '(no route)'}`,
        );
      }
      return;
    }
    case 'models add': {
      const id = need(values.id, '--id');
      await createModel(ctx, actor, {
        id,
        protocol: need(values.protocol, '--protocol') as 'anthropic',
        displayName: need(values.name, '--name'),
        capabilities: json(values.capabilities, '--capabilities'),
        costWeight: numberOption(values['cost-weight'], '--cost-weight', 1),
        sortOrder: numberOption(values.sort, '--sort', 0, true),
      });
      out(`Added model ${id}`);
      return;
    }
    case 'models route': {
      const modelId = need(values.model, '--model');
      const upstream = await db
        .selectFrom('upstreams')
        .select('id')
        .where('name', '=', need(values.upstream, '--upstream'))
        .executeTakeFirst();
      if (!upstream) throw new UsageError(`No upstream named ${values.upstream}`);
      const upstreamModel = need(values['upstream-model'], '--upstream-model');
      await addModelRoute(ctx, actor, modelId, {
        upstreamId: upstream.id,
        upstreamModel,
        priority: numberOption(values.priority, '--priority', 0, true),
      });
      out(`${modelId} -> ${values.upstream}:${upstreamModel}`);
      return;
    }
    case 'models enable':
    case 'models disable': {
      await updateModel(ctx, actor, need(subject, 'model id'), {
        enabled: command === 'enable',
      });
      out(`${subject} ${command}d`);
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
        .selectFrom('usage_events')
        .innerJoin('users', 'users.id', 'usage_events.user_id')
        .select([
          'users.email',
          'usage_events.model_id',
          sql<number>`count(*)`.as('requests'),
          sql<number>`sum(usage_events.input_tokens)`.as('input'),
          sql<number>`sum(usage_events.output_tokens)`.as('output'),
          sql<number>`round(sum(usage_events.weighted_units)::numeric, 1)`.as('units'),
        ])
        .where('usage_events.at', '>=', since)
        .groupBy(['users.email', 'usage_events.model_id'])
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
      error instanceof UsageError || error instanceof AdminRefused ? error.message : error,
    );
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}
