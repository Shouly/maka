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

// The shape of an opened tool result. Ported from the reference design
// system's `tools/tool-result.tsx`.
//
// One place owns these because a dozen renderers would otherwise each write
// their own padding, and a change would have to be made a dozen times and
// would be made eleven.

import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';

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
        'mx-2.5 mb-2 mt-1 rounded-lg border-[1px] border-hairline',
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
      <span className="w-0 flex-grow truncate text-left text-[0.8125rem] leading-[1.125rem] text-text-secondary">
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

/**
 * "Open in Files" / "Open in Terminal": the row's handle on the right pane.
 *
 * A transcript row is a record of something that happened; the pane is where
 * that thing can still be USED — the file re-read, the shell typed into. The
 * button lives on the result panel's label row so it reads as an action on the
 * block it belongs to rather than a second status.
 *
 * Absent when the pane cannot take the handoff, which is why every caller
 * passes it conditionally instead of disabling it: a control that is always
 * there and never works is worse than one that appears when it can act.
 */
export function ToolHandoffButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      data-maka-tool-handoff=""
      className="ui-control-squish ui-control-squish-ghost inline-flex h-5 shrink-0 cursor-pointer items-center rounded-md px-1.5 text-[0.6875rem] leading-none text-text-secondary outline-none hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
    >
      {props.label}
    </button>
  );
}
