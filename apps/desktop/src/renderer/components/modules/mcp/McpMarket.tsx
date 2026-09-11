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

// The shipped MCP directory: a card grid over `lib/ported/mcp-catalog.ts`.
//
// Every entry carries a complete `McpServerConfig`, so "Install" is one
// `mcp.install` with that config — there is no fetch and no registry behind
// this, and consequently no entry that cannot be installed.
//
// What an entry does NOT carry is credentials. `setupRequired` marks the ones
// whose config ships blank environment values; installing one adds a DISABLED
// server plus the "finish configuring credentials" toast, which is exactly
// what the pre-rewrite page did. The row states the requirement up front
// (`setupLabel`) so the disabled result is not a surprise.
//
// An install is a LIVE operation, not a click that returns: main commits the
// config and then connects, and the connect can hang on a network the machine
// does not have. So the card keeps its own phase — installing, then
// cancelling — and offers `mcp.cancelInstall`, which withdraws exactly that
// install's own write (a newer same-id config that landed meanwhile survives).
//
// An entry that is already installed offers Manage instead, which hands the
// page back to Yours with that server's editor open: the directory is where
// people look for a server they installed from it, and "Installed" as a dead
// chip sent them hunting for the row themselves.
//
// A `platform: 'darwin'` entry is offered everywhere and labelled, rather than
// hidden off macOS: hiding it makes the catalog silently differ per machine.

import { useUiLocale } from '@maka/ui';
import { Button } from '../../ui/button.js';
import { cardBodyClass, cardSurfaceClass, cardSurfaceHoverClass } from '../../ui/card-surface.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { ListEmptyState } from '../../ui/list-page.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { cn } from '../../../lib/cn.js';
import {
  catalogEntryMatches,
  getMcpCatalog,
  type McpCatalogEntry,
} from '../../../lib/ported/mcp-catalog.js';
import { McpBrandMark, hasMcpBrandMark } from '../../../lib/ported/mcp-brand-marks.js';
import { normalizeConnectorQuery } from './connectors-list.js';
import { getMcpCopy } from '../../../locales/mcp-copy.js';
import { getConnectorsPageCopy } from '../../../locales/connectors-page-copy.js';

/** Where a directory install has got to. Absent means "not installing". */
export type McpInstallPhase = 'installing' | 'cancelling';

export function McpMarket(props: {
  /** Ids already in mcp.json, so an installed entry offers Manage instead. */
  installedIds: readonly string[];
  installPhases: Readonly<Record<string, McpInstallPhase>>;
  /** The toolbar's search, applied to id, name, description, category, aliases. */
  query: string;
  disabled: boolean;
  onInstall: (entry: McpCatalogEntry) => void;
  onCancelInstall: (entry: McpCatalogEntry) => void;
  onManage: (entry: McpCatalogEntry) => void;
  onClearSearch: () => void;
}) {
  const locale = useUiLocale();
  const copy = getMcpCopy(locale);
  const connectors = getConnectorsPageCopy(locale);
  const normalized = normalizeConnectorQuery(props.query);
  const entries = getMcpCatalog(locale).filter((entry) => catalogEntryMatches(entry, normalized));

  if (entries.length === 0) {
    return (
      <ListEmptyState
        icon={<Anthropicon name="search" size={20} />}
        title={copy.page.noMarket}
        description={copy.page.noMarketDetail(props.query.trim())}
        action={
          <Button variant="secondary" size="sm" onClick={props.onClearSearch}>
            {copy.page.clearSearch}
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 auto-rows-min gap-4 md:grid-cols-2">
      {entries.map((entry) => {
        const installed = props.installedIds.includes(entry.id);
        const phase = props.installPhases[entry.id];
        return (
          <div
            key={entry.id}
            data-maka-contract="mcp-market-row"
            data-mcp-market-id={entry.id}
            data-mcp-install-phase={phase}
            className={cn(cardSurfaceClass, cardSurfaceHoverClass, 'relative h-full')}
          >
            <div className={cardBodyClass}>
              <div className="flex items-center gap-3 pr-24">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-[9.72px]',
                    'border border-hairline bg-surface-2 text-xs font-medium text-text-secondary',
                    // The marks carry their own paint (`McpBrandMark`); the
                    // plate only sizes them. A `fill-current` here would beat
                    // it — a descendant selector outranks the element's own
                    // class — and put the directory back to one grey square
                    // per vendor.
                    '[&_svg]:size-5',
                  )}
                >
                  {hasMcpBrandMark(entry.id) ? <McpBrandMark entry={entry} /> : entry.mark}
                </span>
                <h4 className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                  {entry.name}
                </h4>
              </div>
              <p className="line-clamp-2 text-pretty text-xs text-text-muted">
                {entry.description}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {/* The live phase leads: while an install is running it is the
                    only thing on the card that is about to change. */}
                {phase && (
                  <span className={cn(statusChipClass, statusChipToneClass('active'))}>
                    {phase === 'cancelling' ? copy.card.cancelling : connectors.install.installing}
                  </span>
                )}
                <span className={cn(statusChipClass, statusChipToneClass('neutral'))}>
                  {entry.category}
                </span>
                {entry.platform === 'darwin' && (
                  <span className={cn(statusChipClass, statusChipToneClass('neutral'))}>
                    {copy.card.macOnly}
                  </span>
                )}
                {entry.setupLabel && (
                  <span className="text-xs text-text-muted">{entry.setupLabel}</span>
                )}
              </div>
            </div>
            <div className="absolute right-4 top-4 z-10">
              {phase ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={phase === 'cancelling'}
                  aria-busy={phase === 'cancelling' || undefined}
                  aria-label={
                    phase === 'cancelling'
                      ? copy.card.cancellingAria(entry.name)
                      : copy.card.cancelAria(entry.name)
                  }
                  onClick={() => props.onCancelInstall(entry)}
                >
                  {phase === 'cancelling' ? copy.card.cancelling : copy.card.cancel}
                </Button>
              ) : installed ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={props.disabled}
                  aria-label={connectors.install.manageAria(entry.name)}
                  onClick={() => props.onManage(entry)}
                >
                  {copy.card.manage}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={props.disabled}
                  aria-label={copy.card.installAria(entry.name)}
                  onClick={() => props.onInstall(entry)}
                >
                  {copy.card.install}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
