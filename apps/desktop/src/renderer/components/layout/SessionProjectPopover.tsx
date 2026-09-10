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

import { useState } from 'react';
import { cn } from '../../lib/cn.js';
import { mainHeaderTextControlClass } from './MainHeader.js';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { collapseSessionRevisions } from '@maka/core/session-revisions';
import type { DesktopSessionSummary } from '../../bridge/sessions.js';
import { getSessionProjectInfo, openPath } from '../../bridge/app.js';
import { newTaskStore, sessionsStore, uiStore } from '../../store/index.js';
import { toast } from '../../store/toast-store.js';
import { useAsync } from '../../hooks/use-async.js';
import { sessionMatchesRail } from '../../lib/ported/session-nav-filter.js';
import { projectPathDisplay } from '../../lib/ported/project-path-display.js';
import { getProjectDetailsCopy } from '../../locales/project-details-copy.js';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { menuActionItemClass, menuSeparatorClass } from '../ui/menu-variants.js';

export function projectTaskCount(
  sessions: readonly DesktopSessionSummary[],
  session: DesktopSessionSummary,
): number {
  return collapseSessionRevisions(
    sessions.filter(
      (row) =>
        row.profileId === session.profileId &&
        row.runtimeHostId === session.runtimeHostId &&
        row.projectId === session.projectId &&
        sessionMatchesRail(row),
    ),
    session.id,
  ).length;
}

export function SessionProjectPopover({
  session,
  name,
}: {
  session: DesktopSessionSummary;
  name: string;
}) {
  const copy = getProjectDetailsCopy(useUiLocale());
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const catalog = useStore(newTaskStore, (state) => state.catalog);
  const sessions = useStore(sessionsStore, (state) => state.sessions);
  const complete = useStore(sessionsStore, (state) =>
    state.completeHostIds.includes(session.runtimeHostId),
  );
  const host = catalog?.hosts.find((entry) => entry.profile.id === session.profileId);
  const available =
    host?.readiness === 'ready' &&
    host.state === 'available' &&
    host.hostId === session.runtimeHostId;
  const clientPath = available && host.capabilities.viewClientPath;
  const info = useAsync(
    open && clientPath && session.localState !== 'pending'
      ? () => getSessionProjectInfo(session.id)
      : undefined,
    [open, clientPath, session.id, session.localState],
  );
  const path = clientPath ? info.data?.projectPath || session.cwd : undefined;
  const display = path ? projectPathDisplay(path) : undefined;
  const count = projectTaskCount(sessions, session);
  const canOpen = Boolean(path && available && session.localState !== 'pending');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={copy.view(name)}
          data-maka-contract="session-project-trigger"
          className={cn(
            mainHeaderTextControlClass,
            'maka-no-drag cursor-pointer !shrink data-[state=open]:bg-sidebar-menu-hover',
          )}
        >
          <span className="truncate">{name}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        variant="panel"
        align="start"
        side="bottom"
        sideOffset={6}
        aria-label={copy.view(name)}
        data-maka-contract="session-project-popover"
        className="w-80 max-w-[calc(100vw-2rem)] rounded-xl p-1"
      >
        <div className="flex min-w-0 items-center gap-2 px-2.5 py-2 text-menu-text-primary">
          <Anthropicon name="folder" size={20} className="shrink-0 text-text-secondary" />
          <span className="truncate font-medium" title={name}>
            {name}
          </span>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-2 text-text-secondary">
          <Anthropicon name="chat" size={20} className="shrink-0" />
          <span>{complete ? copy.tasks(count) : copy.partialTasks(count)}</span>
        </div>
        <div className={menuSeparatorClass} />
        <button
          type="button"
          className={cn(
            menuActionItemClass,
            'text-text-secondary hover:text-menu-text-primary focus-visible:text-menu-text-primary',
          )}
          disabled={!canOpen || opening}
          aria-label={copy.openDirectory}
          title={display?.title}
          onClick={() => {
            if (!canOpen || opening) return;
            setOpening(true);
            void openPath('project', session.id)
              .then((result) => {
                if (!result.ok) throw new Error(result.reason);
                setOpen(false);
              })
              .catch(() =>
                toast({ title: copy.openFailed, description: path, variant: 'destructive' }),
              )
              .finally(() => setOpening(false));
          }}
        >
          <Anthropicon name="folder" size={20} className="shrink-0" />
          <span className="min-w-0 truncate">
            {display?.text ??
              (info.loading
                ? copy.loading
                : available && !clientPath
                  ? copy.remoteDirectory
                  : copy.unavailable)}
          </span>
          {canOpen && (
            <Anthropicon
              name="arrowUpRight"
              size={16}
              className="ml-auto shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-disabled:opacity-0"
            />
          )}
        </button>
        <div className={menuSeparatorClass} />
        <button
          type="button"
          className={cn(
            menuActionItemClass,
            'text-text-secondary hover:text-menu-text-primary focus-visible:text-menu-text-primary',
          )}
          disabled={!available}
          onClick={() => {
            setOpen(false);
            uiStore.openSettings('projects');
          }}
        >
          <Anthropicon name="settings" size={20} className="shrink-0" />
          <span>{copy.edit}</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
