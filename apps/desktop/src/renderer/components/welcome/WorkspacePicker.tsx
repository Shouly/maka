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

// Which workspace the next task runs in.
//
// Look ported from the reference design system's `ChatProjectSelector`: a
// Popover rather than a menu (there is a search field inside, and Radix menus
// eat character keys for typeahead), three fixed zones so "Add project" never
// scrolls out of reach.
//
// The data is Maka's and shaped differently: a workspace is a project ON a
// Runtime Host, so rows are grouped by Host and a Host that is unreachable
// still gets a row saying so — silently omitting it would read as "that
// machine's projects are gone".

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.js';
import { menuActionItemClass, menuSeparatorClass } from '../ui/menu-variants.js';
import { cn } from '../../lib/cn.js';
import { projectPathDisplay } from '../../lib/ported/project-path-display.js';
import { newTaskStore } from '../../store/index.js';
import { workspaceOptionsOf, type WorkspaceOption } from '../../store/new-task-store.js';
import { getWelcomeCopy } from '../../locales/welcome-copy.js';

const MENU_ICON = 20;

export function WorkspacePicker(props: { className?: string }) {
  const copy = getWelcomeCopy(useUiLocale()).workspace;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const catalog = useStore(newTaskStore, (state) => state.catalog);
  const loading = useStore(newTaskStore, (state) => state.loading);
  const target = useStore(newTaskStore, (state) => state.target);

  useEffect(() => {
    if (!open) return;
    // Let the popover land before focusing, or Radix's own entry focus
    // management takes it straight back.
    const timer = setTimeout(() => searchRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [open]);

  const options = useMemo(() => workspaceOptionsOf(catalog), [catalog]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      [option.projectName, option.profileName, option.path].some(
        (value) => value !== undefined && value.toLowerCase().includes(needle),
      ),
    );
  }, [options, query]);
  const grouped = useMemo(() => {
    const byHost = new Map<string, { profileName: string; options: WorkspaceOption[] }>();
    for (const option of filtered) {
      const group = byHost.get(option.profileId);
      if (group) group.options.push(option);
      else byHost.set(option.profileId, { profileName: option.profileName, options: [option] });
    }
    return [...byHost.entries()];
  }, [filtered]);

  const current = options.find(
    (option) => option.profileId === target?.profileId && option.projectId === target?.projectId,
  );
  const label = current?.projectName ?? copy.none;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setQuery('');
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${copy.label}: ${label}`}
          className={cn(
            'ui-control-squish ui-control-squish-ghost inline-flex h-8 min-w-0 max-w-[416px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] leading-[1.4] text-text-secondary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]',
            props.className,
          )}
        >
          <Anthropicon name="folder" size={16} className="shrink-0" />
          <span className="min-w-0 truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        variant="panel"
        align="start"
        side="top"
        sideOffset={6}
        className="flex max-h-[min(60vh,420px)] w-[400px] max-w-[calc(100vw-2rem)] flex-col rounded-xl p-1"
      >
        <div className="flex shrink-0 items-center gap-2 px-2 py-1.5 text-menu-text-muted">
          <Anthropicon name="search" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            aria-label={copy.searchLabel}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.placeholder}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm leading-5 text-menu-text-primary outline-none placeholder:text-menu-text-muted"
          />
        </div>
        <div className={cn(menuSeparatorClass, 'shrink-0')} />

        <div className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label={copy.label}>
          {loading && options.length === 0 ? (
            <p className="px-2.5 py-4 text-center text-sm text-menu-text-muted" role="status">
              {copy.loading}
            </p>
          ) : grouped.length === 0 ? (
            <p className="px-2.5 py-4 text-center text-sm text-menu-text-muted" role="status">
              {query.trim() ? copy.noMatch : copy.empty}
            </p>
          ) : (
            grouped.map(([profileId, group]) => (
              <div key={profileId}>
                <p className="px-2.5 py-1 text-xs leading-4 text-menu-text-muted">
                  {group.profileName}
                </p>
                {group.options.map((option) => {
                  const selected =
                    option.profileId === target?.profileId &&
                    option.projectId === target?.projectId;
                  const path = option.path
                    ? projectPathDisplay(option.path, { maxLength: 40 })
                    : undefined;
                  return (
                    <button
                      key={`${option.profileId}:${option.projectId ?? 'none'}`}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={!option.available}
                      title={path?.title}
                      onClick={() => {
                        if (!option.available || !option.hostId) return;
                        newTaskStore.selectTarget({
                          profileId: option.profileId,
                          hostId: option.hostId,
                          projectId: option.projectId,
                        });
                        setOpen(false);
                      }}
                      className={menuActionItemClass}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center">
                        <Anthropicon name="projects" size={MENU_ICON} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col text-left">
                        <span className="truncate">
                          {option.projectName ?? copy.hostUnavailable}
                        </span>
                        {(path || option.unavailableReason) && (
                          <span className="truncate text-xs text-menu-text-muted">
                            {option.unavailableReason ?? path?.text}
                          </span>
                        )}
                      </span>
                      {selected && (
                        <span className="ml-auto flex size-5 shrink-0 items-center justify-center text-menu-accent">
                          <Anthropicon name="check" size={MENU_ICON} weight={566.5} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="shrink-0">
          <div className={menuSeparatorClass} />
          <button
            type="button"
            className={menuActionItemClass}
            onClick={() => {
              const host = target ?? defaultHostRef(options);
              if (!host?.hostId) return;
              setOpen(false);
              void newTaskStore.addProject({ profileId: host.profileId, hostId: host.hostId });
            }}
          >
            <span className="flex size-5 shrink-0 items-center justify-center">
              <Anthropicon name="folderAdd" size={MENU_ICON} />
            </span>
            <span>{copy.add}</span>
          </button>
          {current?.projectId && (
            <button
              type="button"
              className={menuActionItemClass}
              onClick={() => {
                if (!current.hostId || !current.projectId) return;
                setOpen(false);
                void newTaskStore.relinkProject(
                  { profileId: current.profileId, hostId: current.hostId },
                  current.projectId,
                );
              }}
            >
              <span className="flex size-5 shrink-0 items-center justify-center">
                <Anthropicon name="link" size={MENU_ICON} />
              </span>
              <span>{copy.relink}</span>
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function defaultHostRef(
  options: readonly WorkspaceOption[],
): { profileId: string; hostId: string | undefined } | undefined {
  const first = options.find((option) => option.available && option.hostId);
  return first ? { profileId: first.profileId, hostId: first.hostId } : undefined;
}
