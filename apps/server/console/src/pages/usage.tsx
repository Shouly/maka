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

// Usage over the last days: the totals, then who used how much and on which
// models. Weighted usage is what allowances count, so it leads each table.

import { useState } from 'react';
import type { ConsoleUsageReport, ConsoleUsageTotals } from '../../../src/admin-console/types.js';
import {
  SettingsEmpty,
  SettingsTable,
  SettingsTableCell,
  SettingsTableHeadCell,
  SettingsTableRow,
} from '@desktop/components/settings/settings-kit.js';
import { SettingsSection, settingsPanelClass } from '@desktop/components/settings/settings-row.js';
import { SegmentedControl } from '@desktop/components/ui/segmented-control.js';
import { cn } from '@desktop/lib/cn.js';
import { api } from '../api.js';
import { useConsole } from '../context.js';
import { formatCompact, formatDate, formatNumber } from '../format.js';
import { navigate } from '../router.js';
import { LoadFailed, LoadingRows } from '../ui.js';
import { useResource } from '../use-resource.js';

const RANGES = ['7', '30', '90'] as const;
type Range = (typeof RANGES)[number];

export function UsagePage() {
  const { copy, locale } = useConsole();
  const text = copy.usage;
  const [range, setRange] = useState<Range>('30');
  const report = useResource(() => api.get<ConsoleUsageReport>(`/usage?days=${range}`), range);
  const compact = (value: number) => formatCompact(locale, value);

  const totals = report.data?.totals;
  const stats: readonly {
    label: string;
    value: (totals: ConsoleUsageTotals) => string;
    detail?: (totals: ConsoleUsageTotals) => string;
  }[] = [
    { label: text.units, value: (entry) => compact(entry.units) },
    { label: text.requests, value: (entry) => formatNumber(locale, entry.requests) },
    { label: text.inputTokens, value: (entry) => compact(entry.inputTokens) },
    { label: text.outputTokens, value: (entry) => compact(entry.outputTokens) },
    {
      label: text.cacheTokens,
      value: (entry) => compact(entry.cacheReadTokens + entry.cacheWriteTokens),
      detail: (entry) =>
        text.cacheDetail(
          formatNumber(locale, entry.cacheReadTokens),
          formatNumber(locale, entry.cacheWriteTokens),
        ),
    },
    { label: text.errors, value: (entry) => formatNumber(locale, entry.errors) },
  ];

  const numbers = (entry: ConsoleUsageTotals) => (
    <>
      <SettingsTableCell className="text-right tabular-nums">
        {compact(entry.units)}
      </SettingsTableCell>
      <SettingsTableCell className="text-right tabular-nums text-text-secondary">
        {formatNumber(locale, entry.requests)}
      </SettingsTableCell>
      <SettingsTableCell className="text-right tabular-nums text-text-secondary">
        {compact(entry.inputTokens)}
      </SettingsTableCell>
      <SettingsTableCell className="text-right tabular-nums text-text-secondary">
        {compact(entry.outputTokens)}
      </SettingsTableCell>
    </>
  );
  const numberHeads = (
    <>
      <SettingsTableHeadCell className="w-[14%] text-right">
        {text.columns.units}
      </SettingsTableHeadCell>
      <SettingsTableHeadCell className="w-[14%] text-right">
        {text.columns.requests}
      </SettingsTableHeadCell>
      <SettingsTableHeadCell className="w-[14%] text-right">
        {text.columns.input}
      </SettingsTableHeadCell>
      <SettingsTableHeadCell className="w-[14%] text-right">
        {text.columns.output}
      </SettingsTableHeadCell>
    </>
  );

  return (
    <>
      <SettingsSection
        title={text.overview}
        description={report.data ? text.since(formatDate(locale, report.data.since)) : undefined}
        action={
          <SegmentedControl
            ariaLabel={text.rangeLabel}
            value={range}
            onChange={setRange}
            options={RANGES.map((value) => ({
              value,
              label: text.range(Number(value)),
              showLabel: true,
            }))}
          />
        }
      >
        {report.error && !report.data ? (
          <LoadFailed error={report.error} onRetry={report.reload} />
        ) : !totals ? (
          <LoadingRows rows={1} />
        ) : (
          <>
            <div className={cn(settingsPanelClass, 'grid grid-cols-6 divide-x divide-alpha-1')}>
              {stats.map((stat) => (
                <div
                  key={stat.label}
                  className="flex min-w-0 flex-col gap-1 px-4 py-3"
                  title={stat.detail?.(totals)}
                >
                  <span className="truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary">
                    {stat.label}
                  </span>
                  <span className="text-lg font-medium leading-6 tabular-nums">
                    {stat.value(totals)}
                  </span>
                </div>
              ))}
            </div>
            {totals.estimatedRequests > 0 && (
              <p className="!border-t-0 pt-3 text-[0.8125rem] leading-[1.125rem] text-text-muted">
                {text.estimated(formatNumber(locale, totals.estimatedRequests))}
              </p>
            )}
          </>
        )}
      </SettingsSection>

      {report.data && (
        <>
          <SettingsSection title={text.byPerson}>
            {report.data.byUser.length === 0 ? (
              <SettingsEmpty title={text.empty} />
            ) : (
              <SettingsTable
                label={text.byPerson}
                head={
                  <>
                    <SettingsTableHeadCell>{text.columns.person}</SettingsTableHeadCell>
                    {numberHeads}
                  </>
                }
              >
                {report.data.byUser.map((row) => (
                  <SettingsTableRow
                    key={row.userId}
                    onOpen={() => navigate({ page: 'member', id: row.userId })}
                    openLabel={copy.members.open(row.name)}
                  >
                    <SettingsTableCell>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{row.name}</span>
                        <span className="truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary">
                          {row.email}
                        </span>
                      </span>
                    </SettingsTableCell>
                    {numbers(row)}
                  </SettingsTableRow>
                ))}
              </SettingsTable>
            )}
          </SettingsSection>
          <SettingsSection title={text.byModel}>
            {report.data.byModel.length === 0 ? (
              <SettingsEmpty title={text.empty} />
            ) : (
              <SettingsTable
                label={text.byModel}
                head={
                  <>
                    <SettingsTableHeadCell>{text.columns.model}</SettingsTableHeadCell>
                    {numberHeads}
                  </>
                }
              >
                {report.data.byModel.map((row) => (
                  <SettingsTableRow key={row.modelId}>
                    <SettingsTableCell>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{row.displayName ?? row.modelId}</span>
                        <span
                          data-mono="true"
                          className="truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary"
                        >
                          {row.modelId}
                        </span>
                      </span>
                    </SettingsTableCell>
                    {numbers(row)}
                  </SettingsTableRow>
                ))}
              </SettingsTable>
            )}
          </SettingsSection>
        </>
      )}
    </>
  );
}
