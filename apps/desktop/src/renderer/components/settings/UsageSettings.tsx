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

// What the Host has spent, over a window the user picks.
//
// Cost is qualified, never asserted: `estimatedUsageCost` returns undefined
// when nothing in the range was priced, and a `$0.00` in that case would be a
// claim the ledger cannot make. The same goes for `hasUnavailableUsage` —
// records that failed to decode make every total read low, and saying so is
// the difference between a report and a guess.
//
// Breakdowns are bands rather than a chart: the value already reads as a
// number beside its label, so the bar only has to answer "which of these is
// big", and a charting dependency for one horizontal rectangle is not a
// trade worth making (same call as the Trace face, Phase 4).

import { useState } from 'react';
import type { UsageRange, UsageStats } from '@maka/core/settings';
import { estimatedUsageCost, hasUnavailableUsage } from '@maka/core/usage-ledger-merge';
import { useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { SegmentedControl } from '../ui/segmented-control.js';
import { Skeleton } from '../ui/skeleton.js';
import { cn } from '../../lib/cn.js';
import { SettingsRow, SettingsSection, settingsPanelClass } from './settings-row.js';
import { getUsageStats } from '../../bridge/settings.js';
import { useAsync } from '../../hooks/use-async.js';
import { useClientSettings, useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { settingsStore } from '../../store/index.js';
import { getSettingsCopy } from '../../locales/settings-copy.js';
import { getSettingsNavigationCopy } from '../../locales/settings-navigation-copy.js';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';
import { getUsageSettingsCopy } from '../../locales/settings-usage-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

const RANGES: readonly UsageRange[] = ['24h', '7d', '30d', 'all'];
type Breakdown = 'providers' | 'models' | 'tools' | 'pricing';
const BREAKDOWNS: readonly Breakdown[] = ['providers', 'models', 'tools', 'pricing'];

export function UsageSettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const copy = getUsageSettingsCopy(locale);
  const own = getSettingsCopy(locale).usage;
  const shared = getSettingsSharedCopy(locale);
  const page = getSettingsNavigationCopy(locale).sections.usage;
  const report = useSettingsErrorReporter();
  const client = useClientSettings();
  const host = props.host;
  const range = client.data?.usage.range ?? '7d';
  const [tab, setTab] = useState<Breakdown>('models');
  const stats = useAsync(() => getUsageStats(range, host), [range, host?.profileId, host?.hostId]);

  const setRange = (next: UsageRange) => {
    void settingsStore
      .updateClient({ usage: { range: next } })
      .catch((error: unknown) => report(copy.saveFailed, error));
  };

  return (
    <>
      <SettingsSection
        title={page.label}
        description={`${page.description} ${copy.costHelp}`}
        action={
          <span className="flex items-center gap-2">
            <SegmentedControl
              size="sm"
              ariaLabel={copy.rangeAria}
              value={range}
              onChange={setRange}
              options={RANGES.map((value, index) => ({
                value,
                label: copy.ranges[index] ?? value,
              }))}
            />
            <Button
              variant="secondary"
              size="sm"
              aria-label={copy.refreshAria}
              onClick={stats.reload}
            >
              {copy.refreshAria}
            </Button>
          </span>
        }
      >
        {stats.loading && !stats.data ? (
          <div className="flex flex-col gap-2 py-3" role="status" aria-label={shared.loading}>
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : !stats.data ? (
          <SettingsRow title={shared.usageLoadFailed} control={null} />
        ) : (
          <UsageTotals stats={stats.data} copy={copy} />
        )}
      </SettingsSection>

      {stats.data && (
        <SettingsSection
          title={copy.viewAria}
          action={
            <SegmentedControl
              size="sm"
              ariaLabel={copy.viewAria}
              value={tab}
              onChange={setTab}
              options={BREAKDOWNS.map((value, index) => ({
                value,
                label: copy.tabs[index + 1] ?? value,
              }))}
            />
          }
        >
          <Breakdowns stats={stats.data} tab={tab} copy={copy} own={own} />
        </SettingsSection>
      )}
    </>
  );
}

function UsageTotals(props: { stats: UsageStats; copy: ReturnType<typeof getUsageSettingsCopy> }) {
  const { stats, copy } = props;
  const cost = estimatedUsageCost(stats.provenance, stats.summary.totalCostUsd);
  const costLabel =
    cost !== undefined
      ? `$${cost.toFixed(2)}`
      : stats.summary.totalRequests === 0
        ? '$0.00'
        : copy.costUnavailable;
  const incomplete = hasUnavailableUsage(stats.provenance) || stats.logsTruncated === true;
  return (
    <div className="flex flex-col gap-3 py-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" aria-label={copy.summaryAria}>
        <Metric label={copy.totalRequests} value={String(stats.summary.totalRequests)} />
        <Metric label={copy.totalCost} value={costLabel} />
        <Metric
          label={copy.totalTokens}
          value={String(stats.summary.totalTokens)}
          detail={copy.tokenDetail(stats.summary.inputTokens, stats.summary.outputTokens)}
        />
        <Metric
          label={copy.cacheTokens}
          value={String(stats.summary.cacheTokens)}
          detail={copy.cacheDetail(
            stats.summary.cacheMiss,
            stats.summary.cacheRead,
            stats.summary.cacheCreation,
          )}
        />
      </div>
      {incomplete && (
        <p className="text-[13px] leading-[18px] text-warning" role="status">
          {`${copy.incompleteTitle} ${copy.incompleteBody}`}
        </p>
      )}
    </div>
  );
}

function Metric(props: { label: string; value: string; detail?: string }) {
  return (
    <div className={cn(settingsPanelClass, 'flex flex-col gap-1 p-3')}>
      <span className="text-[13px] leading-[18px] text-text-muted">{props.label}</span>
      <span className="text-lg leading-6 text-text-primary" data-mono="true">
        {props.value}
      </span>
      {props.detail && (
        <span className="text-[11px] leading-4 text-text-muted">{props.detail}</span>
      )}
    </div>
  );
}

function Breakdowns(props: {
  stats: UsageStats;
  tab: Breakdown;
  copy: ReturnType<typeof getUsageSettingsCopy>;
  own: ReturnType<typeof getSettingsCopy>['usage'];
}) {
  const { stats, tab, copy, own } = props;
  if (tab === 'pricing') {
    if (stats.pricing.length === 0)
      return <SettingsRow title={copy.tables.pricingEmptyBody} control={null} />;
    return (
      <>
        {stats.pricing.map((row) => (
          <SettingsRow
            key={`${row.provider}:${row.model}`}
            title={row.model}
            description={row.provider}
            control={
              <span className="text-[13px] leading-[18px] text-text-secondary" data-mono="true">
                {`$${row.inputPerMTokUsd} / $${row.outputPerMTokUsd}`}
              </span>
            }
          />
        ))}
      </>
    );
  }
  if (tab === 'tools') {
    if (stats.byTool.length === 0)
      return (
        <SettingsRow
          title={copy.tables.toolEmptyTitle}
          description={copy.tables.toolEmptyBody}
          control={null}
        />
      );
    const max = Math.max(...stats.byTool.map((row) => row.calls), 1);
    return (
      <>
        {stats.byTool.map((row) => (
          <SettingsRow
            key={row.tool}
            layout="stacked"
            title={row.tool}
            description={`${own.calls} ${row.calls} · ${own.averageDuration} ${Math.round(row.avgDurationMs)}ms`}
          >
            <Band
              value={row.calls}
              max={max}
              label={own.shareOf(String(row.calls), percent(row.calls, max))}
            />
          </SettingsRow>
        ))}
      </>
    );
  }
  const rows =
    tab === 'providers'
      ? stats.byProvider.map((row) => ({
          key: row.provider,
          label: row.provider,
          requests: row.requests,
          tokens: row.tokens,
          costUsd: row.costUsd,
        }))
      : stats.byModel.map((row) => ({
          key: row.model,
          label: row.model,
          requests: row.requests,
          tokens: row.tokens,
          costUsd: row.costUsd,
        }));
  if (rows.length === 0)
    return (
      <SettingsRow
        title={tab === 'providers' ? copy.tables.providerEmptyTitle : copy.tables.modelEmptyTitle}
        description={
          tab === 'providers' ? copy.tables.providerEmptyBody : copy.tables.modelEmptyBody
        }
        control={null}
      />
    );
  const max = Math.max(...rows.map((row) => row.tokens), 1);
  return (
    <>
      {rows.map((row) => (
        <SettingsRow
          key={row.key}
          layout="stacked"
          title={row.label}
          description={`${own.requests} ${row.requests} · ${own.tokens} ${row.tokens} · ${own.cost} $${row.costUsd.toFixed(2)}`}
        >
          <Band
            value={row.tokens}
            max={max}
            label={own.shareOf(String(row.tokens), percent(row.tokens, max))}
          />
        </SettingsRow>
      ))}
    </>
  );
}

function percent(value: number, max: number): number {
  return Math.round((value / max) * 100);
}

function Band(props: { value: number; max: number; label: string }) {
  const width = Math.max(2, Math.min(100, (props.value / props.max) * 100));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-alpha-1"
      role="img"
      aria-label={props.label}
    >
      <div className="h-full rounded-full bg-accent-fill" style={{ width: `${width}%` }} />
    </div>
  );
}
