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

// The shape of an opened tool result, and the timeline geometry the rows sit
// on. Ported from the reference design system's `tools/tool-result.tsx`.
//
// One place owns these because a dozen renderers would otherwise each write
// their own padding, and a change would have to be made a dozen times and
// would be made eleven.
//
// The step is FOUR segments, not "a row plus two absolutely positioned lines":
//
//   8px line segment
//   row (4px padding + 20px icon = 28px)
//   in-row line segment   ← the line continues beside opened content
//   8px line segment
//
// The third segment is the reason: with absolute positioning the line stops
// under the header the moment a row opens.

import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';

/** The icon column. 20px wide; the timeline runs down its centre. */
export const stepIconColClass = 'flex w-5 shrink-0 justify-center';

/** The row: 4px above and below a 20px icon, the same height as the summary row. */
export const stepRowClass = 'group/step flex flex-row items-center py-1';

/** The row's content area. */
export const stepBodyClass =
  'group/row flex w-full flex-row items-center justify-between gap-2 rounded-lg px-2.5 text-left';

/**
 * An openable row. The text and icon brighten through their own
 * `group-hover/row` rules; this only owns the pointer and the focus ring —
 * this tier of the reference design has no hover fill.
 */
export const stepBodyInteractiveClass =
  'cursor-pointer outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]';

/** The vertical line. `on=false` keeps the segment's space but paints nothing. */
export function StepLine({ on = true, className }: { on?: boolean; className?: string }) {
  return (
    <div className={cn(stepIconColClass, className)} aria-hidden="true">
      <div className={cn('h-full w-px transition-colors duration-150', on && 'bg-hairline')} />
    </div>
  );
}

/** The 8px segment above or below a row. */
export function StepGap({ on = true }: { on?: boolean }) {
  return (
    <div className="flex h-2 flex-row" aria-hidden="true">
      <StepLine on={on} />
    </div>
  );
}

/**
 * The opened result panel. Everything a renderer shows goes inside one.
 *
 * The scroll cap lives INSIDE the card. Wrapping it in a second capped box
 * gives the reader a smaller window onto an already-small window.
 */
export function ToolResultPanel({
  variant = 'blocks',
  children,
  className,
}: {
  /**
   * `blocks` for a few heterogeneous sections (a command and its output, a
   * request and its response); `list` for a run of equivalent rows (search
   * hits, file lists) — tighter, shorter, and a lighter ground.
   */
  variant?: 'blocks' | 'list';
  children: ReactNode;
  className?: string;
}) {
  const list = variant === 'list';
  return (
    <div
      className={cn(
        'mx-2.5 mb-2 mt-1 rounded-lg border-[0.5px] border-hairline',
        list ? 'bg-surface-2/50' : 'bg-surface-2',
        className,
      )}
    >
      <div
        className={cn(
          'flex flex-col overflow-y-auto',
          list
            ? 'max-h-[150px] gap-1 p-1'
            : 'max-h-[240px] gap-2 p-2 [&_code]:!text-xs [&_pre]:!text-xs',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** One block inside a panel (a command, an output, a chunk of JSON). */
export const toolResultBlockClass = 'flex min-w-0 flex-col gap-3 rounded-md bg-surface-1 p-3';

/**
 * A block's label row. Fixed 12px height — the block's own `p-3` is the
 * padding, and a label row with its own would make two.
 */
export const toolResultBlockLabelRowClass = 'flex h-3 items-center justify-between gap-2';

/** A block's label text ("Command", "Output"). */
export const toolResultBlockLabelClass = 'text-[0.6875rem] leading-none text-text-secondary';

interface ToolResultRowProps {
  /** 12px icon (a favicon, a file type). List rows carry smaller icons than steps. */
  icon?: ReactNode;
  children: ReactNode;
  /** Trailing secondary detail (a hostname, a duration, a count). */
  meta?: ReactNode;
  /** Native tooltip, so a truncated long path is still readable in full. */
  title?: string;
  onClick?: () => void;
  ariaLabel?: string;
  className?: string;
}

/**
 * One row in a list-variant panel.
 *
 * The title uses `w-0 flex-grow` rather than `flex-1`: truncation needs a zero
 * base width, or a long title pushes the trailing meta out of the row.
 *
 * There is no `href` variant. The renderer forbids navigation, and an external
 * link has to go through the bridge's `openExternal`, so a row that opens
 * something takes an `onClick` and stays a button.
 */
export function ToolResultRow({
  icon,
  children,
  meta,
  title,
  onClick,
  ariaLabel,
  className,
}: ToolResultRowProps) {
  const body = (
    <>
      {icon !== undefined && <span className="flex shrink-0 items-center">{icon}</span>}
      <span className="w-0 flex-grow truncate text-left text-[13px] leading-[18px] text-text-secondary">
        {children}
      </span>
      {meta !== undefined && (
        <span className="shrink-0 text-xs leading-4 text-text-muted">{meta}</span>
      )}
    </>
  );
  const cls = cn(
    'flex w-full flex-row items-center gap-3 rounded-md px-2 py-1.5',
    onClick &&
      'cursor-pointer outline-none transition-colors hover:bg-alpha-1 focus-visible:shadow-[var(--sidebar-focus-shadow)]',
    className,
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} aria-label={ariaLabel} className={cls}>
        {body}
      </button>
    );
  }
  return (
    <div title={title} className={cls}>
      {body}
    </div>
  );
}
