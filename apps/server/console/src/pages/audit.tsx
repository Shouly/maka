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

// The audit log, newest first, a hundred at a time. A kind narrows it to one
// family of actions; an entry names who did it (a person, the command line,
// or the system itself), what, and to what.

import { useRef, useState } from 'react';
import type { ConsoleAuditEntry, ConsoleAuditPage } from '../../../src/admin-console/types.js';
import {
  SettingsEmpty,
  SettingsTable,
  SettingsTableCell,
  SettingsTableHeadCell,
  SettingsTableRow,
} from '@desktop/components/settings/settings-kit.js';
import { SettingsSection } from '@desktop/components/settings/settings-row.js';
import { Button } from '@desktop/components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@desktop/components/ui/select.js';
import { api } from '../api.js';
import { useConsole } from '../context.js';
import type { ConsoleCopy } from '../copy.js';
import { formatDateTime, providerName } from '../format.js';
import { LoadFailed, LoadingRows, reportFailure, smallButton } from '../ui.js';
import { useResource } from '../use-resource.js';

const FILTERS = [
  'all',
  'admin.',
  'user.',
  'session.',
  'identity.',
  'model_provider.',
  'model.',
  'quota.',
  'web_search.',
  'signin.',
] as const;

/** What an entry was done to, in words: its name where the server knows it, else from its detail. */
function targetOf(entry: ConsoleAuditEntry, copy: ConsoleCopy): string {
  if (entry.targetType === 'quota' && entry.targetId) {
    // `<scope>:<person or *>:<period>`
    const [scope, , period] = entry.targetId.split(':');
    const who =
      scope === 'user_default' ? copy.audit.organizationDefault : (entry.targetLabel ?? scope);
    return `${who} · ${period === 'month' ? copy.quotas.month : copy.quotas.week}`;
  }
  if (entry.targetType === 'web_search') return 'Tavily';
  if (entry.targetLabel) return entry.targetLabel;
  const detail = entry.detail as Record<string, unknown>;
  if (typeof detail.name === 'string') return detail.name;
  if (typeof detail.provider === 'string') return providerName(detail.provider);
  return entry.targetId ?? '';
}

export function AuditPage() {
  const { copy, locale } = useConsole();
  const text = copy.audit;
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const query = filter === 'all' ? '' : `?action=${encodeURIComponent(filter)}`;
  const first = useResource(() => api.get<ConsoleAuditPage>(`/audit${query}`), filter);
  const [more, setMore] = useState<{ entries: ConsoleAuditEntry[]; next: string | null } | null>(
    null,
  );
  const [loadingMore, setLoadingMore] = useState(false);
  // Bumped when the filter changes: a page asked for under the old filter is dropped.
  const generation = useRef(0);
  const entries = [...(first.data?.entries ?? []), ...(more?.entries ?? [])];
  const next = more ? more.next : (first.data?.nextBefore ?? null);

  const loadMore = () => {
    if (!next || loadingMore) return;
    const asked = generation.current;
    setLoadingMore(true);
    const separator = query ? '&' : '?';
    api
      .get<ConsoleAuditPage>(`/audit${query}${separator}before=${next}`)
      .then((page) => {
        if (generation.current !== asked) return;
        setMore((current) => ({
          entries: [...(current?.entries ?? []), ...page.entries],
          next: page.nextBefore,
        }));
      })
      .catch((error: unknown) => reportFailure(copy.common.loadFailed, error))
      .finally(() => setLoadingMore(false));
  };

  const actorOf = (entry: ConsoleAuditEntry) =>
    entry.actor?.name ?? (entry.detail.via === 'admin-cli' ? text.cli : text.system);

  return (
    <SettingsSection
      title={text.title}
      description={text.help}
      action={
        <Select
          value={filter}
          onValueChange={(value) => {
            generation.current += 1;
            setFilter(value as (typeof FILTERS)[number]);
            setMore(null);
          }}
        >
          <SelectTrigger aria-label={text.filter} variant="ghost">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((value) => (
              <SelectItem key={value} value={value}>
                {text.filters[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {first.error && !first.data ? (
        <LoadFailed error={first.error} onRetry={first.reload} />
      ) : !first.data ? (
        <LoadingRows />
      ) : entries.length === 0 ? (
        <SettingsEmpty title={text.empty} />
      ) : (
        <>
          <SettingsTable
            label={text.title}
            head={
              <>
                <SettingsTableHeadCell className="w-[22%]">
                  {text.columns.time}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-[22%]">
                  {text.columns.actor}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell className="w-[28%]">
                  {text.columns.action}
                </SettingsTableHeadCell>
                <SettingsTableHeadCell>{text.columns.target}</SettingsTableHeadCell>
              </>
            }
          >
            {entries.map((entry) => (
              <SettingsTableRow key={entry.id}>
                <SettingsTableCell className="text-text-secondary tabular-nums">
                  {formatDateTime(locale, entry.at)}
                </SettingsTableCell>
                <SettingsTableCell className="truncate" title={entry.actor?.email}>
                  {actorOf(entry)}
                </SettingsTableCell>
                <SettingsTableCell className="truncate" title={entry.action}>
                  {text.actions[entry.action] ?? entry.action}
                </SettingsTableCell>
                <SettingsTableCell
                  className="truncate text-text-secondary"
                  title={entry.ip ?? undefined}
                >
                  {targetOf(entry, copy)}
                </SettingsTableCell>
              </SettingsTableRow>
            ))}
          </SettingsTable>
          {next && (
            <div className="flex justify-center pt-4">
              <Button {...smallButton} disabled={loadingMore} onClick={loadMore}>
                {text.loadMore}
              </Button>
            </div>
          )}
        </>
      )}
    </SettingsSection>
  );
}
