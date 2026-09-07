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

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { LocaleProvider } from '@maka/ui';
import Markdown from '../../components/ui/Markdown.js';
import { TooltipProvider } from '../../components/ui/tooltip.js';
import { SessionRow } from '../../components/layout/sidebar-parts/SessionRow.js';
import { PaletteResults } from '../../components/palette/CommandPalette.js';
import { buildSessionListModel } from '../session-list-model.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { buildPaletteCommands } from '../../components/palette/commands.js';

function render(text: string) {
  const html = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale: 'en',
      children: createElement(Markdown, { children: text }),
    }),
  );
  return parseHTML(html).document;
}
for (const [name, text, language] of [
  ['single-line fence', '```js\nconst x = 1\n```', 'js'],
  ['unlabelled fence', '```\necho hello\n```', ''],
  ['empty fence', '```js\n```', 'js'],
  ['multiline fence', '```js\nconst x = 1\nconst y = 2\n```', 'js'],
  ['indented block', '    echo hello', ''],
] as const) {
  test(`${name} uses the block renderer with an accessible copy action`, () => {
    const document = render(text);
    assert.equal(document.querySelectorAll('button[aria-label="Copy code"]').length, 1);
    assert.equal(
      document.querySelectorAll('pre div').length,
      0,
      'block wrappers must not be nested inside pre',
    );
    if (language) assert.ok(document.documentElement.textContent?.includes(language));
  });
}
test('inline code stays inline and has no block toolbar', () => {
  const document = render('Run `echo hello` now.');
  assert.equal(document.querySelectorAll('pre, button').length, 0);
  assert.equal(document.querySelector('code')?.textContent, 'echo hello');
});

const sidebarCopy = getSidebarCopy('en');
const NOW = new Date(2026, 8, 7, 12, 0, 0).getTime();

function renderTree(node: Parameters<typeof renderToStaticMarkup>[0]) {
  const html = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale: 'en',
      children: createElement(TooltipProvider, { children: node }),
    }),
  );
  return parseHTML(html).document;
}

function sessionRow(overrides: Record<string, unknown>) {
  const model = buildSessionListModel({
    sessions: [
      {
        id: 'task-1',
        name: 'Wire the sidebar',
        isFlagged: false,
        isArchived: false,
        labels: [],
        hasUnread: false,
        status: 'active',
        lastMessageAt: NOW,
        ...overrides,
      },
    ] as never,
    activeId: undefined,
    filter: '',
    mode: 'time',
    projects: [],
    copy: sidebarCopy,
    now: NOW,
    ...(overrides.sendOutcomes ? { sendOutcomes: overrides.sendOutcomes as never } : {}),
    ...(overrides.runningIds ? { runningIds: overrides.runningIds as never } : {}),
  });
  return model.rows[0]!;
}

const noopRowActions = {
  onOpen: () => {},
  onRename: () => {},
  onSetFlagged: () => {},
  onArchive: () => {},
  onRemove: () => {},
};

test('a sidebar row is one selectable option carrying the contract attribute', () => {
  const document = renderTree(
    createElement(SessionRow, {
      row: sessionRow({}),
      isActive: true,
      copy: sidebarCopy,
      actions: noopRowActions,
    }),
  );
  const container = document.querySelector('[data-maka-contract="session-row"]');
  assert.ok(container, 'the row carries the pinned contract attribute');
  assert.equal(container?.getAttribute('data-session-key'), 'task-1');
  const option = document.querySelector('[role="option"]');
  assert.equal(option?.getAttribute('aria-selected'), 'true');
  assert.ok(option?.hasAttribute('data-roving-row'), 'the row control is a roving-focus target');
  assert.ok(document.documentElement.textContent?.includes('Wire the sidebar'));
  // Every actionable element carries an accessible name.
  for (const button of document.querySelectorAll('button')) {
    const named =
      (button.textContent ?? '').trim().length > 0 || button.hasAttribute('aria-label');
    assert.ok(named, 'every row control has an accessible name');
  }
});

test('a stale row announces the blocker instead of the running dot', () => {
  const document = renderTree(
    createElement(SessionRow, {
      row: sessionRow({ sendOutcomes: { 'task-1': { kind: 'blocked', reason: 'connection_missing' } } }),
      isActive: false,
      copy: sidebarCopy,
      actions: noopRowActions,
    }),
  );
  assert.ok(document.querySelector(`[aria-label="${sidebarCopy.stale}"]`));
  assert.equal(document.querySelector(`[aria-label="${sidebarCopy.running}"]`), null);
});

test('a running row exposes a live status, and an untitled task still has a name', () => {
  const document = renderTree(
    createElement(SessionRow, {
      row: sessionRow({ name: '   ', runningIds: new Set(['task-1']) }),
      isActive: false,
      copy: sidebarCopy,
      actions: noopRowActions,
    }),
  );
  const dot = document.querySelector('[role="status"]');
  assert.equal(dot?.getAttribute('aria-label'), sidebarCopy.running);
  assert.ok(document.documentElement.textContent?.includes(sidebarCopy.untitled));
});

test('the palette result list groups rows and marks exactly one selected', () => {
  const commands = buildPaletteCommands({
    locale: 'en',
    activeSessionId: undefined,
    theme: 'auto',
    connections: [],
    defaultSlug: null,
    onNewTask: () => {},
    onOpenSettings: () => {},
    onOpenSettingsSection: () => {},
    onOpenKeyboardHelp: () => {},
    onSetTheme: () => {},
    onSelectModule: () => {},
    onOpenWorkspaceFolder: () => {},
    onCopyDiagnostics: () => {},
    onTestNetworkProxy: () => {},
    onSetDefaultConnection: () => {},
    onOpenRuntimeDebug: () => {},
  }).slice(0, 6);
  const groups = new Map<string, typeof commands>();
  for (const command of commands) {
    const bucket = groups.get(command.group);
    if (bucket) bucket.push(command);
    else groups.set(command.group, [command]);
  }
  const copy = getShellCopy('en').commandPalette;
  const document = renderTree(
    createElement(PaletteResults, {
      groups: [...groups.entries()],
      flat: commands,
      current: 1,
      copy,
      onHighlight: () => {},
      onRun: () => {},
    }),
  );
  const list = document.querySelector('[role="listbox"]');
  assert.equal(list?.getAttribute('aria-label'), copy.resultsLabel);
  const options = [...document.querySelectorAll('[role="option"]')];
  assert.equal(options.length, commands.length);
  assert.equal(options.filter((row) => row.getAttribute('aria-selected') === 'true').length, 1);
  assert.equal(options[1]?.getAttribute('data-palette-highlighted'), 'true');
  for (const option of options) {
    assert.ok(option.getAttribute('aria-label'), 'every palette row has an accessible name');
  }
});

test('an empty palette says so through a live status, not an empty list', () => {
  const copy = getShellCopy('en').commandPalette;
  const document = renderTree(
    createElement(PaletteResults, {
      groups: [],
      flat: [],
      current: 0,
      copy,
      onHighlight: () => {},
      onRun: () => {},
    }),
  );
  assert.ok(document.querySelector('[role="status"]'));
  assert.ok(document.documentElement.textContent?.includes(copy.emptyTitle));
});
