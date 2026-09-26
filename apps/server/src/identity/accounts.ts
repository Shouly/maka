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

// Who a verified identity is (§4.1, D4). One email is one person, whichever
// provider vouched for it. A known (provider, subject) wins, so a changed
// email keeps its account; otherwise the email finds the person and the new
// provider is linked. The email always comes from the provider's verified
// answer — never from the client, which is how relx-copilot could be
// impersonated.
//
// Linking by email stops where it would hand someone else's account over: a
// second person the same provider knows under the same email (a mailbox given
// to a new hire), or an account that has been deactivated. Those wait for an
// administrator.

import type { OrgRole } from '@maka/platform-protocol';
import { recordAudit } from '../audit.js';
import type { ServerContext } from '../context.js';
import { newId } from '../crypto/tokens.js';
import { IdentityRefused, isAllowedEmail, type VerifiedIdentity } from './providers/types.js';

export interface ResolvedAccount {
  readonly userId: string;
  readonly email: string;
  readonly orgRole: OrgRole;
  readonly created: boolean;
}

export async function resolveAccount(
  ctx: ServerContext,
  identity: VerifiedIdentity,
): Promise<ResolvedAccount> {
  const email = identity.email.toLowerCase();
  if (!isAllowedEmail(email, ctx.config.allowedEmailDomains)) {
    throw new IdentityRefused('domain_not_allowed', 'This email domain cannot sign in');
  }
  try {
    return await resolveOnce(ctx, identity, email);
  } catch (error) {
    // Two first sign-ins of the same person at once: the loser's insert
    // collides with the winner's rows, and a second look finds them.
    if (isUniqueViolation(error)) return resolveOnce(ctx, identity, email);
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

async function resolveOnce(
  ctx: ServerContext,
  identity: VerifiedIdentity,
  email: string,
): Promise<ResolvedAccount> {
  const now = ctx.now();
  const resolved = await ctx.db.transaction().execute(async (tx) => {
    const linked = await tx
      .selectFrom('identity_links')
      .innerJoin('users', 'users.id', 'identity_links.user_id')
      .select(['users.id', 'users.email', 'users.org_role', 'users.status'])
      .where('identity_links.provider', '=', identity.provider)
      .where('identity_links.subject', '=', identity.subject)
      .executeTakeFirst();
    let user = linked;
    let created = false;
    if (!user) {
      user = await tx
        .selectFrom('users')
        .select(['id', 'email', 'org_role', 'status'])
        .where('email', '=', email)
        .executeTakeFirst();
      if (user && user.status !== 'active') return { refused: 'account_deactivated' as const };
      if (user) {
        const other = await tx
          .selectFrom('identity_links')
          .select('subject')
          .where('user_id', '=', user.id)
          .where('provider', '=', identity.provider)
          .executeTakeFirst();
        if (other) {
          await recordAudit(
            tx,
            {
              action: 'identity.conflict',
              actorUserId: null,
              targetType: 'user',
              targetId: user.id,
              detail: { provider: identity.provider, subject: identity.subject },
            },
            now,
          );
          return { refused: 'identity_conflict' as const };
        }
        await tx
          .insertInto('identity_links')
          .values({
            provider: identity.provider,
            subject: identity.subject,
            user_id: user.id,
            created_at: now,
          })
          .execute();
        await recordAudit(
          tx,
          {
            action: 'identity.linked',
            actorUserId: user.id,
            targetType: 'user',
            targetId: user.id,
            detail: { provider: identity.provider },
          },
          now,
        );
      }
    }
    if (!user) {
      const id = newId();
      const orgRole: OrgRole = ctx.config.bootstrapAdminEmails.includes(email)
        ? 'org_admin'
        : 'member';
      await tx
        .insertInto('users')
        .values({
          id,
          email,
          name: identity.name ?? email.slice(0, email.indexOf('@')),
          avatar_url: identity.avatarUrl ?? null,
          org_role: orgRole,
          status: 'active',
          created_at: now,
          updated_at: now,
          last_login_at: null,
        })
        .execute();
      await tx
        .insertInto('identity_links')
        .values({
          provider: identity.provider,
          subject: identity.subject,
          user_id: id,
          created_at: now,
        })
        .execute();
      await recordAudit(
        tx,
        {
          action: 'user.created',
          actorUserId: id,
          targetType: 'user',
          targetId: id,
          detail: { provider: identity.provider, orgRole },
        },
        now,
      );
      user = { id, email, org_role: orgRole, status: 'active' as const };
      created = true;
    }
    if (user.status !== 'active') return { refused: 'account_deactivated' as const };
    // Keep the profile current. A changed email follows the provider unless
    // another person already holds it; then the old one stays.
    const emailTaken =
      user.email !== email &&
      (await tx.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst()) !==
        undefined;
    await tx
      .updateTable('users')
      .set({
        ...(user.email !== email && !emailTaken ? { email } : {}),
        ...(identity.name ? { name: identity.name } : {}),
        ...(identity.avatarUrl ? { avatar_url: identity.avatarUrl } : {}),
        last_login_at: now,
        updated_at: now,
      })
      .where('id', '=', user.id)
      .execute();
    return {
      account: {
        userId: user.id,
        email: user.email !== email && !emailTaken ? email : user.email,
        orgRole: user.org_role,
        created,
      },
    };
  });
  if ('refused' in resolved) {
    throw resolved.refused === 'identity_conflict'
      ? new IdentityRefused(
          'identity_conflict',
          'This email already belongs to another person at this provider; an administrator must resolve it',
        )
      : new IdentityRefused('account_deactivated', 'This account has been deactivated');
  }
  return resolved.account;
}
