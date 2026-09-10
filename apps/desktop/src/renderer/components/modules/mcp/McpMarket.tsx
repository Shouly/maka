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
// A `platform: 'darwin'` entry is offered everywhere and labelled, rather than
// hidden off macOS: hiding it makes the catalog silently differ per machine.

import { useUiLocale } from '@maka/ui';
import { Button } from '../../ui/button.js';
import { cardBodyClass, cardSurfaceClass, cardSurfaceHoverClass } from '../../ui/card-surface.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { cn } from '../../../lib/cn.js';
import { getMcpCatalog, type McpCatalogEntry } from '../../../lib/ported/mcp-catalog.js';
import { McpBrandMark, hasMcpBrandMark } from '../../../lib/ported/mcp-brand-marks.js';
import { getMcpCopy } from '../../../locales/mcp-copy.js';

export function McpMarket(props: {
  /** Ids already in mcp.json, so an installed entry stops offering Install. */
  installedIds: readonly string[];
  busyId: string | null;
  disabled: boolean;
  onInstall: (entry: McpCatalogEntry) => void;
}) {
  const locale = useUiLocale();
  const copy = getMcpCopy(locale);
  const entries = getMcpCatalog(locale);

  return (
    <div className="grid grid-cols-1 auto-rows-min gap-4 md:grid-cols-2">
      {entries.map((entry) => {
        const installed = props.installedIds.includes(entry.id);
        return (
          <div
            key={entry.id}
            data-maka-contract="mcp-market-row"
            data-mcp-market-id={entry.id}
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
              {installed ? (
                <span className={cn(statusChipClass, statusChipToneClass('active'))}>
                  {copy.page.installed}
                </span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={props.disabled}
                  aria-busy={props.busyId === entry.id || undefined}
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
