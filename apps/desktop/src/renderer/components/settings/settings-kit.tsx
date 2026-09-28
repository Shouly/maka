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

// The Settings dialog's building blocks past the row grammar
// (`settings-row.tsx`), each measured off the design (2026-09-27):
//
//   back      a sub-view's way home, drawn in the dialog's own top bar — a
//             ghost 28px "← Page" left of the close button — not in the page
//   modal     anything that creates, adds, renames or fills a form opens a
//             dialog stacked on Settings: 400 / 536 wide, 22/28 title, the
//             footer's Cancel and primary button at the right. Settings dims
//             behind it (`DialogStackContext`); there is still one backdrop
//   panel     settings that only mean something while a switch is on sit in
//             a grey inset panel under that switch's row, not spread in the
//             list: 5% ink on 10% ink, r12, 24px inside
//   table     lists of records: 32px header of 13/17 · 500 secondary, 8/12
//             cells, a 5% hairline between rows inset to the text, and a
//             hover fill that runs 12px past the text on both sides
//   ⋯ menu    a row's actions, the destructive one last in red — there is no
//             red button on a settings page

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
} from 'react';
import { Anthropicon, type AnthropiconName } from '../icons/Anthropicon.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { menuDangerItemClass } from '../ui/menu-variants.js';
import { cn } from '../../lib/cn.js';

/* ------------------------------------------------------------------ *
 * Back
 * ------------------------------------------------------------------ */

export interface SettingsBack {
  label: string;
  onBack: () => void;
}

const SettingsBackContext = createContext<((back: SettingsBack | null) => void) | null>(null);

/** Provided by the dialog; the setter puts a back button in its top bar. */
export const SettingsBackProvider = SettingsBackContext.Provider;

/**
 * A sub-view names its way back while it is showing; `null` when the page is
 * on its own top level. Called unconditionally, like any hook.
 */
export function useSettingsBack(back: SettingsBack | null): void {
  const setBack = useContext(SettingsBackContext);
  const onBack = useRef(back?.onBack);
  onBack.current = back?.onBack;
  const label = back?.label;
  useEffect(() => {
    if (!setBack || label === undefined) return;
    setBack({ label, onBack: () => onBack.current?.() });
    return () => setBack(null);
  }, [setBack, label]);
}

/** The top bar's back button: ghost, 28px, a 16px arrow and the page's name. */
export function SettingsBackButton(props: { back: SettingsBack; ariaLabel: string }) {
  return (
    <button
      type="button"
      aria-label={props.ariaLabel}
      onClick={props.back.onBack}
      className="-ml-2.5 flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-[7px] px-2.5 text-sm leading-5 text-text-primary outline-none transition-colors hover:bg-sidebar-menu-hover focus-visible:shadow-[var(--sidebar-focus-shadow)]"
    >
      <Anthropicon name="arrowLeft" size={16} className="shrink-0" />
      <span className="truncate">{props.back.label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

const MODAL_WIDTH = {
  sm: 'md:max-w-[400px]',
  md: 'md:max-w-[536px]',
  lg: 'md:max-w-[640px]',
} as const;

export function SettingsModal(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  size?: keyof typeof MODAL_WIDTH;
  /** The Cancel and primary buttons, primary last. */
  footer?: ReactNode;
  children?: ReactNode;
  'data-maka-contract'?: string;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        className={MODAL_WIDTH[props.size ?? 'md']}
        data-maka-contract={props['data-maka-contract']}
        {...(props.description === undefined ? { 'aria-describedby': undefined } : {})}
      >
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description !== undefined && (
            <DialogDescription>{props.description}</DialogDescription>
          )}
        </DialogHeader>
        {props.children}
        {props.footer && <DialogFooter className="mt-1">{props.footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

/** A labelled field inside a modal: 14/14 · 500 label, 8px, then the control. */
export function SettingsModalField(props: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={props.htmlFor}
        className="text-sm font-medium leading-[0.875rem] text-text-primary"
      >
        {props.label}
      </label>
      {props.children}
      {props.hint && (
        <p className="text-[0.8125rem] leading-[1.0625rem] text-text-muted">{props.hint}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Inset panel
 * ------------------------------------------------------------------ */

/**
 * The settings a switch unlocks, under that switch's row. A direct child of a
 * `SettingsSection`, so it opts out of the hairline the section draws above
 * each row; the rows inside it stand 24px apart with no hairline of their own.
 */
export function SettingsInsetPanel(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mb-3 flex flex-col rounded-xl bg-alpha-1 px-6 py-3 shadow-[inset_0_0_0_1px_var(--alpha-2)] !border-t-0',
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Table
 * ------------------------------------------------------------------ */

export function SettingsTable(props: {
  label: string;
  /** Header cells; omit for a table whose columns explain themselves. */
  head?: ReactNode;
  children: ReactNode;
  'data-maka-contract'?: string;
}) {
  return (
    // -mx-3: the cells' 12px padding sits outside the text column, so the
    // text lines up with the rows above and only the hover fill overhangs.
    <div className="-mx-3" data-maka-contract={props['data-maka-contract']}>
      <table
        aria-label={props.label}
        className="w-full table-fixed border-separate border-spacing-0 text-sm leading-5"
      >
        {props.head && (
          <thead>
            <tr>{props.head}</tr>
          </thead>
        )}
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

export function SettingsTableHeadCell(
  props: HTMLAttributes<HTMLTableCellElement> & { srOnly?: boolean },
) {
  const { className, srOnly, children, ...rest } = props;
  return (
    <th
      scope="col"
      className={cn(
        'h-8 px-3 text-left align-middle text-[0.8125rem] font-medium leading-[1.0625rem] text-text-secondary',
        className,
      )}
      {...rest}
    >
      {srOnly ? <span className="sr-only">{children}</span> : children}
    </th>
  );
}

/**
 * One record. The hairline above it is a background on the row inset 12px
 * each side, so it spans the text and not the overhang; the first row and a
 * hovered row (and the one under it) drop it, as the reference does.
 */
export function SettingsTableRow(
  props: HTMLAttributes<HTMLTableRowElement> & { onOpen?: () => void; openLabel?: string },
) {
  const { className, onOpen, openLabel, onKeyDown, ...rest } = props;
  return (
    <tr
      {...(onOpen
        ? {
            tabIndex: 0,
            'aria-label': openLabel,
            onClick: onOpen,
            onKeyDown: (event) => {
              onKeyDown?.(event);
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            },
          }
        : { onKeyDown })}
      className={cn(
        'group/row outline-none',
        '[&:not(:first-child)]:[background:linear-gradient(var(--alpha-1),var(--alpha-1))_no-repeat_12px_0/calc(100%-24px)_1px]',
        'hover:![background:none] [tr:hover+&]:![background:none]',
        '[&>td]:transition-colors hover:[&>td]:bg-alpha-1 focus-visible:[&>td]:bg-alpha-1',
        '[&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg',
        onOpen && 'cursor-pointer',
        className,
      )}
      {...rest}
    />
  );
}

export function SettingsTableCell(props: TdHTMLAttributes<HTMLTableCellElement>) {
  const { className, ...rest } = props;
  return <td className={cn('px-3 py-2 align-middle', className)} {...rest} />;
}

/** The trailing actions column: 48px, holding the row's ⋯ menu. */
export function SettingsTableActionsCell(props: { children: ReactNode }) {
  return (
    <td
      className="w-12 px-2 py-2 text-right align-middle"
      // The menu is the row's, not a click on the row.
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {props.children}
    </td>
  );
}

/** A centred line where a table would be: 14/20 secondary, 32px above and below. */
export function SettingsEmpty(props: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 py-8 text-center">
      <p className="text-sm leading-5 text-text-secondary">{props.title}</p>
      {props.body && <p className="text-sm leading-5 text-text-muted">{props.body}</p>}
      {props.action && <div className="mt-3">{props.action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ⋯ menu
 * ------------------------------------------------------------------ */

export interface RowAction {
  label: string;
  /** Every item carries one, in the account menu's 20px slot. */
  icon: AnthropiconName;
  onSelect: () => void;
  disabled?: boolean;
  /** Red, after a separator — always the last item. */
  danger?: boolean;
}

/**
 * A record's actions. `reveal="hover"` shows the trigger only while the row
 * is hovered or focused (the Account tables); the default keeps it
 * visible.
 */
export function RowActionsMenu(props: {
  label: string;
  actions: readonly RowAction[];
  reveal?: 'always' | 'hover';
}) {
  const plain = props.actions.filter((action) => !action.danger);
  const danger = props.actions.filter((action) => action.danger);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={props.label}
        className={cn(
          'inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-text-secondary outline-none transition-[background-color,opacity] hover:bg-alpha-1 hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] data-[state=open]:bg-alpha-1 data-[state=open]:text-text-primary',
          props.reveal === 'hover' &&
            'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 data-[state=open]:opacity-100',
        )}
      >
        <Anthropicon name="dotsVertical" size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {plain.map((action) => (
          <DropdownMenuItem
            key={action.label}
            disabled={action.disabled}
            onSelect={action.onSelect}
          >
            <DropdownMenuItemIcon>
              <Anthropicon name={action.icon} size={20} />
            </DropdownMenuItemIcon>
            <span className="min-w-0 flex-1 truncate">{action.label}</span>
          </DropdownMenuItem>
        ))}
        {plain.length > 0 && danger.length > 0 && <DropdownMenuSeparator />}
        {danger.map((action) => (
          <DropdownMenuItem
            key={action.label}
            disabled={action.disabled}
            className={menuDangerItemClass}
            onSelect={action.onSelect}
          >
            <DropdownMenuItemIcon>
              <Anthropicon name={action.icon} size={20} />
            </DropdownMenuItemIcon>
            <span className="min-w-0 flex-1 truncate">{action.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ *
 * Callout
 * ------------------------------------------------------------------ */

const CALLOUT_TONE = {
  info: {
    surface: 'bg-surface-1 shadow-[inset_0_0_0_1px_var(--alpha-2)]',
    icon: 'text-text-secondary',
    glyph: 'info',
  },
  warning: { surface: 'bg-warning-subtle', icon: 'text-warning', glyph: 'warningCircle' },
  danger: { surface: 'bg-danger-subtle', icon: 'text-danger', glyph: 'warningCircle' },
} as const satisfies Record<string, { surface: string; icon: string; glyph: AnthropiconName }>;

/**
 * A note inside a page (a `role=status` callout): r12, 12/16 inside,
 * a 20px glyph, 14/20 text at body weight. A title only takes weight when a
 * description follows it.
 */
export function SettingsCallout(props: {
  tone?: keyof typeof CALLOUT_TONE;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const tone = CALLOUT_TONE[props.tone ?? 'info'];
  return (
    <div
      role={props.tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-xl px-4 py-3 text-sm leading-5',
        tone.surface,
        props.className,
      )}
    >
      <Anthropicon name={tone.glyph} size={20} className={cn('shrink-0', tone.icon)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={cn('text-text-primary', props.description !== undefined && 'font-medium')}>
          {props.title}
        </p>
        {props.description !== undefined && (
          <p className="text-text-secondary">{props.description}</p>
        )}
      </div>
      {props.action && <div className="shrink-0">{props.action}</div>}
    </div>
  );
}
