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
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { LocaleProvider, TOOL_LINE_CAP, type ToolActivityItem, type TurnViewModel } from '@maka/ui';
import Markdown from '../../components/ui/Markdown.js';
import { TooltipProvider } from '../../components/ui/tooltip.js';
import { SessionRow } from '../../components/layout/sidebar-parts/SessionRow.js';
import { PaletteResults } from '../../components/palette/CommandPalette.js';
import { buildSessionListModel } from '../session-list-model.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { buildPaletteCommands } from '../../components/palette/commands.js';
import { TranscriptTurn } from '../../components/session/TranscriptTurn.js';
import { renderToolContent } from '../../components/session/tools/registry.js';
import {
  toolRowStatus,
  toolRowStatusLabel,
} from '../../components/session/tools/tool-presentation.js';
import { deriveTurnPresentation } from '../../hooks/use-turn-presentation.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';

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
    const named = (button.textContent ?? '').trim().length > 0 || button.hasAttribute('aria-label');
    assert.ok(named, 'every row control has an accessible name');
  }
});

test('a stale row announces the blocker instead of the running dot', () => {
  const document = renderTree(
    createElement(SessionRow, {
      row: sessionRow({
        sendOutcomes: { 'task-1': { kind: 'blocked', reason: 'connection_missing' } },
      }),
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

// ── Phase 3a: the transcript ────────────────────────────────────────────────

/**
 * One turn carrying every shape the timeline can hold: the ask, reasoning, an
 * answer, and three tool rows whose results take three different renderers.
 *
 * The turn is `running` so the tool group renders its window of steps — a
 * settled group collapses to its summary line, which is correct behaviour and
 * would leave nothing here to assert about the rows themselves.
 */
function transcriptFixture(): TurnViewModel {
  const diff: ToolActivityItem = {
    toolUseId: 'tool-diff',
    toolName: 'Edit',
    activityKind: 'edit',
    status: 'completed',
    args: { path: 'src/a.ts' },
    result: {
      kind: 'file_diff',
      paths: ['src/a.ts'],
      diff: '@@ -1 +1 @@\n-const x = 1;\n+const x = 2;',
    },
  };
  const terminal: ToolActivityItem = {
    toolUseId: 'tool-terminal',
    toolName: 'Bash',
    activityKind: 'command',
    status: 'completed',
    args: { command: 'npm test' },
    result: {
      kind: 'terminal',
      cwd: '/workspace',
      cmd: 'npm test',
      status: 'completed',
      exitCode: 0,
      output: {
        mode: 'pipes',
        stdout: 'ok 1 passing\n',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        redacted: false,
      },
    },
  };
  const subagent: ToolActivityItem = {
    toolUseId: 'tool-agent',
    toolName: 'Agent',
    activityKind: 'tool',
    status: 'running',
    args: { profile: 'reviewer' },
    result: {
      kind: 'subagent',
      childSessionId: 'child-1',
      agentName: 'reviewer',
      turnId: 'child-turn',
      status: 'running',
      permissionMode: 'explore',
      summary: 'Reviewing the change',
      artifactIds: [],
    },
  };
  return {
    turnId: 'turn-fixture',
    status: 'running',
    user: { id: 'user-1', role: 'user', text: 'Fix the constant', ts: NOW },
    assistant: { id: 'assistant-1', role: 'assistant', text: 'Done.' },
    tools: [diff, terminal, subagent],
    timeline: [
      { kind: 'thinking', text: 'Weighing two options.', messageId: 'step-1' },
      { kind: 'tools', items: [diff, terminal, subagent] },
      { kind: 'text', text: 'Done.', messageId: 'step-2', complete: true },
    ],
    notes: [{ id: 'note-1', role: 'system', text: 'Earlier history compacted' }],
    startedAt: NOW,
  };
}

test('a turn renders its ask, its reasoning, its answer and every tool row', () => {
  const turn = transcriptFixture();
  const presentation = deriveTurnPresentation([turn], {
    activeId: 'session-1',
    pendingTurnActions: new Set(),
    uiLocale: 'en',
  });
  const document = renderTree(
    createElement(TranscriptTurn, {
      turn,
      live: false,
      footerActions: presentation.footerActionsByTurn[turn.turnId] ?? [],
      toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
      onFooterAction: () => {},
      onOpenLineage: () => {},
      onOpenExternal: () => {},
    }),
  );

  const article = document.querySelector(`[data-turn-id="${turn.turnId}"]`);
  assert.ok(article, 'the turn carries the id the scroll authority and quoting resolve against');

  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes('Fix the constant'), 'the ask is verbatim');
  assert.ok(text.includes('Weighing two options.'), 'reasoning is on screen');
  assert.ok(text.includes('Done.'), 'the answer is on screen');
  assert.ok(text.includes('Earlier history compacted'), 'the system note is a row of its own');

  // Markdown carries the contract attribute the main process and e2e probe.
  assert.ok(document.querySelector('[data-maka-contract="markdown"]'));

  // Three rows, one per tool, each with its own identity.
  const rows = [...document.querySelectorAll('[data-maka-tool-row]')].map((row) =>
    row.getAttribute('data-maka-tool-row'),
  );
  assert.deepEqual(rows, ['tool-diff', 'tool-terminal', 'tool-agent']);

  // Every actionable control has an accessible name (ax-tree-audit rule).
  for (const button of document.querySelectorAll('button')) {
    const name = button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '';
    assert.ok(name.length > 0, 'every button in a turn has an accessible name');
  }
});

test('each result kind renders its own body, and a diff keeps its markers', () => {
  const turn = transcriptFixture();
  const context = { onOpenSession: () => {}, onOpenExternal: () => {} };
  const bodies = turn.tools.map((tool) =>
    renderTree(createElement(Fragment, null, renderToolContent(tool, context))),
  );

  const diff = bodies[0]!.documentElement.textContent ?? '';
  assert.ok(diff.includes('const x = 2;'), 'the added line is on screen');
  assert.ok(diff.includes('+1'), 'the added-line count is on screen');
  assert.equal(bodies[0]!.querySelectorAll('.custom-code-highlight').length, 1);

  const terminal = bodies[1]!.documentElement.textContent ?? '';
  assert.ok(terminal.includes('npm test'), 'the command is on screen');
  assert.ok(terminal.includes('ok 1 passing'), 'the output is on screen');
  assert.ok(terminal.includes('/workspace'), 'the working directory is on screen');

  const agent = bodies[2]!;
  const open = agent.querySelector('button[aria-label]');
  assert.ok(open?.getAttribute('aria-label')?.includes('reviewer'), 'the child task is reachable');
  assert.ok(
    (agent.documentElement.textContent ?? '').includes('Read only'),
    'an explore-mode child says so',
  );
});

// A running command and a settled one must cap the same END. They are two
// different renderers (`PendingResult` and `TerminalResult`), and the live one
// is where it matters most: keeping the head there pins a long run to its
// opening banner for the whole run, and only releases the lines the reader is
// waiting for once the row has been replaced. They had drifted apart exactly
// that way.
test('a long tool output is watched at its tail while it runs, not only once it settles', () => {
  const lines = Array.from({ length: TOOL_LINE_CAP + 40 }, (_, index) => `line ${index}`);
  const first = lines[0]!;
  const last = lines.at(-1)!;
  const document = renderTree(
    createElement(
      Fragment,
      null,
      renderToolContent(
        {
          toolUseId: 'tool-running',
          toolName: 'Bash',
          activityKind: 'terminal',
          status: 'running',
          args: { command: 'npm run build' },
          outputChunks: [{ text: lines.join('\n') }],
        } as unknown as ToolActivityItem,
        { onOpenSession: () => {}, onOpenExternal: () => {} },
      ),
    ),
  );
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes(last), 'the newest line is on screen');
  assert.ok(!text.includes(`${first}\n`), 'the opening banner is what got dropped');
  // The note names what is missing, and sits above the body it was cut from.
  const body = document.querySelector('pre');
  const note = [...document.querySelectorAll('p')].find((row) =>
    (row.textContent ?? '').includes('40'),
  );
  assert.ok(note, 'the dropped-line count is reported');
  assert.ok(body, 'the output body is on screen');
  assert.equal(
    note.compareDocumentPosition(body) & 4,
    4,
    'the note precedes the body, because what was dropped came before it',
  );
});

test('a web search result is text, never markup from the page it found', () => {
  const document = renderTree(
    createElement(
      Fragment,
      null,
      renderToolContent(
        {
          toolUseId: 'tool-web',
          toolName: 'WebSearch',
          activityKind: 'websearch',
          status: 'completed',
          args: { query: 'x' },
          result: {
            kind: 'web_search',
            provider: 'tavily',
            query: 'x',
            rows: [
              {
                title: '<script>alert(1)</script>',
                url: 'https://example.com/a',
                snippet: '**not bold**',
                source: 'example',
              },
            ],
          },
        },
        { onOpenSession: () => {}, onOpenExternal: () => {} },
      ),
    ),
  );
  assert.equal(document.querySelectorAll('script').length, 0);
  assert.equal(document.querySelectorAll('strong').length, 0);
  assert.ok(document.documentElement.textContent?.includes('<script>alert(1)</script>'));
  assert.ok(document.documentElement.textContent?.includes('example.com'));
});

test('a sandbox-denied row offers the way past it, and only then', () => {
  const denied: ToolActivityItem = {
    toolUseId: 'tool-denied',
    toolName: 'Bash',
    activityKind: 'command',
    status: 'errored',
    args: { command: 'sudo ls' },
    result: { kind: 'text', text: 'denied', sandboxDenial: { likely: true } },
  };
  assert.equal(toolRowStatus(denied), 'sandbox_blocked');
  assert.equal(toolRowStatusLabel(denied, 'en'), getTranscriptCopy('en').sandbox.blockedLabel);
});

test('untrusted Markdown keeps HTML and redaction markers as text', () => {
  const document = render(
    '<style>body{display:none}</style>\n\n<details open><summary>click</summary>payload</details>\n\n<redacted>',
  );
  assert.equal(document.querySelector('style,details,summary'), null);
  assert.ok(document.documentElement.textContent?.includes('<redacted>'));
});
test('Markdown preserves only supported internal and attachment URL schemes', async () => {
  const { markdownUrl } = await import('../../components/ui/Markdown.js');
  assert.equal(markdownUrl('maka://settings/models'), 'maka://settings/models');
  assert.equal(markdownUrl('maka://compose?text=hello'), 'maka://compose?text=hello');
  assert.equal(markdownUrl('javascript:alert(1)'), '');
  assert.equal(markdownUrl('maka://unsupported/action'), '');
});
test('Mermaid retains strict security and the automatic diagram budget', async () => {
  const { createMermaidConfig, applyMermaidRenderBudget } = await import(
    '../../components/ui/MermaidDiagram.js'
  );
  assert.equal(createMermaidConfig('dark').securityLevel, 'strict');
  assert.equal(createMermaidConfig('dark').htmlLabels, false);
  const output = applyMermaidRenderBudget(
    Array(4).fill('```mermaid\ngraph TD; A-->B\n```').join('\n\n'),
  );
  assert.equal((output.match(/```mermaid/g) ?? []).length, 3);
  assert.equal((output.match(/```makamermaiddeferred/g) ?? []).length, 1);
});

test('steering rows retain attachments, directories, and inline references', () => {
  const turn = transcriptFixture();
  turn.timeline = [
    {
      kind: 'user',
      messageId: 'steering',
      message: {
        id: 'steering',
        role: 'user',
        text: 'follow up',
        attachments: [
          {
            kind: 'pdf',
            name: 'evidence.pdf',
            mimeType: 'application/pdf',
            bytes: 4,
            ref: { kind: 'session_file', sessionId: 'session-1', relativePath: 'evidence' },
          },
        ],
        directoryReferences: [{ hostId: 'host', path: '/workspace/reference' }],
        inlineReferences: [
          { kind: 'workspace_file', label: 'source.ts', value: '@source.ts', start: 0 },
        ],
      },
    },
  ];
  const document = renderTree(
    createElement(TranscriptTurn, {
      turn,
      live: false,
      footerActions: [],
      toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
      onFooterAction: () => {},
      onOpenLineage: () => {},
      onOpenExternal: () => {},
    }),
  );
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes('evidence.pdf'));
  assert.ok(text.includes('/workspace/reference'));
  assert.ok(text.includes('source.ts'));
});
