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

// Every provider this build can connect to, grouped by how you get in.
//
// The order and the grouping are the registry's (`CATALOG_PROVIDER_TYPES` is
// sorted by `catalogOrder`, and each entry names its `catalogGroup`), not a
// table here. That is what puts the company gateway first without this file
// knowing there is a company gateway.
//
// An experimental provider is listed and not offerable. Hiding it would make
// "why can I not find X" unanswerable; showing it greyed out answers it.

import { useMemo, useState } from 'react';
import {
  CATALOG_PROVIDER_TYPES,
  PROVIDER_REGISTRY,
  type ProviderCatalogGroup,
  type ProviderType,
} from '@maka/core/provider-registry';
import { useUiLocale } from '@maka/ui';
import { Input } from '../../ui/input.js';
import { cardSurfaceHoverClass } from '../../ui/card-surface.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { cn } from '../../../lib/cn.js';
import { ProviderBrandMark } from '../../../lib/ported/provider-brand-marks.js';
import { providerDisplay } from '../../../lib/ported/provider-display-copy.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';

const GROUP_ORDER: readonly ProviderCatalogGroup[] = [
  'recommended',
  'plans',
  'api',
  'aggregators',
  'local',
];

export function ProviderCatalog(props: { onPick: (providerType: ProviderType) => void }) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const [filter, setFilter] = useState('');

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const buckets = new Map<ProviderCatalogGroup, ProviderType[]>();
    for (const providerType of CATALOG_PROVIDER_TYPES) {
      const display = providerDisplay(providerType, locale);
      if (
        needle &&
        !display.name.toLowerCase().includes(needle) &&
        !providerType.toLowerCase().includes(needle) &&
        !display.description.toLowerCase().includes(needle)
      ) {
        continue;
      }
      // An entry with no declared group is an API-key provider by default:
      // that is what every ungrouped entry in the registry has been.
      const group = PROVIDER_REGISTRY[providerType].catalogGroup ?? 'api';
      const bucket = buckets.get(group);
      if (bucket) bucket.push(providerType);
      else buckets.set(group, [providerType]);
    }
    return GROUP_ORDER.flatMap((group) => {
      const providers = buckets.get(group);
      return providers && providers.length > 0 ? [{ group, providers }] : [];
    });
  }, [filter, locale]);

  return (
    <div data-maka-contract="provider-catalog" className="flex flex-col gap-6">
      <Input
        aria-label={copy.panel.searchAria}
        placeholder={copy.panel.searchPlaceholder}
        className="w-72"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      {groups.length === 0 && (
        <p className="text-sm leading-5 text-text-secondary" role="status">
          {copy.panel.noMatch}
        </p>
      )}

      {groups.map(({ group, providers }) => (
        <section key={group} className="flex flex-col gap-3">
          <h3 className="text-[0.8125rem] font-medium leading-[1.125rem] text-text-secondary">
            {copy.panel.groups[group]}
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {providers.map((providerType) => {
              const display = providerDisplay(providerType, locale);
              const experimental = PROVIDER_REGISTRY[providerType].status !== 'ready';
              return (
                <button
                  key={providerType}
                  type="button"
                  disabled={experimental}
                  aria-label={copy.catalog.cardAria(display.name, display.description)}
                  onClick={() => props.onPick(providerType)}
                  className={cn(
                    cardSurfaceHoverClass,
                    'flex cursor-pointer items-start gap-3 p-3 text-left outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:cursor-default disabled:opacity-60',
                  )}
                >
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-text-secondary [&>img]:size-full [&>svg]:size-full">
                    <ProviderBrandMark type={providerType} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium leading-5 text-text-primary">
                        {display.name}
                      </span>
                      {display.badge && (
                        <span className={cn(statusChipClass, statusChipToneClass('neutral'))}>
                          {display.badge}
                        </span>
                      )}
                      {experimental && (
                        <span className={cn(statusChipClass, statusChipToneClass('attention'))}>
                          {copy.catalog.unavailable}
                        </span>
                      )}
                    </span>
                    <span className="text-[0.8125rem] leading-[1.125rem] text-text-secondary">
                      {display.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
