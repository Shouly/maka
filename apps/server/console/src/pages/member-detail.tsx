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

// One member: their account (role, status), how they sign in, the desktops
// they are signed in on, and their allowances. Every change answers with the
// member as they now are, which replaces the page's copy.

import { useState } from 'react';
import type {
  ConsoleDevice,
  ConsoleOrgRole,
  ConsoleQuotaPeriod,
  ConsoleUserDetail,
} from '../../../src/admin-console/types.js';
import { SettingsEmpty } from '@desktop/components/settings/settings-kit.js';
import { SettingsRow, SettingsSection } from '@desktop/components/settings/settings-row.js';
import { Button } from '@desktop/components/ui/button.js';
import { ConfirmDialog } from '@desktop/components/ui/confirm-dialog.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@desktop/components/ui/select.js';
import { api, ConsoleApiError } from '../api.js';
import { navigate } from '../router.js';
import { NotFoundPanel } from './not-found.js';
import { useConsole } from '../context.js';
import { formatCompact, formatDate, formatDateTime, providerName } from '../format.js';
import {
  Avatar,
  Chip,
  DetailHeader,
  LoadFailed,
  LoadingRows,
  reportFailure,
  smallButton,
} from '../ui.js';
import { useResource } from '../use-resource.js';
import { QuotaDialog } from './quota-dialog.js';

type Pending =
  | { readonly kind: 'deactivate' }
  | { readonly kind: 'unlink'; readonly provider: string }
  | { readonly kind: 'revoke'; readonly device: ConsoleDevice }
  | { readonly kind: 'quota'; readonly period: ConsoleQuotaPeriod };

export function MemberDetailPage(props: { id: string }) {
  const { copy, locale, session } = useConsole();
  const text = copy.member;
  const path = `/users/${encodeURIComponent(props.id)}`;
  const member = useResource(() => api.get<ConsoleUserDetail>(path), props.id);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (run: () => Promise<ConsoleUserDetail>, failure: string) => {
    setBusy(true);
    return run()
      .then(member.replace)
      .catch((error: unknown) => {
        reportFailure(failure, error);
        throw error;
      })
      .finally(() => setBusy(false));
  };

  if (member.error instanceof ConsoleApiError && member.error.status === 404) {
    return (
      <NotFoundPanel
        title={copy.notFound.memberTitle}
        body={copy.notFound.memberBody}
        action={copy.notFound.toMembers}
        onAction={() => navigate({ page: 'members' })}
      />
    );
  }
  if (member.error && !member.data) {
    return (
      <SettingsSection>
        <LoadFailed error={member.error} onRetry={member.reload} />
      </SettingsSection>
    );
  }
  const user = member.data;
  if (!user) return <LoadingRows rows={4} />;
  // Nobody removes their own access: the server refuses it, and the page
  // does not offer it.
  const self = user.id === session.user.id;

  return (
    <>
      <DetailHeader>
        <Avatar name={user.name} url={user.avatarUrl} size={40} />
        <div className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-[0.9375rem] font-semibold leading-5">{user.name}</h2>
            {user.orgRole === 'org_admin' && <Chip tone="active">{copy.members.admin}</Chip>}
            {user.status === 'deactivated' && (
              <Chip tone="neutral">{copy.members.deactivated}</Chip>
            )}
          </span>
          <span className="truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary">
            {user.email}
          </span>
        </div>
      </DetailHeader>

      <SettingsSection title={text.account}>
        <SettingsRow
          title={text.role}
          description={text.roleHelp}
          control={
            <Select
              value={user.orgRole}
              disabled={busy || self}
              onValueChange={(orgRole) =>
                void change(
                  () => api.patch<ConsoleUserDetail>(path, { orgRole: orgRole as ConsoleOrgRole }),
                  text.roleFailed,
                ).catch(() => undefined)
              }
            >
              <SelectTrigger aria-label={text.role} variant="ghost">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">{copy.members.member}</SelectItem>
                <SelectItem value="org_admin">{copy.members.admin}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title={user.status === 'active' ? text.active : copy.members.deactivated}
          description={user.status === 'active' ? text.activeHelp : text.deactivatedHelp}
          control={
            user.status === 'active' ? (
              <Button
                {...smallButton}
                disabled={busy || self}
                onClick={() => setPending({ kind: 'deactivate' })}
              >
                {text.deactivate}
              </Button>
            ) : (
              <Button
                {...smallButton}
                disabled={busy}
                onClick={() =>
                  void change(
                    () => api.patch<ConsoleUserDetail>(path, { status: 'active' }),
                    text.statusFailed,
                  ).catch(() => undefined)
                }
              >
                {text.activate}
              </Button>
            )
          }
        />
        <SettingsRow
          title={text.lastLogin}
          control={
            <span className="text-text-secondary">
              {user.lastLoginAt === null
                ? copy.common.never
                : formatDateTime(locale, user.lastLoginAt)}
            </span>
          }
        />
        <SettingsRow
          title={text.joined}
          control={
            <span className="text-text-secondary">{formatDate(locale, user.createdAt)}</span>
          }
        />
      </SettingsSection>

      <SettingsSection title={text.quotas} description={text.quotasHelp}>
        {user.quotas.map((quota) => {
          const used = formatCompact(locale, quota.used);
          const source = text.quotaSource[quota.source];
          return (
            <SettingsRow
              key={quota.period}
              title={
                <span className="flex items-center gap-2">
                  {quota.period === 'week' ? text.week : text.month}
                  {source && <span className="text-text-muted">· {source}</span>}
                </span>
              }
              description={
                quota.limit === null
                  ? text.quotaUnlimited(used)
                  : text.quotaUsage(
                      used,
                      formatCompact(locale, quota.limit),
                      formatDateTime(locale, quota.resetsAt),
                    )
              }
              control={
                <Button
                  {...smallButton}
                  disabled={busy}
                  onClick={() => setPending({ kind: 'quota', period: quota.period })}
                >
                  {text.setQuota}
                </Button>
              }
            />
          );
        })}
      </SettingsSection>

      <SettingsSection title={text.identities} description={text.identitiesHelp}>
        {user.links.length === 0 ? (
          <SettingsEmpty title={text.noIdentities} />
        ) : (
          user.links.map((link) => (
            <SettingsRow
              key={link.provider}
              title={providerName(link.provider)}
              description={
                <span className="block truncate">
                  <span data-mono="true">{link.subject}</span> ·{' '}
                  {formatDate(locale, link.createdAt)}
                </span>
              }
              control={
                <Button
                  {...smallButton}
                  disabled={busy}
                  onClick={() => setPending({ kind: 'unlink', provider: link.provider })}
                >
                  {text.unlink}
                </Button>
              }
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title={text.devices} description={text.devicesHelp}>
        {user.devices.length === 0 ? (
          <SettingsEmpty title={text.noDevices} />
        ) : (
          user.devices.map((device) => {
            const signedIn = device.signedIn;
            const reason = device.revokeReason
              ? text.revokeReasons[device.revokeReason]
              : undefined;
            return (
              <SettingsRow
                key={device.id}
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{device.deviceName ?? text.unnamedDevice}</span>
                    {signedIn ? (
                      <Chip tone="success">{text.online}</Chip>
                    ) : device.revokedAt === null ? (
                      // Never signed out, but too long ago to refresh.
                      <Chip tone="neutral">{text.sessionExpired}</Chip>
                    ) : (
                      <Chip tone="neutral">
                        {text.signedOut}
                        {reason ? ` · ${reason}` : ''}
                      </Chip>
                    )}
                  </span>
                }
                description={text.deviceDetail(
                  providerName(device.provider),
                  formatDateTime(locale, device.lastUsedAt),
                  formatDate(locale, device.createdAt),
                )}
                control={
                  signedIn ? (
                    <Button
                      {...smallButton}
                      disabled={busy}
                      onClick={() => setPending({ kind: 'revoke', device })}
                    >
                      {text.revoke}
                    </Button>
                  ) : null
                }
              />
            );
          })
        )}
      </SettingsSection>

      <ConfirmDialog
        open={pending?.kind === 'deactivate'}
        onOpenChange={(open) => !open && setPending(null)}
        title={text.deactivateTitle(user.name)}
        description={text.deactivateBody}
        confirmText={text.deactivate.replace('…', '')}
        cancelText={copy.common.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={() =>
          change(
            () => api.patch<ConsoleUserDetail>(path, { status: 'deactivated' }),
            text.statusFailed,
          )
            .catch(() => undefined)
            .finally(() => setPending(null))
        }
      />
      <ConfirmDialog
        open={pending?.kind === 'unlink'}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.kind === 'unlink' ? text.unlinkTitle(providerName(pending.provider)) : ''}
        description={text.unlinkBody}
        confirmText={text.unlink.replace('…', '')}
        cancelText={copy.common.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={() => {
          if (pending?.kind !== 'unlink') return;
          return change(
            () =>
              api.delete<ConsoleUserDetail>(
                `${path}/links/${encodeURIComponent(pending.provider)}`,
              ),
            text.unlinkFailed,
          )
            .catch(() => undefined)
            .finally(() => setPending(null));
        }}
      />
      <ConfirmDialog
        open={pending?.kind === 'revoke'}
        onOpenChange={(open) => !open && setPending(null)}
        title={
          pending?.kind === 'revoke'
            ? text.revokeTitle(pending.device.deviceName ?? text.unnamedDevice)
            : ''
        }
        description={text.revokeBody}
        confirmText={text.revoke.replace('…', '')}
        cancelText={copy.common.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={() => {
          if (pending?.kind !== 'revoke') return;
          return change(
            () =>
              api.post<ConsoleUserDetail>(
                `${path}/devices/${encodeURIComponent(pending.device.id)}/revoke`,
              ),
            text.revokeFailed,
          )
            .catch(() => undefined)
            .finally(() => setPending(null));
        }}
      />
      <QuotaDialog
        open={pending?.kind === 'quota'}
        title={
          pending?.kind === 'quota'
            ? copy.quotas.dialogTitle(pending.period === 'week' ? text.week : text.month)
            : ''
        }
        value={
          pending?.kind === 'quota'
            ? (user.quotas.find(
                (quota) => quota.period === pending.period && quota.source === 'user',
              )?.limit ?? null)
            : null
        }
        clearLabel={copy.quotas.inheritChoice}
        onClose={() => setPending(null)}
        onSave={async (limit) => {
          if (pending?.kind !== 'quota') return;
          try {
            await api.put(`/quotas/users/${encodeURIComponent(user.id)}/${pending.period}`, {
              limit,
            });
            member.reload();
          } catch (error) {
            reportFailure(copy.quotas.failed, error);
            throw error;
          }
        }}
      />
    </>
  );
}
