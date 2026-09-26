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
import type { OrgRole } from '@maka/platform-protocol';

type CreatedAt = ColumnType<Date, Date | undefined, never>;

export interface UsersTable {
  id: string;
  /** Lowercased; unique — one email is one person (D4). */
  email: string;
  name: string;
  avatar_url: string | null;
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

export type UpstreamKind =
  | 'anthropic'
  | 'vertex'
  | 'bedrock'
  | 'openai'
  | 'azure-openai'
  | 'openai-compatible'
  | 'gemini';
export type ModelProtocol = 'anthropic' | 'openai' | 'gemini';

export interface UpstreamsTable {
  id: string;
  name: string;
  kind: UpstreamKind;
  /** Non-secret settings: region, project, base URL. */
  config: ColumnType<Record<string, unknown>, string, string>;
  /** The provider credential, sealed (§10). */
  credential_sealed: string | null;
  enabled: boolean;
  created_at: CreatedAt;
  updated_at: Date;
}

/** A model as people see it (everyone, once enabled); where its requests go lives in model_routes. */
export interface ModelsTable {
  id: string;
  protocol: ModelProtocol;
  display_name: string;
  capabilities: ColumnType<Record<string, unknown>, string, string>;
  cost_weight: number;
  enabled: boolean;
  sort_order: number;
  created_at: CreatedAt;
  updated_at: Date;
}

export interface ModelRoutesTable {
  model_id: string;
  upstream_id: string;
  upstream_model: string;
  /** Lower goes first; the next one takes over when an upstream fails before answering. */
  priority: number;
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

export interface UsageEventsTable {
  id: Generated<string>;
  at: CreatedAt;
  user_id: string;
  session_id: string | null;
  model_id: string;
  upstream_id: string | null;
  protocol: ModelProtocol;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  weighted_units: number;
  status: 'ok' | 'error' | 'cancelled';
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
  audit_events: AuditEventsTable;
  upstreams: UpstreamsTable;
  models: ModelsTable;
  model_routes: ModelRoutesTable;
  quotas: QuotasTable;
  usage_events: UsageEventsTable;
}
