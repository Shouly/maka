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

// The organization's model list as desktops read it (`GET /model/catalog`):
// every model open to people, with the contract it is called under. A model
// whose provider is switched off stays listed, unavailable, so conversations
// on it keep its name.

import { GATEWAY_SCHEMA_VERSION, type PlatformModelCatalog } from '@maka/platform-protocol';
import type { ServerContext } from '../context.js';
import { listModels } from '../model-management.js';

export async function organizationCatalog(ctx: ServerContext): Promise<PlatformModelCatalog> {
  // One snapshot: never a new revision beside an old list.
  return ctx.db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      const state = await tx
        .selectFrom('model_catalog_state')
        .select('revision')
        .where('id', '=', 1)
        .executeTakeFirstOrThrow();
      const models = await listModels({ ...ctx, db: tx });
      return {
        schemaVersion: GATEWAY_SCHEMA_VERSION,
        revision: String(state.revision),
        models: models
          .filter((model) => model.enabled)
          .map(({ id, displayName, contract, availability }) => ({
            id,
            displayName,
            contract,
            availability,
          })),
      };
    });
}
