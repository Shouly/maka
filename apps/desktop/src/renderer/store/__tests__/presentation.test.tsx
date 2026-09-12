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
import { groupTurnTimeline } from '../../lib/turn-timeline-groups.js';
import { deriveTurnActivity } from '../../lib/turn-activity.js';
import { TurnRunningStatus } from '../../components/session/TurnRunningStatus.js';
import { TurnIdleMark } from '../../components/session/TurnIdleMark.js';
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

test('a task parked on the user shows the question mark, over the running dot', () => {
  const document = renderTree(
    createElement(SessionRow, {
      row: sessionRow({ status: 'waiting_for_user', runningIds: new Set(['task-1']) }),
      isActive: false,
      copy: sidebarCopy,
      actions: noopRowActions,
    }),
  );
  const mark = document.querySelector(`[aria-label="${sidebarCopy.waitingForUser}"]`);
  assert.ok(mark, 'the question mark');
  assert.equal(
    mark?.querySelector('[data-anthropicon]')?.getAttribute('data-anthropicon'),
    'questionCircle',
  );
  // The running dot yields: the turn is running the whole time it waits.
  assert.equal(document.querySelector('[role="status"]'), null);
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
  // The run under test must be the turn's NEWEST block: an earlier run in a
  // live turn folds to its summary once the next block starts. So the fixture's
  // prose goes first here, and the reasoning + three calls stand last.
  const newestRun = (timeline: TurnViewModel['timeline']) => [turn.timeline[2]!, ...timeline];
  const document = renderTree(
    createElement(TranscriptTurn, {
      turn: { ...turn, timeline: newestRun([turn.timeline[0]!, turn.timeline[1]!]) },
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
  assert.ok(text.includes('Done.'), 'the answer is on screen');
  assert.ok(text.includes('Earlier history compacted'), 'the system note is a row of its own');

  // Markdown carries the contract attribute the main process and e2e probe.
  assert.ok(document.querySelector('[data-maka-contract="markdown"]'));

  // Three rows, one per tool, each with its own identity.
  const rows = [...document.querySelectorAll('[data-maka-tool-row]')].map((row) =>
    row.getAttribute('data-maka-tool-row'),
  );
  assert.deepEqual(rows, ['tool-diff', 'tool-terminal', 'tool-agent']);

  // Reasoning is a STEP of the tool group, so where it shows is the group's
  // rule: while the turn runs, the group is a window onto its last three steps,
  // and this fixture has four — the reasoning, then three calls.
  assert.ok(
    !text.includes('Weighing two options.'),
    'the running window has folded the reasoning above it',
  );
  // The same reasoning on a run short enough to hold it.
  const oneCall = turn.tools[0]!;
  const short = renderTree(
    createElement(TranscriptTurn, {
      turn: {
        ...turn,
        tools: [oneCall],
        timeline: newestRun([turn.timeline[0]!, { kind: 'tools', items: [oneCall] }]),
      },
      live: false,
      footerActions: [],
      toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
      onFooterAction: () => {},
      onOpenLineage: () => {},
      onOpenExternal: () => {},
    }),
  );
  assert.ok(
    (short.documentElement.textContent ?? '').includes('Weighing two options.'),
    'reasoning is on screen',
  );
  assert.ok(
    short.querySelector('[data-maka-tool-group] [data-maka-thinking]'),
    'and it is a step inside the group, not a block standing beside it',
  );
  assert.equal(short.querySelectorAll('[data-maka-thinking]').length, 1);

  // Every actionable control has an accessible name (ax-tree-audit rule).
  for (const button of document.querySelectorAll('button')) {
    const name = button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '';
    assert.ok(name.length > 0, 'every button in a turn has an accessible name');
  }
});

test('a run of reasoning with no call is a group of its own, so the turn keeps its shape when a call lands', () => {
  const base = transcriptFixture();
  const renderTurn = (turn: TurnViewModel) =>
    renderTree(
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

  // Still thinking, nothing called yet.
  const running = renderTurn({
    ...base,
    tools: [],
    timeline: [
      { kind: 'thinking', text: 'Weighing two options.', messageId: 'step-1', live: true },
    ],
  });
  const group = running.querySelector('[data-maka-tool-group]');
  assert.ok(group, 'the reasoning is a group, not a block standing on its own');
  assert.equal(group.getAttribute('data-maka-tool-group-kind'), 'thinking');
  assert.equal(
    group.querySelector('[data-maka-tool-group-summary]'),
    null,
    'no summary line while it runs — the step is the whole story, the status line says Thinking…',
  );
  assert.ok(group.querySelector('[data-maka-thinking]'), 'the text is a step inside it');
  assert.equal(running.querySelectorAll('[data-maka-thinking]').length, 1);

  // The first call lands: same group, now with two steps and a tool summary.
  const oneCall = base.tools[1]!;
  const called = renderTurn({
    ...base,
    tools: [oneCall],
    timeline: [
      { kind: 'thinking', text: 'Weighing two options.', messageId: 'step-1' },
      { kind: 'tools', items: [oneCall] },
    ],
  });
  assert.equal(called.querySelectorAll('[data-maka-tool-group]').length, 1);
  assert.equal(
    called.querySelector('[data-maka-tool-group]')?.getAttribute('data-maka-tool-group-kind'),
    'tools',
  );
  assert.ok(called.querySelector('[data-maka-tool-group] [data-maka-thinking]'));
  assert.ok(called.querySelector('[data-maka-tool-group] [data-maka-tool-row]'));
  // The summary is the same aggregate sentence it will settle on, not the
  // current action: that belongs to the status line under the transcript.
  const liveSummary = called.querySelector('[data-maka-tool-group-summary]')?.textContent ?? '';
  assert.ok(liveSummary.startsWith('Ran'), liveSummary);
  assert.ok(!liveSummary.includes('…'), 'never a present-tense phrase');

  // Done: the group folds to "Thought process", the one way back into the text.
  const done = renderTurn({
    ...base,
    status: 'completed',
    tools: [],
    timeline: [
      { kind: 'thinking', text: 'Weighing two options.', messageId: 'step-1' },
      { kind: 'text', text: 'Done.', messageId: 'step-2', complete: true },
    ],
  });
  const toggle = done.querySelector('[data-maka-tool-group] button[aria-expanded="false"]');
  // The span, not the button: the caret beside it is an icon-font glyph.
  assert.equal(toggle?.querySelector('span')?.textContent, 'Thought process');
  assert.equal(done.querySelectorAll('[data-maka-thinking]').length, 0, 'put away until opened');
});

test('an answered question stands on its own between runs; an open one is not drawn at all', () => {
  const ask = (status: ToolActivityItem['status']): ToolActivityItem => ({
    toolUseId: 'ask-1',
    toolName: 'AskUserQuestion',
    status,
    args: { questions: [{ question: 'Scope?', options: [] }] },
  });
  const read: ToolActivityItem = {
    toolUseId: 'r-1',
    toolName: 'Read',
    status: 'completed',
    args: {},
  };
  const shape = (items: Parameters<typeof groupTurnTimeline>[0]) =>
    groupTurnTimeline(items).map((entry) =>
      entry.kind === 'work'
        ? `work:${entry.id}:${entry.children.length}`
        : entry.kind === 'ask'
          ? `ask:${entry.id}`
          : entry.kind,
    );
  // Open: the run is the read alone, the question is nowhere in the timeline.
  assert.deepEqual(shape([{ kind: 'tools', items: [read, ask('running')] }]), ['work:start:1']);
  // Answered: the run before it keeps its key, the record follows, and a later
  // run keys off the record.
  assert.deepEqual(shape([{ kind: 'tools', items: [read, ask('completed'), read] }]), [
    'work:start:1',
    'ask:ask-1',
    'work:ask:ask-1:1',
  ]);
});

test('groupTurnTimeline keys a run by the boundary before it, so a run keeps its key as it grows', () => {
  const thinking = { kind: 'thinking', text: 't', messageId: 'm-1' } as const;
  const tools = { kind: 'tools' as const, items: [] as ToolActivityItem[] };
  const text = { kind: 'text', text: 'p', messageId: 'm-2', complete: true } as const;
  const user = {
    kind: 'user',
    message: { id: 'u-1', role: 'user', text: 'again' },
    messageId: 'u-1',
  } as const;

  assert.deepEqual(
    groupTurnTimeline([thinking]).map((entry) => entry.kind === 'work' && entry.id),
    ['start'],
  );
  // The same run once a call has landed: same id, one more child.
  assert.deepEqual(
    groupTurnTimeline([thinking, tools]).map((entry) => entry.kind === 'work' && entry.id),
    ['start'],
  );
  assert.deepEqual(
    groupTurnTimeline([thinking, tools, text, thinking, user, tools]).map((entry) =>
      entry.kind === 'work' ? `work:${entry.id}:${entry.children.length}` : entry.kind,
    ),
    ['work:start:2', 'text', 'work:m-2:1', 'user', 'work:u-1:1'],
  );
  assert.deepEqual(
    groupTurnTimeline([text]).map((entry) => entry.kind),
    ['text'],
  );
});

test('the running status reads the newest block: thinking, the tool in flight, writing, or a gap', () => {
  const base = transcriptFixture();
  const running = { ...base.tools[1]!, status: 'running' as const };
  const done = { ...running, status: 'completed' as const };
  const at = (timeline: TurnViewModel['timeline'], tools = base.tools) =>
    deriveTurnActivity({ ...base, tools, timeline }, 'en');

  assert.deepEqual(deriveTurnActivity(undefined, 'en'), { kind: 'none' });
  assert.deepEqual(at([]), { kind: 'none' });
  assert.deepEqual(at([{ kind: 'thinking', text: 't', messageId: 'm', live: true }]), {
    kind: 'thinking',
    label: 'Thinking…',
  });
  assert.equal(at([{ kind: 'tools', items: [running] }]).kind, 'tool');
  assert.deepEqual(at([{ kind: 'tools', items: [done] }]), { kind: 'gap' });
  assert.deepEqual(at([{ kind: 'text', text: 'p', messageId: 'm', live: true, complete: false }]), {
    kind: 'text',
    label: 'Writing…',
  });
  assert.deepEqual(at([{ kind: 'text', text: 'p', messageId: 'm', complete: true }]), {
    kind: 'gap',
  });
});

test('the status line shows the mark and the activity, and holds its label across a gap', () => {
  const base = transcriptFixture();
  const renderStatus = (turn: TurnViewModel | undefined) =>
    renderTree(
      createElement(TurnRunningStatus, {
        turnId: base.turnId,
        startedAt: NOW,
        ...(turn ? { turn } : {}),
      }),
    );

  const waiting = renderStatus(undefined);
  const line = waiting.querySelector('[data-maka-contract="turn-running-status"]');
  assert.ok(line);
  assert.equal(line.getAttribute('aria-label'), 'Working on it…', 'nothing has landed yet');
  assert.equal(
    line.querySelector('[data-maka-relx-mark]')?.getAttribute('data-maka-relx-mark'),
    'breathing',
  );
  assert.equal(
    line.querySelector('[data-maka-contract="turn-elapsed"]')?.textContent,
    '',
    'no clock on first paint',
  );

  const thinking = renderStatus({
    ...base,
    timeline: [{ kind: 'thinking', text: 't', messageId: 'm', live: true }],
  });
  assert.equal(
    thinking
      .querySelector('[data-maka-contract="turn-running-status"]')
      ?.getAttribute('aria-label'),
    'Thinking…',
  );

  // A gap right after a result: a fresh render has nothing to hold, so it says
  // the generic phrase — the HOLD is instance state, exercised in the app by
  // the same element living across the gap.
  const gap = renderStatus({
    ...base,
    timeline: [{ kind: 'tools', items: [{ ...base.tools[1]!, status: 'completed' }] }],
  });
  assert.equal(
    gap
      .querySelector('[data-maka-contract="turn-running-status"]')
      ?.getAttribute('data-maka-activity'),
    'gap',
  );
});

test('in a live turn only the newest run keeps its steps; an earlier one folds when the next block starts', () => {
  const base = transcriptFixture();
  const call = base.tools[1]!;
  const document = renderTree(
    createElement(TranscriptTurn, {
      turn: {
        ...base,
        tools: [call],
        timeline: [
          { kind: 'tools', items: [call] },
          {
            kind: 'text',
            text: 'Half an answer',
            messageId: 'step-2',
            live: true,
            complete: false,
          },
          { kind: 'thinking', text: 'And then.', messageId: 'step-3', live: true },
        ],
      },
      live: false,
      footerActions: [],
      toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
      onFooterAction: () => {},
      onOpenLineage: () => {},
      onOpenExternal: () => {},
    }),
  );
  const groups = [...document.querySelectorAll('[data-maka-tool-group]')];
  assert.equal(groups.length, 2);
  const [earlier, newest] = groups as [Element, Element];
  assert.ok(earlier.querySelector('[data-maka-tool-group-summary] button[aria-expanded="false"]'));
  assert.equal(earlier.querySelector('[data-maka-tool-row]'), null, 'folded to its summary');
  assert.ok(newest.querySelector('[data-maka-thinking]'), 'the live run still shows its step');
});

test('the idle mark is a named button holding the still mark, with a quip for the tooltip', () => {
  const document = renderTree(createElement(TurnIdleMark));
  const mark = document.querySelector('[data-maka-contract="turn-idle-mark"]');
  assert.ok(mark);
  const button = mark.querySelector('button');
  assert.equal(button?.getAttribute('aria-label'), 'End of conversation');
  assert.equal(
    button?.querySelector('[data-maka-relx-mark]')?.getAttribute('data-maka-relx-mark'),
    'still',
  );
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

  // A sent file is a 120px card — its name over an extension badge — inside
  // the labelled attachments row, not a chip (reference `AttachmentPreview`).
  const card = document.querySelector('[data-maka-attachment-card="evidence.pdf"]');
  assert.ok(card, 'the attachment is a card');
  assert.ok(card.closest('[role="group"][aria-label]'), 'inside the attachments row');
  assert.equal(card.querySelector('span span')?.textContent, 'PDF', 'extension badge');
  assert.equal(
    card.querySelector('button')?.getAttribute('aria-label'),
    'Open attachment evidence.pdf',
  );
});
