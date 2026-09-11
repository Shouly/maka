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

// Why sending might not work, grouped by the layer that would stop it.
//
// Read-only: every row here is produced by something else (a connection test,
// a capability snapshot, a permission read), so the page offers a refresh and
// nothing more — a "fix" button would have to guess which of five subsystems
// owns the failure.
//
// The two blocker banners are computed over the WHOLE snapshot, not the
// filtered view: "three signals are blocking sends" stops being true the
// moment a filter hides one of them, and a count that changes when you filter
// is a count nobody can act on.

import { HEALTH_SIGNAL_LAYERS, type HealthSignal } from '@maka/core/health';
import { useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { Skeleton } from '../ui/skeleton.js';
import {
  statusChipClass,
  statusChipDangerClass,
  statusChipWarningClass,
  statusChipToneClass,
} from '../ui/status-chip.js';
import { cn } from '../../lib/cn.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import { getHealthSnapshot } from '../../bridge/permissions.js';
import { useAsync } from '../../hooks/use-async.js';
import { capabilityReasonMessage } from '../../locales/capability-reason-copy.js';
import { botStatusReasonCopy } from '../../locales/settings-bot-copy.js';
import { getHealthCenterCopy, type HealthCenterCopy } from '../../locales/settings-health-copy.js';
import type { UiLocale } from '@maka/core/ui-locale';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

export function HealthSettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const copy = getHealthCenterCopy(locale);
  const shared = getSettingsSharedCopy(locale);
  const host = props.host;
  const snapshot = useAsync(() => getHealthSnapshot(host), [host?.profileId, host?.hostId]);

  if (snapshot.loading && !snapshot.data) return <HealthSkeleton label={shared.loading} />;
  if (!snapshot.data) {
    return (
      <SettingsSection title={copy.title} description={copy.subtitle}>
        <SettingsRow
          title={copy.readFailed}
          control={
            <Button variant="secondary" size="sm" onClick={snapshot.reload}>
              {copy.readAgain}
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  const data = snapshot.data;
  const signals = data.signals;
  const blocksSend = signals.filter((signal) => signal.blocksSend === true).length;
  const blocksCapability = signals.filter((signal) => signal.blocksCapability === true).length;
  const byLayer = new Map<string, HealthSignal[]>();
  for (const signal of signals) {
    const bucket = byLayer.get(signal.layer);
    if (bucket) bucket.push(signal);
    else byLayer.set(signal.layer, [signal]);
  }

  return (
    <>
      <SettingsSection
        title={copy.title}
        description={copy.subtitle}
        action={
          <Button variant="secondary" size="sm" onClick={snapshot.reload}>
            {copy.refresh}
          </Button>
        }
      >
        <SettingsRow
          title={copy.summaryAria}
          control={
            <span className="flex flex-wrap items-center gap-1.5">
              {(['ok', 'info', 'warning', 'error', 'unknown'] as const).map((status) => (
                <span
                  key={status}
                  className={cn(statusChipClass, statusChipToneClass(copy.statuses[status].tone))}
                >
                  {`${copy.statuses[status].label} ${data.summary[status]}`}
                </span>
              ))}
            </span>
          }
        />
        {blocksSend > 0 && (
          <p className="py-3 text-[0.8125rem] leading-[1.125rem] text-danger" role="status">
            {copy.blockers.send(blocksSend, signals.length)}
          </p>
        )}
        {blocksSend === 0 && blocksCapability > 0 && (
          <p className="py-3 text-[0.8125rem] leading-[1.125rem] text-warning" role="status">
            {copy.blockers.capability(blocksCapability, signals.length)}
          </p>
        )}
      </SettingsSection>

      {HEALTH_SIGNAL_LAYERS.filter((layer) => (byLayer.get(layer)?.length ?? 0) > 0).map(
        (layer) => (
          <SettingsSection
            key={layer}
            title={copy.layers[layer].label}
            description={copy.layers[layer].description}
          >
            {(byLayer.get(layer) ?? []).map((signal) => (
              <SettingsRow
                key={signal.id}
                title={`${copy.signalLabel(signal)} · ${copy.scopes[signal.scope]}`}
                description={
                  <span className="flex flex-col gap-0.5">
                    <span>{copy.signalMessage(signal)}</span>
                    {signalDetail(signal, copy, locale) && (
                      <span>{signalDetail(signal, copy, locale)}</span>
                    )}
                    <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {signal.source !== 'capability_snapshot' && (
                        <span className="text-text-muted">
                          {`${copy.source} ${copy.sources[signal.source]}`}
                        </span>
                      )}
                      {signal.blocksSend === true && (
                        <span className={cn(statusChipClass, statusChipDangerClass)}>
                          {copy.blocksSend}
                        </span>
                      )}
                      {signal.blocksCapability === true && (
                        <span className={cn(statusChipClass, statusChipWarningClass)}>
                          {copy.blocksCapability}
                        </span>
                      )}
                    </span>
                  </span>
                }
                control={
                  <span
                    className={cn(
                      statusChipClass,
                      statusChipToneClass(copy.statuses[signal.status].tone),
                    )}
                  >
                    {copy.statuses[signal.status].label}
                  </span>
                }
              />
            ))}
          </SettingsSection>
        ),
      )}
      <p className="text-[0.8125rem] leading-[1.125rem] text-text-muted">{copy.footnote}</p>
    </>
  );
}

function HealthSkeleton(props: { label: string }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label={props.label}>
      {[0, 1, 2, 3].map((index) => (
        <Skeleton key={index} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

// Capability reasons are machine codes (#4551): the shared capability catalog
// first, then the bot bridge's own status reasons, then the health catalog's
// per-locale fallback sentence.
function signalDetail(signal: HealthSignal, copy: HealthCenterCopy, locale: UiLocale) {
  const detail = signal.detail;
  if (detail?.kind !== 'capability_reason') return copy.signalDetail(signal);
  return (
    capabilityReasonMessage(detail.reason, locale) ??
    (signal.relatedCapabilityId?.startsWith('bot:')
      ? botStatusReasonCopy(detail.reason, locale)
      : undefined) ??
    copy.signalDetail(signal)
  );
}
