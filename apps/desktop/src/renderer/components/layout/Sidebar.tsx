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

// The rail. Three bands, top to bottom (owner decision, 2026-09-08):
//
//   menu      New task, Extensions (Skills | MCP), Scheduled — fixed
//   Projects  every project the Hosts know, each expandable to its tasks;
//             a project's row starts a task in it
//   Recents   the most recent tasks across projects, flat, newest first
//
// Geometry and motion are the reference design system's `Sidebar`: the fixed
// header over one scrolling panel, the row fade, the three-layer resize handle
// that doubles as a collapse button, the collapsed-state hover peek. The
// reference's filter box and group-by menu are gone: ⌘K / search is how a task
// is found, and the list has one shape.
//
// The footer carries the update chip, which is the only place the app ever
// asks for the user's attention about itself, and Settings.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useRovingRowFocus, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { SidebarTooltipProvider } from '../ui/sidebar-tooltip.js';
import { cn } from '../../lib/cn.js';
import {
  SESSION_LIST_EXPANDED_MAX_WIDTH,
  SESSION_LIST_EXPANDED_MIN_WIDTH,
} from '../../lib/ported/session-list-layout.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import { scheduledTasksStore, uiStore, updateStore } from '../../store/index.js';
import { pendingScheduledTaskCount } from '../../store/scheduled-tasks-store.js';
import { updateChipOf } from '../../store/update-store.js';
import type { SessionListGroup, SessionListRow } from '../../store/session-list-model.js';
import {
  useProjectRows,
  useSessionList,
  type ProjectRowModel,
} from '../../hooks/use-session-list.js';
import type { SidebarLayout } from '../../hooks/use-sidebar-layout.js';
import {
  ProjectRow,
  SessionRow,
  SidebarGroup,
  SidebarNavButton,
  SidebarNewButton,
  SidebarTabPanel,
  navIconClass,
  type ProjectRowActions,
  type SessionRowActions,
} from './sidebar-parts/index.js';

/** How many tasks the Recents band shows. */
export const SIDEBAR_RECENTS_LIMIT = 20;

export interface SidebarProps {
  layout: SidebarLayout;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onSelectModule: (module: 'skills' | 'mcp' | 'scheduled-tasks') => void;
  sessionActions: SessionRowActions;
  projectActions: ProjectRowActions;
}

/** One Projects entry: the project (when the catalog knows it) and its tasks. */
interface ProjectEntry {
  readonly key: string;
  readonly project: ProjectRowModel | undefined;
  readonly label: string;
  readonly rows: readonly SessionListRow[];
}

export function Sidebar(props: SidebarProps) {
  const locale = useUiLocale();
  const copy = getSidebarCopy(locale);
  const layout = props.layout;
  const { model, loading, error, activeId } = useSessionList('');
  const projects = useProjectRows();
  const navigation = useStore(uiStore, (state) => state.navigation);
  const schedules = useStore(scheduledTasksStore, (state) => state.data);
  const updateStatus = useStore(updateStore, (state) => state.status);
  const chip = updateChipOf(updateStatus);
  const listRef = useRef<HTMLDivElement>(null);
  const rovingProps = useRovingRowFocus(listRef, '[data-roving-row]');
  const pending = pendingScheduledTaskCount(schedules);
  const [projectsHidden, setProjectsHidden] = useState(false);
  const [recentsHidden, setRecentsHidden] = useState(false);

  // The rail publishes its own width so the titlebar strip and any surface
  // measuring the shell can read it without reaching into React.
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.appFrame');
    if (!root) return;
    root.style.setProperty('--maka-sidenav-width', layout.collapsed ? '0px' : `${layout.width}px`);
    if (layout.collapsed) root.setAttribute('data-sidebar-state', 'collapsed');
    else root.removeAttribute('data-sidebar-state');
  }, [layout.collapsed, layout.width]);

  // Projects: the catalog's projects in its order (with or without tasks),
  // then projects only the tasks know (another Host's, or archived since),
  // then the tasks with no project. The list model already groups by project
  // in that order; the catalog rows fill in the projects it has no task for.
  const entries = useMemo<ProjectEntry[]>(() => {
    const byKey = new Map<string, SessionListGroup>(
      model.groups.map((group) => [group.key, group]),
    );
    const out: ProjectEntry[] = [];
    for (const project of projects) {
      const key = `project:${project.id}`;
      out.push({ key, project, label: project.name, rows: byKey.get(key)?.rows ?? [] });
      byKey.delete(key);
    }
    for (const group of byKey.values()) {
      out.push({ key: group.key, project: undefined, label: group.label, rows: group.rows });
    }
    return out;
  }, [model.groups, projects]);

  // Which projects are open. The project holding the active task opens on its
  // own when the active task changes; everything else remembers what the user
  // did for the life of the window.
  const [openProjects, setOpenProjects] = useState<ReadonlySet<string>>(() => new Set());
  const activeEntryKey = useMemo(
    () => entries.find((entry) => entry.rows.some((row) => row.id === activeId))?.key,
    [entries, activeId],
  );
  useEffect(() => {
    if (!activeEntryKey) return;
    setOpenProjects((current) => {
      if (current.has(activeEntryKey)) return current;
      const next = new Set(current);
      next.add(activeEntryKey);
      return next;
    });
  }, [activeEntryKey]);
  const toggleProject = useCallback((key: string) => {
    setOpenProjects((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const recents = useMemo(() => model.rows.slice(0, SIDEBAR_RECENTS_LIMIT), [model.rows]);

  const extensionsActive = navigation.selection.section === 'extensions';
  const openExtensions = () => props.onSelectModule(navigation.moduleMemory.extensions);

  const projectsBody = error ? (
    <div className="p-2 text-sm text-danger" role="alert">
      {copy.error}
    </div>
  ) : loading && model.total === 0 && entries.length === 0 ? (
    <div className="space-y-[1.5px] pb-2" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="h-8 animate-pulse rounded-lg bg-sidebar-selected/60" />
      ))}
    </div>
  ) : entries.length === 0 ? (
    <div className="px-2 pb-2 text-sm leading-[21px] text-sidebar-text-muted" role="status">
      {copy.noProjects}
    </div>
  ) : (
    entries.map((entry) => {
      const open = openProjects.has(entry.key);
      return (
        <div key={entry.key} className="space-y-[1.5px]">
          <ProjectRow
            projectKey={entry.key}
            project={entry.project}
            label={entry.label}
            taskCount={entry.rows.length}
            expanded={open}
            onToggle={() => toggleProject(entry.key)}
            copy={copy}
            actions={props.projectActions}
          />
          {open && (
            <div
              id={`sidebar-project-${entry.key}-tasks`}
              role="group"
              aria-label={entry.label}
              className="space-y-[1.5px] pl-4"
            >
              {entry.rows.length === 0 ? (
                <div className="px-2 py-1 text-[13px] leading-5 text-sidebar-text-muted">
                  {copy.noTasksInProject}
                </div>
              ) : (
                entry.rows.map((row) => (
                  <SessionRow
                    key={row.id}
                    row={row}
                    isActive={row.id === activeId}
                    copy={copy}
                    actions={props.sessionActions}
                  />
                ))
              )}
            </div>
          )}
        </div>
      );
    })
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
              <nav
                className="shrink-0 space-y-[0.5px] px-2 pb-[12.5px] pt-2"
                aria-label={copy.menuLabel}
              >
                <SidebarNewButton
                  label={copy.newTask}
                  shortcut={copy.newTaskShortcut}
                  onSelect={props.onNewTask}
                />
                <SidebarNavButton
                  icon={<Anthropicon name="tool" className={navIconClass} />}
                  label={copy.nav.extensions}
                  isActive={extensionsActive}
                  onSelect={openExtensions}
                />
                <SidebarNavButton
                  icon={<Anthropicon name="clock" className={navIconClass} />}
                  label={copy.nav.scheduled}
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
              <SidebarGroup
                groupKey="projects"
                title={copy.projectsSection}
                copy={copy}
                activeChildKey={activeEntryKey ?? null}
                childKeys={entries.map((entry) => entry.key)}
                isContentHidden={projectsHidden}
                onContentHiddenChange={setProjectsHidden}
              >
                {[<Fragment key="projects">{projectsBody}</Fragment>]}
              </SidebarGroup>

              {recents.length > 0 && (
                <SidebarGroup
                  groupKey="recents"
                  title={copy.recentsSection}
                  copy={copy}
                  activeChildKey={activeId ?? null}
                  childKeys={recents.map((row) => row.id)}
                  isContentHidden={recentsHidden}
                  onContentHiddenChange={setRecentsHidden}
                >
                  {recents.map((row) => (
                    <SessionRow
                      key={row.id}
                      row={row}
                      isActive={row.id === activeId}
                      copy={copy}
                      actions={props.sessionActions}
                    />
                  ))}
                </SidebarGroup>
              )}
            </div>
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
