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

import { useCallback, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { menuDangerItemClass } from '../../ui/menu-variants.js';
import { cn } from '../../../lib/cn.js';
import type { SessionListRow } from '../../../store/session-list-model.js';
import type { SidebarCopy } from '../../../locales/sidebar-copy.js';
import { InlineRename } from './InlineRename.js';
import { SidebarRowActionTrigger } from './SidebarRowActionTrigger.js';
import { sidebarRowFadeProps } from './sidebar-row-motion.js';

export interface SessionRowActions {
  onOpen(row: SessionListRow): void;
  onRename(row: SessionListRow, name: string): void;
  onSetFlagged(row: SessionListRow, flagged: boolean): void;
  onArchive(row: SessionListRow, archived: boolean): void;
  onRemove(row: SessionListRow): void;
}

export function SessionRow(props: {
  row: SessionListRow;
  isActive: boolean;
  copy: SidebarCopy;
  actions: SessionRowActions;
}) {
  const { row, copy, actions } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rowRoot = useRef<HTMLDivElement>(null);
  const renameFromMenu = useRef(false);
  const titleRef = useRef<HTMLSpanElement>(null);
  const [titleClipped, setTitleClipped] = useState(false);
  // Measured on pointer entry rather than on mount: the sidebar is resizable,
  // so whether a title is clipped is only true of a particular width.
  const checkTitleClipped = useCallback(() => {
    const element = titleRef.current;
    if (element) setTitleClipped(element.scrollWidth > element.clientWidth);
  }, []);

  const leading = row.stale ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={copy.stale} className="flex items-center text-warning">
          <Anthropicon name="warningCircle" size={20} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{copy.stale}</TooltipContent>
    </Tooltip>
  ) : row.running ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={copy.running}
          className="size-1.5 shrink-0 animate-status-dot-breathe rounded-full bg-sidebar-text-muted"
        />
      </TooltipTrigger>
      <TooltipContent side="top">{copy.running}</TooltipContent>
    </Tooltip>
  ) : (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        row.unread ? 'bg-accent-fill' : 'border-[1px] border-sidebar-text-muted/50',
      )}
    />
  );

  return (
    <motion.div
      ref={rowRoot}
      {...sidebarRowFadeProps}
      data-maka-contract="session-row"
      data-session-key={row.id}
      data-session-active={props.isActive ? 'true' : undefined}
      className={cn(
        'group relative rounded-lg transition-colors',
        props.isActive
          ? 'bg-sidebar-selected'
          : 'hover:bg-sidebar-hover focus-within:bg-sidebar-hover',
        menuOpen && !props.isActive && 'bg-sidebar-hover',
      )}
    >
      {renaming ? (
        <div className="flex h-8 items-center px-[2px]">
          <InlineRename
            value={row.name}
            label={copy.rename.label}
            onCommit={(name) => {
              setRenaming(false);
              actions.onRename(row, name);
            }}
            onCancel={(restoreFocus) => {
              setRenaming(false);
              if (restoreFocus)
                requestAnimationFrame(() => {
                  const selector = renameFromMenu.current
                    ? '[aria-haspopup="menu"]'
                    : '[data-roving-row]';
                  rowRoot.current?.querySelector<HTMLButtonElement>(selector)?.focus();
                });
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          role="option"
          aria-selected={props.isActive}
          aria-current={props.isActive ? 'page' : undefined}
          // The list is one tab stop; `useRovingRowFocus` writes the tabindex
          // onto the rows it finds through this attribute.
          data-roving-row=""
          onClick={() => actions.onOpen(row)}
          onDoubleClick={() => {
            renameFromMenu.current = false;
            setRenaming(true);
          }}
          className={cn(
            'group/item relative flex h-8 w-full items-center rounded-lg px-[2px] py-0 text-left text-sm leading-[21px] text-sidebar-text-secondary transition-[color,box-shadow] hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none',
            props.isActive && 'text-sidebar-text-primary',
          )}
        >
          <span className="relative mr-2 flex size-7 shrink-0 items-center justify-center">
            {leading}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                ref={titleRef}
                onPointerEnter={checkTitleClipped}
                className={cn(
                  'min-w-0 flex-1 overflow-hidden whitespace-nowrap fade-clip-end text-sm leading-[21px]',
                  menuOpen && 'fade-clip-wide',
                )}
              >
                {row.displayName}
              </span>
            </TooltipTrigger>
            {titleClipped && (
              <TooltipContent side="right" className="break-words">
                {row.displayName}
              </TooltipContent>
            )}
          </Tooltip>
        </button>
      )}

      {!renaming && (
        <div
          className={cn(
            'absolute right-1 top-1/2 flex -translate-y-1/2 items-center transition-opacity duration-[var(--dur-fast)]',
            menuOpen
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
          )}
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarRowActionTrigger
                label={copy.sessionActions(row.displayName)}
                isOpen={menuOpen}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent variant="sidebar" align="end" side="bottom">
              <DropdownMenuItem
                onSelect={() => {
                  renameFromMenu.current = true;
                  setMenuOpen(false);
                  setRenaming(true);
                }}
              >
                <Anthropicon name="edit" size={20} />
                <span className="flex-1">{copy.rowActions.rename}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.onSetFlagged(row, !row.flagged)}>
                <Anthropicon name={row.flagged ? 'pinSlash' : 'pin'} size={20} />
                <span className="flex-1">
                  {row.flagged ? copy.rowActions.unflag : copy.rowActions.flag}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.onArchive(row, !row.archived)}>
                <Anthropicon name={row.archived ? 'arrowCounterClockwise' : 'archive'} size={20} />
                <span className="flex-1">
                  {row.archived ? copy.rowActions.unarchive : copy.rowActions.archive}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={menuDangerItemClass}
                onSelect={() => actions.onRemove(row)}
              >
                <Anthropicon name="trash" size={20} />
                <span className="flex-1">{copy.rowActions.remove}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </motion.div>
  );
}
