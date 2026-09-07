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

// The task rail.
//
// Structure, geometry and motion are the reference design system's `Sidebar`:
// the 44px brand row, the fixed header over one scrolling panel, the row fade
// under `AnimatePresence mode="popLayout"`, the three-layer resize handle that
// doubles as a collapse button, and the collapsed-state hover peek. What is
// gone is everything that belonged to the reference's product rather than its
// design — the five tab segments (personal/group/talk/Y), the websockets, the
// user menu. This product has one panel.
//
// What is Maka's: the rows describe tasks on Runtime Hosts, so they carry a
// project, a relative time and the running/stale signals; the nav rows below
// the list go to the module pages; and the footer carries the update chip,
// which is the only place the app ever asks for the user's attention about
// itself.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useRovingRowFocus, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { SidebarTooltipProvider } from '../ui/sidebar-tooltip.js';
import { Input } from '../ui/input.js';
import { cn } from '../../lib/cn.js';
import {
  SESSION_LIST_EXPANDED_MAX_WIDTH,
  SESSION_LIST_EXPANDED_MIN_WIDTH,
} from '../../lib/ported/session-list-layout.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import { scheduledTasksStore, uiStore, updateStore } from '../../store/index.js';
import { pendingScheduledTaskCount } from '../../store/scheduled-tasks-store.js';
import { updateChipOf } from '../../store/update-store.js';
import type { SessionListGroupMode } from '../../store/session-list-model.js';
import { useProjectRows, useSessionList } from '../../hooks/use-session-list.js';
import type { SidebarLayout } from '../../hooks/use-sidebar-layout.js';
import {
  ProjectRow,
  SessionRow,
  SidebarGroup,
  SidebarGroupModeMenu,
  SidebarNavButton,
  SidebarNewButton,
  SidebarTabPanel,
  navIconClass,
  useHiddenGroupKeys,
  type ProjectRowActions,
  type SessionRowActions,
} from './sidebar-parts/index.js';

export interface SidebarProps {
  layout: SidebarLayout;
  /** The filter box is view state, owned by the shell so ⌘K can clear it. */
  filter: string;
  onFilterChange: (filter: string) => void;
  filterInputRef: React.RefObject<HTMLInputElement | null>;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onSelectModule: (module: 'skills' | 'mcp' | 'scheduled-tasks') => void;
  sessionActions: SessionRowActions;
  projectActions: ProjectRowActions;
}

export function Sidebar(props: SidebarProps) {
  const locale = useUiLocale();
  const copy = getSidebarCopy(locale);
  const layout = props.layout;
  const { model, loading, error, activeId, mode } = useSessionList(props.filter);
  const projects = useProjectRows();
  const navigation = useStore(uiStore, (state) => state.navigation);
  const schedules = useStore(scheduledTasksStore, (state) => state.data);
  const updateStatus = useStore(updateStore, (state) => state.status);
  const chip = updateChipOf(updateStatus);
  const listRef = useRef<HTMLDivElement>(null);
  const rovingProps = useRovingRowFocus(listRef, '[data-roving-row]');
  const [hiddenGroups, setGroupHidden] = useHiddenGroupKeys(mode);
  const [projectsHidden, setProjectsHidden] = useState(true);
  const pending = pendingScheduledTaskCount(schedules);

  const setMode = useCallback((next: SessionListGroupMode) => {
    uiStore.setViewMode(next === 'project' ? 'project' : 'conversation');
  }, []);

  // The rail publishes its own width so the titlebar strip and any surface
  // measuring the shell can read it without reaching into React.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.appFrame');
    if (!root) return;
    root.style.setProperty('--maka-sidenav-width', layout.collapsed ? '0px' : `${layout.width}px`);
    if (layout.collapsed) root.setAttribute('data-sidebar-state', 'collapsed');
    else root.removeAttribute('data-sidebar-state');
  }, [layout.collapsed, layout.width]);

  const groupModeMenu = useMemo(
    () => <SidebarGroupModeMenu copy={copy} mode={mode} onModeChange={setMode} />,
    [copy, mode, setMode],
  );

  const listBody = error ? (
    <div className="p-2 text-sm text-danger" role="alert">
      {copy.error}
    </div>
  ) : loading && model.total === 0 ? (
    <div className="space-y-[1.5px] px-2 pb-2" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div key={index} className="h-8 animate-pulse rounded-lg bg-sidebar-selected/60" />
      ))}
    </div>
  ) : model.groups.length === 0 ? (
    <div
      className="p-4 text-center text-sm leading-[21px] text-sidebar-text-muted"
      role="status"
      aria-live="polite"
    >
      {model.filtered ? copy.emptyFiltered : copy.empty}
    </div>
  ) : (
    model.groups.map((group, index) => (
      <SidebarGroup
        key={group.key}
        groupKey={group.key}
        title={group.label}
        copy={copy}
        activeChildKey={activeId ?? null}
        childKeys={group.rows.map((row) => row.id)}
        isContentHidden={hiddenGroups.has(group.key)}
        onContentHiddenChange={(hidden) => setGroupHidden(group.key, hidden)}
        actions={index === 0 ? groupModeMenu : undefined}
      >
        {group.rows.map((row) => (
          <SessionRow
            key={row.id}
            row={row}
            isActive={row.id === activeId}
            copy={copy}
            actions={props.sessionActions}
          />
        ))}
      </SidebarGroup>
    ))
  );

  return (
    <SidebarTooltipProvider>
      <div
        id="app-sidebar"
        ref={layout.sidebarRef}
        style={layout.sidebarStyle}
        aria-label={copy.panelLabel}
        aria-hidden={!layout.visible || undefined}
        inert={!layout.visible || undefined}
        {...layout.panelHoverProps}
        className={cn(
          'group/sidebar relative flex h-full shrink-0 select-none flex-col text-sidebar-text-secondary',
          layout.isResizing
            ? 'transition-none'
            : 'transition-[width] duration-200 ease-out motion-reduce:transition-none',
          !layout.visible
            ? 'pointer-events-none w-0 overflow-hidden'
            : layout.isPeekOpen
              ? // The reference design's peek surface: raised, hairline edge, its
                // own three-layer shadow. It starts at the WINDOW's top edge and
                // carries its own control row, so panel and titlebar are one
                // surface (below: `maka-sidebar-peek-row`).
                'fixed left-0 top-0 z-40 h-dvh w-[var(--sidebar-expanded-width)] border-r border-hairline bg-surface-2 shadow-[var(--sidebar-peek-shadow)]'
              : 'w-[var(--sidebar-expanded-width)] border-r border-hairline bg-sidebar',
        )}
      >
        {/* Peek: the panel starts at the window's top edge, under the titlebar's
            left segment (which stays on top and keeps the SAME toggle/search
            buttons — nothing remounts, so nothing flickers or moves). This row
            only reserves that height so the panel's edge and shadow run up to
            the top. */}
        {layout.isPeekOpen && <div className="maka-titlebar-row shrink-0" aria-hidden="true" />}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <SidebarTabPanel
            scrollLabel={copy.listLabel}
            header={
              <>
                <div className="shrink-0 px-2 pt-2">
                  <SidebarNewButton
                    label={copy.newTask}
                    shortcut={copy.newTaskShortcut}
                    onSelect={props.onNewTask}
                  />
                </div>
                <div className="shrink-0 px-2 pb-2 pt-2">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sidebar-text-muted">
                      <Anthropicon name="filter" />
                    </span>
                    <Input
                      ref={props.filterInputRef}
                      value={props.filter}
                      onChange={(event) => props.onFilterChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' && props.filter) {
                          event.stopPropagation();
                          props.onFilterChange('');
                        }
                      }}
                      aria-label={copy.filterLabel}
                      placeholder={copy.filterPlaceholder}
                      className="h-8 pl-8 pr-8"
                    />
                    {props.filter && (
                      <button
                        type="button"
                        onClick={() => props.onFilterChange('')}
                        aria-label={copy.filterClear}
                        className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-sidebar-text-muted hover:bg-sidebar-menu-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none"
                      >
                        <Anthropicon name="x" />
                      </button>
                    )}
                  </div>
                </div>
              </>
            }
          >
            <div
              ref={listRef}
              role="listbox"
              aria-label={copy.listLabel}
              aria-busy={loading || undefined}
              data-maka-session-list=""
              className="px-2 pb-2 [&>section+section]:mt-2.5"
              onKeyDown={rovingProps.onKeyDown}
              onFocus={rovingProps.onFocus}
            >
              {listBody}
            </div>

            {projects.length > 0 && (
              <div className="px-2 pb-2">
                <SidebarGroup
                  groupKey="projects"
                  title={copy.projectsSection}
                  copy={copy}
                  childKeys={projects.map((project) => project.id)}
                  isContentHidden={projectsHidden}
                  onContentHiddenChange={setProjectsHidden}
                >
                  {projects.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      copy={copy}
                      actions={props.projectActions}
                    />
                  ))}
                </SidebarGroup>
              </div>
            )}

            <nav className="space-y-[0.5px] px-2 pb-2" aria-label={copy.nav.extensions}>
              <SidebarNavButton
                icon={<Anthropicon name="shapes" className={navIconClass} />}
                label={copy.nav.skills}
                isActive={
                  navigation.selection.section === 'extensions' &&
                  navigation.selection.module === 'skills'
                }
                onSelect={() => props.onSelectModule('skills')}
              />
              <SidebarNavButton
                icon={<Anthropicon name="plugin" className={navIconClass} />}
                label={copy.nav.mcp}
                isActive={
                  navigation.selection.section === 'extensions' &&
                  navigation.selection.module === 'mcp'
                }
                onSelect={() => props.onSelectModule('mcp')}
              />
              <SidebarNavButton
                icon={<Anthropicon name="clock" className={navIconClass} />}
                label={copy.nav.automations}
                isActive={navigation.selection.section === 'automations'}
                onSelect={() => props.onSelectModule('scheduled-tasks')}
                trailing={
                  pending > 0 ? (
                    <span
                      aria-label={copy.nav.pending(pending)}
                      className="ml-auto mr-2 rounded bg-alpha-1 px-1 text-[11px] leading-4 tabular-nums text-sidebar-text-muted"
                    >
                      {pending}
                    </span>
                  ) : undefined
                }
              />
            </nav>
          </SidebarTabPanel>
        </div>

        <div className="shrink-0 border-t border-hairline p-2">
          {chip && (
            <button
              type="button"
              onClick={() =>
                chip.kind === 'downloaded' ? updateStore.install() : updateStore.retry()
              }
              className={cn(
                'mb-1 flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-sm leading-[21px] transition-colors hover:bg-sidebar-hover focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none',
                chip.kind === 'downloaded' ? 'text-accent' : 'text-danger',
              )}
            >
              <Anthropicon name={chip.kind === 'downloaded' ? 'arrowUpCircle' : 'warningCircle'} />
              <span className="min-w-0 flex-1 truncate">
                {chip.kind === 'downloaded'
                  ? copy.update.downloaded(chip.version ?? '')
                  : copy.update.failed}
              </span>
              <span className="shrink-0 text-[11px] text-sidebar-text-muted">
                {chip.kind === 'downloaded' ? copy.update.install : copy.update.retry}
              </span>
            </button>
          )}
          <SidebarNavButton
            icon={<Anthropicon name="settings" className={navIconClass} />}
            label={copy.nav.settings}
            onSelect={props.onOpenSettings}
          />
        </div>

        {/* The handle doubles as a collapse button; a drag also dispatches a
            click on release, which `wasResizeDragged()` is what tells apart. */}
        {!layout.collapsed && (
          <div
            ref={layout.resizeHandleRef}
            role="separator"
            aria-label={copy.resize}
            aria-controls="app-sidebar"
            aria-orientation="vertical"
            aria-valuemin={SESSION_LIST_EXPANDED_MIN_WIDTH}
            aria-valuemax={SESSION_LIST_EXPANDED_MAX_WIDTH}
            aria-valuenow={layout.width}
            aria-valuetext={`${layout.width}px`}
            tabIndex={0}
            onClick={(event) => {
              event.stopPropagation();
              if (layout.wasResizeDragged()) return;
              layout.toggle();
            }}
            onKeyDown={layout.onResizeKeyDown}
            onPointerDown={layout.onResizePointerDown}
            onPointerMove={layout.onResizePointerMove}
            onPointerUp={layout.onResizePointerEnd}
            onPointerCancel={layout.onResizePointerEnd}
            onLostPointerCapture={layout.onResizeLostPointerCapture}
            className="group/resize absolute inset-y-0 -right-[6px] z-30 w-3 cursor-col-resize touch-none outline-none"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 rounded-full transition-shadow duration-[60ms] group-focus-visible/resize:shadow-[var(--sidebar-focus-shadow)]"
            />
            <span
              aria-hidden="true"
              className={cn(
                'pointer-events-none absolute left-1/2 top-1/2 h-full max-h-12 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sidebar-text-muted opacity-0 transition-[opacity,background-color,max-height] delay-200 duration-200 group-hover/resize:opacity-100 group-focus-visible/resize:max-h-none group-focus-visible/resize:bg-accent-fill group-focus-visible/resize:opacity-100 group-focus-visible/resize:delay-0',
                layout.isResizing &&
                  'max-h-12 bg-sidebar-text-secondary opacity-100 transition-none delay-0',
              )}
            />
          </div>
        )}
      </div>
    </SidebarTooltipProvider>
  );
}
