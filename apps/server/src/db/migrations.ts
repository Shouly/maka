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

// Schema migrations, applied in order at startup. Each migration is a list of
// single statements: PGlite (tests) runs one statement per query.
// Migrations only ever add; a released one is never edited (§10).

import { type Kysely, sql } from 'kysely';
import { type Migration, Migrator } from 'kysely/migration';
import type { Database } from './schema.js';

function statements(...queries: string[]): Migration {
  return {
    async up(db) {
      for (const query of queries) await sql.raw(query).execute(db);
    },
  };
}

const MIGRATIONS: Record<string, Migration> = {
  '0001_identity': statements(
    `CREATE TABLE users (
      id uuid PRIMARY KEY,
      email text NOT NULL UNIQUE CHECK (email = lower(email)),
      name text NOT NULL,
      avatar_url text,
      org_role text NOT NULL CHECK (org_role IN ('member', 'org_admin')),
      status text NOT NULL CHECK (status IN ('active', 'deactivated')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL,
      last_login_at timestamptz
    )`,
    `CREATE TABLE identity_links (
      provider text NOT NULL,
      subject text NOT NULL,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (provider, subject)
    )`,
    `CREATE INDEX identity_links_user ON identity_links (user_id)`,
    `CREATE TABLE login_transactions (
      id text PRIMARY KEY,
      client_id text NOT NULL,
      redirect_uri text NOT NULL,
      code_challenge text NOT NULL,
      client_state text NOT NULL,
      device_name text,
      provider text,
      provider_state text UNIQUE,
      nonce text,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE authorization_codes (
      code_hash text PRIMARY KEY,
      transaction_id text NOT NULL REFERENCES login_transactions (id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      client_id text NOT NULL,
      redirect_uri text NOT NULL,
      code_challenge text NOT NULL,
      provider text NOT NULL,
      device_name text,
      auth_time timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      -- The session the code bought; revoked if the code is presented again.
      session_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE device_sessions (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      client_id text NOT NULL,
      device_name text,
      provider text NOT NULL,
      auth_time timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz NOT NULL,
      revoked_at timestamptz,
      revoke_reason text
    )`,
    `CREATE INDEX device_sessions_user ON device_sessions (user_id)`,
    `CREATE TABLE refresh_tokens (
      token_hash text PRIMARY KEY,
      session_id uuid NOT NULL REFERENCES device_sessions (id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      rotated_at timestamptz,
      -- What it was exchanged for, so a retry within the grace can retire it unused.
      successor_hash text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX refresh_tokens_session ON refresh_tokens (session_id)`,
    `CREATE TABLE signing_keys (
      kid text PRIMARY KEY,
      public_jwk jsonb NOT NULL,
      private_jwk_sealed text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      retired_at timestamptz
    )`,
    `CREATE TABLE audit_events (
      id bigserial PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      actor_user_id uuid,
      action text NOT NULL,
      target_type text,
      target_id text,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      ip text
    )`,
    `CREATE INDEX audit_events_at ON audit_events (at DESC)`,
  ),
  '0002_gateway': statements(
    `CREATE TABLE upstreams (
      id uuid PRIMARY KEY,
      name text NOT NULL UNIQUE,
      kind text NOT NULL CHECK (kind IN ('anthropic', 'vertex', 'bedrock', 'openai', 'azure-openai', 'openai-compatible', 'gemini')),
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      credential_sealed text,
      enabled boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL
    )`,
    `CREATE TABLE models (
      id text PRIMARY KEY,
      protocol text NOT NULL CHECK (protocol IN ('anthropic', 'openai', 'gemini')),
      display_name text NOT NULL,
      capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
      -- Postgres ranks NaN above every number, so ">= 0" alone lets it
      -- through; one NaN weight would make every later sum NaN and switch
      -- quotas off.
      cost_weight double precision NOT NULL DEFAULT 1
        CHECK (cost_weight >= 0 AND cost_weight <> 'NaN'::float8 AND cost_weight < 'Infinity'::float8),
      enabled boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL
    )`,
    `CREATE TABLE model_routes (
      model_id text NOT NULL REFERENCES models (id) ON DELETE CASCADE,
      upstream_id uuid NOT NULL REFERENCES upstreams (id) ON DELETE CASCADE,
      upstream_model text NOT NULL,
      priority integer NOT NULL DEFAULT 0,
      PRIMARY KEY (model_id, upstream_id)
    )`,
    `CREATE TABLE quotas (
      id uuid PRIMARY KEY,
      scope text NOT NULL CHECK (scope IN ('user_default', 'user')),
      scope_id uuid,
      period text NOT NULL CHECK (period IN ('week', 'month')),
      limit_units double precision NOT NULL
        CHECK (limit_units >= 0 AND limit_units <> 'NaN'::float8 AND limit_units < 'Infinity'::float8),
      updated_at timestamptz NOT NULL,
      CHECK ((scope = 'user_default') = (scope_id IS NULL))
    )`,
    `CREATE UNIQUE INDEX quotas_scope ON quotas (scope, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid), period)`,
    `CREATE TABLE usage_events (
      id bigserial PRIMARY KEY,
      at timestamptz NOT NULL DEFAULT now(),
      user_id uuid NOT NULL,
      session_id uuid,
      model_id text NOT NULL,
      upstream_id uuid,
      protocol text NOT NULL,
      input_tokens bigint NOT NULL DEFAULT 0,
      output_tokens bigint NOT NULL DEFAULT 0,
      cache_write_tokens bigint NOT NULL DEFAULT 0,
      cache_read_tokens bigint NOT NULL DEFAULT 0,
      weighted_units double precision NOT NULL DEFAULT 0
        CHECK (weighted_units <> 'NaN'::float8 AND weighted_units < 'Infinity'::float8),
      status text NOT NULL CHECK (status IN ('ok', 'error', 'cancelled')),
      http_status integer,
      latency_ms integer,
      client_version text,
      upstream_request_id text
    )`,
    // The quota check sums a period's units per request: answered from the index.
    `CREATE INDEX usage_events_user_at ON usage_events (user_id, at) INCLUDE (weighted_units)`,
  ),
};

export async function migrateToLatest(db: Kysely<Database>): Promise<void> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => MIGRATIONS },
  });
  const { error, results } = await migrator.migrateToLatest();
  const failed = results?.find((result) => result.status === 'Error');
  if (error || failed) {
    throw new Error(
      `Database migration ${failed?.migrationName ?? ''} failed: ${
        error instanceof Error ? error.message : String(error ?? 'unknown error')
      }`,
    );
  }
}
