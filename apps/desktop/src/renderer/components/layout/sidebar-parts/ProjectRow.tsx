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

// The full row toggles its tasks; project actions live in the separate menu.
// Projects absent from the catalog still expand, but offer no directory actions.

import { useCallback, useMemo, useRef, useState, type Ref } from 'react';
import { useUiLocale } from '@maka/ui';
import { getCreateProjectCopy } from '../../../locales/create-project-copy.js';
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
import { cn } from '../../../lib/cn.js';
import { composeRefs } from '../../../lib/compose-refs.js';
import { projectPathDisplay } from '../../../lib/ported/project-path-display.js';
import type { SidebarCopy } from '../../../locales/sidebar-copy.js';
import type { ProjectRowModel } from '../../../hooks/use-session-list.js';
import { InlineRename } from './InlineRename.js';
import { SidebarRowActionTrigger } from './SidebarRowActionTrigger.js';
import { sidebarRowFadeProps } from './sidebar-row-motion.js';

export interface ProjectRowActions {
  onNewTask(project: ProjectRowModel): void;
  onRename(project: ProjectRowModel, name: string): void;
  onArchive(project: ProjectRowModel): void;
  onRestore(project: ProjectRowModel): void;
}

export function ProjectRow(props: {
  /** Stable key of the Projects entry; names the disclosed task group. */
  projectKey: string;
  /** Absent for a project only the tasks know. */
  project: ProjectRowModel | undefined;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  archived?: boolean;
  copy: SidebarCopy;
  actions: ProjectRowActions;
  /** Reaches the row's root element; see `SessionRow`. */
  ref?: Ref<HTMLDivElement>;
}) {
  const { project, label, copy, actions } = props;
  const createCopy = getCreateProjectCopy(useUiLocale());
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rowRoot = useRef<HTMLDivElement>(null);
  const rootRef = useMemo(() => composeRefs(rowRoot, props.ref), [props.ref]);
  const renameFromMenu = useRef(false);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  const checkClipped = useCallback(() => {
    const element = nameRef.current;
    if (element) setClipped(element.scrollWidth > element.clientWidth);
  }, []);
  const path = project?.path ? projectPathDisplay(project.path) : undefined;
  const tasksId = `sidebar-project-${props.projectKey}-tasks`;

  return (
    <motion.div
      ref={rootRef}
      {...sidebarRowFadeProps}
      data-maka-contract="project-row"
      data-project-id={project?.id ?? props.projectKey}
      data-project-expanded={props.expanded ? 'true' : undefined}
      className={cn(
        'group relative rounded-lg transition-colors hover:bg-sidebar-hover focus-within:bg-sidebar-hover',
        menuOpen && 'bg-sidebar-hover',
      )}
    >
      {renaming && project ? (
        <div className="flex h-8 items-center px-[2px]">
          <InlineRename
            value={project.name}
            label={copy.projectRowActions.rename}
            onCommit={(name) => {
              setRenaming(false);
              actions.onRename(project, name);
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
          data-roving-row=""
          onClick={props.onToggle}
          aria-label={props.expanded ? copy.collapseProject(label) : copy.expandProject(label)}
          aria-expanded={props.expanded}
          aria-controls={tasksId}
          className="group/item flex h-8 w-full min-w-0 cursor-pointer items-center rounded-lg px-[2px] text-left text-sm leading-[21px] text-sidebar-text-secondary transition-[color,box-shadow] hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none"
        >
          <span className="group/project-icon relative mr-2 flex size-7 shrink-0 items-center justify-center">
            <Anthropicon
              name="projects"
              className="absolute transition-opacity duration-[var(--dur-fast)] group-hover/project-icon:opacity-0"
            />
            <Anthropicon
              name="caretRight"
              size={16}
              className={cn(
                'absolute opacity-0 transition-[opacity,rotate] duration-[var(--dur-fast)] motion-reduce:transition-none group-hover/project-icon:opacity-100',
                props.expanded && 'rotate-90',
              )}
            />
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                ref={nameRef}
                onPointerEnter={checkClipped}
                className={cn(
                  'min-w-0 flex-1 overflow-hidden whitespace-nowrap fade-clip-end text-sm leading-[21px]',
                  'group-hover:pr-12 group-focus-within:pr-12',
                  menuOpen && 'fade-clip-wide pr-12',
                )}
              >
                {label}
              </span>
            </TooltipTrigger>
            {(clipped || path) && (
              <TooltipContent side="right" className="break-words">
                {path?.title ?? label}
              </TooltipContent>
            )}
          </Tooltip>
        </button>
      )}

      {!renaming && project && (
        <div
          className={cn(
            'absolute right-1 top-1/2 flex -translate-y-1/2 items-center transition-opacity duration-[var(--dur-fast)]',
            menuOpen
              ? 'pointer-events-auto opacity-100'
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={createCopy.quickTask(label)}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.onNewTask(project);
                }}
                className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-sidebar-text-secondary transition-colors hover:bg-sidebar-menu-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none"
              >
                <Anthropicon name="chatAdd" size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{createCopy.quickTask(label)}</TooltipContent>
          </Tooltip>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarRowActionTrigger label={copy.projectActions(label)} isOpen={menuOpen} />
            </DropdownMenuTrigger>
            <DropdownMenuContent variant="sidebar" align="end" side="bottom">
              <DropdownMenuItem onSelect={() => actions.onNewTask(project)}>
                <Anthropicon name="chatAdd" size={20} />
                <span className="flex-1">{copy.projectRowActions.newTask}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  renameFromMenu.current = true;
                  setMenuOpen(false);
                  setRenaming(true);
                }}
              >
                <Anthropicon name="edit" size={20} />
                <span className="flex-1">{copy.projectRowActions.rename}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {props.archived ? (
                <DropdownMenuItem onSelect={() => actions.onRestore(project)}>
                  <Anthropicon name="arrowCounterClockwise" size={20} />
                  <span className="flex-1">{copy.projectRowActions.restore}</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => actions.onArchive(project)}>
                  <Anthropicon name="archive" size={20} />
                  <span className="flex-1">{copy.projectRowActions.archive}</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </motion.div>
  );
}
