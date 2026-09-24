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
import { PermissionModeMenu } from '../../components/composer/PermissionModeMenu.js';
import { resolveCollaborationPermissionMode } from '@maka/core/collaboration';
import { SessionRow } from '../../components/layout/sidebar-parts/SessionRow.js';
import { PaletteResults } from '../../components/palette/CommandPalette.js';
import { buildSessionListModel } from '../session-list-model.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { buildPaletteCommands } from '../../components/palette/commands.js';
import { TranscriptTurn } from '../../components/session/TranscriptTurn.js';
import { renderToolContent } from '../../components/session/tools/registry.js';
import { TurnStatusToolStep } from '../../components/session/tools/TurnStatusStep.js';
import { ToolFailureBlock } from '../../components/session/tools/ToolFailureBlock.js';
import { TOOL_NAMES } from '@maka/core/tool-names';
import {
  canExpandTool,
  resolveToolRendererId,
  toolRowIcon,
  toolRowTitle,
  summarizeToolGroup,
  toolStepLabel,
  toolSummaryKeyOf,
} from '../../components/session/tools/tool-presentation.js';
import {
  toolFailureMark,
  toolRowFailure,
  toolRowStatus,
  toolRowStatusLabel,
} from '../../components/session/tools/tool-presentation.js';
import { deriveTurnPresentation } from '../../hooks/use-turn-presentation.js';
import { groupTurnTimeline } from '../../lib/turn-timeline-groups.js';
import { NARRATION_SHOW_THRESHOLD, scoreNarration } from '../../lib/narration-fold.js';
import { deriveTurnActivity, deriveWorkingMarkActivity } from '../../lib/turn-activity.js';
import { JumpToLatest } from '../../components/session/HistoryControls.js';
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
    args: { file_path: 'src/a.ts' },
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

test('a turn renders its ask, its answer, and one closed status row for its work', () => {
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
  assert.ok(text.includes('Done.'), 'the answer is on screen');
  assert.ok(text.includes('Earlier history compacted'), 'the system note is a row of its own');
  assert.ok(document.querySelector('[data-maka-contract="markdown"]'));

  // The reasoning and the three calls are ONE run: one status row, closed,
  // saying what the run did. Nothing of the card is drawn until it is opened.
  const rows = [...document.querySelectorAll('[data-maka-turn-status]')];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.getAttribute('data-state'), 'done');
  const toggle = rows[0]!.querySelector('button[aria-expanded="false"]');
  assert.equal(toggle?.querySelector('span')?.textContent, summarizeToolGroup(turn.tools, 'en'));
  assert.equal(document.querySelectorAll('[data-maka-turn-status-step]').length, 0);
  assert.ok(!text.includes('Weighing two options.'), 'the reasoning is in the closed card');

  // The status row comes before the answer it led to.
  const order = [...document.querySelectorAll('[data-maka-turn-status], [data-maka-contract]')].map(
    (node) => (node.hasAttribute('data-maka-turn-status') ? 'status' : 'prose'),
  );
  assert.deepEqual(order, ['status', 'prose']);

  // Every actionable control has an accessible name (ax-tree-audit rule).
  for (const button of document.querySelectorAll('button')) {
    const name = button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '';
    assert.ok(name.length > 0, 'every button in a turn has an accessible name');
  }
});

test('a run of reasoning with no call is a run too, so the turn keeps its shape when a call lands', () => {
  const base = transcriptFixture();
  const renderTurn = (turn: TurnViewModel) =>
    renderTree(
      createElement(TranscriptTurn, {
        turn,
        live: true,
        footerActions: [],
        toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
        onFooterAction: () => {},
        onOpenLineage: () => {},
        onOpenExternal: () => {},
      }),
    );
  const statusText = (document: Document) =>
    document.querySelector('[data-maka-turn-status] button')?.textContent ?? '';

  // Still thinking, nothing called yet: one run, saying so.
  const running = renderTurn({
    ...base,
    tools: [],
    timeline: [
      { kind: 'thinking', text: 'Weighing two options.', messageId: 'step-1', live: true },
    ],
  });
  assert.equal(running.querySelectorAll('[data-maka-turn-status]').length, 1);
  assert.equal(
    running.querySelector('[data-maka-turn-status]')?.getAttribute('data-state'),
    'busy',
  );
  assert.ok(statusText(running).includes('Thinking'), statusText(running));

  // The first call lands and is running: the same run, now naming the call.
  const oneCall: ToolActivityItem = { ...base.tools[1]!, status: 'running' };
  const called = renderTurn({
    ...base,
    tools: [oneCall],
    timeline: [
      { kind: 'thinking', text: 'Weighing two options.', messageId: 'step-1' },
      { kind: 'tools', items: [oneCall] },
    ],
  });
  assert.equal(called.querySelectorAll('[data-maka-turn-status]').length, 1);
  assert.equal(
    called.querySelector('[data-maka-turn-status]')?.getAttribute('data-maka-turn-status'),
    'start',
    'the run keeps its identity as it grows',
  );
  assert.ok(statusText(called).includes(toolStepLabel(oneCall, 'en').text), statusText(called));

  // Done with no call: the run says "Thought process", the one way back in.
  const done = renderTurn({
    ...base,
    status: 'completed',
    tools: [],
    timeline: [
      { kind: 'thinking', text: 'Weighing two options.', messageId: 'step-1' },
      { kind: 'text', text: 'Done.', messageId: 'step-2', complete: true },
    ],
  });
  assert.ok(statusText(done).includes('Thought process'), statusText(done));
});

test('an answered question stands on its own between runs; an open one is a step of its run', () => {
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
  // Open: the question is the run's last step — the run is what says the turn
  // is waiting ("Asking a question"), and the prompt sits in the composer's place.
  assert.deepEqual(shapeOf([{ kind: 'tools', items: [read, ask('running')] }]), ['status:start:2']);
  // Answered: the run before it keeps its key, the record follows, and a later
  // run keys off the record.
  assert.deepEqual(shapeOf([{ kind: 'tools', items: [read, ask('completed'), read] }]), [
    'status:start:1',
    'ask:ask-1',
    'status:ask:ask-1:1',
  ]);
});

test('narration folds into the run; the tail and the words before a question stay shown', () => {
  const read = (id: string): ToolActivityItem => ({
    toolUseId: id,
    toolName: 'Read',
    status: 'completed',
    args: {},
  });
  const ask: ToolActivityItem = {
    toolUseId: 'ask-1',
    toolName: 'AskUserQuestion',
    status: 'running',
    args: { questions: [{ question: 'Which one?', options: [] }] },
  };
  const said = (messageId: string, text: string, live = false) =>
    ({ kind: 'text', text, messageId, ...(live ? { live: true } : { complete: true }) }) as const;
  const user = {
    kind: 'user',
    message: { id: 'u-1', role: 'user', text: 'again' },
    messageId: 'u-1',
  } as const;

  // The model talking to itself before more work: narration, a step of the run.
  assert.deepEqual(
    shapeOf([said('a', 'Let me check the files.'), { kind: 'tools', items: [read('r-1')] }]),
    ['status:start:2'],
  );
  // Deep into a run of calls, "now reading…" folds too.
  assert.deepEqual(
    shapeOf([
      { kind: 'tools', items: [read('r-1'), read('r-2'), read('r-3')] },
      said('b', 'Now reading the entry file.'),
      { kind: 'tools', items: [read('r-4')] },
    ]),
    ['status:start:5'],
  );
  // A first reply that says something stays prose, and the work after it is a
  // run of its own.
  const explained =
    'The build fails because the config file points at a missing path; I will fix the path and rerun.';
  assert.deepEqual(shapeOf([said('c', explained), { kind: 'tools', items: [read('r-1')] }]), [
    'text',
    'status:c:1',
  ]);
  // The tail, still streaming or settled: shown, after the run.
  assert.deepEqual(
    shapeOf([{ kind: 'tools', items: [read('r-1')] }, said('d', 'Half an answer', true)]),
    ['status:start:1', 'text'],
  );
  // Followed by a question the user must answer: the context stays readable,
  // however narration-like it reads — reasoning in between included.
  assert.deepEqual(shapeOf([said('e', 'Let me ask.'), { kind: 'tools', items: [ask] }]), [
    'text',
    'status:e:1',
  ]);
  assert.deepEqual(
    shapeOf([
      said('e', 'Let me ask.'),
      { kind: 'thinking', text: 'Which way?', messageId: 'th-q' },
      { kind: 'tools', items: [ask] },
    ]),
    ['text', 'status:e:2'],
  );
  // The user speaks after it: it ended a reply, and is shown.
  assert.deepEqual(
    shapeOf([said('f', 'Let me check.'), user, { kind: 'tools', items: [read('r-1')] }]),
    ['text', 'user', 'status:u-1:1'],
  );
});

test('the narration classifier scores texts the way the reference does', () => {
  const text = (value: string) => ({ kind: 'text', text: value }) as const;
  const call = { kind: 'tool_use' } as const;
  const thought = { kind: 'thinking' } as const;
  const score = (events: Parameters<typeof scoreNarration>[0], at: number) =>
    scoreNarration(events).decided.get(at)!;
  assert.ok(
    score([text('Let me look at the project structure.'), call], 0) < NARRATION_SHOW_THRESHOLD,
  );
  assert.ok(
    score(
      [
        text(
          'The build fails because the config file points at a missing path; I will fix the path and rerun.',
        ),
        call,
      ],
      0,
    ) >= NARRATION_SHOW_THRESHOLD,
  );
  // Reasoning leading into the first text tips a short one into view.
  assert.ok(score([text('我先看看项目结构。'), call], 0) < NARRATION_SHOW_THRESHOLD);
  assert.ok(score([thought, text('我先看看项目结构。'), call], 1) >= NARRATION_SHOW_THRESHOLD);
  // Only texts with a later call or text are decided; the tail is not.
  assert.equal(scoreNarration([call, text('Done.')]).decided.size, 0);
});

test('a SendUserMessage is prose, never a step, unless it did not deliver', () => {
  const read: ToolActivityItem = {
    toolUseId: 'r-1',
    toolName: 'Read',
    status: 'completed',
    args: {},
  };
  const sent = (overrides: Partial<ToolActivityItem>): ToolActivityItem => ({
    toolUseId: 'sum-1',
    toolName: TOOL_NAMES.sendUserMessage,
    status: 'completed',
    args: { message: 'The preview is at **https://example.test**.' },
    result: { kind: 'user_message', message: 'The preview is at **https://example.test**.' },
    ...overrides,
  });

  const delivered = groupTurnTimeline([{ kind: 'tools', items: [read, sent({})] }]);
  assert.deepEqual(delivered.map(shapeOfEntry), ['status:start:1', 'text']);
  const prose = delivered[1]!;
  assert.ok(prose.kind === 'text' && prose.fromSendUserMessage === true);
  assert.equal(prose.kind === 'text' && prose.text, 'The preview is at **https://example.test**.');

  // Arriving: the prose grows from the args preview the Host lets through.
  const arriving = groupTurnTimeline([
    {
      kind: 'tools',
      items: [
        sent({
          status: 'running',
          args: undefined,
          argsPreview: { message: 'The prev' },
          result: undefined,
        }),
      ],
    },
  ]);
  assert.deepEqual(arriving.map(shapeOfEntry), ['text']);
  assert.ok(arriving[0]!.kind === 'text' && arriving[0]!.live === true);
  // Not a word yet: nothing at all, not an empty row.
  assert.deepEqual(
    shapeOf([{ kind: 'tools', items: [sent({ status: 'running', args: {}, result: undefined })] }]),
    [],
  );
  // The handover: arguments streaming, then the call completes before its body
  // arrives (the Host's live frame omits it), then the transcript brings the
  // body. The words are prose at every step — never folded into the run and
  // brought back.
  const handover = [
    sent({ status: 'running', args: undefined, argsPreview: { message: 'Hi' }, result: undefined }),
    sent({
      status: 'completed',
      args: undefined,
      argsPreview: { message: 'Hi' },
      result: undefined,
    }),
    sent({ status: 'completed', result: { kind: 'user_message', message: 'Hi' } }),
  ];
  for (const item of handover) {
    assert.deepEqual(shapeOf([{ kind: 'tools', items: [read, item] }]), ['status:start:1', 'text']);
  }
  // Cut short or failed with no body: it did not arrive, so it is a step.
  assert.deepEqual(
    shapeOf([{ kind: 'tools', items: [sent({ status: 'interrupted', result: undefined })] }]),
    ['status:start:1'],
  );
  assert.deepEqual(
    shapeOf([
      {
        kind: 'tools',
        items: [
          sent({
            status: 'completed',
            result: undefined,
            failure: { kind: 'denied', message: 'blocked' },
          }),
        ],
      },
    ]),
    ['status:start:1'],
  );
  // A run whose only call is a message that did not arrive still says what it
  // did once it is over, rather than "Working on it…" for good.
  const refusedAlone = sent({
    status: 'errored',
    result: { kind: 'text', text: 'too long' },
    failure: { kind: 'failed', message: 'too long' },
  });
  assert.notEqual(summarizeToolGroup([refusedAlone], 'en'), 'Working on it…');
  // Settled without delivering: a step, where its failure can be read — never
  // its arguments drawn as if they had arrived.
  const refused = sent({
    status: 'errored',
    result: { kind: 'text', text: 'message too long' },
    failure: { kind: 'failed', message: 'message too long' },
  });
  assert.deepEqual(shapeOf([{ kind: 'tools', items: [refused] }]), ['status:start:1']);

  // Words before a message and more work after it: the words fold into the run
  // before, the message splits the work, and the next run keys off it.
  assert.deepEqual(
    shapeOf([
      { kind: 'text', text: 'Checking.', messageId: 'a', complete: true },
      { kind: 'tools', items: [sent({}), read] },
    ]),
    ['status:start:1', 'text', 'status:send-user-message:sum-1:1'],
  );
});

test('groupTurnTimeline keys a run by the boundary before it, so a run keeps its key as it grows', () => {
  const thinking = { kind: 'thinking', text: 't', messageId: 'm-1' } as const;
  const tools = { kind: 'tools' as const, items: [] as ToolActivityItem[] };
  const read: ToolActivityItem = {
    toolUseId: 'r-1',
    toolName: 'Read',
    status: 'completed',
    args: {},
  };
  const text = (messageId: string, value: string) =>
    ({ kind: 'text', text: value, messageId, complete: true }) as const;
  const user = {
    kind: 'user',
    message: { id: 'u-1', role: 'user', text: 'again' },
    messageId: 'u-1',
  } as const;

  assert.deepEqual(shapeOf([thinking]), ['status:start:1']);
  // The same run once a call has landed: same id.
  assert.deepEqual(shapeOf([thinking, tools]), ['status:start:1']);
  // Narration folds INTO the run, which keeps the id it started with.
  assert.deepEqual(
    shapeOf([
      thinking,
      { kind: 'tools', items: [read] },
      text('m-2', 'Now the next one.'),
      thinking,
      { kind: 'tools', items: [{ ...read, toolUseId: 'r-2' }] },
    ]),
    ['status:start:5'],
  );
  // A text with nothing after it in its reply is the tail and stays shown; the
  // run after it keys off it.
  assert.deepEqual(shapeOf([thinking, tools, text('m-2', 'p'), thinking, user, tools]), [
    'status:start:1',
    'text',
    'status:m-2:1',
    'user',
  ]);
  assert.deepEqual(shapeOf([text('m-2', 'p')]), ['text']);
});

function shapeOfEntry(entry: ReturnType<typeof groupTurnTimeline>[number]): string {
  return entry.kind === 'status'
    ? `status:${entry.id}:${entry.steps.length}`
    : entry.kind === 'ask'
      ? `ask:${entry.id}`
      : entry.kind;
}

function shapeOf(items: Parameters<typeof groupTurnTimeline>[0]): string[] {
  return groupTurnTimeline(items).map(shapeOfEntry);
}

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

test('the live turn carries its status on its newest run: the call in flight, the mark, the clock', () => {
  const base = transcriptFixture();
  const renderLive = (timeline: TurnViewModel['timeline'], unsteady = false) =>
    renderTree(
      createElement(TranscriptTurn, {
        turn: { ...base, status: 'running', timeline },
        live: true,
        liveStatus: { turnId: base.turnId, startedAt: NOW, unsteady, mark: 'default' },
        footerActions: [],
        toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
        onFooterAction: () => {},
        onOpenLineage: () => {},
        onOpenExternal: () => {},
      }),
    );

  // A command in flight, as the live frame carries it: the description is in
  // the preview, and it is what the row says.
  const running: ToolActivityItem = {
    toolUseId: 'bash-live',
    toolName: 'Bash',
    activityKind: 'command',
    status: 'running',
    args: undefined,
    argsPreview: { command: 'npm test', description: 'Run the unit tests' },
  };
  const busy = renderLive([{ kind: 'tools', items: [running] }]);
  const row = busy.querySelector('[data-maka-turn-status]');
  assert.equal(row?.getAttribute('data-state'), 'busy');
  assert.ok((row?.textContent ?? '').includes('Run the unit tests'), row?.textContent ?? '');
  assert.ok(row?.querySelector('[data-maka-working-mark]'), 'the working mark hangs beside it');
  assert.equal(
    row?.querySelector('[data-maka-contract="turn-elapsed"]')?.textContent,
    '',
    'no clock on first paint',
  );
  assert.equal(busy.querySelector('[data-maka-turn-pending]'), null, 'one status, not two');

  // Nothing has arrived yet: a pending row stands in the run's place.
  const waiting = renderLive([]).querySelector('[data-maka-turn-pending]');
  assert.equal(waiting?.getAttribute('aria-label'), 'Working on it…');
  assert.ok(waiting?.querySelector('[data-maka-working-mark]'));

  // A line being written right under the run: it stands below the run without
  // ending it, so the run keeps the mark and the clock — and keeps its last
  // step's words, now in their settled form, the way the reference does.
  const writing = renderLive([
    { kind: 'tools', items: [{ ...running, status: 'completed' }] },
    { kind: 'text', text: 'Half an answer', messageId: 'a', live: true },
  ]);
  const writingRow = writing.querySelector('[data-maka-turn-status]');
  assert.equal(writingRow?.getAttribute('data-state'), 'busy');
  assert.ok(
    (writingRow?.textContent ?? '').includes('Run the unit tests'),
    writingRow?.textContent ?? '',
  );
  // The same after the call settles with nothing after it yet: the settled
  // words, not the running ones and not "Thinking…".
  const settledGap = renderLive([
    {
      kind: 'tools',
      items: [
        {
          ...running,
          args: { file_path: '/repo/a.ts' },
          argsPreview: undefined,
          toolName: 'Read',
          activityKind: 'read',
          status: 'completed',
        },
      ],
    },
  ]);
  const gapRow = settledGap.querySelector('[data-maka-turn-status]');
  assert.ok((gapRow?.textContent ?? '').includes('Read a.ts'), gapRow?.textContent ?? '');
  assert.ok(!(gapRow?.textContent ?? '').includes('Reading'), 'not the running form');
  assert.ok(writingRow?.querySelector('[data-maka-working-mark]'));
  assert.equal(writing.querySelector('[data-maka-turn-pending]'), null);
  assert.ok((writing.documentElement.textContent ?? '').includes('Half an answer'));
});

test('a turn that goes quiet says it is still working, on the row that is live', () => {
  const base = transcriptFixture();
  const renderLive = (timeline: TurnViewModel['timeline'], unsteady: boolean) =>
    renderTree(
      createElement(TranscriptTurn, {
        turn: { ...base, status: 'running', timeline },
        live: true,
        liveStatus: { turnId: base.turnId, startedAt: NOW, unsteady },
        footerActions: [],
        toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
        onFooterAction: () => {},
        onOpenLineage: () => {},
        onOpenExternal: () => {},
      }),
    );
  const thinking: TurnViewModel['timeline'] = [
    { kind: 'thinking', text: 't', messageId: 'm', live: true },
  ];
  const quiet = renderLive(thinking, true).querySelector('[data-maka-turn-status]');
  assert.ok(
    (quiet?.textContent ?? '').includes('Still working — taking longer than usual…'),
    'it reassures rather than diagnoses: a long tool call is silent too',
  );
  assert.equal(quiet?.getAttribute('data-maka-stream'), 'unsteady');
  const recovered = renderLive(thinking, false).querySelector('[data-maka-turn-status]');
  assert.ok((recovered?.textContent ?? '').includes('Thinking…'));
  assert.equal(recovered?.getAttribute('data-maka-stream'), null);

  // Quiet in the middle of the answer: there is no live run, so the pending row
  // says it, after the prose.
  const stalled = renderLive(
    [{ kind: 'text', text: 'Half an answer', messageId: 'a', live: true }],
    true,
  ).querySelector('[data-maka-turn-pending]');
  assert.equal(stalled?.getAttribute('data-maka-stream'), 'unsteady');
});

test('a live turn is one run: the line being written stands under it and folds in when the next call lands', () => {
  const base = transcriptFixture();
  const call = base.tools[1]!;
  const next: ToolActivityItem = { ...call, toolUseId: 'tool-next', status: 'running' };
  const renderLive = (timeline: TurnViewModel['timeline']) =>
    renderTree(
      createElement(TranscriptTurn, {
        turn: { ...base, status: 'running', tools: [call, next], timeline },
        live: true,
        footerActions: [],
        toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
        onFooterAction: () => {},
        onOpenLineage: () => {},
        onOpenExternal: () => {},
      }),
    );
  // Being written: the line stands under the run, and the run stays live.
  const writing = renderLive([
    { kind: 'tools', items: [call] },
    { kind: 'text', text: 'Now checking the rest.', messageId: 'step-2', live: true },
  ]);
  assert.ok((writing.documentElement.textContent ?? '').includes('Now checking the rest.'));
  const rows = [...writing.querySelectorAll('[data-maka-turn-status]')];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.getAttribute('data-state'), 'busy');
  // The next call lands: the line scores as narration and is tucked into the
  // SAME run — no second run below it, nothing to merge later.
  const folded = renderLive([
    { kind: 'tools', items: [call] },
    { kind: 'text', text: 'Now checking the rest.', messageId: 'step-2', complete: true },
    { kind: 'thinking', text: 'And then.', messageId: 'step-3' },
    { kind: 'tools', items: [next] },
  ]);
  const after = [...folded.querySelectorAll('[data-maka-turn-status]')];
  assert.equal(after.length, 1, 'one run: the call, the narration, the reasoning, the next call');
  assert.equal(
    after[0]!.getAttribute('data-maka-turn-status'),
    rows[0]!.getAttribute('data-maka-turn-status'),
  );
  assert.equal(after[0]!.getAttribute('data-state'), 'busy');
  assert.ok(!(folded.documentElement.textContent ?? '').includes('Now checking the rest.'));
});

test('a running turn always shows exactly one live status, whatever its newest block is', () => {
  const base = transcriptFixture();
  const done: ToolActivityItem = { ...base.tools[1]!, status: 'completed' };
  const busy: ToolActivityItem = { ...base.tools[1]!, toolUseId: 'tool-busy', status: 'running' };
  const message: ToolActivityItem = {
    toolUseId: 'sum-1',
    toolName: TOOL_NAMES.sendUserMessage,
    status: 'completed',
    args: { message: 'Midway report.' },
    result: { kind: 'user_message', message: 'Midway report.' },
  };
  const answered: ToolActivityItem = {
    toolUseId: 'ask-1',
    toolName: 'AskUserQuestion',
    status: 'completed',
    args: { questions: [{ question: 'Which?', options: [] }] },
  };
  const text = (value: string, live = false) =>
    ({
      kind: 'text',
      text: value,
      messageId: `t-${value}`,
      ...(live ? { live: true } : { complete: true }),
    }) as const;
  const user = {
    kind: 'user',
    message: { id: 'u-1', role: 'user', text: 'also this' },
    messageId: 'u-1',
  } as const;
  const shapes: Record<
    string,
    { timeline: TurnViewModel['timeline']; where: 'run' | 'pending'; label?: string }
  > = {
    'nothing yet': { timeline: [], where: 'pending', label: 'Working on it…' },
    thinking: {
      timeline: [{ kind: 'thinking', text: 't', messageId: 'th', live: true }],
      where: 'run',
    },
    'first line being written': {
      timeline: [text('I will start', true)],
      where: 'pending',
      label: 'Writing…',
    },
    // A finished text in a live turn still carries `live: true`; only
    // `complete` says the writing stopped, and the label follows that.
    'first line finished, nothing yet after it': {
      timeline: [
        { kind: 'text', text: 'I will start', messageId: 't-done', live: true, complete: true },
      ],
      where: 'pending',
      label: 'Working on it…',
    },
    'a call running': { timeline: [{ kind: 'tools', items: [busy] }], where: 'run' },
    'a line under a run': {
      timeline: [{ kind: 'tools', items: [done] }, text('Now the rest', true)],
      where: 'run',
    },
    'a line finished under a run': {
      timeline: [{ kind: 'tools', items: [done] }, text('Now the rest')],
      where: 'run',
    },
    'a message just sent': {
      timeline: [{ kind: 'tools', items: [done, message] }],
      where: 'pending',
    },
    'a line then a message': {
      timeline: [text('Sending it'), { kind: 'tools', items: [message] }],
      where: 'pending',
    },
    'a question just answered': {
      timeline: [{ kind: 'tools', items: [done, answered] }],
      where: 'pending',
    },
    'the user just spoke': { timeline: [{ kind: 'tools', items: [done] }, user], where: 'pending' },
  };
  for (const [name, shape] of Object.entries(shapes)) {
    const document = renderTree(
      createElement(TranscriptTurn, {
        turn: { ...base, status: 'running', timeline: shape.timeline },
        live: true,
        liveStatus: { turnId: base.turnId, startedAt: NOW },
        footerActions: [],
        toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
        onFooterAction: () => {},
        onOpenLineage: () => {},
        onOpenExternal: () => {},
      }),
    );
    assert.equal(
      document.querySelectorAll('[data-maka-working-mark]').length,
      1,
      `${name}: one mark`,
    );
    const busyRuns = document.querySelectorAll('[data-maka-turn-status][data-state="busy"]').length;
    const pending = document.querySelector('[data-maka-turn-pending]');
    if (shape.where === 'run') {
      assert.equal(busyRuns, 1, `${name}: the run carries it`);
      assert.equal(pending, null, `${name}: no second status`);
    } else {
      assert.equal(busyRuns, 0, `${name}: no run is live`);
      assert.ok(pending, `${name}: the pending row carries it`);
      if (shape.label) assert.equal(pending?.getAttribute('aria-label'), shape.label, name);
    }
  }
});

test('a run the turn is parked on says what it waits for', () => {
  const base = transcriptFixture();
  const ask: ToolActivityItem = {
    toolUseId: 'ask-1',
    toolName: 'AskUserQuestion',
    status: 'running',
    args: { questions: [{ question: 'Which one?', options: [] }] },
  };
  const renderTurn = (blocked: 'question' | 'input') =>
    renderTree(
      createElement(TranscriptTurn, {
        turn: { ...base, tools: [ask], timeline: [{ kind: 'tools', items: [ask] }] },
        live: true,
        blocked,
        footerActions: [],
        toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
        onFooterAction: () => {},
        onOpenLineage: () => {},
        onOpenExternal: () => {},
      }),
    );
  const question = renderTurn('question').querySelector('[data-maka-turn-status]');
  assert.equal(question?.getAttribute('data-state'), 'blocked');
  assert.ok((question?.textContent ?? '').includes('Asking a question'));
  const input = renderTurn('input').querySelector('[data-maka-turn-status]');
  assert.ok((input?.textContent ?? '').includes('Needs your input'));
});

test('working marks retain the last action between blocks and use semantic tool kinds', () => {
  const base = transcriptFixture();
  const mark = (timeline: TurnViewModel['timeline']) =>
    deriveWorkingMarkActivity({ ...base, timeline });
  assert.equal(deriveWorkingMarkActivity(undefined), 'default');
  assert.equal(mark([]), 'default', 'a new turn never inherits the previous activity');
  assert.equal(mark([{ kind: 'thinking', text: 't', messageId: 'm', live: false }]), 'think');
  assert.equal(mark([{ kind: 'text', text: 'p', messageId: 'm', complete: true }]), 'write');
  for (const [activityKind, expected] of [
    ['read', 'read'],
    ['webfetch', 'read'],
    ['websearch', 'search'],
    ['explore', 'search'],
    ['edit', 'code'],
    ['command', 'code'],
    ['computer', 'default'],
  ] as const) {
    const item: ToolActivityItem = {
      ...base.tools[1]!,
      toolName: 'opaque_tool',
      activityKind,
      status: 'running',
    };
    assert.equal(mark([{ kind: 'tools', items: [item] }]), expected);
    assert.equal(mark([{ kind: 'tools', items: [{ ...item, status: 'completed' }] }]), expected);
  }
  const read: ToolActivityItem = { ...base.tools[1]!, activityKind: 'read', status: 'running' };
  const done: ToolActivityItem = { ...read, activityKind: 'edit', status: 'completed' };
  assert.equal(
    mark([{ kind: 'tools', items: [read, done] }]),
    'read',
    'an in-flight tool wins over a completed sibling',
  );
});

test('the jump button has an animated working mark only during generation', () => {
  const running = renderTree(
    createElement(JumpToLatest, { streaming: true, activity: 'code', onJump() {} }),
  );
  const button = running.querySelector('[data-maka-contract="jump-to-latest"]');
  assert.equal(button?.getAttribute('aria-label'), getTranscriptCopy('en').feed.jumpToLatest);
  assert.equal(
    button?.querySelector('[data-maka-working-mark]')?.getAttribute('data-maka-working-mark'),
    'code',
  );
  const settled = renderTree(createElement(JumpToLatest, { streaming: false, onJump() {} }));
  assert.equal(
    settled.querySelector('[data-maka-working-mark]'),
    null,
    'no hidden animation after completion',
  );
  assert.ok(settled.querySelector('button[aria-label]'));
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

// Where the mark sits, and what opening the row actually shows. Asserted on
// the markup rather than on the presentation functions: both of these were
// right in the data and wrong on screen — the glyph was wedged between the
// title and the caret that opens the row, and the reason was a bare coloured
// paragraph under panels that all share one shape.
test('a failed step keeps its words, says Failed after them, and reasons in a panel', () => {
  const failed: ToolActivityItem = {
    toolUseId: 'tool-failed',
    toolName: 'Bash',
    activityKind: 'command',
    status: 'errored',
    args: { command: 'cp big.iso /vol' },
    failure: { kind: 'failed', message: 'ENOSPC: no space left on device' },
    result: { kind: 'text', text: 'cp: /vol: No space left on device' },
  };
  const markup = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale: 'en',
      children: createElement(TooltipProvider, {
        children: createElement(TurnStatusToolStep, {
          item: failed,
          context: { onOpenSession: () => {}, onOpenExternal: () => {} },
        }),
      }),
    }),
  );
  const { document } = parseHTML(`<main>${markup}</main>`);

  // The words are never recoloured; the outcome is the red "Failed" after them,
  // before the chevron that opens onto the reason.
  const header = document.querySelector('button');
  const words = header?.querySelector('span[title]');
  assert.ok(words, 'the row has its words');
  assert.doesNotMatch(words?.outerHTML ?? '', /text-danger/);
  assert.equal(words?.getAttribute('title'), 'Failed to run cp big.iso /vol');
  const tag = [...(header?.querySelectorAll('span') ?? [])].find(
    (span) => span.textContent === 'Failed',
  );
  assert.ok(tag, 'the row says Failed');
  assert.match(tag?.getAttribute('class') ?? '', /text-danger/);
  assert.equal(header?.getAttribute('aria-expanded'), 'false', 'and opens onto the reason');

  // What opening it shows. The row keeps its expansion in component state, so
  // the body is asserted on the block itself.
  const body = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale: 'en',
      children: createElement(ToolFailureBlock, { failure: toolRowFailure(failed)! }),
    }),
  );
  const panel = parseHTML(`<main>${body}</main>`).document;
  // The grammar every other result body uses: a panel, one block, a label
  // naming what the text is — not a bare coloured paragraph.
  assert.ok(panel.querySelector('[class*="rounded-lg"][class*="border-hairline"]'), 'a panel');
  assert.ok(panel.querySelector('[class*="bg-danger-subtle"]'), 'the block is tinted by grade');
  // The label is the grade, so an amber refusal is never headed with a word
  // that calls it an error.
  assert.match(body, /Failed/, 'the reason is labelled, so it is not read as more output');
  assert.match(body, /ENOSPC: no space left on device/);
  assert.doesNotMatch(body, /This call failed/, 'no heading that restates the mark');

  // Nothing to say and nothing to do draws nothing: the result body below is
  // the explanation and the mark already said which way it went.
  assert.equal(
    renderToStaticMarkup(
      createElement(LocaleProvider, {
        locale: 'en',
        children: createElement(ToolFailureBlock, { failure: { kind: 'failed', tone: 'danger' } }),
      }),
    ),
    '',
  );

  // A boundary the reader can move keeps the card, because it carries an action.
  const denied = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale: 'en',
      children: createElement(ToolFailureBlock, {
        failure: { kind: 'denied', tone: 'warning', class: 'requires_bypass', remedy: 'bypass' },
        onSwitchToFullAccessAndRetry: () => {},
      }),
    }),
  );
  assert.match(denied, /<button/, 'the remedy is offered');
});

// One sentence, once. The synthetic-error path puts the SAME string in the
// result body and in the envelope — the envelope because a live frame omits
// the body — so once the body lands a short reason was drawn twice: labelled
// and tinted in the failure block, then again as anonymous monospace below it.
test('a failed row does not say its reason twice', () => {
  const denied = 'Filesystem access was denied.';
  const same: ToolActivityItem = {
    toolUseId: 'tool-same',
    toolName: 'Glob',
    activityKind: 'search',
    status: 'errored',
    args: { pattern: '**/*' },
    failure: { kind: 'failed', message: denied },
    result: { kind: 'text', text: denied },
  };
  assert.equal(resolveToolRendererId(same), 'none', 'the block already showed it');
  // Still openable: the block is what opening it shows.
  assert.equal(canExpandTool(same), true);

  // A body with more than the envelope holds is a different thing and both
  // belong: a refusal hands the model what it needs to act — the memory tools
  // return the file's current content so it can merge and retry. Suppression
  // runs ONE way, "the reason already holds all of the body"; read the other
  // way it fires whenever the body merely starts with the reason, which is
  // exactly when the body has the part worth reading.
  const richer: ToolActivityItem = {
    ...same,
    toolUseId: 'tool-richer',
    failure: { kind: 'refused', class: 'old_str_not_found', message: 'No match in a.md.' },
    result: {
      kind: 'text',
      text: 'Edit failed: old_str not found in a.md.\nCurrent content follows.\n---\nthe file',
    },
  };
  assert.equal(resolveToolRendererId(richer), 'text');

  // A TRUNCATED envelope is the clearest case of the body having more: the
  // envelope stops at 512 characters and the body runs to 4000, so the cause
  // at the tail of a long error lives only in the body. This test asserted the
  // opposite for one round and locked the loss in.
  const long = `${'x'.repeat(600)}\nCAUSE: the part that only the body has`;
  assert.equal(
    resolveToolRendererId({
      ...same,
      toolUseId: 'tool-cut',
      failure: { kind: 'failed', message: `${long.slice(0, 511)}\u2026` },
      result: { kind: 'text', text: long },
    }),
    'text',
  );

  // A summary that says more than the body still covers it: the reason holds
  // every word the body has, so the body is the redundant one.
  assert.equal(
    resolveToolRendererId({
      ...same,
      toolUseId: 'tool-fuller-reason',
      failure: { kind: 'failed', message: `${denied} Retry inside the workspace.` },
      result: { kind: 'text', text: denied },
    }),
    'none',
  );

  // A terminal result complements the reason rather than repeating it: the
  // command, the exit code and the whole output are not in the envelope.
  assert.equal(
    resolveToolRendererId({
      ...same,
      toolUseId: 'tool-terminal',
      toolName: 'Bash',
      activityKind: 'command',
      failure: { kind: 'failed', class: 'exit_1', message: 'cp: no space left' },
      result: {
        kind: 'terminal',
        cwd: '/w',
        cmd: 'cp x /vol',
        status: 'failed',
        exitCode: 1,
        output: {
          mode: 'pipes',
          stdout: '',
          stderr: 'cp: no space left\n',
          stdoutTruncated: false,
          stderrTruncated: false,
          redacted: false,
        },
      },
    }),
    'terminal',
  );
});

// The row says what it failed at with a glyph, not with the word "Error", and
// keeps its title readable — the weight of a failure belongs in the block that
// carries the reason, which is the rule the sandbox card already followed and
// nothing else did.
test('a failed row is marked, not repainted', () => {
  const denied: ToolActivityItem = {
    toolUseId: 'tool-denied',
    toolName: 'Bash',
    activityKind: 'command',
    status: 'errored',
    args: { command: 'sudo ls' },
    failure: { kind: 'denied', class: 'sandbox_denial', message: 'denied' },
    result: { kind: 'text', text: 'denied' },
  };
  assert.equal(toolRowStatus(denied), 'errored');
  assert.equal(toolRowStatusLabel(denied, 'en'), undefined);
  assert.equal(toolFailureMark(toolRowFailure(denied)!), 'lock');

  const refused: ToolActivityItem = { ...denied, failure: { kind: 'refused', message: 'no' } };
  assert.equal(toolFailureMark(toolRowFailure(refused)!), 'prohibit');
  const failed: ToolActivityItem = { ...denied, failure: { kind: 'failed', message: 'broke' } };
  assert.equal(toolFailureMark(toolRowFailure(failed)!), 'warningCircle');

  // Only a boundary has something to offer.
  assert.equal(toolRowFailure(denied)?.remedy, 'raise_permission');
  assert.equal(toolRowFailure(refused)?.remedy, undefined);
});

// A call the model is still writing is a row that exists and does not yet act.
// Both halves of that were wrong on the first cut: the row wore the generic icon
// until dispatch swapped it, and it held perfectly still while being the busiest
// thing on screen. A Write, not a task tool — a task write's arguments are
// withheld from a live row, which is the one shape that hides the flip below.
test('a call still being written keeps its icon, its box and its sweep at dispatch', () => {
  const arriving: ToolActivityItem = {
    toolUseId: 'tool-arriving',
    toolName: 'Write',
    activityKind: 'edit',
    status: 'running',
    args: undefined,
    input: { text: '{"file_path":"/tmp/a.ts"', preview: { file_path: '/tmp/a.ts' } },
    argsPreview: { file_path: '/tmp/a.ts' },
  };
  // What the Host actually sends for a live call: the preview, never the args.
  const dispatched: ToolActivityItem = {
    toolUseId: 'tool-arriving',
    toolName: 'Write',
    activityKind: 'edit',
    status: 'running',
    args: undefined,
    argsPreview: { file_path: '/tmp/a.ts' },
  };

  assert.equal(toolRowStatus(arriving), 'running');
  assert.equal(toolRowTitle(arriving, 'en'), toolRowTitle(dispatched, 'en'));
  assert.equal(toolRowIcon(arriving), toolRowIcon(dispatched));
  // The row must not open and close around the handoff: the header would swap
  // between a button and a div, React would rebuild the subtree, and the sweep
  // would restart at the exact moment the row should read as one thing.
  assert.equal(canExpandTool(arriving), canExpandTool(dispatched));
  const render = (item: ToolActivityItem) =>
    renderToStaticMarkup(
      createElement(LocaleProvider, {
        locale: 'en',
        children: createElement(TooltipProvider, {
          children: createElement(TurnStatusToolStep, {
            item,
            context: { onOpenSession: () => {}, onOpenExternal: () => {} },
          }),
        }),
      }),
    );
  for (const markup of [render(arriving), render(dispatched)]) {
    assert.ok(markup.includes('animate'), 'it sweeps on both sides of the handoff');
    assert.ok(markup.includes('leading-5'), 'and states the same line box');
  }
});

// The other end of the same handoff, and the one the test above missed: a call
// is on screen from the moment it is NAMED, which is before its arguments have
// said anything. Both rows below are live, a quarter of a second apart.
test('a call keeps its box from the moment it is named, before any argument has closed', () => {
  const named: ToolActivityItem = {
    toolUseId: 'tool-named',
    toolName: 'Write',
    activityKind: 'edit',
    status: 'running',
    args: undefined,
    input: { text: '{"file_pa' },
  };
  const reading: ToolActivityItem = {
    ...named,
    input: { text: '{"file_path":"/tmp/a.ts"', preview: { file_path: '/tmp/a.ts' } },
    argsPreview: { file_path: '/tmp/a.ts' },
  };

  // The first key closes a fraction of a second in. Expandability that follows
  // the arguments swaps the header from a div to a button right there, React
  // rebuilds the subtree, and the sweep restarts in the middle of the run.
  assert.equal(canExpandTool(named), canExpandTool(reading));
  assert.equal(canExpandTool(named), true, 'a live call can be opened for as long as it is live');
});

// A lost fragment is a designed-for path — the preview stream is sheddable — so
// the row must not open and close around one. It keeps the name the valid prefix
// gave it, and with it whether it can be opened at all.
test('a call whose argument stream broke keeps its box', () => {
  const reading: ToolActivityItem = {
    toolUseId: 'tool-gap',
    toolName: 'Bash',
    activityKind: 'command',
    status: 'running',
    args: undefined,
    input: { text: '{"command":"ls', preview: { command: 'ls' } },
    argsPreview: { command: 'ls' },
  };
  const broken: ToolActivityItem = {
    ...reading,
    input: { ...reading.input!, broken: true },
  };

  assert.equal(canExpandTool(broken), canExpandTool(reading));
  assert.equal(toolRowTitle(broken, 'en'), toolRowTitle(reading, 'en'));
});

// A row that cannot be opened used to sit perfectly still for its whole run.
test('a running row that cannot be opened shimmers too', () => {
  // A search names what was asked in the row itself and has no body to open,
  // so it is non-expandable at every point in its life.
  const searching: ToolActivityItem = {
    toolUseId: 'tool-search',
    toolName: 'ToolSearch',
    activityKind: 'search',
    status: 'running',
    args: { query: 'browser' },
  };
  assert.equal(canExpandTool(searching), false);
  const markup = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale: 'en',
      children: createElement(TooltipProvider, {
        children: createElement(TurnStatusToolStep, {
          item: searching,
          context: { onOpenSession: () => {}, onOpenExternal: () => {} },
        }),
      }),
    }),
  );
  assert.ok(markup.includes('animate'), 'it still moves while it works');
  assert.ok(markup.includes('--base-color:var(--text-muted)'));
});

test('a step names its verb and the object it acted on, in the tense of its outcome', () => {
  const step = (overrides: Partial<ToolActivityItem>) =>
    toolStepLabel(
      { toolUseId: 't', toolName: 'Read', status: 'completed', args: {}, ...overrides },
      'en',
    );
  // A call that names itself is its own line.
  assert.deepEqual(
    step({ toolName: 'Bash', args: { command: 'ls', description: 'Locate skill directories' } }),
    { lead: 'Locate skill directories', text: 'Locate skill directories' },
  );
  assert.deepEqual(step({ toolName: 'Bash', args: { command: 'npm test' } }), {
    lead: 'Ran',
    object: 'npm test',
    objectIsCode: true,
    text: 'Ran npm test',
  });
  // A file by its name; the tense follows the outcome.
  assert.equal(step({ args: { file_path: '/repo/src/app.tsx' } }).text, 'Read app.tsx');
  assert.equal(
    step({ status: 'running', args: undefined, argsPreview: { file_path: '/repo/src/app.tsx' } })
      .text,
    'Reading app.tsx',
  );
  assert.equal(
    step({
      status: 'errored',
      args: { file_path: '/repo/missing.md' },
      failure: { kind: 'failed', message: 'ENOENT' },
    }).text,
    'Failed to read missing.md',
  );
  assert.equal(
    step({
      toolName: 'Write',
      args: { file_path: '/repo/a.md' },
      result: { kind: 'file_write', path: '/repo/a.md', bytes: 3, created: false },
    }).text,
    'Updated a.md',
  );
  assert.equal(step({ toolName: 'Write', args: { file_path: '/repo/a.md' } }).text, 'Created a.md');
  assert.equal(step({ toolName: 'Grep', args: { pattern: 'useStore' } }).object, 'useStore');
  assert.equal(
    step({ toolName: 'WebSearch', args: { query: 'tailwind v4' } }).text,
    'Searched web tailwind v4',
  );
  assert.equal(step({ toolName: 'Skill', args: { skill: 'pdf' } }).text, 'Ran skill /pdf');
  // The task family reads like the reference: the verb follows what was set.
  assert.equal(
    step({ toolName: 'TaskCreate', args: { subject: 'Ship it' } }).text,
    'Added task Ship it',
  );
  assert.equal(
    step({ toolName: 'TaskUpdate', args: { taskId: '3', status: 'completed' } }).text,
    'Completed task #3',
  );
  assert.equal(step({ toolName: 'ToolSearch', args: { query: 'browser' } }).text, 'Loaded tools');
  assert.equal(
    step({ toolName: 'AskUserQuestion', args: { questions: [{ question: 'Which one?' }] } }).text,
    'Asked Which one?',
  );
  assert.equal(
    step({
      toolName: 'AskUserQuestion',
      args: { questions: [{ question: 'a' }, { question: 'b' }] },
    }).text,
    'Asked 2 questions',
  );
  // Still being asked: the reference's words, never a count read off the
  // half-written arguments.
  assert.equal(
    step({
      toolName: 'AskUserQuestion',
      status: 'running',
      args: undefined,
      argsPreview: { questions: [{ question: 'a' }, { question: 'b' }] },
    }).text,
    'Asking a question',
  );
});

test('a run whose last call is a running question wears the waiting pill before the request lands', () => {
  const base = transcriptFixture();
  const asking: ToolActivityItem = {
    toolUseId: 'ask-live',
    toolName: 'AskUserQuestion',
    status: 'running',
    args: undefined,
    argsPreview: { questions: [{ question: 'Which one?' }] },
  };
  const document = renderTree(
    createElement(TranscriptTurn, {
      turn: {
        ...base,
        status: 'running',
        tools: [asking],
        timeline: [{ kind: 'tools', items: [asking] }],
      },
      live: true,
      liveStatus: { turnId: base.turnId, startedAt: NOW },
      footerActions: [],
      toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
      onFooterAction: () => {},
      onOpenLineage: () => {},
      onOpenExternal: () => {},
    }),
  );
  const row = document.querySelector('[data-maka-turn-status]');
  assert.equal(row?.getAttribute('data-state'), 'blocked');
  assert.ok((row?.textContent ?? '').includes('Asking a question'));
  assert.ok(!(row?.textContent ?? '').includes('questions'));
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

test('a plain user turn renders no stray 0 where its chips would be', () => {
  // `{count && <div/>}` renders a literal 0 in React when the count is zero.
  // The chip row's guard used to end in a boolean, which hid that every other
  // operand is a COUNT; removing the boolean put a bare 0 on screen under every
  // message that carried no quote, folder, skill or file — which is most of
  // them. The guard has to stay a boolean.
  const turn = transcriptFixture();
  const document = renderTree(
    createElement(TranscriptTurn, {
      // The fixture's own ask carries no quote, folder, skill or file — the
      // ordinary case, and the one that put a 0 on screen.
      turn: { ...turn, timeline: [], tools: [] },
      live: false,
      footerActions: [],
      toolContext: { onOpenSession: () => {}, onOpenExternal: () => {} },
      onFooterAction: () => {},
      onOpenLineage: () => {},
      onOpenExternal: () => {},
    }),
  );
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes('Fix the constant'), 'the message itself is on screen');
  // Structural, not textual: the zero lands with no whitespace around it, so a
  // word-boundary regex misses it. A bare "0" TEXT NODE is the actual defect.
  const stray = [...document.querySelectorAll('*')].filter((element) =>
    [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent === '0'),
  );
  assert.deepEqual(
    stray.map((element) => element.tagName + '.' + (element.getAttribute('class') ?? '')),
    [],
    'no element renders a bare 0 text node',
  );
});

test('a question and a permission request are one-line steps: answered elsewhere, nothing to open', () => {
  const asked: ToolActivityItem = {
    toolUseId: 'ask-1',
    toolName: 'AskUserQuestion',
    status: 'completed',
    args: { questions: [{ question: 'Which one?', options: [] }] },
    result: { kind: 'json', value: { answers: [{ answer: 'A' }] } },
  };
  const asking: ToolActivityItem = { ...asked, status: 'running', result: undefined };
  const boundary: ToolActivityItem = {
    toolUseId: 'sb-1',
    toolName: 'RequestSandboxBoundary',
    status: 'completed',
    args: { justification: 'read the folder' },
    result: { kind: 'text', text: 'approved' },
  };
  assert.equal(canExpandTool(asked), false);
  assert.equal(canExpandTool(asking), false);
  assert.equal(canExpandTool(boundary), false);
  // A refused one still opens: the reason is the one thing it has to show.
  assert.equal(
    canExpandTool({ ...boundary, status: 'errored', failure: { kind: 'denied', message: 'no' } }),
    true,
  );
});

test('a tool search is its own row: what was asked, no body, nothing to open', () => {
  const searchItem = (args: unknown): ToolActivityItem =>
    ({
      toolCallId: 'call-1',
      toolName: 'ToolSearch',
      status: 'completed',
      args,
      result: { kind: 'json', value: { activated: ['mcp__desktop_browser__BrowserSnapshot'] } },
    }) as unknown as ToolActivityItem;

  // Named: the row reads as loading that tool, not as the wire form.
  assert.equal(
    toolRowTitle(searchItem({ query: 'select:mcp__desktop_browser__BrowserSnapshot' }), 'en'),
    // A proxied tool is named for its server on the wire; the row names the tool.
    'Loading tool: BrowserSnapshot',
  );
  // The same call wrapped in a provider's search envelope reads identically.
  assert.equal(
    toolRowTitle(
      searchItem({ arguments: { query: 'select:ScheduledTaskList' }, call_id: 'call_x' }),
      'en',
    ),
    'Loading tool: ScheduledTaskList',
  );
  // Anything else is its own words.
  assert.equal(
    toolRowTitle(searchItem({ query: 'list scheduled tasks' }), 'en'),
    'list scheduled tasks',
  );
  // No query at all still says what the row is.
  assert.equal(toolRowTitle(searchItem({}), 'en'), 'Loading tools');

  const item = searchItem({ query: 'select:ScheduledTaskList' });
  assert.equal(resolveToolRendererId(item), 'tool_search');
  assert.equal(canExpandTool(item), false, 'the row is the whole statement');
  assert.equal(
    renderToolContent(item, {
      onOpenSession: () => {},
      onOpenExternal: () => {},
    }),
    null,
    'and it has no body to draw',
  );
});

test('a tool search has its own icon and its own summary phrase', () => {
  const item = {
    toolCallId: 'call-1',
    toolName: 'ToolSearch',
    status: 'completed',
    args: { query: 'select:Grep' },
  } as unknown as ToolActivityItem;
  // The reference gives the discovery connector a glyph of its own — it is not
  // a search over the workspace, it is what makes other tools reachable.
  assert.equal(toolRowIcon(item), 'connectors');
  assert.notEqual(toolRowIcon(item), 'tool');
  // And a turn that only looked for tools must not report "called a tool".
  assert.equal(toolSummaryKeyOf(item), 'toolSearch');
  const copy = getTranscriptCopy('en').tools;
  assert.equal(copy.summary.toolSearch.one, 'Loaded tools');
  assert.equal(copy.active.toolSearch, 'Loading tools');
});

test('the permission chip names the boundary Plan holds the session to', () => {
  // Plan leaves the header's mode alone and runs the session read-only; the
  // chip used to name the header's mode, so Plan read "Manual".
  const chip = (activeMode: 'explore' | 'ask', chosenMode: 'ask') =>
    renderTree(
      createElement(PermissionModeMenu, {
        activeMode: resolveCollaborationPermissionMode({
          collaborationMode: activeMode === 'explore' ? 'plan' : 'agent',
          permissionMode: chosenMode,
        }),
        chosenMode,
        side: 'top',
        onSelect: () => {},
      }),
    ).querySelector('button');
  assert.equal(chip('explore', 'ask')?.textContent, 'Read only');
  assert.equal(chip('explore', 'ask')?.getAttribute('aria-label'), 'Permission mode: Read only');
  assert.equal(chip('ask', 'ask')?.textContent, 'Manual');
});
