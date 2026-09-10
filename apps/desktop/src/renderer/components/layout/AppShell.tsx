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

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { useStore } from 'zustand';
import { useUiLocale, MakaUriContext } from '@maka/ui';
import type { SettingsSection, ThemePreference } from '@maka/core/settings';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { ToastAction } from '../ui/toast.js';
import { AppLayout } from './AppLayout.js';
import { Sidebar } from './Sidebar.js';
import { projectTaskTarget } from '../../store/new-task-store.js';
import { SessionIdentity } from './SessionIdentity.js';
import { WindowTitlebar } from './WindowTitlebar.js';
import { TaskWelcomeContent } from '../welcome/TaskWelcomeContent.js';
import { composerInputStore } from '../../store/composer-input-store.js';
import { newComposerKey } from '../composer/ChatInput.js';
import { SessionView } from '../session/SessionView.js';
import { CommandPalette } from '../palette/CommandPalette.js';
import { KeyboardHelp } from '../palette/KeyboardHelp.js';
import { SearchModal } from '../palette/SearchModal.js';
import { SkillsModule } from '../modules/skills/SkillsModule.js';
import { McpModule } from '../modules/mcp/McpModule.js';
import { ScheduledTasksModule } from '../modules/scheduled/ScheduledTasksModule.js';
import { SettingsIdentity } from '../settings/SettingsIdentity.js';
import { SettingsView } from '../settings/SettingsView.js';
import { RuntimeDebug } from '../dev/RuntimeDebug.js';
import { WorkbarPane } from '../workbar/WorkbarPane.js';
import { WorkbarToggle } from '../workbar/WorkbarToggle.js';
import { useRendererStores, useScopedRuntimeHost } from '../../hooks/use-workspace.js';
import { usePageHistory } from '../../hooks/use-page-history.js';
import type { PageLocation } from '../../store/page-history.js';
import { useSessionList } from '../../hooks/use-session-list.js';
import { useSidebarLayout } from '../../hooks/use-sidebar-layout.js';
import { useShellHotkeys } from '../../hooks/use-hotkeys.js';
import { useWorkbar } from '../../hooks/use-workbar.js';
import {
  archiveProjectAndClearDefault,
  connectionsStore,
  hostScopeStore,
  newTaskStore,
  onboardingStore,
  sessionsStore,
  settingsStore,
  turnActionsStore,
  uiStore,
} from '../../store/index.js';
import { startWindowCommands } from '../../store/window-commands.js';
import type { SessionListRow } from '../../store/session-list-model.js';
import type { ProjectRowModel } from '../../hooks/use-session-list.js';
import { toast } from '../../store/toast-store.js';
import { getDesktopConversationCopy } from '../../locales/conversation-copy.js';
import {
  copyDiagnosticReport,
  copyPreviousMainProcessInterruption,
  takePreviousMainProcessInterruption,
} from '../../bridge/diagnostics.js';
import { openPath } from '../../bridge/app.js';
import { previewSessionRemoval } from '../../bridge/sessions.js';
import { testNetworkProxy } from '../../bridge/settings.js';
import { restoreProject, renameProject } from '../../bridge/projects.js';
import { getShellCopy, localizedShellErrorMessage } from '../../locales/shell-copy.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import type { PendingE2eFixtureUiState } from '../../lib/fixture.js';

type MainView = 'welcome' | 'session' | 'settings' | 'skills' | 'mcp' | 'automations' | 'debug';

export function AppShell(props: { fixture: PendingE2eFixtureUiState | null }) {
  useRendererStores();
  const locale = useUiLocale();
  const shell = getShellCopy(locale);
  const sidebarCopy = getSidebarCopy(locale);
  const layout = useSidebarLayout();
  // The module pages read the same Runtime Host Settings does (plan §2.12):
  // a skills list from one machine beside a composer talking to another is the
  // bug this hook exists to prevent.
  const scopedHost = useScopedRuntimeHost();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ row: SessionListRow; count: number } | null>(
    null,
  );
  const activeId = useStore(sessionsStore, (state) => state.activeId);
  const localPending = useStore(
    sessionsStore,
    (state) => state.sessions.find((row) => row.id === state.activeId)?.localState === 'pending',
  );
  // The catalog's change events carry more than an invalidation (upstream
  // `handleSessionChange`): a named turn or message change answers whatever
  // turn action was still claimed for that Session, and a Host that rebound
  // the task to another model says so.
  useEffect(
    () =>
      sessionsStore.onChange((event) => {
        if (
          event.sessionId &&
          (event.reason === 'turn-status-change' ||
            event.reason === 'message-appended' ||
            event.reason === 'deleted')
        ) {
          turnActionsStore.clearPending(event.sessionId);
        }
        if (event.reason === 'rebound') {
          const copy = getDesktopConversationCopy(locale).actions;
          toast({
            title: copy.modelReboundTitle,
            description: copy.modelReboundDescription(event.modelId),
            variant: 'info',
          });
        }
      }),
    [locale],
  );
  const navigation = useStore(uiStore, (state) => state.navigation);
  const settingsOpen = useStore(uiStore, (state) => state.settingsOpen);
  const settingsSection = useStore(uiStore, (state) => state.settingsSection);
  const historyTarget = useStore(newTaskStore, (state) => state.target);
  const historySessions = useStore(sessionsStore, (state) => state.sessions);
  const historyReady = useStore(
    sessionsStore,
    (state) => state.revision > 0 || state.error !== undefined || state.activeId !== undefined,
  );
  const searchOpen = useStore(uiStore, (state) => state.searchOpen);
  const theme = useStore(settingsStore.client, (state) => state.data?.appearance.theme ?? 'auto');
  const connections = useStore(connectionsStore, (state) => state.data);
  const defaultHost = useStore(hostScopeStore, (state) => state.host);
  const { model } = useSessionList('');
  const workbar = useWorkbar(activeId);
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

  const selectModule = useCallback((module: 'sessions' | 'skills' | 'mcp' | 'scheduled-tasks') => {
    uiStore.closeSettings();
    setDebugOpen(false);
    if (module === 'sessions') uiStore.navigate({ section: 'sessions' });
    else if (module === 'scheduled-tasks')
      uiStore.navigate({ section: 'automations', module: 'scheduled-tasks' });
    else uiStore.navigate({ section: 'extensions', module });
  }, []);

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
    },
    toggleWorkbar: workbar.toggle,
    workbarFiles: () => workbar.toggleFace('files'),
    workbarReview: () => workbar.toggleFace('review'),
    workbarTerminal: () => workbar.toggleFace('terminal'),
    workbarBrowser: () => workbar.toggleFace('browser'),
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
        const operation = archived
          ? sessionsStore.archive(row.id)
          : sessionsStore.unarchive(row.id);
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
        const target = projectTaskTarget(project, newTaskStore.getState().catalog, defaultHost);
        if (!target) {
          reportError(
            shell.projectActions.projectUpdateFailedTitle,
            getSidebarCopy(locale).projectUnavailable,
          );
          return;
        }
        newTaskStore.selectTarget(target);
        newTask();
      },
      onRename: (project: ProjectRowModel, name: string) => {
        void renameProject(project.id, name, hostRef(project, defaultHost))
          .then(() => newTaskStore.refresh())
          .catch((error) => reportError(shell.projectActions.projectUpdateFailedTitle, error));
      },
      onArchive: (project: ProjectRowModel) => {
        void archiveProjectAndClearDefault(project.id, hostRef(project, defaultHost))
          .then(() => newTaskStore.refresh())
          .catch((error) => reportError(shell.projectActions.projectUpdateFailedTitle, error));
      },
      onRestore: (project: ProjectRowModel) => {
        void restoreProject(project.id, hostRef(project, defaultHost))
          .then(() => newTaskStore.refresh())
          .catch((error) => reportError(shell.projectActions.projectUpdateFailedTitle, error));
      },
    }),
    [defaultHost, reportError, shell, locale, newTask],
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

  const historyLocation = useMemo<PageLocation>(() => {
    if (view === 'session' && activeId) return { view, sessionId: activeId };
    if (view === 'settings')
      return {
        view,
        section: settingsSection as SettingsSection,
        sessionId: activeId,
        selection: navigation.selection,
      };
    if (view === 'welcome' || view === 'session') return { view: 'welcome', target: historyTarget };
    return { view, sessionId: activeId };
  }, [view, activeId, settingsSection, historyTarget, navigation.selection]);
  const historyAvailable = useCallback(
    (page: PageLocation) =>
      !page.sessionId ||
      historySessions.some((session) => session.id === page.sessionId && !session.isArchived),
    [historySessions],
  );
  const restoreHistory = useCallback(
    (page: PageLocation) => {
      uiStore.setSearchOpen(false);
      setPaletteOpen(false);
      setHelpOpen(false);
      if (page.view !== 'welcome' && page.view !== 'session') sessionsStore.select(page.sessionId);
      if (page.view === 'session') selectSession(page.sessionId);
      else if (page.view === 'welcome') {
        if (page.target) newTaskStore.selectTarget(page.target);
        newTask();
      } else if (page.view === 'settings') {
        setDebugOpen(false);
        if (page.selection) uiStore.navigate(page.selection);
        uiStore.openSettings(page.section);
      } else if (page.view === 'debug') setDebugOpen(true);
      else selectModule(page.view === 'automations' ? 'scheduled-tasks' : page.view);
    },
    [newTask, selectSession, selectModule],
  );
  const pageHistory = usePageHistory(
    historyLocation,
    historyReady,
    historyAvailable,
    restoreHistory,
  );

  const dispatchInternal = useCallback(
    (destination: import('@maka/ui/maka-uri').MakaUriDest) => {
      if (destination.kind === 'settings') openSettings(destination.section);
      else {
        const key = activeId ?? newComposerKey(newTaskStore.getState().target);
        composerInputStore.setText(key, destination.text);
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>('[data-maka-contract="composer-input"]')?.focus(),
        );
      }
    },
    [activeId, openSettings],
  );

  return (
    <MakaUriContext.Provider value={dispatchInternal}>
      {/*
        The window is two columns, not two rows: the right pane runs the FULL
        height of the window, and the titlebar belongs to the column left of
        it. That is the reference design's shape, and it is what makes the two
        things below true without any code to keep them true:

        - the pane's frame is the same 8px eave on all four sides, instead of
          hanging 56px below the top edge because a window-wide titlebar was in
          the way;
        - the titlebar narrows when the pane opens, so the workbar toggle ends
          up on the seam beside the pane rather than pinned above it.

        Everything the pane needs from the shell it now gets from the layout.
      */}
      <div className="flex min-h-0 flex-1 flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <WindowTitlebar
            layout={layout}
            history={pageHistory}
            softEdge={view === 'session'}
            // Full screen is the pane owning the window; this row's controls would
            // all point underneath it (see `concealed`).
            concealed={workbar.expanded}
            identity={
              // Settings owns the identity slot while it owns the content column;
              // the actions slot stays empty there (plan §2.12).
              view === 'settings' ? (
                <SettingsIdentity />
              ) : view === 'session' && activeId ? (
                <SessionIdentity
                  key={activeId}
                  row={activeRow}
                  actions={sessionActions}
                  parentName={parentRow?.displayName}
                  onOpenParent={selectSession}
                />
              ) : undefined
            }
            actions={
              view === 'session' && activeId ? (
                // The model is chosen on the composer's meta row; the titlebar
                // keeps only the workbar's switch, which has to be reachable while
                // the pane is not on screen. In full screen the whole row is
                // concealed, so this needs no case of its own.
                <WorkbarToggle workbar={workbar} />
              ) : undefined
            }
          />
          <AppLayout
            collapsed={layout.collapsed}
            sidebar={
              <Sidebar
                layout={layout}
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
              <SettingsView onOpenKeyboardHelp={() => setHelpOpen(true)} />
            ) : view === 'skills' ? (
              <SkillsModule host={scopedHost} onSelectModule={selectModule} />
            ) : view === 'mcp' ? (
              <McpModule host={scopedHost} onSelectModule={selectModule} />
            ) : view === 'automations' ? (
              <ScheduledTasksModule />
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
        </div>
        {/* The pane is the second column of the window, so it needs nothing
            from the first one: it starts at the top edge, it narrows the
            titlebar and the transcript together, and full screen is simply
            this column growing to the whole frame. */}
        <AnimatePresence initial={false}>
          {view === 'session' && activeId && !workbar.collapsed && !localPending && (
            <WorkbarColumn>
              <WorkbarPane sessionId={activeId} workbar={workbar} />
            </WorkbarColumn>
          )}
        </AnimatePresence>
      </div>

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
        title={
          pendingDelete ? shell.sessionRowActions.deleteTitle(pendingDelete.row.displayName) : ''
        }
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
            if (sessionsStore.getState().activeId === target.row.id)
              sessionsStore.select(undefined);
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
    </MakaUriContext.Provider>
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

/**
 * The pane's column, opening and closing.
 *
 * The column's WIDTH is what moves: the titlebar and the transcript are the
 * rest of the row, so they give way and take it back over the same fifth of a
 * second instead of jumping. `width: auto` at rest rather than a number — the
 * pane owns its width and writes it straight to its own box during a resize
 * drag, and a column that hugs its child follows that for free.
 *
 * What is NOT animated is anything inside the pane: the child keeps its full
 * width the whole way and simply hangs off the narrow column, so a terminal is
 * not reflowed sixty times on the way in and a browser view is not resized
 * under the reader. What hangs off the end hangs off the WINDOW, and the frame
 * clips it — this column never does, because the pane's own frame is a
 * box-shadow drawn outside its box, hairline ring included, and a clip here
 * would cut the left edge of that away.
 */
function WorkbarColumn(props: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const present = useIsPresent();
  return (
    <motion.div
      // While it is leaving it is still in the tree, and a pane the reader has
      // put away should not answer to the keyboard or be read out.
      aria-hidden={!present || undefined}
      inert={!present || undefined}
      initial={{ width: 0 }}
      animate={{ width: 'auto' }}
      exit={{ width: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: 'easeOut' }}
      data-maka-contract="session-workbar-column"
      className="flex shrink-0"
    >
      {props.children}
    </motion.div>
  );
}
