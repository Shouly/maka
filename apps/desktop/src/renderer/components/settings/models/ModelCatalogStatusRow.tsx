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

// Where the model catalog came from, and a way to refresh it.
//
// The catalog (models.dev) decides which models get an effort picker, their
// context windows and more. It used to be refreshed once at startup with no
// trace when that failed, so a picker could lose its effort levels for a
// whole run and nothing on screen said why. This row says which table is in
// force, when it was fetched, and the last failure if there was one.

import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { uiLocaleToIntlLocale, type UiLocale } from '@maka/core/ui-locale';
import { useUiLocale } from '@maka/ui';
import { Button } from '../../ui/button.js';
import { SettingsRow } from '../settings-row.js';
import { getModelCatalogStatus, refreshModelCatalog } from '../../../bridge/connections.js';
import { connectionsStore } from '../../../store/index.js';
import type { DesktopRuntimeHostRef } from '../../../bridge/projects.js';
import type { DesktopModelCatalogStatus } from '../../../../shared/desktop-connection-snapshot.js';
import {
  getSettingsModelsCopy,
  type SettingsModelsCopy,
} from '../../../locales/settings-models-copy.js';

export function ModelCatalogStatusRow(props: {
  host: DesktopRuntimeHostRef | undefined;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const [status, setStatus] = useState<DesktopModelCatalogStatus | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const host = props.host;
  // A catalog the Host swapped in the background re-resolves every connection
  // and announces it; re-reading on that announcement keeps this line current.
  const catalogRevision = useStore(connectionsStore, (state) => state.revision);

  useEffect(() => {
    if (!host) return;
    let live = true;
    void getModelCatalogStatus(host).then(
      (next) => {
        if (!live) return;
        setStatus(next);
        setUnreadable(false);
      },
      () => {
        if (live) setUnreadable(true);
      },
    );
    return () => {
      live = false;
    };
  }, [host?.hostId, host?.profileId, catalogRevision]);

  return (
    // Under the section's own title, the row is the state: which table, since when.
    <SettingsRow
      title={
        status ? (
          modelCatalogDescription(status, copy, locale)
        ) : !host || unreadable ? (
          copy.sources.catalogUnreadable
        ) : (
          // A span, not the block Skeleton: the title is phrasing content.
          <span
            aria-hidden
            className="inline-block h-4 w-56 animate-pulse rounded-md bg-skeleton align-middle"
          />
        )
      }
      description={copy.sources.catalogHelp}
      control={
        <Button
          variant="secondary"
          size="sm"
          className="rounded-[7px] text-sm"
          disabled={!host || refreshing}
          onClick={() => {
            if (!host) return;
            setRefreshing(true);
            void refreshModelCatalog(host)
              .then(setStatus)
              .catch((error: unknown) => props.onError(copy.page.catalogRefreshFailed, error))
              .finally(() => setRefreshing(false));
          }}
        >
          {refreshing ? copy.page.catalogRefreshing : copy.page.catalogRefresh}
        </Button>
      }
    />
  );
}

/** One line: which table is in force and since when, then the last failure if any. */
export function modelCatalogDescription(
  status: DesktopModelCatalogStatus,
  copy: SettingsModelsCopy,
  locale: UiLocale,
): string {
  const when = status.fetchedAt === null ? undefined : formatWhen(status.fetchedAt, locale);
  const source =
    status.active === 'bundled' || when === undefined
      ? copy.page.catalogBundled
      : status.active === 'cache'
        ? copy.page.catalogCached(when)
        : copy.page.catalogFetched(when);
  const attempt = status.lastAttempt;
  const join = copy.page.catalogSentenceJoin;
  if (attempt?.outcome === 'failed' && attempt.error) {
    return `${source}${join}${copy.page.catalogFailed(attempt.error)}`;
  }
  if (attempt?.outcome === 'skipped') {
    return `${source}${join}${copy.page.catalogSkippedProxy}`;
  }
  return source;
}

function formatWhen(epochMs: number, locale: UiLocale): string {
  return new Intl.DateTimeFormat(uiLocaleToIntlLocale(locale), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(epochMs));
}
