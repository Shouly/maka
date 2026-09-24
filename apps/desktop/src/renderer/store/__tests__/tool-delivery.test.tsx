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

// Phase 8b's renderer surface: the two deliveries, the two search panels, the
// question shape, and the row label a `description` supplies.
//
// Every view under test is rendered with `renderToStaticMarkup` and read back
// as a DOM. That is the whole contract for this tier: `useStore` under SSR
// yields the store's INITIAL state, so a test that needed a store to have been
// written to would be testing nothing. What is asserted here is what a pure
// view does with the props it is handed — which is also what a reader sees.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { LocaleProvider, type ToolActivityItem, type TurnViewModel } from '@maka/ui';
import { TooltipProvider } from '../../components/ui/tooltip.js';
import { TranscriptTurn } from '../../components/session/TranscriptTurn.js';
import { AskUserQuestionRecord } from '../../components/session/AskUserQuestionRecord.js';
import { renderToolContent } from '../../components/session/tools/registry.js';
import { deliveryAutoOpenTarget } from '../../components/session/tools/renderers/DeliveryResults.js';
import {
  canExpandTool,
  resolveToolRendererId,
  summarizeToolGroup,
  toolRowTitle,
  toolStepLabel,
} from '../../components/session/tools/tool-presentation.js';
import { groupTurnTimeline } from '../../lib/turn-timeline-groups.js';
import {
  parseGrepRow,
  readGlobResult,
  readGrepResult,
  readUserFileDelivery,
  readUserMessage,
} from '../../lib/tool-delivery-results.js';
import { toolRowDescription } from '../../lib/tool-row-description.js';
import {
  buildUserQuestionResponse,
  canLeaveQuestion,
  createQuestionDrafts,
  draftAnswer,
  draftHasOption,
  readUserQuestions,
  toggleDraftOption,
  type QuestionDraft,
} from '../../lib/user-question-shape.js';

import { TaskProgressRow, ProgressSteps } from '../../components/session/SessionPanel.js';
import { getSessionPanelCopy } from '../../locales/session-panel-copy.js';
import { openBlockersOf } from '../../hooks/use-task-progress.js';

function renderTree(node: Parameters<typeof renderToStaticMarkup>[0]) {
  const html = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale: 'en',
      children: createElement(TooltipProvider, { children: node }),
    }),
  );
  return parseHTML(html).document;
}

const CONTEXT = { onOpenSession: () => {}, onOpenExternal: () => {} };

/** A settled call, with whatever result the case under test needs. */
function call(overrides: Partial<ToolActivityItem> & { toolUseId: string }): ToolActivityItem {
  return {
    toolName: 'Tool',
    status: 'completed',
    args: {},
    ...overrides,
  } as ToolActivityItem;
}

const DELIVERY = {
  kind: 'user_file_delivery',
  status: 'proactive',
  caption: 'The two drafts, side by side.',
  display: 'render',
  files: [
    {
      artifactId: 'artifact-1',
      name: 'plan.md',
      path: 'notes/plan.md',
      kind: 'file',
      mimeType: 'text/markdown',
      sizeBytes: 2048,
    },
    {
      artifactId: 'artifact-2',
      name: 'shot.png',
      path: 'shots/shot.png',
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 40960,
    },
  ],
} as const;

// ── the two deliveries ─────────────────────────────────────────────────────

test('a memory row draws the memory: a file list, a document, the two sides of an edit', () => {
  const listed = renderTree(
    renderToolContent(
      call({
        toolUseId: 'm1',
        toolName: 'MemoryList',
        args: { path_prefix: '/topics/' },
        result: {
          kind: 'text',
          text: [
            '/topics/food.md  (21 bytes, updated 2026-09-18T01:00:00+00:00)',
            '  what they eat',
            'More files follow; pass cursor="/topics/food.md" to continue.',
          ].join('\n'),
        },
      }),
      CONTEXT,
    ),
  );
  assert.equal(listed.querySelectorAll('[data-maka-memory-file]').length, 1);
  assert.match(listed.documentElement.textContent ?? '', /\/topics\/food\.md/);
  assert.match(listed.documentElement.textContent ?? '', /what they eat/);
  assert.doesNotMatch(listed.documentElement.textContent ?? '', /cursor/);

  const read = renderTree(
    renderToolContent(
      call({
        toolUseId: 'm2',
        toolName: 'MemoryRead',
        args: { path: '/topics/food.md' },
        result: {
          kind: 'text',
          text: '[updated: 2026-09-18T01:00:00+00:00] [version: abcdef012345] (pass as if_version on your next MemoryWrite to this path)\n- [stated] drinks tea',
        },
      }),
      CONTEXT,
    ),
  );
  assert.match(read.documentElement.textContent ?? '', /\[stated\] drinks tea/);
  assert.doesNotMatch(read.documentElement.textContent ?? '', /version|if_version/);

  const edited = renderTree(
    renderToolContent(
      call({
        toolUseId: 'm3',
        toolName: 'MemoryStrReplace',
        args: { path: '/topics/food.md', old_str: 'coffee', new_str: 'tea', if_version: 'abc' },
        result: { kind: 'text', text: 'Saved /topics/food.md (version: def, 30 of 16384 bytes).' },
      }),
      CONTEXT,
    ),
  );
  const labels = [...edited.querySelectorAll('p')].map((node) => node.textContent);
  assert.deepEqual(labels, ['Removed', 'Added']);
  assert.doesNotMatch(edited.documentElement.textContent ?? '', /abc|def/);

  const deleted = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale: 'en',
      children: renderToolContent(
        call({
          toolUseId: 'm4',
          toolName: 'MemoryDelete',
          args: { path: '/topics/food.md', if_version: 'abc' },
          result: { kind: 'text', text: 'Deleted /topics/food.md.' },
        }),
        CONTEXT,
      ),
    }),
  );
  assert.equal(deleted, '');
});

test('a file delivery routes to its own renderer and never opens as a tool row', () => {
  const item = call({
    toolUseId: 'send-files',
    toolName: 'SendUserFile',
    result: DELIVERY as never,
  });
  assert.equal(resolveToolRendererId(item), 'user_file_delivery');
  // The card strip is the block; a row that opened to the same cards would be
  // the same sentence twice.
  assert.equal(canExpandTool(item), false);
  // Its step names what was shared.
  assert.equal(toolStepLabel(item, 'en').text, 'Shared 2 files');
});

test('a delivery draws one row card per file: a sentence, a kind line, and nothing else', () => {
  const item = call({
    toolUseId: 'send-files',
    toolName: 'SendUserFile',
    result: DELIVERY as never,
  });
  const document = renderTree(
    createElement(
      Fragment,
      null,
      renderToolContent(item, {
        ...CONTEXT,
        onOpenArtifact: () => {},
        onShowDeliveredFile: () => {},
      }),
    ),
  );
  const text = document.documentElement.textContent ?? '';

  // The name is the filename made readable, and the line under it is the
  // category and the extension — measured off the reference's cards.
  assert.ok(text.includes('Plan'), `the title is a sentence, not a filename: ${text}`);
  assert.ok(text.includes('Document · MD'), `the kind line is the word and the extension: ${text}`);
  assert.ok(text.includes('Image · PNG'), text);
  assert.ok(!text.includes('plan.md'), 'the raw filename is not the title');

  // Three things the reference does NOT draw in the transcript, and neither
  // does this: the caption, the status, and the byte size.
  assert.ok(!text.includes('The two drafts, side by side.'), 'the caption is not drawn');
  assert.ok(!text.includes('Sent unprompted'), 'the status is not drawn');
  assert.ok(!/\d\s?KB/u.test(text), `the size is not drawn: ${text}`);

  // Opening a card is what the card is for, so it is a real button with a
  // name of its own, and the two file actions are reachable.
  const labels = [...document.querySelectorAll('button')].map((button) =>
    button.getAttribute('aria-label'),
  );
  assert.ok(labels.includes('Open plan.md in Files'), labels.join(', '));
  // ONE action, named by the platform's own file manager. No app list: the
  // file is in the user's project, so the platform's "Open With" already has
  // one, maintained by the system.
  assert.ok(/Show in (Finder|Explorer|file manager)/u.test(text), text);
  assert.ok(!text.includes('Save'), `the file is already on this machine: ${text}`);
});

test('display: render opens the pane on the first file, but only while the turn is live', () => {
  // History must not move the pane: a session full of old deliveries would
  // take it away from whatever the reader had put there.
  assert.equal(deliveryAutoOpenTarget({ result: DELIVERY as never, live: false }), undefined);
  // The first card is the one opened — the same file `display`'s own default
  // was decided from.
  assert.equal(deliveryAutoOpenTarget({ result: DELIVERY as never, live: true }), 'artifact-1');
  // `attach` is the model saying a preview would be noise.
  assert.equal(
    deliveryAutoOpenTarget({ result: { ...DELIVERY, display: 'attach' } as never, live: true }),
    undefined,
  );
  assert.equal(deliveryAutoOpenTarget({ result: undefined, live: true }), undefined);
});

test('a delivery with no way into the Files face draws labels, not dead buttons', () => {
  const item = call({
    toolUseId: 'send-files',
    toolName: 'SendUserFile',
    result: DELIVERY as never,
  });
  const document = renderTree(createElement(Fragment, null, renderToolContent(item, CONTEXT)));
  // Not a disabled button — no button at all. The card is a label, and the
  // name and kind still read, because that is the half of it that always works.
  assert.equal(document.querySelectorAll('button').length, 0);
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes('Plan') && text.includes('Document · MD'), text);
});

test('delivered files gather at the foot of the turn and stay a step of their run; a message is prose where it was said', () => {
  const work = call({ toolUseId: 'read-1', activityKind: 'read' });
  const files = call({
    toolUseId: 'send-files',
    toolName: 'SendUserFile',
    result: DELIVERY as never,
  });
  const message = call({
    toolUseId: 'message-1',
    toolName: 'SendUserMessage',
    result: { kind: 'user_message', message: 'Two things:\n- a\n- b' } as never,
  });
  const grouped = groupTurnTimeline(
    [{ kind: 'tools', items: [work, files, message] }],
    () => false,
  );
  // The files were sent FIRST and come LAST: the reader meets the turn as a
  // finished thing, and cards wedged between two paragraphs read as an
  // interruption of the answer rather than as what it hands over. The message
  // is words addressed to the reader, where they were said.
  assert.deepEqual(
    grouped.map((entry) => entry.kind),
    ['status', 'text', 'delivery'],
  );
  const run = grouped[0]!;
  assert.ok(run.kind === 'status');
  assert.deepEqual(
    run.steps.map((step) => (step.kind === 'tool' ? step.item.toolUseId : step.kind)),
    ['read-1', 'send-files'],
    'the delivery is still a step of the work ("Shared a file"), and the message is not',
  );
  const prose = grouped[1]!;
  assert.ok(prose.kind === 'text' && prose.fromSendUserMessage === true);
  assert.equal((grouped[2] as { item: ToolActivityItem }).item.toolUseId, 'send-files');
});

test('a turn lays a delivery out beside its prose, the way a text entry stands', () => {
  const files = call({
    toolUseId: 'send-files',
    toolName: 'SendUserFile',
    result: DELIVERY as never,
  });
  const turn: TurnViewModel = {
    turnId: 'turn-delivery',
    status: 'completed',
    user: { id: 'user-1', role: 'user', text: 'Send me the drafts' },
    tools: [files],
    timeline: [
      { kind: 'tools', items: [files] },
      { kind: 'text', text: 'Here they are.', messageId: 'step-1', complete: true },
    ],
    notes: [],
  } as unknown as TurnViewModel;
  const document = renderTree(
    createElement(TranscriptTurn, {
      turn,
      live: false,
      footerActions: [],
      toolContext: CONTEXT,
      onFooterAction: () => {},
      onOpenLineage: () => {},
      onOpenExternal: () => {},
    }),
  );
  const block = document.querySelector('[data-maka-delivery="send-files"]');
  assert.ok(block, 'the delivery is a block of the turn');
  assert.equal(
    document.querySelector('[data-maka-turn-status] [data-maka-delivery]'),
    null,
    'and never inside the collapsed step list',
  );
  assert.ok(block.querySelector('[data-maka-file-delivery="proactive"]'));
});

test('a malformed delivery drops the files it cannot open rather than drawing dead cards', () => {
  const read = readUserFileDelivery({
    kind: 'user_file_delivery',
    status: 'normal',
    display: 'attach',
    files: [{ name: 'orphan.txt', sizeBytes: 4 }, DELIVERY.files[0]],
  } as never);
  assert.deepEqual(
    read?.files.map((file) => file.name),
    ['plan.md'],
  );
  assert.equal(read?.status, 'normal');
  assert.equal(read?.display, 'attach');
  // A blank message is not a message; the block would be a label over nothing.
  assert.equal(readUserMessage({ kind: 'user_message', message: '   ' } as never), undefined);
});

// ── Grep / Glob ────────────────────────────────────────────────────────────

test('a Grep result is recognised by its shape, not by the tool that produced it', () => {
  const item = call({
    toolUseId: 'grep-1',
    toolName: 'mcp__search__find',
    activityKind: 'search',
    result: { kind: 'json', value: { matches: ['src/a.ts:12:const x = 1'], mode: 'content' } },
  });
  assert.equal(resolveToolRendererId(item), 'grep');
  // Read keeps the JSON renderer: `{ content }` has no list in it.
  assert.equal(
    resolveToolRendererId(
      call({
        toolUseId: 'read-1',
        toolName: 'Read',
        result: { kind: 'json', value: { content: 'hello' } },
      }),
    ),
    'json',
  );
  assert.equal(
    readGrepResult({ matches: [1] }),
    undefined,
    'a list of non-strings is not a hit list',
  );
  assert.equal(readGlobResult({ files: ['a', 'b'], truncated: true })?.truncated, true);
});

test('a Grep panel is one row per hit, the path a link and the line beside it', () => {
  const item = call({
    toolUseId: 'grep-1',
    toolName: 'Grep',
    activityKind: 'search',
    result: {
      kind: 'json',
      value: {
        matches: ['src/a.ts:12:const x = 1', 'src/b.ts:3:const y = 2'],
        mode: 'content',
        truncated: true,
        omitted: 7,
      },
    },
  });
  const document = renderTree(
    createElement(Fragment, null, renderToolContent(item, { ...CONTEXT, onOpenFile: () => {} })),
  );
  const rows = [...document.querySelectorAll('[data-maka-search-row]')].map((row) =>
    row.getAttribute('data-maka-search-row'),
  );
  assert.deepEqual(rows, ['src/a.ts', 'src/b.ts'], 'the path is its own element, and is the link');
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes(':12'), 'the line number follows the path');
  assert.ok(text.includes('const x = 1'), 'and the matching text follows that');
  assert.ok(text.includes('7 more omitted'), 'a capped list says what it dropped');
  const names = [...document.querySelectorAll('button')].map((button) =>
    button.getAttribute('aria-label'),
  );
  assert.ok(names.includes('Open src/a.ts in Files'), names.join(', '));
});

test('a Glob panel lists paths, and says so when nothing matched', () => {
  const listed = renderTree(
    createElement(
      Fragment,
      null,
      renderToolContent(
        call({
          toolUseId: 'glob-1',
          toolName: 'Glob',
          activityKind: 'search',
          result: { kind: 'json', value: { files: ['a/b.ts'], truncated: true } },
        }),
        { ...CONTEXT, onOpenFile: () => {} },
      ),
    ),
  );
  assert.equal(listed.querySelector('[data-maka-search-row]')?.textContent, 'a/b.ts');
  assert.ok((listed.documentElement.textContent ?? '').includes('omitted'));

  const empty = renderTree(
    createElement(
      Fragment,
      null,
      renderToolContent(
        call({
          toolUseId: 'glob-2',
          toolName: 'Glob',
          result: { kind: 'json', value: { files: [] } },
        }),
        CONTEXT,
      ),
    ),
  );
  assert.ok((empty.documentElement.textContent ?? '').includes('No files matched.'));
});

test('a ripgrep line splits at the colon before its line number, not at the first one', () => {
  assert.deepEqual(parseGrepRow('C:\\src\\a.ts:12:let x', 'content'), {
    path: 'C:\\src\\a.ts',
    line: 12,
    text: 'let x',
  });
  assert.deepEqual(parseGrepRow('src/a.ts:4', 'count'), { path: 'src/a.ts', count: 4 });
  assert.deepEqual(parseGrepRow('src/a.ts', 'files_with_matches'), { path: 'src/a.ts' });
  // A line that does not fit the mode's shape stays whole rather than being
  // cut in a place that means nothing.
  assert.deepEqual(parseGrepRow('no colons here', 'content'), { path: 'no colons here' });
});

// ── row labels ─────────────────────────────────────────────────────────────

test('a described Bash or Agent call shows the description, and nothing else does', () => {
  const bash = call({
    toolUseId: 'bash-1',
    toolName: 'Bash',
    activityKind: 'command',
    args: { command: 'npm run typecheck --workspace @maka/desktop', description: 'Typecheck  it' },
  });
  assert.equal(toolRowTitle(bash, 'en'), 'Typecheck it', 'whitespace is flattened to one line');
  // No description: the command itself, exactly as before.
  assert.equal(
    toolRowTitle(call({ ...bash, args: { command: 'npm run typecheck' } }), 'en'),
    'npm run typecheck',
  );
  assert.equal(
    toolRowDescription(
      call({ toolUseId: 'a', toolName: 'Agent', args: { description: 'Review the diff' } }),
    ),
    'Review the diff',
  );
  // An MCP tool's `description` is the tool's own documentation echoed back
  // into the call; as a row label every call of it would read identically.
  assert.equal(
    toolRowDescription(
      call({ toolUseId: 'm', toolName: 'mcp__x__y', args: { description: 'Search the wiki' } }),
    ),
    undefined,
  );
  // A description long enough to wrap is cut, because a two-line step row
  // pushes every row under it down.
  const long = toolRowDescription(
    call({ toolUseId: 'b', toolName: 'Bash', args: { description: 'x'.repeat(400) } }),
  );
  assert.equal(long?.length, 201);
  assert.ok(long?.endsWith('…'));
});

// ── the question shape ─────────────────────────────────────────────────────

const QUESTIONS = [
  {
    question: 'Which draft should ship?',
    header: 'Release',
    options: [
      { label: 'The short one', description: 'Two paragraphs' },
      { label: 'The long one', description: 'Three pages' },
    ],
  },
  {
    question: 'Who should review it?',
    header: 'Reviewers',
    multiSelect: true,
    options: [{ label: 'Ana' }, { label: 'Bo' }, { label: 'Cy' }],
  },
];

test('a question is read with its header and its multi-select flag', () => {
  const read = readUserQuestions({ questions: QUESTIONS });
  assert.equal(read.length, 2);
  assert.equal(read[0]?.header, 'Release');
  assert.equal(read[0]?.options[0]?.description, 'Two paragraphs');
  assert.equal(read[0]?.multiSelect, undefined);
  assert.equal(read[1]?.multiSelect, true);
  // An option with no label cannot be picked, so it is not drawn.
  assert.deepEqual(
    readUserQuestions({
      questions: [{ question: 'Q', header: 'H', options: [{ description: 'x' }] }],
    })[0]?.options,
    [],
  );
  // Anything that is not a question at all reads as no questions, never as a
  // blank one — a blank row in the panel is a row the user cannot answer. A
  // question with no header is one of those: the panel does not draw the
  // header, but the tool requires it, so a question missing it is malformed.
  assert.deepEqual(readUserQuestions({ questions: ['just a string'] }), []);
  assert.deepEqual(readUserQuestions({ questions: [{ question: 'Q', options: [] }] }), []);
});

test('a multi-select draft collects several labels and a single-select draft holds one', () => {
  const questions = readUserQuestions({ questions: QUESTIONS });
  const drafts: QuestionDraft[] = createQuestionDrafts(questions);
  assert.equal(drafts.length, 2);
  assert.equal(drafts.filter((draft) => draft !== null).length, 0, 'a fresh panel answers nothing');

  drafts[0] = { kind: 'option', optionIndex: 1 };
  let multi = toggleDraftOption(null, 2);
  multi = toggleDraftOption(multi, 0);
  drafts[1] = multi;
  assert.equal(draftHasOption(multi, 0), true);
  assert.equal(draftHasOption(multi, 1), false);
  assert.deepEqual(
    draftAnswer(questions[1], multi),
    ['Ana', 'Cy'],
    'in option order, not click order',
  );

  const response = buildUserQuestionResponse({ requestId: 'req-1' }, questions, drafts);
  assert.deepEqual(response, {
    requestId: 'req-1',
    answers: ['The long one', ['Ana', 'Cy']],
  } as never);

  // Un-ticking the last option is "no answer", not an empty list.
  assert.equal(toggleDraftOption(toggleDraftOption(null, 1), 1), null);
  // A blank free-text answer cannot be paged away from; a picked option can.
  assert.equal(canLeaveQuestion({ kind: 'other', value: '  ' }), false);
  assert.equal(canLeaveQuestion({ kind: 'other', value: 'neither' }), true);
  assert.equal(canLeaveQuestion(null), true);
  assert.deepEqual(
    buildUserQuestionResponse({ requestId: 'req-2' }, questions, [null, null]).answers,
    [null, null],
  );
});

test('the settled record shows every answer given, and never the header', () => {
  const item = call({
    toolUseId: 'ask-1',
    toolName: 'AskUserQuestion',
    args: { questions: QUESTIONS },
    result: {
      kind: 'json',
      value: { answers: [{ answer: 'The long one' }, { answer: ['Ana', 'Cy'] }] },
    },
  });
  const document = renderTree(createElement(AskUserQuestionRecord, { item }));
  const card = document.querySelector('[data-maka-ask-user-record="ask-1"]');
  assert.ok(card);
  const text = card.textContent ?? '';
  assert.ok(text.includes('Which draft should ship?'));
  assert.ok(text.includes('The long one'));
  assert.ok(text.includes('Ana') && text.includes('Cy'), 'both picks survive');
  // The header is the model's index term, not copy. It is carried in the
  // shape and in the persisted result, and drawn nowhere.
  assert.ok(!text.includes('Release'), 'the header is not drawn');
  assert.ok(!text.includes('Reviewers'), 'not for a multi-select question either');
});

test('an unanswered question says so rather than showing the Host’s words to the model', () => {
  const item = call({
    toolUseId: 'ask-2',
    toolName: 'AskUserQuestion',
    args: { questions: [QUESTIONS[0]] },
    result: { kind: 'text', text: 'The user did not answer; proceed with your best judgment.' },
  });
  const document = renderTree(createElement(AskUserQuestionRecord, { item }));
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes('No answer'));
  assert.ok(!text.includes('best judgment'));
});

// ── the session panel's progress rows ───────────────────────────────────────

const TASKS = [
  {
    id: '1',
    subject: 'Read the spec',
    description: 'Read it end to end',
    status: 'completed' as const,
    blocks: ['3'],
    blockedBy: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: '2',
    subject: 'Write the adapter',
    description: 'Port the four tools',
    status: 'in_progress' as const,
    activeForm: 'Writing the adapter',
    blocks: [],
    blockedBy: [],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: '3',
    subject: 'Run the suite',
    description: 'Every workspace',
    status: 'pending' as const,
    blocks: [],
    blockedBy: ['1', '2'],
    createdAt: 0,
    updatedAt: 0,
  },
];

test('a completed blocker stops blocking, so only the open ones are named', () => {
  assert.deepEqual(openBlockersOf(TASKS, TASKS[2]!), ['2']);
  assert.deepEqual(openBlockersOf(TASKS, TASKS[0]!), []);
});

test('a running task shows its active form, and a finished one keeps its subject', () => {
  const document = renderTree(
    createElement(
      'div',
      null,
      TASKS.map((task) =>
        createElement(TaskProgressRow, {
          key: task.id,
          task,
          blockedBy: openBlockersOf(TASKS, task),
        }),
      ),
    ),
  );
  const rows = [...document.querySelectorAll('[data-maka-task-id]')];
  assert.equal(rows.length, 3);

  // Completed: a neutral check marks the finished step; the subject stays readable.
  assert.equal(rows[0]?.getAttribute('data-maka-task-status'), 'completed');
  assert.ok(rows[0]?.querySelector('[data-anthropicon="checkCircleFilled"]'));
  assert.equal(rows[0]?.querySelector('.line-through'), null);

  // Running: the badge keeps the id, and the label is the active form.
  const running = rows[1]?.textContent ?? '';
  assert.ok(running.includes('Writing the adapter'));
  assert.ok(!running.includes('Write the adapter'));

  // Pending and blocked: the note names only the blocker that still stands.
  const blocked = rows[2]?.textContent ?? '';
  assert.ok(blocked.includes('Run the suite'));
  assert.ok(blocked.includes('blocked by #2'), blocked);
  assert.ok(!blocked.includes('#1'), blocked);
});

test('activity folds earlier completed steps while keeping ongoing and blocked work visible', () => {
  const tasks = [
    { ...TASKS[0]!, id: '1' },
    { ...TASKS[1]!, id: '2' },
    { ...TASKS[2]!, id: '3' },
    { ...TASKS[0]!, id: '4' },
    { ...TASKS[0]!, id: '5' },
  ];
  const document = renderTree(
    createElement(ProgressSteps, { tasks, copy: getSessionPanelCopy('en') }),
  );
  assert.ok(document.querySelector('[data-maka-task-id="1"]')?.closest('[inert]'));
  for (const id of ['2', '3', '4', '5'])
    assert.ok(document.querySelector(`[data-maka-task-id="${id}"]`));
  assert.ok(
    document
      .querySelector('button[aria-expanded="false"]')
      ?.textContent?.startsWith('1 earlier step'),
  );
});
