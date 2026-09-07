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

// One grouping grammar for the whole list. Ported from the reference design
// system's `SidebarGrouping`, minus the parts that only exist there (the
// `next/link` "view all" row, the project deep-link action, the `none` mode).
//
// Every group is the same shape: a small muted label row that reveals a caret
// and its actions on hover or keyboard focus, then the rows. No group is
// visually special, so the group-by menu can hang off the first label's action
// slot without looking like it belongs to that group in particular.

import { useEffect, useRef, useState, type Key, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { Anthropicon } from '../../icons/Anthropicon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.js';
import { cn } from '../../../lib/cn.js';
import type { SessionListGroupMode } from '../../../store/session-list-model.js';
import type { SidebarCopy } from '../../../locales/sidebar-copy.js';

export const labelActionRevealClass =
  'pointer-events-none opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover/section:pointer-events-auto group-hover/section:opacity-100 group-focus-within/labelrow:pointer-events-auto group-focus-within/labelrow:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 motion-reduce:transition-none';

export const labelActionButtonClass =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-sidebar-text-muted transition-[color,background-color,box-shadow] hover:bg-sidebar-menu-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none motion-reduce:transition-none';

export function SidebarGroupModeMenu(props: {
  copy: SidebarCopy;
  mode: SessionListGroupMode;
  onModeChange: (mode: SessionListGroupMode) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {/* Always shown, unlike the row actions: it is the list's own mode
            switch, and hiding it would hide that grouping can be changed. */}
        <button
          type="button"
          aria-label={props.copy.groupBy}
          className={cn(labelActionButtonClass, 'cursor-pointer', open && 'bg-sidebar-menu-hover text-sidebar-text-primary')}
        >
          <Anthropicon name="filter" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent variant="sidebar" align="end" sideOffset={4} className="min-w-36">
        <DropdownMenuLabel>{props.copy.groupBy}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={props.mode}
          onValueChange={(value) => props.onModeChange(value as SessionListGroupMode)}
        >
          <DropdownMenuRadioItem value="time">{props.copy.groupModes.time}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="project">
            {props.copy.groupModes.project}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarGroupLabel(props: {
  labelId?: string;
  title: string;
  contentId?: string;
  isContentHidden?: boolean;
  onToggle?: () => void;
  actions?: ReactNode;
  copy: SidebarCopy;
}) {
  return (
    <div className="group/labelrow flex h-11 items-center gap-2 pb-1 pl-1.5 pr-1 pt-4 text-[13px] leading-4 text-sidebar-text-muted">
      {props.onToggle ? (
        <button
          type="button"
          onClick={props.onToggle}
          aria-label={
            props.isContentHidden
              ? props.copy.expandSection(props.title)
              : props.copy.collapseSection(props.title)
          }
          aria-expanded={!props.isContentHidden}
          aria-controls={props.contentId}
          // `-m-1 p-1` is a pair: the hit area and focus ring grow to 24px and
          // the negative margin takes the growth back out of the layout.
          className="group/toggle -m-1 flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-lg p-1 text-left transition-[color,box-shadow] hover:text-sidebar-text-secondary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none motion-reduce:transition-none"
        >
          <span id={props.labelId} className="min-w-0 truncate">
            {props.title}
          </span>
          <Anthropicon
            name="caretRight"
            className={cn(
              'shrink-0 opacity-0 transition-[opacity,transform] duration-[var(--dur-fast)] group-hover/section:opacity-100 group-focus-within/labelrow:opacity-100 motion-reduce:transition-none',
              !props.isContentHidden && 'rotate-90',
            )}
          />
        </button>
      ) : (
        <h3 id={props.labelId} className="min-w-0 flex-1 truncate">
          {props.title}
        </h3>
      )}
      {props.actions && <div className="flex shrink-0 items-center gap-1">{props.actions}</div>}
    </div>
  );
}

export function SidebarGroup(props: {
  groupKey: string;
  title: string;
  activeChildKey?: Key | null;
  isContentHidden: boolean;
  onContentHiddenChange: (hidden: boolean) => void;
  actions?: ReactNode;
  copy: SidebarCopy;
  children: ReactNode[];
  /** Row keys in this group, so a newly active row can reopen it. */
  childKeys: readonly string[];
}) {
  const labelId = `sidebar-group-${props.groupKey}-label`;
  const itemsId = `sidebar-group-${props.groupKey}-items`;
  const hasActiveChild =
    props.activeChildKey != null && props.childKeys.includes(String(props.activeChildKey));
  const previousActiveKey = useRef<Key | null | undefined>(undefined);
  const previouslyHadActive = useRef(false);
  const onContentHiddenChange = props.onContentHiddenChange;
  useEffect(() => {
    if (
      hasActiveChild &&
      (!previouslyHadActive.current || previousActiveKey.current !== props.activeChildKey)
    ) {
      // Only a NEWLY active child reopens the group. Rows reordering under a
      // manual collapse must not undo it.
      onContentHiddenChange(false);
    }
    previousActiveKey.current = props.activeChildKey;
    previouslyHadActive.current = hasActiveChild;
  }, [hasActiveChild, props.activeChildKey, onContentHiddenChange]);

  return (
    <section className="group/section flex flex-col gap-px" aria-labelledby={labelId}>
      <SidebarGroupLabel
        labelId={labelId}
        title={props.title}
        contentId={itemsId}
        isContentHidden={props.isContentHidden}
        onToggle={() => props.onContentHiddenChange(!props.isContentHidden)}
        actions={props.actions}
        copy={props.copy}
      />
      <div id={itemsId} hidden={props.isContentHidden}>
        {!props.isContentHidden && (
          <div className="space-y-[1.5px] pb-[0.5px]">
            <AnimatePresence mode="popLayout">{props.children}</AnimatePresence>
          </div>
        )}
      </div>
    </section>
  );
}

/** Collapsed group keys, cleared whenever the grouping itself changes. */
export function useHiddenGroupKeys(resetKey: string) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    setHidden(new Set());
  }, [resetKey]);
  return [
    hidden,
    (groupKey: string, isHidden: boolean) =>
      setHidden((current) => {
        if (current.has(groupKey) === isHidden) return current;
        const next = new Set(current);
        if (isHidden) next.add(groupKey);
        else next.delete(groupKey);
        return next;
      }),
  ] as const;
}
