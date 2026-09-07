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

// Phase 4 state: the right pane's model, and the pure decisions its faces make.
//
// Everything here is pure or store-fed, so nothing needs a DOM. What the pane
// LOOKS like is not asserted here — that is the Electron smoke test, which
// drives the real pane against a real Host.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { SessionEvent } from '@maka/core/events';
import { createUiStore } from '../ui-store.js';
import { createWorkbarStore, matchArtifactForPath } from '../workbar-store.js';
import { resolveHotkey } from '../../hooks/use-hotkeys.js';
import { isSessionWorkbarCollapsed } from '../../lib/ported/workbar-layout.js';
import { nextArtifactListAction } from '../../lib/ported/artifact-list-keyboard.js';
import {
  ARTIFACT_TEXT_HIGHLIGHT_LINE_LIMIT,
  boundPreviewText,
  capPreviewLines,
  countExternalLinks,
  isMarkdownArtifactName,
} from '../../lib/ported/artifact-preview-text.js';
import { SessionTerminalHydration } from '../../lib/ported/session-terminal-hydration.js';
import {
  createTraceRefreshCoalescer,
  isTraceRelevantEvent,
} from '../../lib/ported/session-trace-refresh.js';
import { deriveInspectorPanelModel } from '../../lib/ported/session-inspector-panel-model.js';

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

function chord(
  key: string,
  overrides: Partial<{
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    inTextEntry: boolean;
    code: string;
  }> = {},
) {
  return {
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

// ── the five chords ─────────────────────────────────────────────────────────

test('the workbar chords resolve on both platforms and do not collide', () => {
  assert.equal(resolveHotkey(chord('p', { metaKey: true }), true), 'workbarFiles');
  assert.equal(resolveHotkey(chord('p', { ctrlKey: true }), false), 'workbarFiles');
  assert.equal(resolveHotkey(chord('t', { metaKey: true }), true), 'workbarBrowser');
  assert.equal(resolveHotkey(chord('s', { metaKey: true, altKey: true }), true), 'toggleWorkbar');
  // Control, literally, on macOS too: ⌘` is the OS window cycler and ⌘⇧G is
  // "go to folder" in every file dialog.
  assert.equal(resolveHotkey(chord('g', { ctrlKey: true, shiftKey: true }), true), 'workbarReview');
  assert.equal(resolveHotkey(chord('`', { ctrlKey: true }), true), 'workbarTerminal');
  // A ⌘ chord on the same keys must not reach the Control bindings.
  assert.equal(resolveHotkey(chord('g', { metaKey: true, shiftKey: true }), true), undefined);
  assert.equal(resolveHotkey(chord('`', { metaKey: true }), true), undefined);
  // Bare Control on macOS is not `mod`, so ⌃P must not open Files there.
  assert.equal(resolveHotkey(chord('p', { ctrlKey: true }), true), undefined);
});

test('the workbar chords survive a text field, because that is where they are pressed', () => {
  assert.equal(
    resolveHotkey(chord('p', { metaKey: true, inTextEntry: true }), true),
    'workbarFiles',
  );
  assert.equal(
    resolveHotkey(chord('`', { ctrlKey: true, inTextEntry: true }), true),
    'workbarTerminal',
  );
});

test('⌥ composes a character on macOS, so the physical key decides', () => {
  // ⌘⌥S arrives as `key: 'ß'` on a US layout; `code` still says KeyS.
  assert.equal(
    resolveHotkey(chord('ß', { metaKey: true, altKey: true, code: 'KeyS' }), true),
    'toggleWorkbar',
  );
  // The fallback is only for Option chords: a stray `code` cannot invent one.
  assert.equal(resolveHotkey(chord('ß', { metaKey: true, code: 'KeyS' }), true), undefined);
});

// ── the layout, and the keys it writes ──────────────────────────────────────

test('opening a face reveals the pane for that task and persists the topology', () => {
  const restore = installMemoryLocalStorage();
  try {
    const ui = createUiStore();
    ui.dispatchWorkbar({ type: 'activate-session', sessionId: 'task-a' });
    // A task with no faces open starts collapsed.
    assert.equal(isSessionWorkbarCollapsed(ui.getState().workbar), true);

    ui.dispatchWorkbar({
      type: 'open',
      placement: 'right',
      tab: { id: 'workbar:files', kind: 'files' },
    });
    assert.equal(isSessionWorkbarCollapsed(ui.getState().workbar), false);
    const persisted = JSON.parse(localStorage.getItem('maka-session-workbar-panels-v3') ?? '');
    assert.equal(persisted.version, 3);
    assert.deepEqual(persisted.right.tabs, [{ id: 'workbar:files', kind: 'files' }]);
    assert.equal(persisted.right.activeTabId, 'workbar:files');

    // Collapse is remembered PER TASK, under the v2 key. The v1 key had no
    // owner and is removed rather than migrated (`workbar-layout.ts`).
    ui.dispatchWorkbar({ type: 'collapse', placement: 'right', collapsed: true });
    assert.deepEqual(JSON.parse(localStorage.getItem('maka-session-workbar-collapsed-v2') ?? ''), {
      'task-a': true,
    });
    assert.equal(localStorage.getItem('maka-session-workbar-collapsed-v1'), null);

    // Another task does not inherit it.
    ui.dispatchWorkbar({ type: 'activate-session', sessionId: 'task-b' });
    assert.equal(isSessionWorkbarCollapsed(ui.getState().workbar), true);
  } finally {
    restore();
  }
});

test('closing the last face puts the pane away, and the width is clamped', () => {
  const restore = installMemoryLocalStorage();
  try {
    const ui = createUiStore();
    ui.dispatchWorkbar({ type: 'activate-session', sessionId: 'task' });
    ui.dispatchWorkbar({
      type: 'open',
      placement: 'right',
      tab: { id: 'workbar:review', kind: 'review' },
    });
    ui.dispatchWorkbar({ type: 'close', placement: 'right', tabIds: ['workbar:review'] });
    assert.equal(ui.getState().workbar.panels.right.tabs.length, 0);
    assert.equal(isSessionWorkbarCollapsed(ui.getState().workbar), true);

    ui.dispatchWorkbar({ type: 'resize', placement: 'right', size: 10_000 });
    assert.equal(ui.getState().workbar.rightWidth, 600);
    assert.equal(localStorage.getItem('maka-session-workbar-width-v1'), '600');
    ui.dispatchWorkbar({ type: 'resize', placement: 'right', size: 10 });
    assert.equal(ui.getState().workbar.rightWidth, 340);
  } finally {
    restore();
  }
});

test('a no-op dispatch writes nothing, because selecting a task dispatches on every change', () => {
  const restore = installMemoryLocalStorage();
  try {
    const ui = createUiStore();
    ui.dispatchWorkbar({ type: 'activate-session', sessionId: 'task' });
    localStorage.clear();
    ui.dispatchWorkbar({ type: 'activate-session', sessionId: 'task' });
    assert.equal(localStorage.length, 0);
  } finally {
    restore();
  }
});

// ── what the pane is looking at ─────────────────────────────────────────────

test('the pane remembers a file and a shell run per task, and forgets removed tasks', () => {
  const store = createWorkbarStore();
  store.selectArtifact('a', 'artifact-1');
  store.selectTerminalRun('a', 'run-1');
  store.selectArtifact('b', 'artifact-2');
  assert.equal(store.getState().artifactBySession.a, 'artifact-1');
  assert.equal(store.getState().terminalRefBySession.a, 'run-1');

  store.retain(new Set(['a']));
  assert.equal(store.getState().artifactBySession.b, undefined);
  assert.equal(store.getState().artifactBySession.a, 'artifact-1');

  store.selectArtifact('a', undefined);
  assert.equal('a' in store.getState().artifactBySession, false);
});

test('a tool row asks by path; the pane answers with the id once the list has one', () => {
  const store = createWorkbarStore();
  store.requestArtifactPath('a', 'src/deep/report.md');
  assert.equal(store.getState().pendingPathBySession.a, 'src/deep/report.md');
  store.resolvePendingPath('a', 'artifact-9');
  assert.equal(store.getState().artifactBySession.a, 'artifact-9');
  assert.equal(store.getState().pendingPathBySession.a, undefined);
});

test('a path is matched on its basename, and the newest artifact of that name wins', () => {
  const records = [
    { id: 'old', name: 'report.md', createdAt: 1 },
    { id: 'new', name: 'report.md', createdAt: 5 },
    { id: 'other', name: 'notes.md', createdAt: 9 },
  ];
  assert.equal(matchArtifactForPath(records, '/work/src/report.md')?.id, 'new');
  assert.equal(matchArtifactForPath(records, 'C:\\work\\notes.md')?.id, 'other');
  assert.equal(matchArtifactForPath(records, 'src/missing.md'), undefined);
  assert.equal(matchArtifactForPath(records, ''), undefined);
});

// ── the artifact list's keyboard ────────────────────────────────────────────

test('the artifact list is one tab stop with a wrapping roving selection', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(
    nextArtifactListAction({ currentSelectedId: undefined, visibleIds: ids, key: 'ArrowDown' }),
    { kind: 'select', targetId: 'a' },
  );
  assert.deepEqual(
    nextArtifactListAction({ currentSelectedId: 'c', visibleIds: ids, key: 'ArrowDown' }),
    { kind: 'select', targetId: 'a' },
  );
  assert.deepEqual(
    nextArtifactListAction({ currentSelectedId: 'a', visibleIds: ids, key: 'End' }),
    {
      kind: 'select',
      targetId: 'c',
    },
  );
  assert.deepEqual(
    nextArtifactListAction({ currentSelectedId: 'b', visibleIds: ids, key: 'Enter' }),
    { kind: 'activate', targetId: 'b' },
  );
  assert.equal(
    nextArtifactListAction({ currentSelectedId: 'b', visibleIds: [], key: 'ArrowDown' }).kind,
    'noop',
  );
});

// ── how much of a file the preview draws ────────────────────────────────────

test('the preview bounds highlighting separately from display, and never cuts a codepoint', () => {
  const long = `${'x'.repeat(70_000)}\né`;
  const bounded = boundPreviewText(long);
  // Highlighting stops at its own smaller bound; the rest still renders plain.
  assert.ok(bounded.highlightedText.length < bounded.displayText.length);
  assert.equal(bounded.hasPlainRemainder, true);
  assert.equal(bounded.highlightedText + bounded.plainRemainder, bounded.displayText);
  // The é survived: a cut inside its two bytes would have produced U+FFFD.
  assert.equal(bounded.displayText.includes('\uFFFD'), false);
  assert.equal(bounded.isDisplayTruncated, false);

  const many = `${'a\n'.repeat(ARTIFACT_TEXT_HIGHLIGHT_LINE_LIMIT + 50)}`;
  assert.equal(
    boundPreviewText(many).highlightedText.split('\n').length,
    ARTIFACT_TEXT_HIGHLIGHT_LINE_LIMIT + 1,
  );
});

test('diffs are line-capped, links are counted, markdown opens rendered', () => {
  const capped = capPreviewLines('a\nb\nc\nd', 2);
  assert.equal(capped.text, 'a\nb');
  assert.equal(capped.hiddenLines, 2);
  assert.equal(capPreviewLines('a\nb', 5).hiddenLines, 0);

  assert.equal(countExternalLinks('<a href="x">1</a> <A  class="y" HREF=z>2</A>'), 2);
  assert.equal(countExternalLinks('<span>none</span>'), 0);

  assert.equal(isMarkdownArtifactName('notes.MD'), true);
  assert.equal(isMarkdownArtifactName('notes.markdown'), true);
  assert.equal(isMarkdownArtifactName('notes.txt'), false);
});

// ── the terminal's attach handshake ─────────────────────────────────────────

test('PTY frames that raced the attach are replayed after the snapshot, once', () => {
  const hydration = new SessionTerminalHydration();
  const epoch = hydration.begin();
  // Frames arriving before `attach` resolves are buffered, not written.
  assert.equal(hydration.accept({ sequence: 12, data: 'late' }), undefined);
  assert.equal(hydration.accept({ sequence: 11, data: 'earlier' }), undefined);
  const committed = hydration.commit(epoch, { sequence: 10, buffer: 'screen' });
  assert.ok(committed);
  assert.deepEqual(
    committed.replay.map((event) => event.data),
    ['earlier', 'late'],
  );
  // Anything at or below the committed sequence is a duplicate of the buffer.
  assert.equal(hydration.accept({ sequence: 12, data: 'again' }), undefined);
  assert.deepEqual(hydration.accept({ sequence: 13, data: 'live' }), {
    sequence: 13,
    data: 'live',
  });
  // A resync starts a new epoch; the old one can no longer commit.
  const next = hydration.begin();
  assert.equal(hydration.commit(epoch, { sequence: 99, buffer: '' }), undefined);
  assert.ok(hydration.commit(next, { sequence: 20, buffer: 'fresh' }));
});

// ── when the Inspector re-reads ─────────────────────────────────────────────

test('only events that append to a ledger re-read the trace', () => {
  const relevant = ['tool_start', 'tool_result', 'token_usage', 'complete', 'abort', 'error'];
  for (const type of relevant) {
    assert.equal(isTraceRelevantEvent({ type } as SessionEvent), true, type);
  }
  for (const type of ['text_delta', 'thinking_delta', 'tool_output_delta', 'queue_update']) {
    assert.equal(isTraceRelevantEvent({ type } as SessionEvent), false, type);
  }
});

test('a burst of relevant events becomes one read', () => {
  let refreshes = 0;
  // A holder rather than a `let`: the assignment happens inside a callback the
  // compiler cannot see through, so a bare variable narrows to `null`.
  const timer: { run: (() => void) | null } = { run: null };
  const coalescer = createTraceRefreshCoalescer({
    refresh: () => {
      refreshes += 1;
    },
    delayMs: 400,
    schedule: (callback) => {
      timer.run = callback;
      return 1;
    },
    cancel: () => {
      timer.run = null;
    },
  });
  coalescer.observe({ type: 'tool_start' } as SessionEvent);
  coalescer.observe({ type: 'text_delta' } as SessionEvent);
  coalescer.observe({ type: 'complete' } as SessionEvent);
  assert.equal(refreshes, 0);
  timer.run?.();
  assert.equal(refreshes, 1);
  coalescer.cancel();
});

test('a trace with nothing in it is empty; a trace with a reported gap is not', () => {
  assert.equal(deriveInspectorPanelModel(undefined).empty, true);
  const bare = deriveInspectorPanelModel({
    turns: [],
    coverage: {
      modelCalls: 'partial',
      turnsMissingModelCalls: ['t1'],
      turnsWithFewerModelCallsThanSteps: [],
      unreadableRecords: 2,
      oversizedRuns: 0,
    },
  } as never);
  assert.equal(bare.empty, false);
  assert.equal(bare.coverage?.kind, 'partial');
  assert.equal(bare.coverage?.unreadableRecords, 2);
});
