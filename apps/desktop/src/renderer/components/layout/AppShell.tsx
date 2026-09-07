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

// The shell: what is on screen, and every intent that changes it.
//
// One place owns the answer to "what does the main column show", because the
// sidebar, the palette, the native menu and the keyboard can all change it and
// they must agree. The rule is a single ordering, top to bottom: settings and
// module pages when the nav says so, the conversation when a task is selected,
// the welcome surface otherwise.
//
// Row actions live here rather than in the row for the same reason: deleting a
// task is a confirm dialog plus a Host call plus a toast plus, sometimes, a
// change of what the main column shows. A row cannot own that, and thirty rows
// each owning a copy of it would be thirty copies.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import type { SettingsSection, ThemePreference } from '@maka/core/settings';
import { Anthropicon } from '../icons/Anthropicon.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { ToastAction } from '../ui/toast.js';
import { AppLayout } from './AppLayout.js';
import { Sidebar } from './Sidebar.js';
import { SessionIdentity } from './SessionIdentity.js';
import { WindowTitlebar } from './WindowTitlebar.js';
import { TaskWelcomeContent } from '../welcome/TaskWelcomeContent.js';
import { SessionView } from '../session/SessionView.js';
import { ModelSwitcher } from '../session/ModelSwitcher.js';
import { CommandPalette } from '../palette/CommandPalette.js';
import { KeyboardHelp } from '../palette/KeyboardHelp.js';
import { SearchModal } from '../palette/SearchModal.js';
import { ModulePlaceholder, SettingsPlaceholder } from '../placeholder/ModulePlaceholder.js';
import { RuntimeDebug } from '../dev/RuntimeDebug.js';
import { useRendererStores } from '../../hooks/use-workspace.js';
import { useSessionList } from '../../hooks/use-session-list.js';
import { useSidebarLayout } from '../../hooks/use-sidebar-layout.js';
import { useShellHotkeys } from '../../hooks/use-hotkeys.js';
import {
  connectionsStore,
  hostScopeStore,
  newTaskStore,
  onboardingStore,
  sessionsStore,
  settingsStore,
  uiStore,
} from '../../store/index.js';
import { startWindowCommands } from '../../store/window-commands.js';
import type { SessionListRow } from '../../store/session-list-model.js';
import type { ProjectRowModel } from '../../hooks/use-session-list.js';
import { toast } from '../../store/toast-store.js';
import {
  copyDiagnosticReport,
  copyPreviousMainProcessInterruption,
  takePreviousMainProcessInterruption,
} from '../../bridge/diagnostics.js';
import { openPath } from '../../bridge/app.js';
import { previewSessionRemoval } from '../../bridge/sessions.js';
import { testNetworkProxy } from '../../bridge/settings.js';
import { revealProject, archiveProject, restoreProject, renameProject } from '../../bridge/projects.js';
import { getShellCopy, localizedShellErrorMessage } from '../../locales/shell-copy.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import { getSharedPlaceholderCopy } from '../../locales/placeholder-copy.js';
import type { PendingE2eFixtureUiState } from '../../lib/fixture.js';

type MainView = 'welcome' | 'session' | 'settings' | 'skills' | 'mcp' | 'automations' | 'debug';

export function AppShell(props: { fixture: PendingE2eFixtureUiState | null }) {
  useRendererStores();
  const locale = useUiLocale();
  const shell = getShellCopy(locale);
  const sidebarCopy = getSidebarCopy(locale);
  const placeholder = getSharedPlaceholderCopy(locale);
  const layout = useSidebarLayout();
  const [filter, setFilter] = useState('');
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ row: SessionListRow; count: number } | null>(
    null,
  );
  const activeId = useStore(sessionsStore, (state) => state.activeId);
  const navigation = useStore(uiStore, (state) => state.navigation);
  const settingsOpen = useStore(uiStore, (state) => state.settingsOpen);
  const searchOpen = useStore(uiStore, (state) => state.searchOpen);
  const theme = useStore(settingsStore.client, (state) => state.data?.appearance.theme ?? 'auto');
  const connections = useStore(connectionsStore, (state) => state.data);
  const defaultHost = useStore(hostScopeStore, (state) => state.host);
  const { model } = useSessionList(filter);
  const activeRow = model.rows.find((row) => row.id === activeId);
  const parentRow = activeRow?.branchOf
    ? model.rows.find((row) => row.id === activeRow.branchOf?.id)
    : undefined;

  const reportError = useCallback(
    (title: string, error: unknown) => {
      const description = localizedShellErrorMessage(error, shell.actions.retry, locale);
      toast({
        title,
        description,
        variant: 'destructive',
        // Every failure the shell reports carries the same escape hatch: the
        // report main assembles is the only thing that can explain it.
        action: (
          <ToastAction
            altText={shell.errorBoundary.copyReport}
            onClick={() => {
              void copyDiagnosticReport({
                surface: 'toast',
                title,
                description,
                ...(activeId ? { target: { sessionId: activeId } } : {}),
              });
            }}
          >
            {shell.errorBoundary.copyReport}
          </ToastAction>
        ),
      });
    },
    [locale, shell, activeId],
  );

  const openSettings = useCallback((section?: SettingsSection) => {
    // `settingsSection` is restored from localStorage, so it is a string until
    // it is validated; an unknown value falls back to the first page.
    const stored = uiStore.getState().settingsSection as SettingsSection;
    uiStore.openSettings(section ?? stored);
  }, []);

  const newTask = useCallback(() => {
    uiStore.closeSettings();
    uiStore.navigate({ section: 'sessions' });
    sessionsStore.select(undefined);
    setDebugOpen(false);
  }, []);

  const selectSession = useCallback((id: string) => {
    uiStore.closeSettings();
    uiStore.navigate({ section: 'sessions' });
    sessionsStore.select(id);
    setDebugOpen(false);
  }, []);

  const selectModule = useCallback(
    (module: 'sessions' | 'skills' | 'mcp' | 'scheduled-tasks') => {
      uiStore.closeSettings();
      setDebugOpen(false);
      if (module === 'sessions') uiStore.navigate({ section: 'sessions' });
      else if (module === 'scheduled-tasks')
        uiStore.navigate({ section: 'automations', module: 'scheduled-tasks' });
      else uiStore.navigate({ section: 'extensions', module });
    },
    [],
  );

  useShellHotkeys({
    palette: () => setPaletteOpen((open) => !open),
    settings: () => openSettings(),
    newTask,
    toggleSidebar: layout.toggle,
    keyboardHelp: () => setHelpOpen(true),
    copyDiagnostics: () => {
      void copyDiagnosticReport({
        surface: 'manual',
        ...(activeId ? { target: { sessionId: activeId } } : {}),
      });
    },
    escape: () => {
      if (paletteOpen) setPaletteOpen(false);
      else if (helpOpen) setHelpOpen(false);
      else if (searchOpen) uiStore.setSearchOpen(false);
      else if (settingsOpen) uiStore.closeSettings();
      else if (filter) setFilter('');
    },
    focusFilter: () => {
      // Only when the list already has focus: `f` is a letter, and stealing it
      // from anywhere would make the rest of the shell feel unresponsive.
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !active.closest('[data-maka-session-list]')) return;
      filterInputRef.current?.focus();
      filterInputRef.current?.select();
    },
  });

  useEffect(
    () =>
      startWindowCommands({
        newTask,
        openSettings: () => openSettings(),
        openHelp: () => setHelpOpen(true),
      }),
    [newTask, openSettings],
  );

  // The previous run's crash, reported once. `take` clears main's marker, so
  // this must run exactly once per mount and nowhere else.
  useEffect(() => {
    let cancelled = false;
    void takePreviousMainProcessInterruption().then((interrupted) => {
      if (!interrupted || cancelled) return;
      toast({
        title: shell.errorBoundary.title,
        description: shell.errorBoundary.description,
        variant: 'destructive',
        action: (
          <ToastAction
            altText={shell.errorBoundary.copyReport}
            onClick={() => void copyPreviousMainProcessInterruption()}
          >
            {shell.errorBoundary.copyReport}
          </ToastAction>
        ),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [shell]);

  // The fixture's UI state, applied once the stores that own it exist.
  const fixture = props.fixture;
  useEffect(() => {
    if (!fixture) return;
    uiStore.applyFixture(fixture);
    void sessionsStore.refresh().then(() => {
      if (fixture.activeSessionId) sessionsStore.select(fixture.activeSessionId);
    });
  }, [fixture]);

  const sessionActions = useMemo(
    () => ({
      onOpen: (row: SessionListRow) => selectSession(row.id),
      onRename: (row: SessionListRow, name: string) => {
        void sessionsStore
          .rename(row.id, name)
          .catch((error) => reportError(shell.sessionRowActions.renameFailedTitle, error));
      },
      onSetFlagged: (row: SessionListRow, flagged: boolean) => {
        void sessionsStore
          .flag(row.id, flagged)
          .catch((error) =>
            reportError(
              flagged
                ? shell.sessionRowActions.flagFailedTitle
                : shell.sessionRowActions.unflagFailedTitle,
              error,
            ),
          );
      },
      onArchive: (row: SessionListRow, archived: boolean) => {
        const operation = archived ? sessionsStore.archive(row.id) : sessionsStore.unarchive(row.id);
        void operation.catch((error) =>
          reportError(
            archived
              ? shell.sessionRowActions.archiveFailedTitle
              : shell.sessionRowActions.unarchiveFailedTitle,
            error,
          ),
        );
      },
      onRemove: (row: SessionListRow) => {
        // Ask the Host how much this actually removes before asking the user:
        // an edit-and-resend family deletes more than the row shows.
        void previewSessionRemoval(row.id)
          .then((count) => setPendingDelete({ row, count }))
          .catch(() => setPendingDelete({ row, count: 1 }));
      },
    }),
    [reportError, selectSession, shell],
  );

  const projectActions = useMemo(
    () => ({
      onNewTask: (project: ProjectRowModel) => {
        if (project.hostId)
          newTaskStore.selectTarget({
            profileId: project.profileId,
            hostId: project.hostId,
            projectId: project.id,
          });
        newTask();
      },
      onRename: (project: ProjectRowModel, name: string) => {
        void renameProject(project.id, name, hostRef(project, defaultHost))
          .then(() => newTaskStore.refresh())
          .catch((error) => reportError(shell.projectActions.projectUpdateFailedTitle, error));
      },
      onArchive: (project: ProjectRowModel) => {
        void archiveProject(project.id, hostRef(project, defaultHost))
          .then(() => newTaskStore.refresh())
          .catch((error) => reportError(shell.projectActions.projectUpdateFailedTitle, error));
      },
      onRestore: (project: ProjectRowModel) => {
        void restoreProject(project.id, hostRef(project, defaultHost))
          .then(() => newTaskStore.refresh())
          .catch((error) => reportError(shell.projectActions.projectUpdateFailedTitle, error));
      },
      onRelink: (project: ProjectRowModel) => {
        if (!project.hostId) return;
        void newTaskStore
          .relinkProject({ profileId: project.profileId, hostId: project.hostId }, project.id)
          .catch((error) => reportError(shell.projectActions.projectUpdateFailedTitle, error));
      },
      onReveal: (project: ProjectRowModel) => {
        void revealProject(project.id, hostRef(project, defaultHost)).catch((error) =>
          reportError(shell.projectActions.readPathFailedTitle, error),
        );
      },
    }),
    [defaultHost, reportError, shell],
  );

  const commandInput = useMemo(
    () => ({
      theme: theme as ThemePreference,
      connections: connections?.connections ?? [],
      defaultSlug: connections?.defaultConnection ?? null,
      onNewTask: newTask,
      onOpenSettings: () => openSettings(),
      onOpenSettingsSection: (section: SettingsSection) => openSettings(section),
      onOpenKeyboardHelp: () => setHelpOpen(true),
      onSetTheme: (next: ThemePreference) => {
        void settingsStore
          .updateClient({ appearance: { theme: next } })
          .catch((error) => reportError(shell.app.appearanceLoadErrorTitle, error));
      },
      onSelectModule: selectModule,
      onOpenWorkspaceFolder: () => {
        void openPath('workspace').catch((error) =>
          reportError(shell.projectActions.readPathFailedTitle, error),
        );
      },
      onOpenProjectFolder: activeId
        ? () => {
            void openPath('project', activeId).catch((error) =>
              reportError(shell.projectActions.readPathFailedTitle, error),
            );
          }
        : undefined,
      onCopyDiagnostics: () => {
        void copyDiagnosticReport({
          surface: 'manual',
          ...(activeId ? { target: { sessionId: activeId } } : {}),
        }).then((copied) => {
          if (copied)
            toast({
              title: shell.commandActions.diagnosticsCopiedTitle,
              description: shell.commandActions.diagnosticsCopiedDescription,
              variant: 'success',
            });
        });
      },
      onTestNetworkProxy: () => {
        void testNetworkProxy()
          .then((result) =>
            toast({
              title: result.ok
                ? shell.commandActions.networkPassedTitle
                : shell.commandActions.networkFailedTitle,
              variant: result.ok ? 'success' : 'destructive',
            }),
          )
          .catch((error) => reportError(shell.commandActions.genericTestFailedTitle, error));
      },
      onSetDefaultConnection: (slug: string) => {
        const connection = connections?.connections.find((row) => row.slug === slug);
        if (!connection || !defaultHost) return;
        void connectionsStore
          .setDefault({ connectionId: connection.connectionId, slug: connection.slug }, defaultHost)
          .then(() =>
            toast({
              title: shell.commandActions.setDefaultSuccess(connection.name),
              variant: 'success',
            }),
          )
          .catch((error) => reportError(shell.commandActions.setDefaultFailedTitle, error));
      },
      onOpenRuntimeDebug: () => setDebugOpen(true),
    }),
    [
      theme,
      connections,
      defaultHost,
      newTask,
      openSettings,
      selectModule,
      reportError,
      shell,
      activeId,
    ],
  );

  const view: MainView = debugOpen
    ? 'debug'
    : settingsOpen
      ? 'settings'
      : navigation.selection.section === 'extensions'
        ? navigation.selection.module === 'mcp'
          ? 'mcp'
          : 'skills'
        : navigation.selection.section === 'automations'
          ? 'automations'
          : activeId
            ? 'session'
            : 'welcome';

  return (
    <>
      {/* Row 1: the window titlebar — traffic lights, sidebar toggle, search,
          session identity, actions. Everything below starts under it. */}
      <WindowTitlebar
        layout={layout}
        onOpenSearch={() => uiStore.setSearchOpen(true)}
        identity={
          view === 'session' && activeId ? (
            <SessionIdentity
              row={activeRow}
              parentName={parentRow?.displayName}
              onOpenParent={selectSession}
            />
          ) : undefined
        }
        actions={
          view === 'session' && activeId ? (
            <ModelSwitcher
              sessionId={activeId}
              onOpenSettings={() => openSettings('models')}
              onError={reportError}
            />
          ) : undefined
        }
      />
      <AppLayout
        collapsed={layout.collapsed}
        sidebar={
          <Sidebar
            layout={layout}
            filter={filter}
            onFilterChange={setFilter}
            filterInputRef={filterInputRef}
            onNewTask={newTask}
            onOpenSettings={() => openSettings()}
            onSelectModule={selectModule}
            sessionActions={sessionActions}
            projectActions={projectActions}
          />
        }
      >
        {view === 'debug' ? (
          <RuntimeDebug />
        ) : view === 'settings' ? (
          <SettingsPlaceholder />
        ) : view === 'skills' ? (
          <ModulePlaceholder
            title={placeholder.skills}
            icon="shapes"
            description={placeholder.skillsDescription}
          />
        ) : view === 'mcp' ? (
          <ModulePlaceholder
            title={placeholder.mcp}
            icon="plugin"
            description={placeholder.mcpDescription}
          />
        ) : view === 'automations' ? (
          <ModulePlaceholder
            title={placeholder.automations}
            icon="clock"
            description={placeholder.automationsDescription}
          />
        ) : view === 'session' && activeId ? (
          <SessionView
            sessionId={activeId}
            onOpenSettings={(section) => openSettings(section ?? 'models')}
            onError={reportError}
          />
        ) : (
          <TaskWelcomeContent
            onOpenSettings={() => openSettings('projects')}
            onOpenModels={() => openSettings('models')}
            onOpenConnection={() => openSettings('models')}
            onError={reportError}
          />
        )}
      </AppLayout>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commandInput={commandInput}
      />
      <KeyboardHelp open={helpOpen} onOpenChange={setHelpOpen} />
      <SearchModal
        open={searchOpen}
        onOpenChange={(open) => uiStore.setSearchOpen(open)}
        onSelectSession={selectSession}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete ? shell.sessionRowActions.deleteTitle(pendingDelete.row.displayName) : ''}
        description={
          pendingDelete && pendingDelete.count > 1
            ? `${shell.sessionRowActions.deleteDescription} ${shell.sessionRowActions.deletedSubtaskNote(pendingDelete.count)}`
            : shell.sessionRowActions.deleteDescription
        }
        confirmText={shell.sessionRowActions.deleteLabel}
        cancelText={shell.sessionRowActions.cancelLabel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          const target = pendingDelete;
          if (!target) return;
          try {
            await sessionsStore.remove(target.row.id, { revisionFamily: true });
            if (sessionsStore.getState().activeId === target.row.id) sessionsStore.select(undefined);
            toast({
              title: shell.sessionRowActions.deletedTitle(target.row.displayName),
              variant: 'success',
            });
          } catch (error) {
            reportError(shell.sessionRowActions.deleteFailedTitle, error);
          } finally {
            setPendingDelete(null);
          }
        }}
      />
      <OnboardingRefresh />
    </>
  );
}

/** The onboarding snapshot has to be re-read after a task lands, or the hero
 *  keeps saying "no tasks yet" over a workspace that now has one. */
function OnboardingRefresh() {
  const revision = useStore(sessionsStore, (state) => state.revision);
  useEffect(() => {
    if (revision === 0) return;
    if (onboardingStore.getState().snapshot === undefined) return;
    void onboardingStore.refresh();
  }, [revision]);
  return null;
}

function hostRef(
  project: ProjectRowModel,
  fallback: { profileId: string; hostId: string } | undefined,
): { profileId: string; hostId: string } | undefined {
  if (project.hostId) return { profileId: project.profileId, hostId: project.hostId };
  return fallback;
}
