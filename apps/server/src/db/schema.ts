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

// Table shapes as Kysely sees them. The SQL in migrations.ts is the source of
// truth; these types must follow it.

import type { ColumnType, Generated } from 'kysely';
import type {
  ModelApiProtocol,
  ModelExecutionContract,
  ModelIntegrationId,
} from '@maka/core/model-gateway';
import type { OrgRole } from '@maka/platform-protocol';

type CreatedAt = ColumnType<Date, Date | undefined, never>;

export interface UsersTable {
  id: string;
  /** Lowercased; unique — one email is one person (D4). */
  email: string;
  /** The identity provider's, rewritten at every sign-in. */
  name: string;
  avatar_url: string | null;
  /** The name the person set for themselves; shown instead of `name`. */
  profile_name: string | null;
  /** The seed of the generated avatar the person picked; null means initials. */
  avatar_seed: string | null;
  /** What the person asks the assistant to call them. */
  nickname: string | null;
  /** The person's own preferences for the assistant, as they wrote them. */
  preferences: string | null;
  org_role: OrgRole;
  status: 'active' | 'deactivated';
  created_at: CreatedAt;
  updated_at: Date;
  last_login_at: Date | null;
}

export interface IdentityLinksTable {
  provider: string;
  subject: string;
  user_id: string;
  created_at: CreatedAt;
}

/** One desktop sign-in attempt, from `/oauth/authorize` until its code is issued. */
export interface LoginTransactionsTable {
  id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  client_state: string;
  device_name: string | null;
  provider: string | null;
  /** The `state` sent to the identity provider; single use. */
  provider_state: string | null;
  nonce: string | null;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: CreatedAt;
}

export interface AuthorizationCodesTable {
  code_hash: string;
  transaction_id: string;
  user_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  provider: string;
  device_name: string | null;
  auth_time: Date;
  expires_at: Date;
  used_at: Date | null;
  /** The session the code bought; revoked if the code is presented again. */
  session_id: string | null;
  created_at: CreatedAt;
}

export interface DeviceSessionsTable {
  id: string;
  user_id: string;
  client_id: string;
  device_name: string | null;
  provider: string;
  /** When the person last proved themselves at the identity provider; caps refresh (§4.3). */
  auth_time: Date;
  created_at: CreatedAt;
  last_used_at: Date;
  revoked_at: Date | null;
  revoke_reason: string | null;
}

export interface RefreshTokensTable {
  token_hash: string;
  session_id: string;
  expires_at: Date;
  /** Set once the token has been exchanged; a second use is a replay. */
  rotated_at: Date | null;
  /** The token it was exchanged for, so a retry within the grace can retire it unused. */
  successor_hash: string | null;
  created_at: CreatedAt;
}

export interface SigningKeysTable {
  kid: string;
  public_jwk: ColumnType<Record<string, unknown>, string, string>;
  private_jwk_sealed: string;
  created_at: CreatedAt;
  retired_at: Date | null;
}

/** One signed-in browser of the admin console (§3.2). */
export interface AdminSessionsTable {
  id: string;
  /** SHA-256 of the cookie's token; the token itself is never stored. */
  token_hash: string;
  user_id: string;
  /** Sent back on every change the page makes, beside the cookie. */
  csrf_token: string;
  provider: string;
  created_at: CreatedAt;
  last_used_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  ip: string | null;
  user_agent: string | null;
}

export interface AuditEventsTable {
  id: Generated<string>;
  at: CreatedAt;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: ColumnType<Record<string, unknown>, string, string>;
  ip: string | null;
}

/** A provider account: what it is is fixed at creation; name, key and switch are not. */
export interface ModelProvidersTable {
  id: string;
  name: string;
  integration: ModelIntegrationId;
  /** Non-secret settings: a base URL, or Vertex's project and region. */
  config: ColumnType<Record<string, unknown>, string, never>;
  credential_sealed: string;
  enabled: boolean;
  /** Bumped by every change; the console sends it back to change it again. */
  revision: number;
  created_at: CreatedAt;
  updated_at: Date;
}
/** What people pick in Maka: one provider model under one provider, under a contract fixed at publishing. */
export interface OrganizationModelsTable {
  id: string;
  model_provider_id: string;
  /** The provider's own model id. */
  provider_model: string;
  display_name: string;
  contract: ColumnType<ModelExecutionContract, string, never>;
  cost_weight: number;
  enabled: boolean;
  sort_order: number;
  revision: number;
  created_at: CreatedAt;
  updated_at: Date;
}
/** A provider's model list as read for one administrator, kept briefly so publishing never trusts the page. */
export interface ProviderCatalogSnapshotsTable {
  id: string;
  actor_id: string;
  fingerprint: string;
  models: ColumnType<import('../admin-console/types.js').ConsoleCatalogModel[], string, never>;
  expires_at: Date;
  created_at: CreatedAt;
}
export interface ModelCatalogStateTable {
  id: number;
  revision: number;
}
/** The answer to a create or publish, kept a day under its idempotency key. */
export interface AdminMutationsTable {
  id: string;
  actor_id: string;
  fingerprint: string;
  result: ColumnType<Record<string, unknown>, string, never>;
  created_at: CreatedAt;
}

export interface QuotasTable {
  id: string;
  /** `user_default` applies to everyone without a `user` row of their own. */
  scope: 'user_default' | 'user';
  scope_id: string | null;
  period: 'week' | 'month';
  limit_units: number;
  updated_at: Date;
}

/** One forwarded request, written when it ends. */
export interface ModelUsageTable {
  id: string;
  cost_weight: number;
  at: CreatedAt;
  user_id: string;
  session_id: string | null;
  model_id: string;
  model_provider_id: string;
  api_protocol: ModelApiProtocol;
  /** `reported` by the provider, or `estimated` from what was seen of the answer. */
  quality: 'reported' | 'estimated';
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  weighted_units: number;
  /** `incomplete`: the answer began and broke off. */
  status: 'ok' | 'error' | 'cancelled' | 'incomplete';
  http_status: number | null;
  latency_ms: number | null;
  client_version: string | null;
  upstream_request_id: string | null;
}

export interface Database {
  users: UsersTable;
  identity_links: IdentityLinksTable;
  login_transactions: LoginTransactionsTable;
  authorization_codes: AuthorizationCodesTable;
  device_sessions: DeviceSessionsTable;
  refresh_tokens: RefreshTokensTable;
  signing_keys: SigningKeysTable;
  admin_sessions: AdminSessionsTable;
  audit_events: AuditEventsTable;
  model_providers: ModelProvidersTable;
  organization_models: OrganizationModelsTable;
  provider_catalog_snapshots: ProviderCatalogSnapshotsTable;
  model_catalog_state: ModelCatalogStateTable;
  admin_mutations: AdminMutationsTable;
  quotas: QuotasTable;
  model_usage: ModelUsageTable;
}
