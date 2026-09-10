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

// Phase 5a state: what Settings decides before anything is drawn.
//
// The four things worth pinning are the ones a screenshot cannot check: which
// pages the nav offers, which channel a settings patch is written to, what an
// optimistic edit does when the write loses, and which button the updater's
// eight states each end up offering.

import assert from 'node:assert/strict';
import test from 'node:test';
import { SETTINGS_SECTIONS, type SettingsSection } from '@maka/core/settings';
import {
  DEFERRED_SETTINGS_SECTIONS,
  SETTINGS_NAV_GROUPS,
  VISIBLE_SETTINGS_SECTIONS,
  resolveSettingsSection,
} from '../../components/settings/settings-sections.js';
import { createOptimisticSettingsDraft } from '../../lib/ported/optimistic-settings-draft.js';
import { aboutUpdateRow, type AboutUpdateCopy } from '../../lib/ported/about-update-status.js';
import { updateInstallOutcome } from '../../hooks/use-update-install.js';
import { createSettingsStore } from '../settings-store.js';
import { createComposerInputStore } from '../composer-input-store.js';
import { createUiStore } from '../ui-store.js';
import type { AppUpdateStatus } from '../../bridge/app.js';

function installMemoryLocalStorage(seed: Record<string, string> = {}): () => void {
  const entries = new Map(Object.entries(seed));
  const api = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, String(value));
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    clear: () => entries.clear(),
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size;
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    value: api,
    configurable: true,
    writable: true,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis as object, 'localStorage');
  };
}

// ── the nav ────────────────────────────────────────────────────────────────

test('the nav lists every shipped section exactly once, in four groups', () => {
  const listed = SETTINGS_NAV_GROUPS.flatMap((group) => group.sections);
  assert.equal(listed.length, new Set(listed).size);
  assert.deepEqual([...listed], [...VISIBLE_SETTINGS_SECTIONS]);
  assert.equal(SETTINGS_NAV_GROUPS.length, 4);
});

test('the deferred pages keep their core id but never appear in the nav', () => {
  for (const section of DEFERRED_SETTINGS_SECTIONS) {
    assert.ok((SETTINGS_SECTIONS as readonly string[]).includes(section));
    assert.equal(VISIBLE_SETTINGS_SECTIONS.includes(section), false);
  }
  // Everything that is neither deferred nor listed would be a page with no
  // way in — the two sets have to partition the enum.
  for (const section of SETTINGS_SECTIONS) {
    assert.equal(
      VISIBLE_SETTINGS_SECTIONS.includes(section) || DEFERRED_SETTINGS_SECTIONS.includes(section),
      true,
      section,
    );
  }
});

test('a deep link or a restored value naming a deferred page falls back to general', () => {
  assert.equal(resolveSettingsSection('appearance'), 'appearance');
  assert.equal(resolveSettingsSection('bot-chat'), 'general');
  assert.equal(resolveSettingsSection('daily-review'), 'general');
  assert.equal(resolveSettingsSection('import-tasks'), 'general');
  assert.equal(resolveSettingsSection('not-a-section'), 'general');
  assert.equal(resolveSettingsSection(undefined), 'general');
});

// Phase 5b filled the four pages that used to open a placeholder. The list is
// spelled out rather than read from a constant: the constant that named them
// was deleted with the placeholder, and a page silently dropping out of the
// nav is exactly what this asserts against.
test('the four capability pages are in the nav', () => {
  for (const section of ['models', 'subagents', 'memory', 'search'] as const) {
    assert.equal(VISIBLE_SETTINGS_SECTIONS.includes(section), true);
  }
});

test('opening a section persists it under the unchanged localStorage key', () => {
  const restore = installMemoryLocalStorage();
  try {
    const ui = createUiStore();
    ui.openSettings('health');
    assert.equal(ui.getState().settingsOpen, true);
    assert.equal(ui.getState().settingsSection, 'health');
    assert.equal(localStorage.getItem('maka-settings-section-v1'), 'health');
    ui.closeSettings();
    assert.equal(ui.getState().settingsOpen, false);
    // The section survives the close, which is what makes ⌘, reopen it.
    assert.equal(ui.getState().settingsSection, 'health');
  } finally {
    restore();
  }
});

test('the fixture can open a section, and a deferred one still resolves', () => {
  const restore = installMemoryLocalStorage();
  try {
    const ui = createUiStore();
    ui.applyFixture({
      activeSessionId: undefined,
      openSettingsSection: 'bot-chat' as SettingsSection,
    } as Parameters<typeof ui.applyFixture>[0]);
    assert.equal(ui.getState().settingsOpen, true);
    assert.equal(resolveSettingsSection(ui.getState().settingsSection), 'general');
  } finally {
    restore();
  }
});

// ── which channel a patch is written to ────────────────────────────────────

function fakeSettingsBridge() {
  const calls: { channel: 'client' | 'host'; patch: unknown }[] = [];
  return {
    calls,
    bridge: {
      getClientSettings: async () => ({}) as never,
      getHostSettings: async () => ({}) as never,
      updateClientSettings: async (patch: unknown) => {
        calls.push({ channel: 'client', patch });
        return { settings: {} } as never;
      },
      updateHostSettings: async (patch: unknown) => {
        calls.push({ channel: 'host', patch });
        return { settings: {} } as never;
      },
      subscribeClientSettingsChanged: () => () => {},
      subscribeExternalSettingsChanged: () => () => {},
      testNetworkProxy: async () => ({}) as never,
      getUsageStats: async () => ({}) as never,
    },
  };
}

const HOST = { profileId: 'local', hostId: 'host-1' };

test('client-owned patches go to the client channel', async () => {
  const { calls, bridge } = fakeSettingsBridge();
  const store = createSettingsStore(bridge as never);
  await store.update({ appearance: { theme: 'dark' } }, HOST);
  await store.update({ notifications: { runComplete: true } }, HOST);
  await store.update({ personalization: { uiLocale: 'en' } }, HOST);
  assert.deepEqual(
    calls.map((call) => call.channel),
    ['client', 'client', 'client'],
  );
});

test('Host-owned patches go to the Host channel', async () => {
  const { calls, bridge } = fakeSettingsBridge();
  const store = createSettingsStore(bridge as never);
  await store.update({ privacy: { incognitoActive: true } }, HOST);
  await store.update({ chatDefaults: { permissionMode: 'bypass' } }, HOST);
  await store.update({ personalization: { displayName: 'Ada' } }, HOST);
  await store.update({ network: { proxy: { enabled: true } } }, HOST);
  await store.update({ shell: { preference: 'git_bash' } }, HOST);
  assert.deepEqual(
    calls.map((call) => call.channel),
    ['host', 'host', 'host', 'host', 'host'],
  );
});

test('a mixed patch goes to the Host, which applies the client half itself', async () => {
  const { calls, bridge } = fakeSettingsBridge();
  const store = createSettingsStore(bridge as never);
  await store.update({ appearance: { theme: 'light' }, privacy: { incognitoActive: false } }, HOST);
  assert.deepEqual(
    calls.map((call) => call.channel),
    ['host'],
  );
});

test('a Host-owned patch without a Host is refused rather than silently dropped', async () => {
  const { calls, bridge } = fakeSettingsBridge();
  const store = createSettingsStore(bridge as never);
  await assert.rejects(() => store.update({ privacy: { incognitoActive: true } }, undefined));
  assert.deepEqual(calls, []);
});

// ── optimistic edits ───────────────────────────────────────────────────────

interface Draft {
  host: string;
  port: number;
}

function draftHarness(initial: Draft, commit: (patch: Partial<Draft>) => Promise<Draft>) {
  const seen: Draft[] = [];
  const errors: unknown[] = [];
  const controller = createOptimisticSettingsDraft<Draft>({
    initial,
    commit,
    onDraftChange: (draft) => seen.push(draft),
    onError: (error) => errors.push(error),
  });
  return { controller, seen, errors };
}

test('an edit shows immediately and settles on what the write returned', async () => {
  const { controller, seen } = draftHarness({ host: '', port: 0 }, async (patch) => ({
    host: '127.0.0.1',
    port: 0,
    ...patch,
  }));
  const applied = controller.update({ host: 'proxy.local' });
  assert.equal(controller.draft().host, 'proxy.local');
  assert.equal(await applied, true);
  assert.equal(controller.draft().host, 'proxy.local');
  assert.ok(seen.length >= 2);
});

test('a failed write rolls back to what is stored, not to what was typed', async () => {
  const stored: Draft = { host: 'stored.example', port: 7890 };
  const { controller, errors } = draftHarness(stored, async () => {
    throw new Error('nope');
  });
  assert.equal(await controller.update({ host: 'typed.example' }), false);
  assert.deepEqual(controller.draft(), stored);
  assert.equal(errors.length, 1);
});

test('the last intent wins even when an earlier write answers last', async () => {
  const resolvers: ((value: Draft) => void)[] = [];
  const { controller } = draftHarness({ host: '', port: 0 }, () => {
    return new Promise<Draft>((resolve) => resolvers.push(resolve));
  });
  const first = controller.update({ host: 'one' });
  const second = controller.update({ host: 'two' });
  // The slow first write answers after the second one.
  resolvers[1]?.({ host: 'two', port: 0 });
  resolvers[0]?.({ host: 'one', port: 0 });
  assert.equal(await second, true);
  assert.equal(await first, false);
  assert.equal(controller.draft().host, 'two');
});

test('a snapshot arriving mid-flight lands only once the write settles', async () => {
  let resolve: ((value: Draft) => void) | undefined;
  const { controller } = draftHarness({ host: 'a', port: 1 }, () => {
    return new Promise<Draft>((next) => {
      resolve = next;
    });
  });
  const pending = controller.update({ host: 'b' });
  // The subscription pushes something unrelated while the write is open.
  controller.syncPersisted({ host: 'from-subscription', port: 2 });
  assert.equal(controller.draft().host, 'b', 'the field must not move under the user');
  resolve?.({ host: 'b', port: 1 });
  await pending;
  assert.equal(controller.draft().host, 'b');
});

test('a disposed draft drops the late response instead of resurrecting itself', async () => {
  let resolve: ((value: Draft) => void) | undefined;
  const { controller, seen } = draftHarness({ host: 'a', port: 1 }, () => {
    return new Promise<Draft>((next) => {
      resolve = next;
    });
  });
  const pending = controller.update({ host: 'b' });
  const before = seen.length;
  controller.dispose();
  resolve?.({ host: 'server', port: 9 });
  assert.equal(await pending, false);
  assert.equal(seen.length, before);
});

// ── the updater row ────────────────────────────────────────────────────────

const UPDATE_COPY: AboutUpdateCopy = {
  checkingForUpdates: 'checking',
  updateIdle: 'idle',
  updateNotAvailable: 'current',
  updateAvailable: 'available',
  updateDownloading: (percent) => `downloading ${percent}`,
  updateVerifying: 'verifying',
  updateDownloaded: 'downloaded',
  updateInstalling: 'installing',
  updateScheduleHint: 'checks periodically',
  updateFetchingHint: (version) => `fetching ${version}`,
  updateDownloadedHint: (version) => `restart for ${version}`,
  updateInstallingHint: (version) => `installing ${version}`,
  updateFailed: { check: 'check failed', download: 'download failed', install: 'install failed' },
  channelSummaries: { dev: 'dev', nightly: 'nightly', release: 'release' },
};

test('every updater state keeps one button in the same slot, and the right one', () => {
  // Three columns: which button, whether it is quiet because the updater is
  // working on its own, and the version-bearing second line that is always
  // there. The row used to drop the control in four of these states, which is
  // what made the page jump while a download ran.
  const cases: [AppUpdateStatus | undefined, string, boolean][] = [
    [undefined, 'check', false],
    [{ state: 'idle', currentVersion: '1' }, 'check', false],
    [{ state: 'checking', currentVersion: '1' }, 'check', true],
    [{ state: 'not-available', currentVersion: '1' }, 'check', false],
    [{ state: 'available', currentVersion: '1', latestVersion: '2' }, 'check', true],
    [
      {
        state: 'downloading',
        currentVersion: '1',
        latestVersion: '2',
        progress: { percent: 40 },
      },
      'check',
      true,
    ],
    [{ state: 'verifying', currentVersion: '1', latestVersion: '2' }, 'check', true],
    [{ state: 'downloaded', currentVersion: '1', latestVersion: '2' }, 'install', false],
    [{ state: 'installing', currentVersion: '1', latestVersion: '2' }, 'install', true],
    [
      { state: 'error', currentVersion: '1', message: 'x', operation: 'download' },
      'retry-download',
      false,
    ],
    [{ state: 'error', currentVersion: '1', message: 'x', operation: 'check' }, 'check', false],
    // The build is on disk; pressing restart again is the whole recovery.
    [{ state: 'error', currentVersion: '1', message: 'x', operation: 'install' }, 'install', false],
  ];
  for (const [status, action, working] of cases) {
    const row = aboutUpdateRow(status, UPDATE_COPY);
    const where = JSON.stringify(status);
    assert.equal(row.action, action, where);
    assert.equal(row.working, working, where);
    assert.notEqual(row.description, '', where);
  }
});

test('the label is a phase word and the version rides the line below it', () => {
  const downloading = aboutUpdateRow(
    { state: 'downloading', currentVersion: '1', latestVersion: '2', progress: { percent: 41.6 } },
    UPDATE_COPY,
  );
  // Rounded, and without the version: the label must not grow into the button.
  assert.equal(downloading.label, 'downloading 42');
  assert.equal(downloading.description, 'fetching 2');
  const downloaded = aboutUpdateRow(
    { state: 'downloaded', currentVersion: '1', latestVersion: '2' },
    UPDATE_COPY,
  );
  assert.equal(downloaded.label, 'downloaded');
  assert.equal(downloaded.description, 'restart for 2');
});

// The refusal is the whole point of this path: `updateStore.install` used to
// drop it, so pressing the sidebar's restart while a task ran did nothing at
// all — no restart, no message, nothing to press next.
test('a refused install asks before interrupting, and only asks once', () => {
  assert.deepEqual(updateInstallOutcome({ ok: true }, false), { kind: 'restarting' });
  assert.deepEqual(updateInstallOutcome({ ok: false, reason: 'active_tasks' }, false), {
    kind: 'ask-to-interrupt',
  });
  // Already asked and answered: a second refusal means the interrupt did not
  // take, which is a sentence, not the same question again.
  assert.deepEqual(updateInstallOutcome({ ok: false, reason: 'active_tasks' }, true), {
    kind: 'refused',
    reason: 'active_tasks',
  });
  for (const reason of ['not_downloaded', 'install_failed'] as const) {
    assert.deepEqual(updateInstallOutcome({ ok: false, reason }, false), {
      kind: 'refused',
      reason,
    });
  }
});

// ── clearing drafts ────────────────────────────────────────────────────────

test('clearing drafts empties both the store and its persisted copy', () => {
  let written = '{}';
  const storage = {
    read: () => written,
    write: (value: string) => {
      written = value;
    },
  };
  const store = createComposerInputStore(storage);
  store.setText('session-a', 'half a sentence');
  store.setText('session-b', 'another');
  assert.ok(written.includes('half a sentence'));
  assert.equal(store.clearAll(), 2);
  assert.deepEqual(store.getState().drafts, {});
  assert.equal(written, '{}');
});
