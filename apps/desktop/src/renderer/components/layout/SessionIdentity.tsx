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

// Who the content column is showing, rendered into the window titlebar's
// second column (plan §2.12) — not a header bar of its own.
//
// Shows the parent task, editable task name, and project folder shortcut.
//
// `data-maka-contract="titlebar-identity"` is pinned: the main process probe
// and the e2e suite both look for it.

import { useState } from 'react';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { cn } from '../../lib/cn.js';
import { InlineRename } from './sidebar-parts/InlineRename.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { sessionsStore } from '../../store/index.js';
import { openPath } from '../../bridge/app.js';
import type { SessionListRow } from '../../store/session-list-model.js';

const textControlClass =
  'flex h-7 min-w-0 items-center rounded-[7px] px-1.5 text-[13px] leading-5 hover:bg-sidebar-menu-hover focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none';

export function SessionIdentity(props: {
  row: SessionListRow | undefined;
  parentName: string | undefined;
  onOpenParent: (sessionId: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getSidebarCopy(locale);
  const shell = getShellCopy(locale);
  const [renaming, setRenaming] = useState(false);
  const row = props.row;
  return (
    <div
      data-maka-contract="titlebar-identity"
      className="flex min-w-0 items-center gap-0.5 text-sidebar-text-primary"
    >
      {row?.branchOf && (
        <>
          <button
            type="button"
            onClick={() => props.onOpenParent(row.branchOf!.id)}
            className={cn(
              textControlClass,
              'maka-no-drag cursor-pointer text-sidebar-text-secondary',
            )}
          >
            <span className="truncate">{props.parentName ?? row.branchOf.name}</span>
          </button>
          <span aria-hidden="true" className="text-sidebar-text-muted">
            <Anthropicon name="caretRight" size={12} />
          </span>
        </>
      )}
      {!row ? null : renaming ? (
        <div className="maka-no-drag w-56 min-w-0 px-1">
          <InlineRename
            value={row.name}
            label={copy.rename.label}
            onCommit={(name) => {
              setRenaming(false);
              void sessionsStore.rename(row.id, name);
            }}
            onCancel={() => setRenaming(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setRenaming(true)}
          aria-label={copy.rowActions.rename}
          className={cn(textControlClass, 'maka-no-drag cursor-pointer font-medium')}
        >
          <span className="truncate">{row.displayName}</span>
        </button>
      )}
      {row?.projectName && (
        <>
          <span aria-hidden="true" className="px-0.5 text-sidebar-text-muted opacity-50">
            ·
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void openPath('project', row.id)}
                className={cn(
                  textControlClass,
                  'maka-no-drag cursor-pointer text-sidebar-text-secondary',
                )}
              >
                <span className="truncate">{row.projectName}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{shell.paths.project}</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}
