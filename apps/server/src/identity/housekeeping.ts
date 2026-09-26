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

// Rows a sign-in leaves behind once they can no longer matter. Anyone can
// start a sign-in, so unfinished ones must not pile up forever. Expired rows
// are kept a day first: a code or refresh token presented again shortly after
// it expired is still recognised as a replay rather than as unknown.

import type { ServerContext } from '../context.js';

const KEEP_EXPIRED_MS = 24 * 60 * 60 * 1000;
export const HOUSEKEEPING_INTERVAL_MS = 60 * 60 * 1000;

export async function purgeExpiredSignIns(
  ctx: ServerContext,
): Promise<{ transactions: number; refreshTokens: number }> {
  const before = new Date(ctx.now().getTime() - KEEP_EXPIRED_MS);
  // Their authorization codes go with them (ON DELETE CASCADE).
  const transactions = await ctx.db
    .deleteFrom('login_transactions')
    .where('expires_at', '<', before)
    .executeTakeFirst();
  const refreshTokens = await ctx.db
    .deleteFrom('refresh_tokens')
    .where('expires_at', '<', before)
    .executeTakeFirst();
  return {
    transactions: Number(transactions.numDeletedRows),
    refreshTokens: Number(refreshTokens.numDeletedRows),
  };
}
