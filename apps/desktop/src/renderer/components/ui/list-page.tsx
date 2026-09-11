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

// The grammar of a LIST page — Customize, Scheduled — as Claude draws it and
// the reference design system ports it (`list-page-header.tsx`,
// `card-surface.ts`, `CustomizeCards.tsx`): a display title, a toolbar of
// pill tabs with the actions on the right, then rows in labelled sections or
// cards in a two-column grid. One file so the three pages read as one place.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Anthropicon } from '../icons/Anthropicon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu.js';
import { cn } from '../../lib/cn.js';

/* ------------------------------------------------------------------ *
 * Toolbar controls (reference `list-page-header.tsx`).
 * ------------------------------------------------------------------ */

/*
 * Toolbar rhythm, measured off Claude's: icon buttons sit 4px apart (the
 * actions container's gap), and any button with a label — the black primary
 * or a bordered secondary — stands 12px off whatever precedes it (`ml-2` on
 * top of the gap). A row of icons reads as one group, the button as its own.
 */
/** Secondary control: 32px · r8 · squish. */
export const listToolbarButtonClass =
  'ui-control-squish ml-2 inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-0 px-3 text-sm font-normal leading-5 text-text-primary outline-none transition-shadow focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50';
/** Primary control: the one black button on the page. */
export const listToolbarPrimaryButtonClass =
  'ui-control-squish ui-control-squish-primary ml-2 inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border-0 px-3 text-sm font-medium leading-5 text-on-primary outline-none transition-shadow focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50';
/**
 * Square icon control in the toolbar. Secondary text at rest, like Claude's
 * (one rung under the title); primary on hover, and primary while the
 * control it opens is narrowing the list — `data-active` — so an applied
 * filter or a non-default sort reads from the toolbar without opening it.
 */
export const listToolbarIconButtonClass =
  'ui-control-squish ui-control-squish-ghost flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 text-text-secondary outline-none transition-[box-shadow,color] hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] data-[active=true]:text-text-primary disabled:pointer-events-none disabled:opacity-50';

const listToolbarSearchFieldClass =
  'flex h-8 w-full min-w-0 cursor-text items-center gap-1.5 rounded-lg bg-fill-field pl-3 pr-0 text-text-primary shadow-[var(--field-shadow)] transition-shadow duration-[60ms] [&:hover:not(:focus-within)]:shadow-[var(--field-shadow-hover)] has-[:focus-visible]:shadow-[var(--sidebar-focus-shadow)]';
const listToolbarSearchInputClass =
  'h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-normal leading-5 text-text-primary outline-none placeholder:text-text-muted focus:ring-0 focus-visible:shadow-none [&::-webkit-search-cancel-button]:hidden';
const listToolbarSearchClearButtonClass =
  'ui-control-squish ui-control-squish-ghost flex size-[22px] cursor-pointer items-center justify-center rounded-[3px] border-0 text-text-primary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]';

/**
 * The toolbar's search: a magnifier that opens into a 288px field in place,
 * and closes back to the magnifier on Escape or the clear button (reference
 * `ListPageHeader`). Results filter as the user types; the parent owns the
 * query.
 */
export function ListSearch(props: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(() => props.value.length > 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  const close = () => {
    props.onChange('');
    setOpen(false);
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  };
  if (!open) {
    return (
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={props.label}
        className={listToolbarIconButtonClass}
      >
        <Anthropicon name="search" size={20} />
      </button>
    );
  }
  return (
    <div role="search" className="flex w-72 min-w-40 max-w-full items-center">
      <div className={listToolbarSearchFieldClass}>
        <Anthropicon name="search" className="text-text-muted" />
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          aria-label={props.label}
          aria-describedby={hintId}
          placeholder={props.placeholder ?? props.label}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
          className={listToolbarSearchInputClass}
        />
        <span className="flex size-8 shrink-0 items-center justify-center">
          <button
            type="button"
            onClick={close}
            aria-label={props.label}
            className={listToolbarSearchClearButtonClass}
          >
            <Anthropicon name="x" />
          </button>
        </span>
      </div>
      <p id={hintId} className="sr-only">
        {props.label}
      </p>
    </div>
  );
}

/**
 * The toolbar's sort: the up-down arrows, opening a menu headed "Sort by"
 * with one radio row per order (Claude's list toolbars). The trigger stays an
 * icon whatever is chosen; the chosen order is the checked row.
 */
export function ListSortMenu<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={props.label}
          data-active={props.value !== props.options[0]?.value || undefined}
          className={listToolbarIconButtonClass}
        >
          <Anthropicon name="sort" size={20} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {/* Muted, like Claude's: a heading for the rows, not a row itself. */}
        <DropdownMenuLabel className="text-menu-text-muted">{props.label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={props.value}
          onValueChange={(value) => props.onChange(value as T)}
        >
          {props.options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One dimension of a `ListFilterMenu`: a radio list under its own submenu. */
export interface ListFilterGroup<T extends string> {
  id: string;
  label: string;
  value: T;
  /** The first option is the "All" that clears the dimension. */
  options: readonly { value: T; label: string; count?: number }[];
  // A method, not a property: method signatures stay bivariant, so a group
  // typed over `'all' | Scope` fits a `ListFilterGroup<string>[]`.
  onChange(value: T): void;
}

/**
 * The filter icon beside the sort: a muted "Filter by" heading, then the
 * options. One dimension is a flat radio list with counts; several become one
 * submenu each, the narrowed ones showing their choice in muted text on the
 * trigger row. Claude's Customize page keeps its filters here rather than as
 * a pill row above the list; the list itself is grouped instead.
 */
export function ListFilterMenu(props: {
  label: string;
  heading: string;
  groups: readonly ListFilterGroup<string>[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={props.label}
          data-active={
            props.groups.some((group) => group.value !== group.options[0]?.value) || undefined
          }
          className={listToolbarIconButtonClass}
        >
          <Anthropicon name="filter" size={20} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-menu-text-muted">{props.heading}</DropdownMenuLabel>
        {props.groups.length === 1 && props.groups[0] ? (
          <ListFilterOptions group={props.groups[0]} />
        ) : (
          props.groups.map((group) => {
            const current = group.options.find((option) => option.value === group.value);
            const narrowed = current !== undefined && current !== group.options[0];
            return (
              <DropdownMenuSub key={group.id}>
                <DropdownMenuSubTrigger>
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  {narrowed && (
                    <span className="ml-2 shrink-0 text-menu-text-muted">{current.label}</span>
                  )}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-44">
                  <ListFilterOptions group={group} />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ListFilterOptions(props: { group: ListFilterGroup<string> }) {
  const { group } = props;
  return (
    <DropdownMenuRadioGroup value={group.value} onValueChange={(value) => group.onChange(value)}>
      {group.options.map((option) => (
        <DropdownMenuRadioItem key={option.value} value={option.value}>
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.count !== undefined && (
            <span className="shrink-0 text-menu-text-muted">{option.count}</span>
          )}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/**
 * A pill tab. The fill is painted on `::before`, inset 1px on each side, so
 * neighbours keep a 2px seam without a gap on the list. Selected and hovered
 * share one 5% fill; only the text colour tells them apart.
 */
const listTabClass =
  'relative isolate inline-flex h-8 shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-none px-3 text-sm font-medium leading-5 outline-none transition-colors before:absolute before:inset-x-px before:inset-y-0 before:-z-[1] before:rounded-lg before:transition-colors before:content-[""] focus-visible:before:shadow-[var(--sidebar-focus-shadow)]';
const listTabActiveClass = 'text-text-primary before:bg-alpha-1';
const listTabIdleClass = 'text-text-muted hover:before:bg-alpha-1';

export function ListTabs<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" aria-label={props.label} className="flex min-w-0 items-center">
      {props.options.map((option) => {
        const selected = option.value === props.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => props.onChange(option.value)}
            className={cn(listTabClass, selected ? listTabActiveClass : listTabIdleClass)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Filter pills under the toolbar (Claude's "All · Connected · Not connected"):
 * the tab look, one row, the count optional on each.
 */
export function ListFilterPills<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; count?: number }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={props.label}
      className="flex min-w-0 flex-wrap items-center gap-1 pb-2 pt-4"
    >
      {props.options.map((option) => {
        const selected = option.value === props.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => props.onChange(option.value)}
            className={cn(
              'inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-sm leading-5 outline-none transition-colors focus-visible:shadow-[var(--sidebar-focus-shadow)]',
              selected ? 'bg-alpha-1 text-text-primary' : 'text-text-muted hover:bg-alpha-1',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="text-xs text-text-muted">{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The thin vertical rule between two tab groups (Skills | MCP ‖ Yours | Discover). */
export function ListTabsDivider() {
  return <span aria-hidden="true" className="mx-2 h-5 w-px shrink-0 bg-hairline" />;
}

/* ------------------------------------------------------------------ *
 * Header: display title, optional subtitle, actions, and a toolbar row.
 * ------------------------------------------------------------------ */

export function ListPageHeader(props: {
  title: string;
  subtitle?: string;
  /** Right of the title when there is no toolbar; right of the toolbar otherwise. */
  actions?: ReactNode;
  /** The toolbar's left side, typically `ListTabs`. */
  toolbar?: ReactNode;
}) {
  const actions = props.actions && (
    <div className="ml-auto flex min-h-8 shrink-0 items-center justify-end gap-1">
      {props.actions}
    </div>
  );
  return (
    <div className="shrink-0">
      <header className="flex min-h-12 items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="min-w-0 truncate font-display text-2xl font-medium leading-8 text-text-primary">
            {props.title}
          </h1>
          {props.subtitle && (
            <p className="mt-1 text-sm leading-5 text-text-muted">{props.subtitle}</p>
          )}
        </div>
        {!props.toolbar && actions}
      </header>
      {props.toolbar && (
        <div className="mt-4 flex min-h-8 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto">{props.toolbar}</div>
          {actions}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sections and rows (Claude's "Yours" list).
 * ------------------------------------------------------------------ */

/** "Created by you · 1": a section label with its count, then its rows. */
export function ListSection(props: {
  id: string;
  label: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={props.id} className="min-w-0">
      <h2
        id={props.id}
        className="flex items-baseline gap-2 pb-2 pt-4 text-sm font-medium leading-5 text-text-primary"
      >
        <span className="truncate">{props.label}</span>
        {props.count !== undefined && (
          <span className="shrink-0 text-xs font-normal text-text-muted">· {props.count}</span>
        )}
      </h2>
      <div className="flex flex-col">{props.children}</div>
    </section>
  );
}

/**
 * One row: a 36px icon tile, the title with its chips, one muted line of meta,
 * and a trailing slot for the date, the switch and the ⋯ menu. Rows are
 * separated by a hairline; the last row of a section drops it.
 */
export function ListRow(props: {
  icon: ReactNode;
  title: ReactNode;
  chips?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  /** When given, the row's body is a button that opens the item. */
  onOpen?: () => void;
  openLabel?: string;
  busy?: boolean;
  'data-maka-contract'?: string;
}) {
  const body = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[9.72px] border border-hairline bg-surface-2 text-text-secondary [&_svg]:size-5">
        {props.icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-medium leading-5 text-text-primary">
            {props.title}
          </span>
          {props.chips}
        </span>
        {props.meta && (
          <span className="min-w-0 truncate text-xs leading-4 text-text-muted">{props.meta}</span>
        )}
      </span>
    </>
  );
  return (
    <div
      data-maka-contract={props['data-maka-contract']}
      aria-busy={props.busy || undefined}
      className="flex min-h-[3.75rem] items-center gap-3 border-b border-hairline py-2.5 last:border-b-0"
    >
      {props.onOpen ? (
        <button
          type="button"
          onClick={props.onOpen}
          aria-label={props.openLabel}
          className="-mx-2 flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 py-1 text-left outline-none transition-colors hover:bg-alpha-1 focus-visible:shadow-[var(--sidebar-focus-shadow)]"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {props.trailing && (
        <div className="flex shrink-0 items-center gap-2 pl-2">{props.trailing}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Cards (reference `card-surface.ts`, list-card family).
 * ------------------------------------------------------------------ */

/** r12 · inset 1px ring · no shadow · page-coloured; hover lifts to surface-2. */
export const listCardSurfaceClass =
  'flex h-full w-full flex-col gap-2 rounded-xl bg-surface-1 p-4 text-sm leading-5 shadow-[inset_0_0_0_1px_var(--hairline)]';
export const listCardClass = cn(
  listCardSurfaceClass,
  'outline-none hover:bg-surface-2 focus-visible:shadow-[var(--sidebar-focus-shadow)]',
);
/** The shell around a card: hover group, anchor for the ⋯ slot, press feedback. */
export const listCardShellClass =
  'group relative h-full transition-transform duration-200 ease-[cubic-bezier(.165,.84,.44,1)] has-[button:active]:scale-[0.98]';
/** The ⋯ slot, top-right, revealed on hover, focus, or while its menu is open. */
export const listCardActionsSlotClass =
  'absolute right-3 top-3 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 has-[[aria-expanded=true]]:opacity-100 has-[[data-state=checked]]:opacity-100';
export const listCardTitleClass = 'truncate pr-10 text-sm font-medium leading-5 text-text-primary';
export const listCardDescClass = 'line-clamp-3 text-sm leading-5 text-text-secondary';
export const listCardFooterClass =
  'mt-auto flex flex-wrap items-center gap-2 pt-2 text-xs leading-4 text-text-muted';
export const listCardGridClass = 'grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4';

/* ------------------------------------------------------------------ *
 * Empty state (reference `CustomizeEmptyState`).
 * ------------------------------------------------------------------ */

export function ListEmptyState(props: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-hairline px-6 py-8 text-center">
      <span className="flex size-11 items-center justify-center rounded-xl bg-alpha-1 text-text-muted">
        {props.icon}
      </span>
      <p className="mt-4 text-sm font-medium text-text-primary">{props.title}</p>
      {props.description && (
        <p className="mt-1 max-w-sm text-xs leading-5 text-text-secondary">{props.description}</p>
      )}
      {props.action && <div className="mt-4">{props.action}</div>}
    </div>
  );
}

/** A quiet inline notice above a list whose refresh failed but whose last snapshot still shows. */
export function ListStaleNotice(props: { title: string; action: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-hairline px-4 py-2.5 text-sm text-text-secondary">
      <span className="flex min-w-0 items-center gap-2">
        <Anthropicon name="warningCircle" size={16} className="shrink-0 text-danger" />
        <span className="min-w-0 truncate">{props.title}</span>
      </span>
      {props.action}
    </div>
  );
}
