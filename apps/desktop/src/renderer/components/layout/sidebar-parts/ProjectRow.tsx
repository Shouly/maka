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

// One project in the list. Geometry ported from the reference design system's
// `ProjectItem`; the action set is Maka's, because a project here is a real
// directory on a Runtime Host rather than a server-side folder — it can be
// relinked when the directory moves, and revealed in the OS file manager.

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
  project: ProjectRowModel;
  archived?: boolean;
  copy: SidebarCopy;
  actions: ProjectRowActions;
}) {
  const { project, copy, actions } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const nameRef = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  const checkClipped = useCallback(() => {
    const element = nameRef.current;
    if (element) setClipped(element.scrollWidth > element.clientWidth);
  }, []);
  const path = project.path ? projectPathDisplay(project.path) : undefined;

  return (
    <motion.div
      {...sidebarRowFadeProps}
      data-maka-contract="project-row"
      data-project-id={project.id}
      className={cn(
        'group relative rounded-lg transition-colors hover:bg-sidebar-hover focus-within:bg-sidebar-hover',
        menuOpen && 'bg-sidebar-hover',
      )}
    >
      {renaming ? (
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
        <button
          type="button"
          onClick={() => actions.onNewTask(project)}
          className="group/item flex h-8 w-full items-center rounded-lg px-[2px] py-0 text-left text-sm leading-[21px] text-sidebar-text-secondary transition-[color,box-shadow] hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none"
        >
          <span className="relative mr-2 flex size-7 shrink-0 items-center justify-center">
            <Anthropicon
              name="projects"
              className="text-sidebar-text-secondary transition-colors group-hover/item:text-sidebar-text-primary"
            />
          </span>
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
                {project.name}
              </span>
            </TooltipTrigger>
            {(clipped || path) && (
              <TooltipContent side="right" className="break-words">
                {path?.title ?? project.name}
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
                label={copy.projectActions(project.name)}
                isOpen={menuOpen}
              />
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
