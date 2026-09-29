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

// Allowances: the organization's default per period, then the people who
// have one of their own. A person's row opens their page, where theirs is
// changed alongside their usage; adding one here picks the person first.

import { useState } from 'react';
import type {
  ConsoleQuotaPeriod,
  ConsoleQuotas,
  ConsoleUser,
} from '../../../src/admin-console/types.js';
import {
  SettingsEmpty,
  SettingsModal,
  SettingsModalField,
  SettingsTable,
  SettingsTableCell,
  SettingsTableHeadCell,
  SettingsTableRow,
} from '@desktop/components/settings/settings-kit.js';
import { SettingsRow, SettingsSection } from '@desktop/components/settings/settings-row.js';
import { Button } from '@desktop/components/ui/button.js';
import { Input } from '@desktop/components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@desktop/components/ui/select.js';
import { api } from '../api.js';
import { useConsole } from '../context.js';
import { formatCompact, formatNumber } from '../format.js';
import { navigate } from '../router.js';
import { LoadFailed, LoadingRows, reportFailure, smallButton } from '../ui.js';
import { useResource } from '../use-resource.js';
import { QuotaDialog } from './quota-dialog.js';

const PERIODS: readonly ConsoleQuotaPeriod[] = ['week', 'month'];

export function QuotasPage() {
  const { copy, locale } = useConsole();
  const text = copy.quotas;
  const quotas = useResource(() => api.get<ConsoleQuotas>('/quotas'), 'quotas');
  const [editing, setEditing] = useState<ConsoleQuotaPeriod | null>(null);
  const [adding, setAdding] = useState(false);
  const periodLabel = (period: ConsoleQuotaPeriod) => (period === 'week' ? text.week : text.month);
  const limitText = (value: number | null, none: string) =>
    value === null ? none : copy.common.units(formatCompact(locale, value));

  return (
    <>
      <SettingsSection title={text.defaults} description={text.defaultsHelp}>
        {quotas.error && !quotas.data ? (
          <LoadFailed error={quotas.error} onRetry={quotas.reload} />
        ) : !quotas.data ? (
          <LoadingRows rows={2} />
        ) : (
          PERIODS.map((period) => {
            const value = quotas.data!.defaults[period];
            return (
              <SettingsRow
                key={period}
                title={periodLabel(period)}
                description={period === 'week' ? text.weekHelp : text.monthHelp}
                control={
                  <span className="flex items-center gap-3">
                    <span
                      className="text-text-secondary"
                      title={value === null ? undefined : formatNumber(locale, value)}
                    >
                      {limitText(value, copy.common.unlimited)}
                    </span>
                    <Button {...smallButton} onClick={() => setEditing(period)}>
                      {copy.common.edit}
                    </Button>
                  </span>
                }
              />
            );
          })
        )}
      </SettingsSection>

      <SettingsSection
        title={text.people}
        description={text.peopleHelp}
        action={
          <Button {...smallButton} disabled={!quotas.data} onClick={() => setAdding(true)}>
            {text.addPerson}
          </Button>
        }
      >
        {!quotas.data ? null : quotas.data.users.length === 0 ? (
          <SettingsEmpty title={text.noPeople} />
        ) : (
          <SettingsTable
            label={text.people}
            head={
              <>
                <SettingsTableHeadCell className="w-[50%]">
                  {text.columns.person}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell>{text.columns.week}</SettingsTableHeadCell>
                <SettingsTableHeadCell>{text.columns.month}</SettingsTableHeadCell>
              </>
            }
          >
            {quotas.data.users.map((person) => (
              <SettingsTableRow
                key={person.userId}
                onOpen={() => navigate({ page: 'member', id: person.userId })}
                openLabel={copy.members.open(person.name)}
              >
                <SettingsTableCell>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{person.name}</span>
                    <span className="truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary">
                      {person.email}
                    </span>
                  </span>
                </SettingsTableCell>
                {PERIODS.map((period) => (
                  <SettingsTableCell key={period} className="text-text-secondary">
                    {limitText(person.limits[period], text.inherit)}
                  </SettingsTableCell>
                ))}
              </SettingsTableRow>
            ))}
          </SettingsTable>
        )}
        <p className="pt-3 text-[0.8125rem] leading-[1.125rem] text-text-muted">{text.units}</p>
      </SettingsSection>

      <QuotaDialog
        open={editing !== null}
        title={editing ? text.dialogTitle(periodLabel(editing)) : ''}
        value={editing && quotas.data ? quotas.data.defaults[editing] : null}
        clearLabel={text.unlimitedChoice}
        onClose={() => setEditing(null)}
        onSave={async (limit) => {
          if (!editing) return;
          try {
            quotas.replace(await api.put<ConsoleQuotas>(`/quotas/default/${editing}`, { limit }));
          } catch (error) {
            reportFailure(text.failed, error);
            throw error;
          }
        }}
      />
      <AddPersonQuota open={adding} onClose={() => setAdding(false)} onSaved={quotas.replace} />
    </>
  );
}

/** Pick a member and a period, and set that member's own allowance. */
function AddPersonQuota(props: {
  open: boolean;
  onClose: () => void;
  onSaved: (quotas: ConsoleQuotas) => void;
}) {
  const { copy } = useConsole();
  const text = copy.quotas;
  const users = useResource(
    () => (props.open ? api.get<ConsoleUser[]>('/users') : Promise.resolve([])),
    String(props.open),
  );
  const [userId, setUserId] = useState('');
  const [period, setPeriod] = useState<ConsoleQuotaPeriod>('week');
  const [limit, setLimit] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setUserId('');
    setLimit('');
    setInvalid(false);
    props.onClose();
  };
  const submit = () => {
    const value = Number(limit.trim());
    if (!userId || limit.trim() === '' || !Number.isFinite(value) || value < 0) {
      setInvalid(true);
      return;
    }
    setSaving(true);
    api
      .put<ConsoleQuotas>(`/quotas/users/${encodeURIComponent(userId)}/${period}`, { limit: value })
      .then((next) => {
        props.onSaved(next);
        close();
      })
      .catch((error: unknown) => reportFailure(text.failed, error))
      .finally(() => setSaving(false));
  };

  return (
    <SettingsModal
      open={props.open}
      onOpenChange={(open) => !open && close()}
      size="sm"
      title={text.addPerson}
      description={text.peopleHelp}
      footer={
        <>
          <Button variant="secondary" disabled={saving} onClick={close}>
            {copy.common.cancel}
          </Button>
          <Button disabled={saving} onClick={submit}>
            {saving ? copy.common.saving : copy.common.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <SettingsModalField label={text.personField} htmlFor="quota-person">
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger id="quota-person" aria-label={text.personField}>
              <SelectValue placeholder={text.personPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {(users.data ?? []).map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name} · {user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsModalField>
        <SettingsModalField label={text.periodField} htmlFor="quota-period">
          <Select value={period} onValueChange={(value) => setPeriod(value as ConsoleQuotaPeriod)}>
            <SelectTrigger id="quota-period" aria-label={text.periodField}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">{text.week}</SelectItem>
              <SelectItem value="month">{text.month}</SelectItem>
            </SelectContent>
          </Select>
        </SettingsModalField>
        <SettingsModalField
          label={text.limit}
          htmlFor="quota-person-limit"
          hint={invalid ? <span className="text-danger">{text.invalidLimit}</span> : undefined}
        >
          <Input
            id="quota-person-limit"
            inputMode="numeric"
            value={limit}
            placeholder={text.limitPlaceholder}
            onChange={(event) => {
              setLimit(event.target.value);
              setInvalid(false);
            }}
          />
        </SettingsModalField>
      </div>
    </SettingsModal>
  );
}
