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

// What the admin console's API answers (`/admin/api`), shared with the page
// that reads it: types, and the one header name both sides must agree on.
// Times are epoch milliseconds.

export type ConsoleOrgRole = 'member' | 'org_admin';
export type ConsoleUserStatus = 'active' | 'deactivated';
export type ConsoleQuotaPeriod = 'week' | 'month';
import type { ModelIntegrationId, ModelExecutionContract } from '@maka/core/model-gateway';

/** Why a sign-in went back to the sign-in page instead of into the console (`?error=`). */
export type ConsoleSignInFailure =
  | 'expired'
  | 'cancelled'
  | 'not_admin'
  | 'email_not_verified'
  | 'domain_not_allowed'
  | 'account_deactivated'
  | 'identity_conflict'
  | 'provider_error';

/** The header every change the page makes carries, beside the cookie. */
export const CONSOLE_CSRF_HEADER = 'x-maka-csrf';

export interface ConsoleSession {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
    readonly avatarUrl?: string;
  };
  readonly csrfToken: string;
  /** The server's public address, as the desktop app is told to use it. */
  readonly serverUrl: string;
  readonly expiresAt: number;
}

export interface ConsoleUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl?: string;
  readonly orgRole: ConsoleOrgRole;
  readonly status: ConsoleUserStatus;
  readonly createdAt: number;
  readonly lastLoginAt: number | null;
  /** Desktops signed in now. */
  readonly activeDevices: number;
}

export interface ConsoleIdentityLink {
  readonly provider: string;
  readonly subject: string;
  readonly createdAt: number;
}

export interface ConsoleDevice {
  readonly id: string;
  readonly deviceName: string | null;
  readonly provider: string;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly revokedAt: number | null;
  readonly revokeReason: string | null;
  /** Not signed out, and signed in recently enough to keep refreshing. */
  readonly signedIn: boolean;
}

/** One allowance as it applies to a person now. */
export interface ConsoleQuotaUsage {
  readonly period: ConsoleQuotaPeriod;
  /** Null: no allowance for this period, so no limit. */
  readonly limit: number | null;
  /** Whose limit it is: the person's own, the organization's default, or neither. */
  readonly source: 'user' | 'default' | 'none';
  readonly used: number;
  readonly resetsAt: number;
}

export interface ConsoleUserDetail extends ConsoleUser {
  readonly links: readonly ConsoleIdentityLink[];
  /** Signed in now first, then the most recently ended. */
  readonly devices: readonly ConsoleDevice[];
  readonly quotas: readonly ConsoleQuotaUsage[];
}

export interface ConsoleUserPatch {
  readonly orgRole?: ConsoleOrgRole;
  readonly status?: ConsoleUserStatus;
}

/**
 * A provider account the organization connected: an integration, its
 * non-secret settings and a sealed credential. What it is (integration,
 * address, project) is fixed once created; its name, key and switch are not.
 */
export interface ConsoleModelProvider {
  readonly id: string;
  readonly name: string;
  readonly integration: ModelIntegrationId;
  /** Non-secret settings: `baseUrl`, or Vertex's `projectId` and `region`. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly enabled: boolean;
  readonly modelCount: number;
  readonly revision: number;
  readonly updatedAt: number;
}
export interface ConsoleModelProviderDetail extends ConsoleModelProvider {
  readonly models: readonly ConsoleModel[];
}
/** What the add flow sends: the name may be left out (the integration's label, made unique). */
export interface ConsoleModelProviderDraft {
  readonly integration: ModelIntegrationId;
  readonly name?: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly credential: Readonly<Record<string, unknown>>;
}
export interface ConsoleModelProviderPatch {
  readonly expectedRevision: number;
  readonly name?: string;
  /** A replacement key; checked against the provider before it is kept. */
  readonly credential?: Readonly<Record<string, unknown>>;
  readonly enabled?: boolean;
}
/** One model the provider account lists, as it would be published. */
export interface ConsoleCatalogModel {
  /** The provider's own model id. */
  readonly id: string;
  readonly displayName: string;
  readonly contract: ModelExecutionContract;
  /** Already published from this provider: the organization model's id. */
  readonly publishedModelId?: string;
}
export type ConsoleModelCatalog =
  | {
      readonly status: 'ready';
      readonly snapshotId: string;
      readonly expiresAt: number;
      readonly models: readonly ConsoleCatalogModel[];
      /** Entries the provider listed that could not be read. */
      readonly skippedModels?: number;
    }
  | {
      readonly status: 'failed';
      /** `credentials`: the provider refused the key; the others may pass on retry. */
      readonly reason: 'credentials' | 'unavailable' | 'invalid_response';
    };
export interface ConsoleModelSelection {
  /** A `ConsoleCatalogModel.id` from the snapshot. */
  readonly id: string;
}
export interface ConsolePublishModels {
  readonly snapshotId: string;
  /** Empty: keep the provider without publishing anything yet. */
  readonly selections: readonly ConsoleModelSelection[];
  /** One per attempt the person makes; a retry of a lost answer reuses it. */
  readonly idempotencyKey: string;
}
/** `POST /model-providers`. */
export interface ConsoleCreateModelProvider {
  readonly draft: ConsoleModelProviderDraft;
  readonly publish: ConsolePublishModels;
}
/** `POST /model-providers/:id/publish`. */
export interface ConsolePublishToProvider extends ConsolePublishModels {
  readonly expectedRevision: number;
}
export interface ConsolePublished {
  readonly providerId: string;
  /** The name it was saved under, when the requested one was taken. */
  readonly providerName: string;
  readonly modelIds: readonly string[];
}
/** An organization model: what people pick in Maka, fixed to one provider and one provider model. */
export interface ConsoleModel {
  readonly id: string;
  readonly displayName: string;
  readonly contract: ModelExecutionContract;
  readonly availability: import('@maka/platform-protocol').PlatformModel['availability'];
  readonly costWeight: number;
  readonly enabled: boolean;
  readonly sortOrder: number;
  readonly revision: number;
  readonly provider: {
    readonly id: string;
    readonly name: string;
    readonly integration: ModelIntegrationId;
    readonly enabled: boolean;
  };
  /** The provider's own model id. */
  readonly providerModel: string;
  readonly updatedAt: number;
}
export interface ConsoleModelPatch {
  readonly expectedRevision: number;
  readonly displayName?: string;
  readonly costWeight?: number;
  readonly sortOrder?: number;
  readonly enabled?: boolean;
}
/**
 * Why an administration call was refused, beside the message, so the page
 * can say it in its own words. `revision_conflict` and `catalog_expired`
 * mean: read again and retry.
 */
export type ConsoleErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'revision_conflict'
  | 'catalog_expired'
  | 'credentials_rejected'
  | 'provider_in_use'
  | 'name_taken'
  | 'idempotency_conflict';

/** The organization's web search service (`/admin/api/web-search`). */
export interface ConsoleWebSearch {
  readonly provider: 'tavily';
  /** Whether a key is saved; nobody can search until one is. */
  readonly configured: boolean;
  readonly enabled: boolean;
  /** 0 until a key is saved; sent back to change it. */
  readonly revision: number;
  readonly updatedAt?: number;
}

/** `PUT /admin/api/web-search`: the first save needs a key. */
export interface ConsoleWebSearchPatch {
  readonly expectedRevision: number;
  /** Checked with the search service before it replaces the saved one. */
  readonly apiKey?: string;
  readonly enabled?: boolean;
}

export interface ConsoleQuotas {
  /** Null: no limit for that period. */
  readonly defaults: Readonly<Record<ConsoleQuotaPeriod, number | null>>;
  readonly users: readonly {
    readonly userId: string;
    readonly email: string;
    readonly name: string;
    readonly limits: Readonly<Record<ConsoleQuotaPeriod, number | null>>;
  }[];
}

export interface ConsoleUsageTotals {
  readonly requests: number;
  /** The provider refused, or the answer broke off; a person's own stop is not one. */
  readonly errors: number;
  /** Counted from what was seen, because the provider did not report its usage. */
  readonly estimatedRequests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** Weighted units, what allowances are counted in. */
  readonly units: number;
}

export interface ConsoleUsageReport {
  readonly since: number;
  readonly days: number;
  readonly totals: ConsoleUsageTotals;
  readonly byUser: readonly (ConsoleUsageTotals & {
    readonly userId: string;
    readonly email: string;
    readonly name: string;
  })[];
  readonly byModel: readonly (ConsoleUsageTotals & {
    readonly modelId: string;
    readonly displayName?: string;
  })[];
}

export interface ConsoleAuditEntry {
  readonly id: string;
  readonly at: number;
  readonly action: string;
  readonly actor: { readonly id: string; readonly email: string; readonly name: string } | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  /** The target in words where there is one: a member's email, a provider's or model's name, a device's name. */
  readonly targetLabel?: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly ip: string | null;
}

export interface ConsoleAuditPage {
  readonly entries: readonly ConsoleAuditEntry[];
  /** Pass as `before` for the next page; null at the end. */
  readonly nextBefore: string | null;
}
