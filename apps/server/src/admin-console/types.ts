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
export type ConsoleUpstreamKind = 'anthropic' | 'vertex' | 'openrouter';
export type ConsoleModelProtocol = 'anthropic' | 'openai' | 'gemini';

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

export interface ConsoleUpstream {
  readonly id: string;
  readonly name: string;
  readonly kind: ConsoleUpstreamKind;
  /** Non-secret settings: base URL, project, region. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly enabled: boolean;
  /** The credential is written, never read back. */
  readonly credentialConfigured: boolean;
  /** Models that route through it. */
  readonly modelCount: number;
  readonly updatedAt: number;
}

export interface ConsoleUpstreamDraft {
  readonly name: string;
  readonly kind: ConsoleUpstreamKind;
  readonly config: Readonly<Record<string, unknown>>;
  readonly credential: Readonly<Record<string, unknown>>;
}

export interface ConsoleUpstreamPatch {
  readonly name?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  /** Replaces the stored one; absent keeps it. */
  readonly credential?: Readonly<Record<string, unknown>>;
  readonly enabled?: boolean;
}

/** What people's apps are told about a model; empty fields come from the vendor's own entry. */
export interface ConsoleModelCapabilities {
  /** The vendor's id for it, when this model is published under another name. */
  readonly referenceModelId?: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly thinkingLevels?: readonly string[];
  readonly defaultThinkingLevel?: string;
  readonly inputModalities?: readonly string[];
  readonly supportsTools?: boolean;
}

export interface ConsoleModelRoute {
  readonly upstreamId: string;
  readonly upstreamName: string;
  readonly upstreamKind: ConsoleUpstreamKind;
  readonly upstreamEnabled: boolean;
  /** The model's name at that upstream. */
  readonly upstreamModel: string;
  /** Lower goes first. */
  readonly priority: number;
}

export interface ConsoleModel {
  readonly id: string;
  readonly protocol: ConsoleModelProtocol;
  readonly displayName: string;
  readonly capabilities: ConsoleModelCapabilities;
  readonly costWeight: number;
  readonly enabled: boolean;
  readonly sortOrder: number;
  readonly routes: readonly ConsoleModelRoute[];
  readonly updatedAt: number;
}

export interface ConsoleModelDraft {
  readonly id: string;
  readonly protocol: ConsoleModelProtocol;
  readonly displayName: string;
  readonly capabilities?: ConsoleModelCapabilities;
  readonly costWeight?: number;
  readonly sortOrder?: number;
  readonly enabled?: boolean;
}

export interface ConsoleModelPatch {
  readonly displayName?: string;
  readonly capabilities?: ConsoleModelCapabilities;
  readonly costWeight?: number;
  readonly sortOrder?: number;
  readonly enabled?: boolean;
}

export interface ConsoleRouteDraft {
  readonly upstreamId: string;
  readonly upstreamModel: string;
  readonly priority: number;
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
  readonly errors: number;
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
  /** The target in words where there is one: a member's email, an upstream's name, a device's name. */
  readonly targetLabel?: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly ip: string | null;
}

export interface ConsoleAuditPage {
  readonly entries: readonly ConsoleAuditEntry[];
  /** Pass as `before` for the next page; null at the end. */
  readonly nextBefore: string | null;
}
