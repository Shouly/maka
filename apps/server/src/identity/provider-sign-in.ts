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

// Handing a login transaction to an identity provider, shared by the
// desktop's sign-in and the admin console's.

import type { ServerContext } from '../context.js';
import { newOpaqueToken } from '../crypto/tokens.js';
import type { IdentityProvider } from './providers/types.js';

/** Where a provider sends the browser back: the address registered with it. */
export function providerCallbackUrl(ctx: ServerContext, provider: IdentityProvider): string {
  return provider.callbackUrl ?? `${ctx.config.publicUrl}/login/${provider.id}/callback`;
}

/**
 * Bind a login transaction to a provider and return where to send the
 * browser; undefined once the transaction has expired or was used.
 */
export async function beginProviderSignIn(
  ctx: ServerContext,
  provider: IdentityProvider,
  txnId: string,
): Promise<string | undefined> {
  const providerState = newOpaqueToken();
  const nonce = newOpaqueToken();
  const updated = await ctx.db
    .updateTable('login_transactions')
    .set({ provider: provider.id, provider_state: providerState, nonce })
    .where('id', '=', txnId)
    .where('consumed_at', 'is', null)
    .where('expires_at', '>', ctx.now())
    .executeTakeFirst();
  if (Number(updated.numUpdatedRows) !== 1) return undefined;
  return provider.authorizationUrl({
    state: providerState,
    nonce,
    redirectUri: providerCallbackUrl(ctx, provider),
  });
}
