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

// How full the context is: a ring, and what it is made of.
//
// Ported from the reference design system's `ContextUsageIndicator`, minus its
// archive flow (Maka compacts through `sessions.compact`, which the popover
// offers instead) and minus the proactive callout, which belongs to a product
// decision Phase 3b makes with the composer.
//
// The rest is verbatim: 2px stroke, neutral until 80% and then amber and red,
// breathing once it is worth attention. Neutral rather than accent at rest on
// purpose — the composer's one coloured control is Send, and a second one
// competing with it makes neither read as the important one.
//
// Where it hangs is Maka's own: the reference puts it inside the composer
// surface beside Send, this stands it on the meta row below, leading the model
// chip (`ChatInput`). Two things follow from the move. The ring is 14px, not
// the reference's 18: it now sits beside that chip's brand mark, which is
// `size-3.5`, in a row set in 13px, and a ring drawn for a 32px button in the
// surface reads a size too loud among them. The 24px box around it stays — it
// is the row's own height, and the hit target should not shrink with the
// drawing.
//
// The popover names no model. It used to print `usage.modelId`, the wire
// spelling, while the chip four pixels away printed the display name: the same
// fact twice, in two spellings, one of which the reader never chose. What the
// popover is for is the number the chip cannot show — how much of the window
// is gone — and the window's size is already in the line beneath the bar.

import { memo, useEffect } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.js';
import { cn } from '../../../lib/cn.js';
import {
  CONTEXT_WARNING_PERCENT,
  contextUsageStore,
  projectContextUsage,
} from '../../../store/context-usage-store.js';
import { turnActionsStore } from '../../../store/index.js';
import { getTranscriptCopy } from '../../../locales/transcript-copy.js';

const SIZE = 14;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export const ContextUsageIndicator = memo(function ContextUsageIndicator(props: {
  sessionId: string;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).context;
  const data = useStore(contextUsageStore, (state) => state.data);
  const pending = useStore(
    turnActionsStore,
    (state) => state.pending[props.sessionId]?.includes('compact') ?? false,
  );

  useEffect(() => contextUsageStore.observe(props.sessionId), [props.sessionId]);

  const usage = projectContextUsage(data);
  const percent = usage?.percent ?? 0;
  const label = usage
    ? usage.contextWindow
      ? copy.used(formatTokens(usage.usedTokens), formatTokens(usage.contextWindow))
      : copy.usedNoWindow(formatTokens(usage.usedTokens))
    : copy.unavailable;
  const ringTone =
    usage?.tier === 'critical'
      ? 'text-danger'
      : usage?.tier === 'warning'
        ? 'text-warning'
        : 'text-text-secondary';

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`${copy.label}: ${label}`}
              className="ui-control-squish ui-control-squish-ghost relative flex size-6 cursor-pointer items-center justify-center rounded-lg text-text-primary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]"
            >
              <svg
                width={SIZE}
                height={SIZE}
                viewBox={`0 0 ${SIZE} ${SIZE}`}
                aria-hidden="true"
                className={cn(
                  'relative z-10',
                  percent >= CONTEXT_WARNING_PERCENT && 'animate-ring-breathe',
                )}
              >
                <circle
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={0.2}
                  strokeWidth={STROKE}
                  className="text-text-muted"
                />
                {/* A zero-length dash with a round cap paints a lone dot at
                    twelve o'clock in some renderers, so nothing is drawn. */}
                {percent > 0 && (
                  <circle
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
                    transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
                    className={cn('transition-all duration-300', ringTone)}
                  />
                )}
              </svg>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{`${copy.label}: ${label}`}</TooltipContent>
      </Tooltip>
      <PopoverContent variant="panel" align="end" side="top" sideOffset={8} className="w-72">
        <div className="flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium leading-5 text-menu-text-primary">
              {copy.label}
            </span>
            {usage?.percent !== undefined && (
              <span className="text-sm tabular-nums text-menu-text-muted">
                {copy.share(usage.percent)}
              </span>
            )}
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-menu-hover">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                usage?.tier === 'critical'
                  ? 'bg-danger-fill'
                  : usage?.tier === 'warning'
                    ? 'bg-warning-fill'
                    : 'bg-accent-fill',
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="truncate text-xs leading-[1.0625rem] tabular-nums text-menu-text-muted">
            {label}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              void turnActionsStore.compact(props.sessionId).catch(() => undefined);
            }}
            className="ui-control-squish inline-flex h-8 w-fit shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-[0.8125rem] leading-[1.125rem] text-text-primary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50"
          >
            <Anthropicon name="archive" size={18} className="shrink-0" />
            {pending ? copy.compacting : copy.compact}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
});
