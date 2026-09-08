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

// Phase 2 state: what the shell derives, and what it does with an intent.
//
// Everything under test here is pure or bridge-fed, so nothing needs a DOM.
// The presentation counterpart (a sidebar row and the palette rendered to
// markup) lives in `presentation.test.tsx`.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionSummary } from '@maka/core/session';
import { buildSessionListModel, timeBucketOf } from '../session-list-model.js';
import { createNewTaskStore, defaultTargetOf, workspaceOptionsOf } from '../new-task-store.js';
import { createUpdateStore, updateChipOf } from '../update-store.js';
import { pendingScheduledTaskCount } from '../scheduled-tasks-store.js';
import { createOnboardingStore, sendOutcomesOf } from '../onboarding-store.js';
import { dispatchShellCommand } from '../window-commands.js';
import { createUiStore } from '../ui-store.js';
import { resolveHotkey, SHELL_HOTKEYS } from '../../hooks/use-hotkeys.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import {
  buildPaletteCommands,
  buildSessionCommands,
  filterPaletteCommands,
} from '../../components/palette/commands.js';

const copy = getSidebarCopy('en');
const DAY = 86_400_000;
const NOON = new Date(2026, 8, 7, 12, 0, 0).getTime();

function session(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    name: id,
    isFlagged: false,
    isArchived: false,
    labels: [],
    hasUnread: false,
    status: 'active',
    backend: 'runtime',
    llmConnectionSlug: 'e2e',
    connectionLocked: false,
    model: 'test-model',
    lastMessageAt: NOON,
    ...overrides,
  } as unknown as SessionSummary;
}

function listModel(sessions: SessionSummary[], overrides: Record<string, unknown> = {}) {
  return buildSessionListModel({
    sessions,
    activeId: undefined,
    filter: '',
    mode: 'time',
    projects: [],
    copy,
    now: NOON,
    ...overrides,
  } as Parameters<typeof buildSessionListModel>[0]);
}

test('time buckets are calendar days, not rolling windows', () => {
  assert.equal(timeBucketOf(NOON, NOON), 'today');
  assert.equal(timeBucketOf(NOON - DAY, NOON), 'yesterday');
  assert.equal(timeBucketOf(NOON - 3 * DAY, NOON), 'week');
  assert.equal(timeBucketOf(NOON - 30 * DAY, NOON), 'older');
  // 23:59 yesterday is yesterday even though it is under 24 hours ago.
  const lateYesterday = new Date(2026, 8, 6, 23, 59, 0).getTime();
  assert.equal(timeBucketOf(lateYesterday, NOON), 'yesterday');
});

test('groups by time, with flagged tasks lifted out of their bucket', () => {
  const model = listModel([
    session('a'),
    session('b', { lastMessageAt: NOON - DAY }),
    session('c', { isFlagged: true, lastMessageAt: NOON - 30 * DAY }),
  ]);
  assert.deepEqual(
    model.groups.map((group) => group.key),
    ['flagged', 'today', 'yesterday'],
  );
  assert.deepEqual(
    model.groups[0]?.rows.map((row) => row.id),
    ['c'],
  );
});

test('groups by project, keeping catalog order and giving loose tasks a home', () => {
  const model = listModel(
    [
      session('a', { projectId: 'p1' }),
      session('b', { projectId: 'p2' }),
      session('c'),
      session('d', { projectId: 'ghost' }),
    ],
    {
      mode: 'project',
      projects: [
        { id: 'p1', name: 'One' },
        { id: 'p2', name: 'Two' },
      ],
    },
  );
  assert.deepEqual(
    model.groups.map((group) => group.label),
    ['One', 'Two', 'ghost', copy.noProject],
  );
});

test('the filter reads the name, the project and the Host, and reports itself', () => {
  const rows = [session('alpha', { projectId: 'p1' }), session('beta', { projectId: 'p1' })];
  const projects = [{ id: 'p1', name: 'Reporting' }];
  assert.equal(listModel(rows, { filter: 'alp', projects }).total, 1);
  assert.equal(listModel(rows, { filter: 'REPORT', projects }).total, 2);
  assert.equal(listModel(rows, { filter: 'nothing', projects }).total, 0);
  assert.equal(listModel(rows, { filter: '  ', projects }).filtered, false);
  assert.equal(listModel(rows, { filter: 'alp', projects }).filtered, true);
});

test('a revision family occupies one row and carries its own size', () => {
  const family = [
    session('root'),
    session('rev1', {
      revisionRootSessionId: 'root',
      revisionParentSessionId: 'root',
      revisionIndex: 2,
      revisionState: 'committed',
      lastMessageAt: NOON + 10,
    }),
  ];
  const model = listModel(family);
  assert.equal(model.total, 1);
  assert.equal(model.rows[0]?.revisionCount, 2);
  assert.deepEqual([...(model.rows[0]?.familyIds ?? [])].sort(), ['rev1', 'root']);
});

test('a branch names the parent it descends from, and only while the parent is listed', () => {
  const withParent = listModel([
    session('parent'),
    session('child', { parentSessionId: 'parent' }),
  ]);
  assert.deepEqual(withParent.rows.find((row) => row.id === 'child')?.branchOf, {
    id: 'parent',
    name: 'parent',
  });
  const orphan = listModel([session('child', { parentSessionId: 'gone' })]);
  assert.equal(orphan.rows[0]?.branchOf, undefined);
});

test('stale marks only the blockers the rail can explain', () => {
  const rows = [session('a'), session('b'), session('c')];
  const model = listModel(rows, {
    sendOutcomes: {
      a: { kind: 'blocked', reason: 'connection_missing' },
      b: { kind: 'blocked', reason: 'runtime_unavailable' },
      c: { kind: 'ready' },
    },
  });
  assert.deepEqual(
    model.rows.filter((row) => row.stale).map((row) => row.id),
    ['a'],
  );
});

test('running is true from the live stream even when the stored status disagrees', () => {
  const model = listModel([session('a', { status: 'active' })], {
    runningIds: new Set(['a']),
  });
  assert.equal(model.rows[0]?.running, true);
});

test('archived tasks stay out of the rail unless asked for', () => {
  const rows = [session('a'), session('b', { isArchived: true })];
  assert.equal(listModel(rows).total, 1);
  assert.equal(listModel(rows, { includeArchived: true }).total, 2);
});

const readyHost = (projects: { id: string; name: string }[]) => ({
  profile: { id: 'local', name: 'This Mac' },
  hostId: 'host-1',
  readiness: 'ready' as const,
  state: 'available' as const,
  projects: projects.map((project) => ({
    ...project,
    locations: [{ path: `/tmp/${project.id}`, isWorktree: false }],
    available: true,
  })),
  capabilities: {},
  selectedProjectId: projects[0]?.id ?? null,
  chatDefaults: {},
});

function fakeNewTaskBridge(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  return {
    calls,
    bridge: {
      getNewTaskCatalog: async () => ({
        defaultProfileId: 'local',
        hosts: [
          readyHost([
            { id: 'p1', name: 'One' },
            { id: 'p2', name: 'Two' },
          ]),
        ],
      }),
      subscribeNewTaskChanges: () => () => {},
      getNewTaskConnections: async () => ({
        connections: [],
        defaultConnection: 'e2e',
        chatModelChoices: [
          {
            connectionId: 'c1',
            connectionSlug: 'e2e',
            providerType: 'anthropic',
            providerLabel: 'Anthropic',
            model: 'm1',
            label: 'Model One',
            isDefault: true,
            thinkingLevels: [],
          },
        ],
      }),
      getNewTaskReadiness: async () => ({
        blockers: [
          { id: 'workspace', state: 'blocked', repairTarget: { kind: 'workspace_picker' } },
        ],
      }),
      createNewTask: async (target: unknown, input: unknown) => {
        calls.push(JSON.stringify([target, input]));
        return { id: 'created' };
      },
      addNewTaskProject: async () => ({ ok: true, project: { id: 'p3', name: 'Three' } }),
      relinkNewTaskProject: async () => ({ ok: true, project: { id: 'p1', name: 'One' } }),
      listNewTaskInvocableSkills: async () => [],
      ...overrides,
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test('the new-task catalog flattens to workspace rows and picks a default target', async () => {
  const { bridge } = fakeNewTaskBridge();
  const catalog = await bridge.getNewTaskCatalog();
  const options = workspaceOptionsOf(catalog as never);
  assert.deepEqual(
    options.map((option) => option.projectName),
    ['One', 'Two'],
  );
  assert.deepEqual(defaultTargetOf(catalog as never), {
    profileId: 'local',
    hostId: 'host-1',
    projectId: 'p1',
  });
});

test('an unreachable Host is still listed, so its projects do not silently vanish', () => {
  const options = workspaceOptionsOf({
    defaultProfileId: 'local',
    hosts: [
      { profile: { id: 'far', name: 'Server' }, readiness: 'unavailable', message: 'offline' },
    ],
  } as never);
  assert.equal(options.length, 1);
  assert.equal(options[0]?.available, false);
  assert.equal(options[0]?.unavailableReason, 'offline');
});

test('the store loads readiness and a model for its target, and creates with both', async () => {
  const { bridge, calls } = fakeNewTaskBridge();
  const store = createNewTaskStore(bridge as never);
  const stop = store.start();
  await tick();
  await tick();
  assert.equal(store.getState().target?.projectId, 'p1');
  assert.equal(store.getState().readiness?.blockers.length, 1);
  assert.equal(store.getState().model?.model, 'm1');
  await store.create();
  assert.equal(calls.length, 1);
  assert.match(calls[0] ?? '', /"projectId":"p1"/u);
  assert.match(calls[0] ?? '', /"model":"m1"/u);
  stop();
});

test('creating without a workspace refuses rather than guessing one', async () => {
  const { bridge } = fakeNewTaskBridge({
    getNewTaskCatalog: async () => ({ defaultProfileId: 'local', hosts: [] }),
  });
  const store = createNewTaskStore(bridge as never);
  const stop = store.start();
  await tick();
  await assert.rejects(() => store.create(), /workspace/u);
  stop();
});

test('selecting a target reloads only the reads that are scoped to it', async () => {
  let readinessCalls = 0;
  const { bridge } = fakeNewTaskBridge({
    getNewTaskReadiness: async () => {
      readinessCalls += 1;
      return { blockers: [] };
    },
  });
  const store = createNewTaskStore(bridge as never);
  const stop = store.start();
  await tick();
  await tick();
  const before = readinessCalls;
  // Selecting the same target is a no-op; a different one is not.
  store.selectTarget({ profileId: 'local', hostId: 'host-1', projectId: 'p1' });
  assert.equal(readinessCalls, before);
  store.selectTarget({ profileId: 'local', hostId: 'host-1', projectId: 'p2' });
  await tick();
  await tick();
  assert.equal(readinessCalls, before + 1);
  stop();
});

test('the update chip shows only what the user can act on', () => {
  assert.equal(updateChipOf(undefined), undefined);
  assert.equal(updateChipOf({ state: 'checking', currentVersion: '1' }), undefined);
  assert.equal(
    updateChipOf({
      state: 'downloading',
      currentVersion: '1',
      latestVersion: '2',
      progress: {},
    } as never),
    undefined,
  );
  assert.deepEqual(updateChipOf({ state: 'downloaded', currentVersion: '1', latestVersion: '2' }), {
    kind: 'downloaded',
    version: '2',
    message: undefined,
  });
  assert.equal(
    updateChipOf({ state: 'error', currentVersion: '1', message: 'boom', operation: 'download' })
      ?.kind,
    'error',
  );
});

test('the update store takes its status from the subscription and stops listening', async () => {
  let handler: ((status: unknown) => void) | undefined;
  let unsubscribed = false;
  const store = createUpdateStore({
    subscribeUpdateStatus: (next: (status: unknown) => void) => {
      handler = next;
      return () => {
        unsubscribed = true;
      };
    },
    getUpdateStatus: async () => ({ state: 'idle', currentVersion: '1' }),
  } as never);
  const stop = store.start();
  await tick();
  assert.equal(store.getState().status?.state, 'idle');
  handler?.({ state: 'downloaded', currentVersion: '1', latestVersion: '2' });
  assert.equal(store.getState().status?.state, 'downloaded');
  stop();
  assert.equal(unsubscribed, true);
  // A status arriving after the scope closed must not revive it.
  handler?.({ state: 'checking', currentVersion: '1' });
  assert.equal(store.getState().status?.state, 'downloaded');
});

test('the automations badge counts armed tasks, not every task', () => {
  assert.equal(pendingScheduledTaskCount(undefined), 0);
  assert.equal(
    pendingScheduledTaskCount([
      { status: 'active', nextFireAt: 1 },
      { status: 'active', nextFireAt: null },
      { status: 'paused', nextFireAt: 1 },
      { status: 'completed', nextFireAt: null },
    ] as never),
    1,
  );
});

test('the onboarding snapshot arrives on its own budget and exposes send outcomes', async () => {
  let reads = 0;
  const store = createOnboardingStore({
    getOnboardingSnapshot: async () => {
      reads += 1;
      return { sessionSendOutcomes: { a: { kind: 'ready' } } };
    },
    setOnboardingMilestone: async () => ({ sessionSendOutcomes: {} }),
  } as never);
  assert.deepEqual(sendOutcomesOf(store.getState()), {});
  const cancel = store.prefetch(0);
  await tick();
  await tick();
  assert.equal(reads, 1);
  assert.deepEqual(sendOutcomesOf(store.getState()), { a: { kind: 'ready' } });
  cancel();
  // A cancelled prefetch never reads.
  const other = createOnboardingStore({ getOnboardingSnapshot: async () => ({}) } as never);
  other.prefetch(50)();
  await tick();
  assert.equal(other.getState().snapshot, undefined);
});

test('a failed onboarding read leaves the shell usable', async () => {
  const store = createOnboardingStore({
    getOnboardingSnapshot: async () => {
      throw new Error('offline');
    },
  } as never);
  store.prefetch(0);
  await tick();
  await tick();
  assert.equal(store.getState().error, 'offline');
  assert.equal(store.getState().snapshot, undefined);
});

test('native menu commands route to the shell, and unknown ids are ignored', () => {
  const seen: string[] = [];
  const handlers = {
    newTask: () => seen.push('newTask'),
    openSettings: () => seen.push('openSettings'),
    openHelp: () => seen.push('openHelp'),
  };
  assert.equal(dispatchShellCommand('newTask', handlers), true);
  assert.equal(dispatchShellCommand('openSettings', handlers), true);
  assert.equal(dispatchShellCommand('openHelp', handlers), true);
  assert.equal(dispatchShellCommand('somethingElse', handlers), false);
  assert.deepEqual(seen, ['newTask', 'openSettings', 'openHelp']);
});

const chord = (
  key: string,
  modifiers: Partial<{
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    inTextEntry: boolean;
  }> = {},
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

test('the hotkey map resolves the shell chords on both platforms', () => {
  assert.equal(resolveHotkey(chord('k', { metaKey: true }), true), 'palette');
  assert.equal(resolveHotkey(chord('k', { ctrlKey: true }), false), 'palette');
  // The other platform's modifier must not work.
  assert.equal(resolveHotkey(chord('k', { ctrlKey: true }), true), undefined);
  assert.equal(resolveHotkey(chord(',', { metaKey: true }), true), 'settings');
  assert.equal(resolveHotkey(chord('n', { metaKey: true }), true), 'newTask');
  assert.equal(
    resolveHotkey(chord('d', { metaKey: true, shiftKey: true }), true),
    'copyDiagnostics',
  );
  assert.equal(resolveHotkey(chord('?'), true), 'keyboardHelp');
  assert.equal(resolveHotkey(chord('/', { metaKey: true }), true), 'keyboardHelp');
  assert.equal(resolveHotkey(chord('f'), true), undefined);
  assert.equal(resolveHotkey(chord('Escape'), true), 'escape');
});

test('typing wins: only Escape survives a text field', () => {
  assert.equal(resolveHotkey(chord('f', { inTextEntry: true }), true), undefined);
  assert.equal(resolveHotkey(chord('?', { inTextEntry: true }), true), undefined);
  assert.equal(resolveHotkey(chord('Escape', { inTextEntry: true }), true), 'escape');
  // A modifier chord still reaches the shell from inside the composer, which
  // is where ⌘K and ⌘N are most often pressed.
  assert.equal(resolveHotkey(chord('k', { metaKey: true, inTextEntry: true }), true), 'palette');
  assert.equal(resolveHotkey(chord('n', { metaKey: true, inTextEntry: true }), true), 'newTask');
});

test('every hotkey action has exactly one binding path', () => {
  const actions = new Set(SHELL_HOTKEYS.map((binding) => binding.action));
  assert.deepEqual([...actions].sort(), [
    'copyDiagnostics',
    'escape',
    'keyboardHelp',
    'newTask',
    'palette',
    'settings',
    'toggleSidebar',
    'toggleWorkbar',
    'workbarBrowser',
    'workbarFiles',
    'workbarReview',
    'workbarTerminal',
  ]);
  // ⌘B toggles the sidebar from anywhere, the composer included (plan §2.12).
  assert.equal(
    resolveHotkey(chord('b', { metaKey: true, inTextEntry: true }), true),
    'toggleSidebar',
  );
});

test('the fixture seeds selection, layout and the settings section', () => {
  const ui = createUiStore();
  ui.applyFixture({
    activeSessionId: 'x',
    sidebarCollapsed: true,
    searchModalOpen: true,
    openSettingsSection: 'models',
    sidebarSection: 'mcp',
  });
  const state = ui.getState();
  assert.equal(state.sidebarCollapsed, true);
  assert.equal(state.searchOpen, true);
  assert.equal(state.settingsOpen, true);
  assert.equal(state.settingsSection, 'models');
  assert.deepEqual(state.navigation.selection, { section: 'extensions', module: 'mcp' });
});

function paletteInput(overrides: Record<string, unknown> = {}) {
  const ran: string[] = [];
  const noop = (name: string) => () => ran.push(name);
  return {
    ran,
    input: {
      locale: 'en' as const,
      activeSessionId: undefined,
      theme: 'dark' as const,
      connections: [],
      defaultSlug: null,
      onNewTask: noop('newTask'),
      onOpenSettings: noop('openSettings'),
      onOpenSettingsSection: noop('section'),
      onOpenKeyboardHelp: noop('help'),
      onSetTheme: noop('theme'),
      onSelectModule: noop('module'),
      onOpenWorkspaceFolder: noop('workspace'),
      onCopyDiagnostics: noop('diagnostics'),
      onTestNetworkProxy: noop('proxy'),
      onSetDefaultConnection: noop('default'),
      onOpenRuntimeDebug: noop('debug'),
      ...overrides,
    },
  };
}

test('the palette offers a settings command per section and marks the current theme', () => {
  const { input } = paletteInput();
  const commands = buildPaletteCommands(input as never);
  assert.equal(commands.filter((command) => command.id.startsWith('settings:')).length, 16);
  assert.ok(commands.find((command) => command.id === 'theme:dark')?.hint);
  assert.equal(commands.find((command) => command.id === 'theme:light')?.hint, undefined);
  assert.ok(commands.find((command) => command.id === 'diag:runtime-debug'));
});

test('the project-folder command needs a task, and the connection commands need a usable one', () => {
  const withoutSession = buildPaletteCommands(paletteInput().input as never);
  assert.equal(
    withoutSession.some((command) => command.id === 'diag:open-project-folder'),
    false,
  );
  const withSession = buildPaletteCommands(
    paletteInput({ activeSessionId: 's', onOpenProjectFolder: () => {} }).input as never,
  );
  assert.ok(withSession.find((command) => command.id === 'diag:open-project-folder'));

  const connections = buildPaletteCommands(
    paletteInput({
      defaultSlug: 'first',
      connections: [
        {
          slug: 'first',
          name: 'First',
          providerType: 'anthropic',
          enabled: true,
          defaultModel: 'm',
        },
        {
          slug: 'second',
          name: 'Second',
          providerType: 'anthropic',
          enabled: true,
          defaultModel: 'm',
        },
        { slug: 'off', name: 'Off', providerType: 'anthropic', enabled: false, defaultModel: 'm' },
        { slug: 'nomodel', name: 'No model', providerType: 'anthropic', enabled: true },
      ],
    }).input as never,
  ).filter((command) => command.id.startsWith('connection:set-default:'));
  assert.deepEqual(
    connections.map((command) => command.id),
    ['connection:set-default:second'],
  );
});

test('palette rows filter on label, hint and keywords', () => {
  const commands = buildPaletteCommands(paletteInput().input as never);
  assert.ok(filterPaletteCommands(commands, 'keyboard').length > 0);
  assert.equal(filterPaletteCommands(commands, '').length, commands.length);
  assert.equal(filterPaletteCommands(commands, 'zzzznothing').length, 0);
});

test('session rows are built separately and mark the open one', () => {
  const model = listModel([session('a'), session('b')]);
  const rows = buildSessionCommands({
    locale: 'en',
    rows: model.rows,
    activeSessionId: 'a',
    onSelectSession: () => {},
  });
  assert.deepEqual(rows.map((row) => row.label).sort(), ['a', 'b']);
  assert.ok(rows.find((row) => row.label === 'a')?.hint);
  assert.equal(rows.find((row) => row.label === 'b')?.hint, undefined);
});
