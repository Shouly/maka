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

import { useRef, useState } from 'react';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu.js';
import { cn } from '../../lib/cn.js';
import { InlineRename } from './sidebar-parts/InlineRename.js';
import { SessionActionMenuItems } from './sidebar-parts/SessionActionMenuItems.js';
import type { SessionRowActions } from './sidebar-parts/SessionRow.js';
import {
  MainHeaderBreadcrumb,
  mainHeaderTextControlClass,
  mainHeaderIconControlClass,
} from './MainHeader.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import { openPath } from '../../bridge/app.js';
import type { SessionListRow } from '../../store/session-list-model.js';

export function SessionIdentity(props: {
  row: SessionListRow | undefined;
  parentName: string | undefined;
  onOpenParent: (sessionId: string) => void;
  actions: SessionRowActions;
}) {
  const copy = getSidebarCopy(useUiLocale());
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const titleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const renameFromMenu = useRef(false);
  const row = props.row;
  const finishRename = (restoreFocus = false) => {
    setRenaming(false);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        (renameFromMenu.current ? menuRef : titleRef).current?.focus();
      });
    }
  };
  return (
    <div
      data-maka-contract="titlebar-identity"
      className="flex min-w-0 items-center text-sm leading-5 text-sidebar-text-primary"
    >
      {row?.projectName && (
        <MainHeaderBreadcrumb
          onClick={() => void openPath('project', row.id)}
          linkClassName="maka-no-drag"
        >
          <span className="min-w-0 truncate">{row.projectName}</span>
        </MainHeaderBreadcrumb>
      )}
      {row?.branchOf && (
        <MainHeaderBreadcrumb
          onClick={() => props.onOpenParent(row.branchOf!.id)}
          linkClassName="maka-no-drag"
        >
          <span className="min-w-0 truncate">{props.parentName ?? row.branchOf.name}</span>
        </MainHeaderBreadcrumb>
      )}
      {!row ? null : renaming ? (
        <div className="maka-no-drag w-56 min-w-0 px-1">
          <InlineRename
            value={row.name}
            label={copy.rename.label}
            onCommit={(name) => {
              finishRename();
              props.actions.onRename(row, name);
            }}
            onCancel={finishRename}
          />
        </div>
      ) : (
        <div className="flex min-w-0 items-center">
          <button
            ref={titleRef}
            type="button"
            onClick={() => {
              renameFromMenu.current = false;
              setRenaming(true);
            }}
            aria-label={copy.rowActions.rename}
            className={cn(mainHeaderTextControlClass, 'maka-no-drag cursor-pointer font-normal')}
          >
            <span className="min-w-0 truncate">{row.displayName}</span>
          </button>
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                ref={menuRef}
                type="button"
                aria-label={copy.sessionActions(row.displayName)}
                className={cn(
                  mainHeaderIconControlClass,
                  'maka-no-drag -ml-2 text-sidebar-text-primary data-[state=open]:bg-sidebar-menu-hover',
                )}
              >
                <Anthropicon name="caretDown" size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom">
              <SessionActionMenuItems
                row={row}
                copy={copy}
                actions={props.actions}
                onRename={() => {
                  renameFromMenu.current = true;
                  setMenuOpen(false);
                  setRenaming(true);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
