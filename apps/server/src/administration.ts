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

// What an administrator can do to the organization (design §3.2): people and
// their devices, upstreams, models and their routes, allowances, and the
// reports. The admin console and the command line both call these, so a rule
// (the last administrator stays, a deactivated person is signed out
// everywhere) holds whichever one is used. Every change is audited in the
// transaction that makes it.

import { type Kysely, sql, type Transaction } from 'kysely';
import { recordAudit } from './audit.js';
import type {
  ConsoleAuditEntry,
  ConsoleAuditPage,
  ConsoleDevice,
  ConsoleModel,
  ConsoleModelCapabilities,
  ConsoleModelDraft,
  ConsoleModelPatch,
  ConsoleOrgRole,
  ConsoleQuotaPeriod,
  ConsoleQuotas,
  ConsoleQuotaUsage,
  ConsoleRouteDraft,
  ConsoleUpstream,
  ConsoleUpstreamDraft,
  ConsoleUpstreamKind,
  ConsoleUpstreamPatch,
  ConsoleUsageReport,
  ConsoleUsageTotals,
  ConsoleUser,
  ConsoleUserDetail,
  ConsoleUserStatus,
} from './admin-console/types.js';
import type { ServerContext } from './context.js';
import { newId } from './crypto/tokens.js';
import type { Database, ModelProtocol } from './db/schema.js';
import { nextPeriodStart, periodStart } from './gateway/quota.js';
import { validateUpstreamConfig, validateUpstreamCredential } from './gateway/upstream-clients.js';

type Db = Kysely<Database> | Transaction<Database>;

/** A request the organization's rules refuse; `status` is how the console answers it. */
export class AdminRefused extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'AdminRefused';
  }
}

/** Who made a change, for the audit log. */
export interface AdminActor {
  /** Null from the command line, which runs as nobody in particular. */
  readonly userId: string | null;
  readonly via: 'admin-console' | 'admin-cli';
  readonly ip?: string;
}

const QUOTA_PERIODS: readonly ConsoleQuotaPeriod[] = ['week', 'month'];

/** Which gateway protocols an upstream kind can serve. */
export const KIND_PROTOCOLS: Readonly<Record<string, readonly ModelProtocol[]>> = {
  anthropic: ['anthropic'],
  vertex: ['anthropic', 'gemini'],
  openrouter: ['anthropic'],
  openai: ['openai'],
  gemini: ['gemini'],
};

/** The upstream kinds the gateway can call today. */
export const SUPPORTED_UPSTREAM_KINDS: readonly ConsoleUpstreamKind[] = [
  'anthropic',
  'vertex',
  'openrouter',
];

function audit(
  db: Db,
  actor: AdminActor,
  now: Date,
  action: string,
  targetType: string,
  targetId: string,
  detail: Record<string, unknown> = {},
) {
  return recordAudit(
    db,
    {
      action,
      actorUserId: actor.userId,
      targetType,
      targetId,
      detail: { ...detail, via: actor.via },
      ...(actor.ip ? { ip: actor.ip } : {}),
    },
    now,
  );
}

const time = (value: Date | null) => (value ? value.getTime() : null);

/**
 * One writer at a time for a rule that reads before it writes (the roster
 * of administrators, one allowance), held until the transaction ends.
 */
async function serialize(tx: Transaction<Database>, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`.execute(tx);
}

/** A name or id taken by a write that landed between the check and the insert. */
async function unlessTaken<T>(work: () => Promise<T>, message: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: unknown }).code === '23505') throw new AdminRefused(409, message);
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

export async function listUsers(
  ctx: ServerContext,
  options: { readonly query?: string; readonly id?: string } = {},
): Promise<ConsoleUser[]> {
  const needle = options.query?.trim().toLowerCase();
  const now = ctx.now();
  const rows = await ctx.db
    .selectFrom('users')
    .select((eb) => [
      'users.id',
      'users.email',
      'users.name',
      'users.profile_name',
      'users.avatar_url',
      'users.org_role',
      'users.status',
      'users.created_at',
      'users.last_login_at',
      eb
        .selectFrom('device_sessions')
        .select(sql<number>`count(*)`.as('count'))
        .whereRef('device_sessions.user_id', '=', 'users.id')
        .where('device_sessions.revoked_at', 'is', null)
        .where('device_sessions.auth_time', '>', new Date(now.getTime() - SIGN_IN_WINDOW_MS))
        .as('active_devices'),
    ])
    .$if(options.id !== undefined, (query) => query.where('users.id', '=', options.id!))
    .$if(Boolean(needle), (query) =>
      query.where((eb) =>
        eb.or([
          eb('users.email', 'like', `%${escapeLike(needle!)}%`),
          eb(sql`lower(users.name)`, 'like', `%${escapeLike(needle!)}%`),
          eb(sql`lower(coalesce(users.profile_name, ''))`, 'like', `%${escapeLike(needle!)}%`),
        ]),
      ),
    )
    .orderBy('users.email')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.profile_name ?? row.name,
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    orgRole: row.org_role,
    status: row.status,
    createdAt: row.created_at.getTime(),
    lastLoginAt: time(row.last_login_at),
    activeDevices: Number(row.active_devices ?? 0),
  }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id the database would refuse to compare is simply not found. */
function requireId(value: string, what: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new AdminRefused(404, `No such ${what}`);
  return value;
}

/** A device signed in longer than this ago can no longer refresh (§4.3). */
const SIGN_IN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export async function userDetail(ctx: ServerContext, userId: string): Promise<ConsoleUserDetail> {
  if (!UUID.test(userId)) throw new AdminRefused(404, 'No such person');
  const signInSince = ctx.now().getTime() - SIGN_IN_WINDOW_MS;
  const [user] = await listUsers(ctx, { id: userId });
  if (!user) throw new AdminRefused(404, 'No such person');
  const links = await ctx.db
    .selectFrom('identity_links')
    .select(['provider', 'subject', 'created_at'])
    .where('user_id', '=', userId)
    .orderBy('provider')
    .execute();
  const devices = await ctx.db
    .selectFrom('device_sessions')
    .select([
      'id',
      'device_name',
      'provider',
      'created_at',
      'last_used_at',
      'revoked_at',
      'revoke_reason',
      'auth_time',
    ])
    .where('user_id', '=', userId)
    .orderBy(sql`revoked_at IS NULL`, 'desc')
    .orderBy('last_used_at', 'desc')
    .limit(20)
    .execute();
  return {
    ...user,
    links: links.map((link) => ({
      provider: link.provider,
      subject: link.subject,
      createdAt: link.created_at.getTime(),
    })),
    devices: devices.map(
      (device): ConsoleDevice => ({
        id: device.id,
        deviceName: device.device_name,
        provider: device.provider,
        createdAt: device.created_at.getTime(),
        lastUsedAt: device.last_used_at.getTime(),
        revokedAt: time(device.revoked_at),
        revokeReason: device.revoke_reason,
        signedIn: device.revoked_at === null && device.auth_time.getTime() > signInSince,
      }),
    ),
    quotas: await quotaUsage(ctx, userId),
  };
}

export async function userByEmail(db: Db, email: string): Promise<{ id: string; email: string }> {
  const user = await db
    .selectFrom('users')
    .select(['id', 'email'])
    .where('email', '=', email.trim().toLowerCase())
    .executeTakeFirst();
  if (!user) throw new AdminRefused(404, `No user with email ${email}`);
  return user;
}

/**
 * Change a person's role or status. Nobody changes their own, and the last
 * active administrator stays one: otherwise the console could lock everyone
 * out of it. Deactivating signs every device and console out at once.
 */
export async function updateUser(
  ctx: ServerContext,
  actor: AdminActor,
  userId: string,
  patch: { readonly orgRole?: ConsoleOrgRole; readonly status?: ConsoleUserStatus },
): Promise<void> {
  requireId(userId, 'person');
  if (patch.orgRole !== undefined && patch.orgRole !== 'member' && patch.orgRole !== 'org_admin') {
    throw new AdminRefused(400, 'The role is member or org_admin');
  }
  if (patch.status !== undefined && patch.status !== 'active' && patch.status !== 'deactivated') {
    throw new AdminRefused(400, 'The status is active or deactivated');
  }
  const now = ctx.now();
  await ctx.db.transaction().execute(async (tx) => {
    // Role and status changes go one at a time: two administrators demoting
    // each other would otherwise lock the same rows in opposite orders.
    await serialize(tx, 'administration:roster');
    const user = await tx
      .selectFrom('users')
      .select(['id', 'org_role', 'status'])
      .where('id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    if (!user) throw new AdminRefused(404, 'No such person');
    const demoting = patch.orgRole === 'member' && user.org_role === 'org_admin';
    const deactivating = patch.status === 'deactivated' && user.status === 'active';
    if ((demoting || deactivating) && actor.userId === userId) {
      throw new AdminRefused(409, 'You cannot remove your own administrator access');
    }
    if ((demoting || deactivating) && user.org_role === 'org_admin') {
      const admins = await tx
        .selectFrom('users')
        .select('id')
        .where('org_role', '=', 'org_admin')
        .where('status', '=', 'active')
        .execute();
      if (admins.filter((admin) => admin.id !== userId).length === 0) {
        throw new AdminRefused(409, 'The organization needs at least one active administrator');
      }
    }
    const changes: { org_role?: ConsoleOrgRole; status?: ConsoleUserStatus } = {};
    if (patch.orgRole && patch.orgRole !== user.org_role) changes.org_role = patch.orgRole;
    if (patch.status && patch.status !== user.status) changes.status = patch.status;
    if (Object.keys(changes).length === 0) return;
    await tx
      .updateTable('users')
      .set({ ...changes, updated_at: now })
      .where('id', '=', userId)
      .execute();
    if (changes.status === 'deactivated') {
      await tx
        .updateTable('device_sessions')
        .set({ revoked_at: now, revoke_reason: 'account_deactivated' })
        .where('user_id', '=', userId)
        .where('revoked_at', 'is', null)
        .execute();
    }
    if (changes.status === 'deactivated' || changes.org_role === 'member') {
      // The console is for administrators; a changed one is out of it now.
      await tx
        .updateTable('admin_sessions')
        .set({ revoked_at: now })
        .where('user_id', '=', userId)
        .where('revoked_at', 'is', null)
        .execute();
    }
    if (changes.org_role) {
      await audit(tx, actor, now, 'user.role_changed', 'user', userId, {
        orgRole: changes.org_role,
      });
    }
    if (changes.status) {
      await audit(
        tx,
        actor,
        now,
        changes.status === 'deactivated' ? 'user.deactivated' : 'user.activated',
        'user',
        userId,
      );
    }
  });
}

/** Unlink one identity provider; the devices and console sessions signed in through it go too. */
export async function unlinkIdentity(
  ctx: ServerContext,
  actor: AdminActor,
  userId: string,
  provider: string,
): Promise<void> {
  requireId(userId, 'person');
  const now = ctx.now();
  await ctx.db.transaction().execute(async (tx) => {
    const removed = await tx
      .deleteFrom('identity_links')
      .where('user_id', '=', userId)
      .where('provider', '=', provider)
      .executeTakeFirst();
    if (Number(removed.numDeletedRows) === 0) {
      throw new AdminRefused(404, `Not linked to ${provider}`);
    }
    await tx
      .updateTable('device_sessions')
      .set({ revoked_at: now, revoke_reason: 'identity_unlinked' })
      .where('user_id', '=', userId)
      .where('provider', '=', provider)
      .where('revoked_at', 'is', null)
      .execute();
    await tx
      .updateTable('admin_sessions')
      .set({ revoked_at: now })
      .where('user_id', '=', userId)
      .where('provider', '=', provider)
      .where('revoked_at', 'is', null)
      .execute();
    await audit(tx, actor, now, 'identity.unlinked', 'user', userId, { provider });
  });
}

/** Sign one desktop out. */
export async function revokeDevice(
  ctx: ServerContext,
  actor: AdminActor,
  userId: string,
  sessionId: string,
): Promise<void> {
  requireId(userId, 'person');
  requireId(sessionId, 'device');
  const now = ctx.now();
  await ctx.db.transaction().execute(async (tx) => {
    const revoked = await tx
      .updateTable('device_sessions')
      .set({ revoked_at: now, revoke_reason: 'admin_revoked' })
      .where('id', '=', sessionId)
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    if (Number(revoked.numUpdatedRows) === 0) {
      throw new AdminRefused(404, 'That device is not signed in');
    }
    await audit(tx, actor, now, 'session.revoked', 'device_session', sessionId, {
      reason: 'admin_revoked',
      userId,
    });
  });
}

/* ------------------------------------------------------------------ *
 * Upstreams
 * ------------------------------------------------------------------ */

export async function listUpstreams(ctx: ServerContext): Promise<ConsoleUpstream[]> {
  const rows = await ctx.db
    .selectFrom('upstreams')
    .select((eb) => [
      'upstreams.id',
      'upstreams.name',
      'upstreams.kind',
      'upstreams.config',
      'upstreams.enabled',
      'upstreams.credential_sealed',
      'upstreams.updated_at',
      eb
        .selectFrom('model_routes')
        .select(sql<number>`count(*)`.as('count'))
        .whereRef('model_routes.upstream_id', '=', 'upstreams.id')
        .as('model_count'),
    ])
    .orderBy('upstreams.name')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind as ConsoleUpstreamKind,
    config: row.config,
    enabled: row.enabled,
    credentialConfigured: row.credential_sealed !== null,
    modelCount: Number(row.model_count ?? 0),
    updatedAt: row.updated_at.getTime(),
  }));
}

function upstreamName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80)
    throw new AdminRefused(400, 'Name the upstream (up to 80 characters)');
  return name;
}

function supportedKind(kind: string): ConsoleUpstreamKind {
  if (!(SUPPORTED_UPSTREAM_KINDS as readonly string[]).includes(kind)) {
    throw new AdminRefused(400, `Upstream kind ${kind} is not supported yet`);
  }
  return kind as ConsoleUpstreamKind;
}

/** A flat settings object compared by content: the database keeps its keys in its own order. */
function canonical(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  );
}

function validated<T>(check: () => T, what: string): T {
  try {
    return check();
  } catch {
    throw new AdminRefused(400, `The ${what} is incomplete or malformed`);
  }
}

async function nameTaken(db: Db, name: string, except?: string): Promise<boolean> {
  const row = await db
    .selectFrom('upstreams')
    .select('id')
    .where('name', '=', name)
    .$if(Boolean(except), (query) => query.where('id', '<>', except!))
    .executeTakeFirst();
  return Boolean(row);
}

export async function createUpstream(
  ctx: ServerContext,
  actor: AdminActor,
  draft: ConsoleUpstreamDraft,
): Promise<string> {
  const name = upstreamName(draft.name);
  const kind = supportedKind(draft.kind);
  const config = validated(() => validateUpstreamConfig(kind, draft.config), 'configuration');
  const credential = validated(
    () => validateUpstreamCredential(kind, draft.credential),
    'credential',
  );
  const now = ctx.now();
  const id = newId();
  const taken = `An upstream is already named ${name}`;
  await unlessTaken(
    () =>
      ctx.db.transaction().execute(async (tx) => {
        if (await nameTaken(tx, name)) throw new AdminRefused(409, taken);
        await tx
          .insertInto('upstreams')
          .values({
            id,
            name,
            kind,
            config: JSON.stringify(config),
            credential_sealed: ctx.secrets.seal(JSON.stringify(credential), `upstream:${id}`),
            enabled: true,
            updated_at: now,
          })
          .execute();
        await audit(tx, actor, now, 'upstream.created', 'upstream', id, { name, kind });
      }),
    taken,
  );
  return id;
}

export async function updateUpstream(
  ctx: ServerContext,
  actor: AdminActor,
  id: string,
  patch: ConsoleUpstreamPatch,
): Promise<void> {
  requireId(id, 'upstream');
  const now = ctx.now();
  await ctx.db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom('upstreams')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AdminRefused(404, 'No such upstream');
    const changes: {
      name?: string;
      config?: string;
      credential_sealed?: string;
      enabled?: boolean;
    } = {};
    const changed: string[] = [];
    if (patch.name !== undefined) {
      const name = upstreamName(patch.name);
      if (name !== row.name) {
        if (await nameTaken(tx, name, id)) {
          throw new AdminRefused(409, `An upstream is already named ${name}`);
        }
        changes.name = name;
        changed.push('name');
      }
    }
    if (patch.config !== undefined) {
      const config = validated(
        () => validateUpstreamConfig(row.kind, patch.config),
        'configuration',
      );
      if (canonical(config) !== canonical(row.config)) {
        changes.config = JSON.stringify(config);
        changed.push('config');
      }
    }
    if (patch.credential !== undefined) {
      const credential = validated(
        () => validateUpstreamCredential(row.kind, patch.credential),
        'credential',
      );
      changes.credential_sealed = ctx.secrets.seal(JSON.stringify(credential), `upstream:${id}`);
      changed.push('credential');
    }
    if (patch.enabled !== undefined && patch.enabled !== row.enabled) {
      changes.enabled = patch.enabled;
      changed.push(patch.enabled ? 'enabled' : 'disabled');
    }
    if (changed.length === 0) return;
    // `updated_at` is also the gateway's cue to build a new client.
    await tx
      .updateTable('upstreams')
      .set({ ...changes, updated_at: now })
      .where('id', '=', id)
      .execute();
    await audit(tx, actor, now, 'upstream.updated', 'upstream', id, { changed });
  });
}

/** Only an upstream no model routes through: a route to nowhere would fail every request. */
export async function deleteUpstream(
  ctx: ServerContext,
  actor: AdminActor,
  id: string,
): Promise<void> {
  requireId(id, 'upstream');
  const now = ctx.now();
  await ctx.db.transaction().execute(async (tx) => {
    // Locked first: a route being added to it waits (or makes this wait), so
    // the count below is the last word and the cascade never takes a route.
    const upstream = await tx
      .selectFrom('upstreams')
      .select('name')
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!upstream) throw new AdminRefused(404, 'No such upstream');
    const routes = await tx
      .selectFrom('model_routes')
      .select('model_id')
      .where('upstream_id', '=', id)
      .execute();
    if (routes.length > 0) {
      throw new AdminRefused(409, 'Models still route through this upstream; move them first');
    }
    await tx.deleteFrom('upstreams').where('id', '=', id).execute();
    await audit(tx, actor, now, 'upstream.deleted', 'upstream', id, { name: upstream.name });
  });
}

/* ------------------------------------------------------------------ *
 * Models
 * ------------------------------------------------------------------ */

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const MODALITIES = new Set(['text', 'image', 'pdf', 'audio', 'video']);
/** Beyond any model's window: the desktop sizes its context from these. */
const MAX_TOKEN_COUNT = 100_000_000;
/**
 * The protocols a model may be offered on: only those the gateway serves, or
 * the model would be listed to people and fail on the first send.
 */
const OFFERED_PROTOCOLS: readonly ModelProtocol[] = ['anthropic'];

/** What is stored for a model's capabilities: only what was said, each field checked. */
function capabilitiesOf(input: ConsoleModelCapabilities | undefined): Record<string, unknown> {
  if (input === undefined) return {};
  if (typeof input !== 'object' || input === null) {
    throw new AdminRefused(400, 'Capabilities must be an object');
  }
  const out: Record<string, unknown> = {};
  const positive = (value: unknown, what: string) => {
    if (value === undefined) return undefined;
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value <= 0 ||
      value > MAX_TOKEN_COUNT
    ) {
      throw new AdminRefused(400, `${what} must be a whole number from 1 to ${MAX_TOKEN_COUNT}`);
    }
    return value;
  };
  if (input.referenceModelId !== undefined) {
    const reference = String(input.referenceModelId).trim();
    if (reference && !MODEL_ID.test(reference)) {
      throw new AdminRefused(400, 'The vendor model id is not a model id');
    }
    if (reference) out.referenceModelId = reference;
  }
  const contextWindow = positive(input.contextWindow, 'The context window');
  if (contextWindow !== undefined) out.contextWindow = contextWindow;
  const maxOutputTokens = positive(input.maxOutputTokens, 'The output limit');
  if (maxOutputTokens !== undefined) out.maxOutputTokens = maxOutputTokens;
  if (input.thinkingLevels !== undefined) {
    if (
      !Array.isArray(input.thinkingLevels) ||
      !input.thinkingLevels.every((level) => THINKING_LEVELS.has(level))
    ) {
      throw new AdminRefused(400, 'Unknown thinking level');
    }
    if (input.thinkingLevels.length > 0) out.thinkingLevels = [...new Set(input.thinkingLevels)];
  }
  if (input.defaultThinkingLevel !== undefined) {
    const levels = (out.thinkingLevels as string[] | undefined) ?? [];
    if (!levels.includes(input.defaultThinkingLevel)) {
      throw new AdminRefused(400, 'The default thinking level must be one of the levels offered');
    }
    out.defaultThinkingLevel = input.defaultThinkingLevel;
  }
  if (input.inputModalities !== undefined) {
    if (
      !Array.isArray(input.inputModalities) ||
      !input.inputModalities.every((modality) => MODALITIES.has(modality))
    ) {
      throw new AdminRefused(400, 'Unknown input kind');
    }
    if (input.inputModalities.length > 0) out.inputModalities = [...new Set(input.inputModalities)];
  }
  if (input.supportsTools !== undefined) {
    if (typeof input.supportsTools !== 'boolean') {
      throw new AdminRefused(400, 'Tool support is yes or no');
    }
    out.supportsTools = input.supportsTools;
  }
  return out;
}

function costWeight(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) {
    throw new AdminRefused(400, 'The cost weight must be a number from 0 to 1000');
  }
  return value;
}

function sortOrder(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > 1_000_000) {
    throw new AdminRefused(400, 'The order must be a whole number');
  }
  return value;
}

function displayName(value: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 120)
    throw new AdminRefused(400, 'Name the model (up to 120 characters)');
  return name;
}

export async function listModels(ctx: ServerContext): Promise<ConsoleModel[]> {
  const models = await ctx.db
    .selectFrom('models')
    .selectAll()
    .orderBy('sort_order')
    .orderBy('id')
    .execute();
  const routes = await ctx.db
    .selectFrom('model_routes')
    .innerJoin('upstreams', 'upstreams.id', 'model_routes.upstream_id')
    .select([
      'model_routes.model_id',
      'model_routes.upstream_id',
      'model_routes.upstream_model',
      'model_routes.priority',
      'upstreams.name',
      'upstreams.kind',
      'upstreams.enabled',
    ])
    .orderBy('model_routes.priority')
    .orderBy('upstreams.name')
    .execute();
  return models.map((model) => ({
    id: model.id,
    protocol: model.protocol,
    displayName: model.display_name,
    capabilities: model.capabilities as ConsoleModelCapabilities,
    costWeight: model.cost_weight,
    enabled: model.enabled,
    sortOrder: model.sort_order,
    updatedAt: model.updated_at.getTime(),
    routes: routes
      .filter((route) => route.model_id === model.id)
      .map((route) => ({
        upstreamId: route.upstream_id,
        upstreamName: route.name,
        upstreamKind: route.kind as ConsoleUpstreamKind,
        upstreamEnabled: route.enabled,
        upstreamModel: route.upstream_model,
        priority: route.priority,
      })),
  }));
}

export async function createModel(
  ctx: ServerContext,
  actor: AdminActor,
  draft: ConsoleModelDraft,
): Promise<void> {
  const id = typeof draft.id === 'string' ? draft.id.trim() : '';
  if (!MODEL_ID.test(id)) {
    throw new AdminRefused(400, 'A model id is letters, digits and . _ : / @ - (up to 128)');
  }
  if (!OFFERED_PROTOCOLS.includes(draft.protocol)) {
    throw new AdminRefused(400, `Protocol ${String(draft.protocol)} is not offered`);
  }
  if (draft.enabled !== undefined && typeof draft.enabled !== 'boolean') {
    throw new AdminRefused(400, 'Enabled is yes or no');
  }
  const values = {
    id,
    protocol: draft.protocol,
    display_name: displayName(draft.displayName),
    capabilities: JSON.stringify(capabilitiesOf(draft.capabilities)),
    cost_weight: costWeight(draft.costWeight) ?? 1,
    enabled: draft.enabled ?? true,
    sort_order: sortOrder(draft.sortOrder) ?? 0,
  };
  const now = ctx.now();
  const taken = `A model ${id} already exists`;
  await unlessTaken(
    () =>
      ctx.db.transaction().execute(async (tx) => {
        const existing = await tx
          .selectFrom('models')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst();
        if (existing) throw new AdminRefused(409, taken);
        await tx
          .insertInto('models')
          .values({ ...values, updated_at: now })
          .execute();
        await audit(tx, actor, now, 'model.created', 'model', id, { protocol: draft.protocol });
      }),
    taken,
  );
}

export async function updateModel(
  ctx: ServerContext,
  actor: AdminActor,
  id: string,
  patch: ConsoleModelPatch,
): Promise<void> {
  const changes: {
    display_name?: string;
    capabilities?: string;
    cost_weight?: number;
    sort_order?: number;
    enabled?: boolean;
  } = {};
  if (patch.displayName !== undefined) changes.display_name = displayName(patch.displayName);
  if (patch.capabilities !== undefined) {
    changes.capabilities = JSON.stringify(capabilitiesOf(patch.capabilities));
  }
  const weight = costWeight(patch.costWeight);
  if (weight !== undefined) changes.cost_weight = weight;
  const order = sortOrder(patch.sortOrder);
  if (order !== undefined) changes.sort_order = order;
  if (patch.enabled !== undefined) {
    if (typeof patch.enabled !== 'boolean') throw new AdminRefused(400, 'Enabled is yes or no');
    changes.enabled = patch.enabled;
  }
  if (Object.keys(changes).length === 0) return;
  const now = ctx.now();
  await ctx.db.transaction().execute(async (tx) => {
    const updated = await tx
      .updateTable('models')
      .set({ ...changes, updated_at: now })
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 0) throw new AdminRefused(404, 'No such model');
    await audit(tx, actor, now, 'model.updated', 'model', id, { changed: Object.keys(changes) });
  });
}

/** Its routes go with it; its usage stays, recorded under its id. */
export async function deleteModel(
  ctx: ServerContext,
  actor: AdminActor,
  id: string,
): Promise<void> {
  const now = ctx.now();
  await ctx.db.transaction().execute(async (tx) => {
    const removed = await tx.deleteFrom('models').where('id', '=', id).executeTakeFirst();
    if (Number(removed.numDeletedRows) === 0) throw new AdminRefused(404, 'No such model');
    await audit(tx, actor, now, 'model.deleted', 'model', id);
  });
}

/** Replace where a model's requests go, each upstream once, in priority order. */
export async function setModelRoutes(
  ctx: ServerContext,
  actor: AdminActor,
  modelId: string,
  routes: readonly ConsoleRouteDraft[],
): Promise<void> {
  await ctx.db.transaction().execute((tx) => writeRoutes(tx, actor, ctx.now(), modelId, routes));
}

async function writeRoutes(
  tx: Transaction<Database>,
  actor: AdminActor,
  now: Date,
  modelId: string,
  routes: readonly ConsoleRouteDraft[],
): Promise<void> {
  if (!Array.isArray(routes) || routes.length > 10) {
    throw new AdminRefused(400, 'Give up to ten routes');
  }
  const model = await tx
    .selectFrom('models')
    .select('protocol')
    .where('id', '=', modelId)
    .forUpdate()
    .executeTakeFirst();
  if (!model) throw new AdminRefused(404, 'No such model');
  const seen = new Set<string>();
  const rows = [];
  for (const route of routes) {
    const upstreamModel =
      typeof route?.upstreamModel === 'string' ? route.upstreamModel.trim() : '';
    if (!upstreamModel || upstreamModel.length > 200) {
      throw new AdminRefused(400, "Give the model's name at each upstream");
    }
    const priority = sortOrder(route.priority) ?? 0;
    if (typeof route.upstreamId !== 'string' || seen.has(route.upstreamId)) {
      throw new AdminRefused(400, 'Each upstream once');
    }
    requireId(route.upstreamId, 'upstream');
    seen.add(route.upstreamId);
    // Shared: deleting the upstream waits until this is written.
    const upstream = await tx
      .selectFrom('upstreams')
      .select(['id', 'name', 'kind'])
      .where('id', '=', route.upstreamId)
      .forShare()
      .executeTakeFirst();
    if (!upstream) throw new AdminRefused(404, 'No such upstream');
    if (!KIND_PROTOCOLS[upstream.kind]?.includes(model.protocol)) {
      throw new AdminRefused(
        400,
        `${upstream.name} (${upstream.kind}) cannot serve ${model.protocol} models`,
      );
    }
    rows.push({
      model_id: modelId,
      upstream_id: upstream.id,
      upstream_model: upstreamModel,
      priority,
      name: upstream.name,
    });
  }
  await tx.deleteFrom('model_routes').where('model_id', '=', modelId).execute();
  if (rows.length > 0) {
    await tx
      .insertInto('model_routes')
      .values(rows.map(({ name: _name, ...row }) => row))
      .execute();
  }
  await audit(tx, actor, now, 'model.routed', 'model', modelId, {
    routes: rows.map((row) => `${row.name}:${row.upstream_model}`),
  });
}

/** Add or replace one route, keeping the others (the command line's `models route`). */
export async function addModelRoute(
  ctx: ServerContext,
  actor: AdminActor,
  modelId: string,
  route: ConsoleRouteDraft,
): Promise<void> {
  await ctx.db.transaction().execute(async (tx) => {
    // Read under the model's lock, so a change made meanwhile is not lost.
    const model = await tx
      .selectFrom('models')
      .select('id')
      .where('id', '=', modelId)
      .forUpdate()
      .executeTakeFirst();
    if (!model) throw new AdminRefused(404, `No model ${modelId}`);
    const current = await tx
      .selectFrom('model_routes')
      .select(['upstream_id', 'upstream_model', 'priority'])
      .where('model_id', '=', modelId)
      .execute();
    await writeRoutes(tx, actor, ctx.now(), modelId, [
      ...current
        .filter((existing) => existing.upstream_id !== route.upstreamId)
        .map((existing) => ({
          upstreamId: existing.upstream_id,
          upstreamModel: existing.upstream_model,
          priority: existing.priority,
        })),
      route,
    ]);
  });
}

/* ------------------------------------------------------------------ *
 * Allowances
 * ------------------------------------------------------------------ */

export async function listQuotas(ctx: ServerContext): Promise<ConsoleQuotas> {
  const rows = await ctx.db
    .selectFrom('quotas')
    .leftJoin('users', 'users.id', 'quotas.scope_id')
    .select([
      'quotas.scope',
      'quotas.scope_id',
      'quotas.period',
      'quotas.limit_units',
      'users.email',
      'users.name',
      'users.profile_name',
    ])
    .execute();
  const defaults: Record<ConsoleQuotaPeriod, number | null> = { week: null, month: null };
  const users = new Map<
    string,
    {
      userId: string;
      email: string;
      name: string;
      limits: Record<ConsoleQuotaPeriod, number | null>;
    }
  >();
  for (const row of rows) {
    if (row.scope === 'user_default') {
      defaults[row.period] = row.limit_units;
      continue;
    }
    if (!row.scope_id || !row.email) continue;
    const entry = users.get(row.scope_id) ?? {
      userId: row.scope_id,
      email: row.email,
      name: row.profile_name ?? row.name ?? row.email,
      limits: { week: null, month: null },
    };
    entry.limits[row.period] = row.limit_units;
    users.set(row.scope_id, entry);
  }
  return {
    defaults,
    users: [...users.values()].sort((a, b) => a.email.localeCompare(b.email)),
  };
}

function quotaPeriod(value: string): ConsoleQuotaPeriod {
  if (!(QUOTA_PERIODS as readonly string[]).includes(value)) {
    throw new AdminRefused(400, 'The period is week or month');
  }
  return value as ConsoleQuotaPeriod;
}

/** Set one allowance; null removes it (no limit, or the default for a person). */
export async function setQuota(
  ctx: ServerContext,
  actor: AdminActor,
  target: { readonly scope: 'user_default' } | { readonly scope: 'user'; readonly userId: string },
  periodValue: string,
  limit: number | null,
): Promise<void> {
  const period = quotaPeriod(periodValue);
  if (limit !== null && (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0)) {
    throw new AdminRefused(400, 'The allowance must be a number of units, 0 or more');
  }
  const scopeId = target.scope === 'user' ? requireId(target.userId, 'person') : null;
  const now = ctx.now();
  await ctx.db.transaction().execute(async (tx) => {
    // The slot is replaced (delete, then insert): two writers take turns.
    await serialize(tx, `quota:${target.scope}:${scopeId ?? '*'}:${period}`);
    if (scopeId) {
      const user = await tx
        .selectFrom('users')
        .select('id')
        .where('id', '=', scopeId)
        .executeTakeFirst();
      if (!user) throw new AdminRefused(404, 'No such person');
    }
    await tx
      .deleteFrom('quotas')
      .where('scope', '=', target.scope)
      .where('period', '=', period)
      .where((eb) => (scopeId ? eb('scope_id', '=', scopeId) : eb('scope_id', 'is', null)))
      .execute();
    if (limit !== null) {
      await tx
        .insertInto('quotas')
        .values({
          id: newId(),
          scope: target.scope,
          scope_id: scopeId,
          period,
          limit_units: limit,
          updated_at: now,
        })
        .execute();
    }
    await audit(
      tx,
      actor,
      now,
      limit === null ? 'quota.removed' : 'quota.set',
      'quota',
      `${target.scope}:${scopeId ?? '*'}:${period}`,
      {
        ...(limit === null ? {} : { limit }),
      },
    );
  });
}

/** Each period's allowance as it applies to the person now, and how much of it is used. */
async function quotaUsage(ctx: ServerContext, userId: string): Promise<ConsoleQuotaUsage[]> {
  const now = ctx.now();
  const rows = await ctx.db
    .selectFrom('quotas')
    .select(['scope', 'period', 'limit_units'])
    .where((eb) =>
      eb.or([
        eb('scope', '=', 'user_default'),
        eb.and([eb('scope', '=', 'user'), eb('scope_id', '=', userId)]),
      ]),
    )
    .execute();
  const result: ConsoleQuotaUsage[] = [];
  for (const period of QUOTA_PERIODS) {
    const own = rows.find((row) => row.scope === 'user' && row.period === period);
    const fallback = rows.find((row) => row.scope === 'user_default' && row.period === period);
    const used = await ctx.db
      .selectFrom('usage_events')
      .select(sql<number>`coalesce(sum(weighted_units), 0)`.as('units'))
      .where('user_id', '=', userId)
      .where('at', '>=', periodStart(period, now))
      .executeTakeFirstOrThrow();
    result.push({
      period,
      limit: own?.limit_units ?? fallback?.limit_units ?? null,
      source: own ? 'user' : fallback ? 'default' : 'none',
      used: Number(used.units),
      resetsAt: nextPeriodStart(period, now).getTime(),
    });
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

function totalsOf(row: {
  requests: unknown;
  errors: unknown;
  input: unknown;
  output: unknown;
  cache_read: unknown;
  cache_write: unknown;
  units: unknown;
}): ConsoleUsageTotals {
  return {
    requests: Number(row.requests ?? 0),
    errors: Number(row.errors ?? 0),
    inputTokens: Number(row.input ?? 0),
    outputTokens: Number(row.output ?? 0),
    cacheReadTokens: Number(row.cache_read ?? 0),
    cacheWriteTokens: Number(row.cache_write ?? 0),
    units: Math.round(Number(row.units ?? 0) * 10) / 10,
  };
}

const TOTALS = [
  sql<number>`count(*)`.as('requests'),
  sql<number>`count(*) FILTER (WHERE usage_events.status = 'error')`.as('errors'),
  sql<number>`coalesce(sum(usage_events.input_tokens), 0)`.as('input'),
  sql<number>`coalesce(sum(usage_events.output_tokens), 0)`.as('output'),
  sql<number>`coalesce(sum(usage_events.cache_read_tokens), 0)`.as('cache_read'),
  sql<number>`coalesce(sum(usage_events.cache_write_tokens), 0)`.as('cache_write'),
  sql<number>`coalesce(sum(usage_events.weighted_units), 0)`.as('units'),
] as const;

export async function usageReport(ctx: ServerContext, days: number): Promise<ConsoleUsageReport> {
  if (!Number.isInteger(days) || days < 1 || days > 366) {
    throw new AdminRefused(400, 'Report on 1 to 366 days');
  }
  const since = new Date(ctx.now().getTime() - days * 24 * 60 * 60 * 1000);
  const totals = await ctx.db
    .selectFrom('usage_events')
    .select([...TOTALS])
    .where('usage_events.at', '>=', since)
    .executeTakeFirstOrThrow();
  const byUser = await ctx.db
    .selectFrom('usage_events')
    .innerJoin('users', 'users.id', 'usage_events.user_id')
    .select(['users.id', 'users.email', 'users.name', 'users.profile_name', ...TOTALS])
    .where('usage_events.at', '>=', since)
    .groupBy(['users.id', 'users.email', 'users.name', 'users.profile_name'])
    .orderBy('units', 'desc')
    .execute();
  const byModel = await ctx.db
    .selectFrom('usage_events')
    .leftJoin('models', 'models.id', 'usage_events.model_id')
    .select(['usage_events.model_id', 'models.display_name', ...TOTALS])
    .where('usage_events.at', '>=', since)
    .groupBy(['usage_events.model_id', 'models.display_name'])
    .orderBy('units', 'desc')
    .execute();
  return {
    since: since.getTime(),
    days,
    totals: totalsOf(totals),
    byUser: byUser.map((row) => ({
      userId: row.id,
      email: row.email,
      name: row.profile_name ?? row.name,
      ...totalsOf(row),
    })),
    byModel: byModel.map((row) => ({
      modelId: row.model_id,
      ...(row.display_name ? { displayName: row.display_name } : {}),
      ...totalsOf(row),
    })),
  };
}

const AUDIT_PAGE_SIZE = 100;
const MAX_BIGINT = 9_223_372_036_854_775_807n;

/** Members, upstreams and devices by name, for the page's targets that still exist. */
async function auditTargetLabels(
  ctx: ServerContext,
  rows: readonly { target_type: string | null; target_id: string | null }[],
): Promise<Map<string, string>> {
  const ids = (type: string) => [
    ...new Set(
      rows
        .filter((row) => row.target_type === type && row.target_id && UUID.test(row.target_id))
        .map((row) => row.target_id!),
    ),
  ];
  const labels = new Map<string, string>();
  // A person's allowance is keyed `user:<id>:<period>`; its person is the label.
  const quotaUsers = rows
    .filter((row) => row.target_type === 'quota' && row.target_id?.startsWith('user:'))
    .map((row) => row.target_id!.split(':')[1] ?? '')
    .filter((id) => UUID.test(id));
  const users = [...new Set([...ids('user'), ...quotaUsers])];
  if (users.length > 0) {
    for (const user of await ctx.db
      .selectFrom('users')
      .select(['id', 'email'])
      .where('id', 'in', users)
      .execute()) {
      labels.set(`user:${user.id}`, user.email);
      labels.set(`quota:user:${user.id}:week`, user.email);
      labels.set(`quota:user:${user.id}:month`, user.email);
    }
  }
  const upstreams = ids('upstream');
  if (upstreams.length > 0) {
    for (const upstream of await ctx.db
      .selectFrom('upstreams')
      .select(['id', 'name'])
      .where('id', 'in', upstreams)
      .execute()) {
      labels.set(`upstream:${upstream.id}`, upstream.name);
    }
  }
  const devices = ids('device_session');
  if (devices.length > 0) {
    for (const device of await ctx.db
      .selectFrom('device_sessions')
      .innerJoin('users', 'users.id', 'device_sessions.user_id')
      .select(['device_sessions.id', 'device_sessions.device_name', 'users.email'])
      .where('device_sessions.id', 'in', devices)
      .execute()) {
      labels.set(
        `device_session:${device.id}`,
        device.device_name ? `${device.device_name} · ${device.email}` : device.email,
      );
    }
  }
  return labels;
}

/** Newest first; `before` is the last id of the page before. */
export async function auditPage(
  ctx: ServerContext,
  options: { readonly before?: string; readonly action?: string } = {},
): Promise<ConsoleAuditPage> {
  if (
    options.before !== undefined &&
    (!/^\d{1,19}$/.test(options.before) || BigInt(options.before) > MAX_BIGINT)
  ) {
    throw new AdminRefused(400, 'Not a page');
  }
  const rows = await ctx.db
    .selectFrom('audit_events')
    .leftJoin('users', 'users.id', 'audit_events.actor_user_id')
    .select([
      'audit_events.id',
      'audit_events.at',
      'audit_events.action',
      'audit_events.target_type',
      'audit_events.target_id',
      'audit_events.detail',
      'audit_events.ip',
      'audit_events.actor_user_id',
      'users.email',
      'users.name',
      'users.profile_name',
    ])
    .$if(options.before !== undefined, (query) =>
      query.where('audit_events.id', '<', options.before!),
    )
    .$if(Boolean(options.action), (query) =>
      query.where('audit_events.action', 'like', `${escapeLike(options.action!)}%`),
    )
    .orderBy('audit_events.id', 'desc')
    .limit(AUDIT_PAGE_SIZE + 1)
    .execute();
  const page = rows.slice(0, AUDIT_PAGE_SIZE);
  const labels = await auditTargetLabels(ctx, page);
  return {
    entries: page.map(
      (row): ConsoleAuditEntry => ({
        id: String(row.id),
        at: row.at.getTime(),
        action: row.action,
        actor:
          row.actor_user_id && row.email
            ? {
                id: row.actor_user_id,
                email: row.email,
                name: row.profile_name ?? row.name ?? row.email,
              }
            : null,
        targetType: row.target_type,
        targetId: row.target_id,
        ...(row.target_id && labels.has(`${row.target_type}:${row.target_id}`)
          ? { targetLabel: labels.get(`${row.target_type}:${row.target_id}`)! }
          : {}),
        detail: row.detail,
        ip: row.ip,
      }),
    ),
    nextBefore: rows.length > AUDIT_PAGE_SIZE ? String(page.at(-1)!.id) : null,
  };
}
