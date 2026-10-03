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

// The organization's web service: one Tavily key, checked with Tavily before
// it is kept and saved sealed, and a switch. The console reads and changes
// it; /tools/web-search and /tools/web-fetch use it.

import { type Selectable, sql } from 'kysely';
import { z } from 'zod';
import type { ConsoleWebSearch } from '../admin-console/types.js';
import { type AdminActor, AdminRefused } from '../administration.js';
import { recordAudit } from '../audit.js';
import type { ServerContext } from '../context.js';
import type { WebSearchSettingsTable } from '../db/schema.js';
import { tavilyKeyRefused } from './tavily.js';

export interface WebSearchDeps {
  /** How Tavily is reached; tests stand in for it. */
  readonly fetch: typeof fetch;
}

const SEAL_CONTEXT = 'web-search:tavily';

const patchSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  // Printable ASCII: a pasted zero-width space or line break would otherwise
  // pass the check (the header cannot be sent) and break every search.
  apiKey: z
    .string()
    .trim()
    .max(16384)
    .regex(/^[\x21-\x7E]+$/)
    .optional(),
  enabled: z.boolean().optional(),
});

function view(row: Selectable<WebSearchSettingsTable> | undefined): ConsoleWebSearch {
  return row
    ? {
        provider: row.provider,
        configured: true,
        enabled: row.enabled,
        revision: row.revision,
        updatedAt: row.updated_at.getTime(),
      }
    : { provider: 'tavily', configured: false, enabled: false, revision: 0 };
}

export async function webSearchSettings(ctx: ServerContext): Promise<ConsoleWebSearch> {
  return view(await ctx.db.selectFrom('web_search_settings').selectAll().executeTakeFirst());
}

/** Save a key (the first save needs one) or flip the switch; the first key starts switched on. */
export async function updateWebSearch(
  ctx: ServerContext,
  actor: AdminActor,
  input: unknown,
  deps: WebSearchDeps,
): Promise<ConsoleWebSearch> {
  const patch = patchSchema.parse(input);
  // Asked of Tavily before anything is locked.
  if (patch.apiKey !== undefined && (await tavilyKeyRefused(deps.fetch, patch.apiKey)))
    throw new AdminRefused(400, 'Tavily refused this key', 'credentials_rejected');
  return ctx.db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('web-search-settings'))`.execute(tx);
    const row = await tx.selectFrom('web_search_settings').selectAll().executeTakeFirst();
    if ((row?.revision ?? 0) !== patch.expectedRevision)
      throw new AdminRefused(
        409,
        'This was changed elsewhere; reload and try again',
        'revision_conflict',
      );
    if (!row && patch.apiKey === undefined)
      throw new AdminRefused(400, 'Save a key first', 'invalid_request');
    const enabled = patch.enabled ?? row?.enabled ?? true;
    const changed = [
      ...(patch.apiKey !== undefined ? ['key'] : []),
      ...(row && enabled !== row.enabled ? ['enabled'] : []),
    ];
    if (changed.length === 0) return view(row);
    const values = {
      credential_sealed:
        patch.apiKey !== undefined
          ? ctx.secrets.seal(patch.apiKey, SEAL_CONTEXT)
          : row!.credential_sealed,
      enabled,
      revision: (row?.revision ?? 0) + 1,
      updated_at: ctx.now(),
    };
    const saved = await tx
      .insertInto('web_search_settings')
      .values({ id: 1, provider: 'tavily', ...values })
      .onConflict((conflict) => conflict.column('id').doUpdateSet(values))
      .returningAll()
      .executeTakeFirstOrThrow();
    await recordAudit(
      tx,
      {
        action: 'web_search.updated',
        actorUserId: actor.userId,
        targetType: 'web_search',
        targetId: 'tavily',
        detail: { changed, enabled, via: actor.via },
        ...(actor.ip ? { ip: actor.ip } : {}),
      },
      ctx.now(),
    );
    return view(saved);
  });
}

/** The key to search with, or why there is none. */
export async function webSearchKey(
  ctx: ServerContext,
): Promise<{ readonly key: string } | { readonly unavailable: 'not_configured' | 'disabled' }> {
  const row = await ctx.db.selectFrom('web_search_settings').selectAll().executeTakeFirst();
  if (!row) return { unavailable: 'not_configured' };
  if (!row.enabled) return { unavailable: 'disabled' };
  return { key: ctx.secrets.open(row.credential_sealed, SEAL_CONTEXT) };
}
