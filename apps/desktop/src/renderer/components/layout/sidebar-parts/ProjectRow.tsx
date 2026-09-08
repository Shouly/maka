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

// One project in the Projects band. Geometry ported from the reference design
// system's `ProjectItem`; two things are this product's:
//
//   - the row is a DISCLOSURE as well as a link: the leading slot holds the
//     project mark at rest and a caret on hover, and the caret toggles the
//     project's tasks under it. Clicking the name starts a task in the
//     project, the same as the reference's row opening the project;
//   - the action set, because a project here is a real directory on a
//     Runtime Host rather than a server-side folder — it can be relinked
//     when the directory moves, and revealed in the OS file manager.
//
// A row can also stand for a project only the tasks know (another Host's, or
// one archived since). Such a row has no `project`; it still discloses its
// tasks but offers no actions.

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
import { cn } from '../../../lib/cn.js';
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
  onRelink(project: ProjectRowModel): void;
  onReveal(project: ProjectRowModel): void;
}

export function ProjectRow(props: {
  /** Stable key of the Projects entry; names the disclosed task group. */
  projectKey: string;
  /** Absent for a project only the tasks know. */
  project: ProjectRowModel | undefined;
  label: string;
  taskCount: number;
  expanded: boolean;
  onToggle: () => void;
  archived?: boolean;
  copy: SidebarCopy;
  actions: ProjectRowActions;
}) {
  const { project, label, copy, actions } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
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
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : (
        <div className="flex h-8 items-center px-[2px]">
          {/* The disclosure. At rest the slot shows the project mark; on hover
              and while open it shows the caret, the reference's own pattern
              for a row that is both a link and a folder. */}
          <button
            type="button"
            onClick={props.onToggle}
            aria-label={props.expanded ? copy.collapseProject(label) : copy.expandProject(label)}
            aria-expanded={props.expanded}
            aria-controls={tasksId}
            className="group/disclose relative mr-2 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-text-secondary outline-none transition-colors hover:bg-sidebar-menu-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
          >
            <Anthropicon
              name="projects"
              className={cn(
                'absolute transition-opacity duration-[var(--dur-fast)] group-hover/disclose:opacity-0 group-focus-visible/disclose:opacity-0',
                props.expanded && 'opacity-0',
              )}
            />
            <Anthropicon
              name="caretRight"
              className={cn(
                'absolute opacity-0 transition-[opacity,transform] duration-[var(--dur-fast)] group-hover/disclose:opacity-100 group-focus-visible/disclose:opacity-100',
                props.expanded && 'rotate-90 opacity-100',
              )}
            />
          </button>
          <button
            type="button"
            onClick={() => (project ? actions.onNewTask(project) : props.onToggle())}
            title={project ? copy.projectRowActions.newTask : undefined}
            className="group/item flex h-8 min-w-0 flex-1 cursor-pointer items-center rounded-lg text-left text-sm leading-[21px] text-sidebar-text-secondary transition-[color,box-shadow] hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  ref={nameRef}
                  onPointerEnter={checkClipped}
                  className={cn(
                    'min-w-0 flex-1 overflow-hidden whitespace-nowrap fade-clip-end text-sm leading-[21px]',
                    menuOpen && 'fade-clip-wide',
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
            {props.taskCount > 0 && (
              <span
                aria-label={copy.taskCount(props.taskCount)}
                className="ml-2 mr-1 shrink-0 text-[11px] leading-4 tabular-nums text-sidebar-text-muted group-hover:opacity-0"
              >
                {props.taskCount}
              </span>
            )}
          </button>
        </div>
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
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarRowActionTrigger label={copy.projectActions(label)} isOpen={menuOpen} />
            </DropdownMenuTrigger>
            <DropdownMenuContent variant="sidebar" align="end" side="bottom">
              <DropdownMenuItem onSelect={() => actions.onNewTask(project)}>
                {copy.projectRowActions.newTask}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setRenaming(true)}>
                {copy.projectRowActions.rename}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.onReveal(project)}>
                {copy.projectRowActions.reveal}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => actions.onRelink(project)}>
                {copy.projectRowActions.relink}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {props.archived ? (
                <DropdownMenuItem onSelect={() => actions.onRestore(project)}>
                  {copy.projectRowActions.restore}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => actions.onArchive(project)}>
                  {copy.projectRowActions.archive}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </motion.div>
  );
}
