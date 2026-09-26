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

// Process entry: read configuration, migrate the database, serve.

import { buildServer } from './app.js';
import { loadConfig } from './config.js';
import type { ServerContext } from './context.js';
import { localSecretBox } from './crypto/secret-box.js';
import { connectPostgres } from './db/database.js';
import { migrateToLatest } from './db/migrations.js';
import { AccessTokens } from './identity/access-tokens.js';
import { HOUSEKEEPING_INTERVAL_MS, purgeExpiredSignIns } from './identity/housekeeping.js';
import { providersFromConfig } from './identity/providers-from-config.js';

const config = loadConfig(process.env);
// The model SDKs read these from the environment on their own (extra headers,
// another base URL or bearer token for every upstream call). The upstreams'
// settings live in the database; nothing here may add to them.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('ANTHROPIC_') || name === 'CLOUD_ML_REGION') delete process.env[name];
}
const db = connectPostgres(config.databaseUrl);
await migrateToLatest(db);
const ctx: ServerContext = {
  config,
  db,
  secrets: localSecretBox(config.masterKey),
  now: () => new Date(),
};
const accessTokens = new AccessTokens(ctx);
await accessTokens.initialize();
const app = await buildServer(ctx, {
  providers: providersFromConfig(config),
  accessTokens,
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
});

const housekeeping = setInterval(() => {
  purgeExpiredSignIns(ctx).catch((error: unknown) =>
    app.log.error({ err: error }, 'housekeeping failed'),
  );
}, HOUSEKEEPING_INTERVAL_MS);
housekeeping.unref();

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  clearInterval(housekeeping);
  await app.close();
  await db.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
