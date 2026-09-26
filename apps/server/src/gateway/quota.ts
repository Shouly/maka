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

// Quotas (design §5.2): a weekly or monthly allowance in weighted units, per
// person — the organization's default, or one set for that person. Checked
// before the request goes upstream, so concurrent requests can overshoot a
// little — the design accepts that.

import { sql } from 'kysely';
import type { ServerContext } from '../context.js';
import type { QuotasTable } from '../db/schema.js';

export type QuotaPeriod = QuotasTable['period'];

/** Periods start at 00:00 UTC: Monday for a week, the 1st for a month. */
export function periodStart(period: QuotaPeriod, now: Date): Date {
  if (period === 'month') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const day = now.getUTCDay();
  const sinceMonday = (day + 6) % 7;
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday),
  );
}

export function nextPeriodStart(period: QuotaPeriod, now: Date): Date {
  const start = periodStart(period, now);
  if (period === 'month')
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
}

export interface QuotaExceeded {
  readonly retryAt: number;
}

/** The exhausted allowance that resets last, or undefined when the request may proceed. */
export async function exceededQuota(
  ctx: ServerContext,
  userId: string,
): Promise<QuotaExceeded | undefined> {
  const now = ctx.now();
  const rows = await ctx.db
    .selectFrom('quotas')
    .selectAll()
    .where((eb) =>
      eb.or([
        eb('scope', '=', 'user_default'),
        eb.and([eb('scope', '=', 'user'), eb('scope_id', '=', userId)]),
      ]),
    )
    .execute();
  // A person's own allowance replaces the default for the same period.
  const limits = new Map<QuotaPeriod, number>();
  for (const row of rows) {
    if (row.scope === 'user_default' && !limits.has(row.period))
      limits.set(row.period, row.limit_units);
  }
  for (const row of rows) {
    if (row.scope === 'user') limits.set(row.period, row.limit_units);
  }
  // Every allowance is checked: with the week and the month both used up, the
  // request can go again only when the later of the two resets.
  let exceeded: QuotaExceeded | undefined;
  for (const [period, limit] of limits) {
    const used = await ctx.db
      .selectFrom('usage_events')
      .select(sql<number>`coalesce(sum(weighted_units), 0)`.as('units'))
      .where('user_id', '=', userId)
      .where('at', '>=', periodStart(period, now))
      .executeTakeFirstOrThrow();
    if (Number(used.units) >= limit) {
      const retryAt = nextPeriodStart(period, now).getTime();
      if (!exceeded || retryAt > exceeded.retryAt) exceeded = { retryAt };
    }
  }
  return exceeded;
}
