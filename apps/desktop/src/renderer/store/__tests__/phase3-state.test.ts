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

// Phase 3a state: the transcript's decisions, taken without a DOM.
//
// The renderer counterpart — a `TurnViewModel` rendered to markup — lives in
// `presentation.test.tsx`. Everything here is pure or bridge-fed, so the tool
// registry's resolution, the turn presentation's caching, the revision draft's
// transitions and the queue's reordering are all exercised as values.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOOL_ACTIVITY_KINDS,
  type ToolActivityKind,
  type ToolResultContent,
} from '@maka/core/events';
import type { StoredMessage, TurnStatus } from '@maka/core/session';
import type { ToolActivityItem, TurnViewModel } from '@maka/ui';
import { diffSyntaxTokens, parseMcpToolName } from '@maka/ui';
import { createRevisionDraftStore, revisionCopyId, revisionRefusalFor } from '../revision-draft.js';
import { createContextUsageStore, projectContextUsage } from '../context-usage-store.js';
import { createComposerDraftStore } from '../composer-draft-store.js';
import {
  followupOrder,
  queueOrderAfterMove,
  reorderQueue,
} from '../../components/session/MessageQueue.js';
import { deriveTurnActive, retainRunningTurnIds } from '../../lib/ported/model-wait-state.js';
import {
  activeToolLabel,
  canExpandTool,
  rendererForResultKind,
  resolveToolRendererId,
  summarizeToolGroup,
  toolActivityIcon,
  toolRowIcon,
  toolRowMeta,
  toolRowFailure,
  toolRowStatus,
  toolRowStatusLabel,
  toolRowTitle,
} from '../../components/session/tools/tool-presentation.js';
import {
  memoryBreadcrumb,
  parseMemoryListResult,
  parseMemoryReadResult,
} from '../../lib/memory-tool-results.js';
import {
  askUserQuestionRecord,
  isAskUserQuestionTool,
  knownUserQuestionCalls,
  rememberedUserQuestionRecord,
} from '../../lib/ask-user-question.js';
import {
  createTurnPresentationDerivation,
  pendingTurnActionKey,
} from '../../hooks/use-turn-presentation.js';

// ── fixtures ────────────────────────────────────────────────────────────────

function tool(overrides: Partial<ToolActivityItem> = {}): ToolActivityItem {
  return {
    toolUseId: 'tool-1',
    toolName: 'Bash',
    activityKind: 'command',
    status: 'completed',
    args: { command: 'ls' },
    ...overrides,
  };
}

function turn(overrides: Partial<TurnViewModel> = {}): TurnViewModel {
  return {
    turnId: 'turn-1',
    status: 'completed' as TurnStatus,
    tools: [],
    timeline: [],
    notes: [],
    startedAt: 0,
    ...overrides,
  };
}

function userMessage(
  overrides: Record<string, unknown> = {},
): Extract<StoredMessage, { type: 'user' }> {
  return {
    type: 'user',
    id: 'message-1',
    turnId: 'turn-1',
    ts: 0,
    text: 'hello',
    ...overrides,
  } as unknown as Extract<StoredMessage, { type: 'user' }>;
}

// ── tool registry ───────────────────────────────────────────────────────────

const RESULT_KINDS: readonly ToolResultContent['kind'][] = [
  'text',
  'json',
  'file_diff',
  'file_write',
  'archived_tool_result',
  'terminal',
  'shell_run',
  'image',
  'summary',
  'web_search',
  'web_search_error',
  'subagent',
  'agent_swarm',
  'rive_workflow',
];

test('every result kind the runtime can emit resolves to a renderer', () => {
  for (const kind of RESULT_KINDS) {
    const id = rendererForResultKind(kind);
    assert.ok(id !== 'none' && id !== 'pending', `${kind} fell through to ${id}`);
  }
  // The two shell shapes share one renderer; that is the point of keying on
  // result kind rather than on tool name.
  assert.equal(rendererForResultKind('terminal'), rendererForResultKind('shell_run'));
});

test('every activity kind has an icon and a summary phrase', () => {
  for (const kind of TOOL_ACTIVITY_KINDS) {
    assert.ok(toolActivityIcon(kind).length > 0, `${kind} has no icon`);
    const summary = summarizeToolGroup([tool({ activityKind: kind })], 'en');
    assert.ok(summary.length > 0, `${kind} has no summary`);
  }
  assert.equal(toolActivityIcon(undefined), 'tool');
});

// The reference gives a glyph per TOOL; an activity kind is one bucket wider
// than that, and reading the icon off the kind is what put a pencil on Write and
// a plain page on Read. Each pair below shares a kind and must not share a glyph.
test('follows the reference glyph where a kind is too coarse for it', () => {
  const t = (toolName: string, activityKind?: ToolActivityItem['activityKind']) =>
    tool({ toolUseId: toolName, toolName, ...(activityKind ? { activityKind } : {}) });

  assert.equal(toolRowIcon(t('Write', 'edit')), 'note');
  assert.equal(toolRowIcon(t('Edit', 'edit')), 'edit');
  assert.equal(toolRowIcon(t('Read', 'read')), 'code');
  assert.equal(toolRowIcon(t('ArchiveRead', 'read')), 'file');
  assert.equal(toolRowIcon(t('ToolSearch')), 'connectors');
  assert.equal(toolRowIcon(t('Skill')), 'scroll');
  assert.equal(toolRowIcon(t('SendUserFile')), 'file');
  assert.equal(toolRowIcon(t('WebFetch', 'webfetch')), 'globe');
  assert.equal(toolRowIcon(t('Agent', 'delegate')), 'agent');
});

// The reference has no scheduled task, so this one follows Maka's own: the
// sidebar entry, the module, the detail chip and the card this very call draws
// all wear a clock. A calendar on the row contradicted the card beside it.
test('a scheduled task row wears the clock the rest of the app wears', () => {
  assert.equal(
    toolRowIcon(
      tool({ toolUseId: 's', toolName: 'ScheduledTaskCreate', activityKind: 'schedule' }),
    ),
    'clock',
  );
});

// A collapsed group is all a finished turn shows of its work. Every one of
// these families used to land in the generic bucket and report "Called a tool"
// under a generic wrench — a turn that handed work to a subagent said nothing
// about it at all.
test('names the work of the families that had no activity kind', () => {
  const delegated = tool({ toolUseId: 'a', toolName: 'Agent', activityKind: 'delegate' });
  assert.equal(summarizeToolGroup([delegated], 'en'), 'Delegated a task');
  assert.equal(toolRowIcon(delegated), 'agent');

  const scheduled = tool({
    toolUseId: 'b',
    toolName: 'ScheduledTaskUpdate',
    activityKind: 'schedule',
  });
  assert.equal(summarizeToolGroup([scheduled], 'en'), 'Scheduled a task');
  assert.equal(toolRowIcon(scheduled), 'clock');

  // The question is decided by the request registry, not by a kind: a live one
  // carries no tool name, so a kind would leave it generic for the whole wait
  // and change the glyph under the reader the moment it settled.
  const named = tool({ toolUseId: 'c', toolName: 'AskUserQuestion' });
  const liveAndNameless = tool({ toolUseId: 'q', toolName: 'Tool' });
  knownUserQuestionCalls.setState({ byToolUseId: { q: { questions: [] } } });
  try {
    for (const item of [named, liveAndNameless]) {
      assert.equal(summarizeToolGroup([item], 'en'), 'Asked a question');
      assert.equal(toolRowIcon(item), 'questionCircle');
    }
    // One mechanism, not two: the live header reads the same key.
    assert.equal(
      activeToolLabel([{ ...named, status: 'running' }], 'en'),
      'Asking you a question…',
    );
  } finally {
    knownUserQuestionCalls.setState({ byToolUseId: {} });
  }
});

test('a row with no result yet renders what was asked for, not an empty result', () => {
  assert.equal(resolveToolRendererId(tool({ status: 'running', result: undefined })), 'pending');
  // A settled call with no result at all has nothing to open.
  assert.equal(resolveToolRendererId(tool({ status: 'interrupted', result: undefined })), 'none');
  assert.equal(canExpandTool(tool({ status: 'interrupted', result: undefined })), false);
});

test('a completed write says everything in its header, so it does not open', () => {
  const item = tool({
    activityKind: 'edit',
    result: { kind: 'file_write', path: 'a.ts', bytes: 12 },
  });
  assert.equal(resolveToolRendererId(item), 'file_write');
  assert.equal(canExpandTool(item), false);
});

// The three grades, and what each one changes. This used to be a test about
// the sandbox alone, because the sandbox was the only failure the row could
// tell apart from any other.
test('a failed row is graded, and only a boundary offers a way past it', () => {
  const denied = tool({
    status: 'errored',
    failure: { kind: 'denied', class: 'sandbox_denial', message: 'the sandbox said no' },
    result: { kind: 'text', text: 'nope' },
  });
  assert.deepEqual(toolRowFailure(denied), {
    kind: 'denied',
    tone: 'warning',
    class: 'sandbox_denial',
    message: 'the sandbox said no',
    remedy: 'raise_permission',
  });

  // A rule that said no: the work did not happen, but nothing is broken and
  // there is no control that would change it.
  const refused = tool({
    status: 'errored',
    failure: { kind: 'refused', class: 'LoopGate', message: 'stop repeating this call' },
    result: { kind: 'text', text: 'nope' },
  });
  assert.equal(toolRowFailure(refused)?.tone, 'warning');
  assert.equal(toolRowFailure(refused)?.remedy, undefined);

  // Unannotated reads as `failed` — an imported session, or a Host that
  // predates the envelope, is drawn exactly as it was before it existed.
  const bare = tool({ status: 'errored', result: { kind: 'text', text: 'nope' } });
  assert.deepEqual(toolRowFailure(bare), { kind: 'failed', tone: 'danger' });

  // The lifecycle no longer carries the failure's kind at all.
  assert.equal(toolRowStatus(denied), 'errored');
  // Neither a success nor a stop is a failure.
  assert.equal(toolRowFailure(tool({ status: 'completed' })), undefined);
  assert.equal(toolRowFailure(tool({ status: 'interrupted' })), undefined);
});

// The reason has to be reachable while the turn is still running, which is
// exactly when the Host omits the result body.
test('a live failure is readable before its result body arrives', () => {
  const live = tool({
    status: 'errored',
    failure: { kind: 'failed', class: 'exit_1', message: 'ENOSPC: no space left on device' },
    result: undefined,
  });
  assert.equal(canExpandTool(live), true);
  assert.equal(toolRowFailure(live)?.message, 'ENOSPC: no space left on device');
});

// A background command inherited from another session. `shellRunSource` was
// computed all the way to the row and then read by nobody, so all three cases
// drew identically — including the one where the owner cannot be resolved and
// the overlay falls back to the transcript's snapshot, which says `running`
// and always will. That row shimmered for the rest of the session over a
// process nobody here could see: the same shape as a detached Agent's row.
test('an inherited background command says whose it is, and settles when it is lost', () => {
  const run = (status: string) =>
    ({
      kind: 'shell_run',
      ref: 'r1',
      status,
      cwd: '/w',
      cmd: 'npm run dev',
      startedAt: 0,
      updatedAt: 1,
      revision: 2,
      mode: 'pipes',
      output: {
        mode: 'pipes',
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        redacted: false,
      },
    }) as never;
  const inherited = (source: ToolActivityItem['shellRunSource'], status = 'running') =>
    tool({
      toolName: 'Bash',
      status: 'completed',
      result: run(status),
      ...(source ? { shellRunSource: source } : {}),
    });

  // Ours: watched, and nothing to say about it.
  assert.equal(toolRowStatus(inherited(undefined)), 'running');
  assert.equal(toolRowStatusLabel(inherited(undefined), 'en'), undefined);

  // Someone else's, and still reachable: it really is running, so the row
  // keeps running — its owner publishes updates and it will settle on its own.
  assert.equal(toolRowStatus(inherited('owned')), 'running');
  assert.equal(toolRowStatusLabel(inherited('owned'), 'en'), 'Running elsewhere');

  // Someone else's and out of reach: nothing will ever update this row, so it
  // must not go on claiming to watch it. `interrupted` is the honest word
  // available — our view stopped, not necessarily the command — and the label
  // is what keeps that from reading as "the command was interrupted".
  assert.equal(toolRowStatus(inherited('unavailable')), 'interrupted');
  assert.equal(toolRowStatusLabel(inherited('unavailable'), 'en'), 'Lost track of it');

  // A run that already ended carries no badge: the fold only marks live ones,
  // and a settled row must not be relabelled by a stale source.
  assert.equal(toolRowStatus(inherited(undefined, 'completed')), 'completed');
});

test('a shell run reads its presentation status from the run, not the call', () => {
  const running = tool({
    toolName: 'Bash',
    status: 'completed',
    result: {
      kind: 'shell_run',
      ref: 'run-1',
      status: 'running',
      cwd: '/w',
      cmd: 'sleep 1',
      startedAt: 0,
      updatedAt: 0,
      revision: 1,
      mode: 'pipes',
    } as ToolResultContent,
  });
  assert.equal(toolRowStatus(running), 'running');
});

test('the task summary names the verb, and never a call count', () => {
  // Four tools share one activity kind because they share an icon. Two of them
  // only read, and one call now carries one task — so counting calls would both
  // report work that never happened and make a six-task plan read as churn.
  const taskTool = (toolUseId: string, toolName: string) =>
    tool({ toolUseId, toolName, activityKind: 'tasks', args: {} });

  const created = summarizeToolGroup(
    [
      taskTool('a', 'TaskCreate'),
      taskTool('b', 'TaskCreate'),
      taskTool('c', 'TaskCreate'),
      taskTool('d', 'TaskUpdate'),
    ],
    'en',
  );
  assert.equal(created, 'Updated tasks');

  // Reads are their own phrase: a turn that only looked did not update anything.
  assert.equal(summarizeToolGroup([taskTool('e', 'TaskList')], 'en'), 'Checked tasks');
  assert.equal(
    summarizeToolGroup([taskTool('f', 'TaskGet'), taskTool('g', 'TaskGet')], 'en'),
    'Checked tasks',
  );

  // Both in one group: two phrases, still no numbers.
  const mixed = summarizeToolGroup(
    [taskTool('h', 'TaskCreate'), taskTool('i', 'TaskUpdate'), taskTool('j', 'TaskList')],
    'en',
  );
  assert.ok(mixed.includes('Updated tasks'), mixed);
  assert.ok(mixed.toLowerCase().includes('checked tasks'), mixed);
  assert.doesNotMatch(mixed, /\d/, mixed);

  // A running read says it is reading, not updating.
  assert.equal(
    activeToolLabel([{ ...taskTool('k', 'TaskList'), status: 'running' }], 'en'),
    'Checking progress',
  );
});

// ── memory rows ─────────────────────────────────────────────────────────────

const memoryTool = (
  toolUseId: string,
  toolName: string,
  overrides: Partial<ToolActivityItem> = {},
) =>
  tool({
    toolUseId,
    toolName,
    activityKind: toolName === 'MemoryList' || toolName === 'MemoryRead' ? 'read' : 'edit',
    args: { path: '/topics/food.md' },
    ...overrides,
  });

test('a memory tool is its own renderer, by name, with its own icon', () => {
  for (const name of [
    'MemoryList',
    'MemoryRead',
    'MemoryWrite',
    'MemoryStrReplace',
    'MemoryAppend',
    'MemoryDelete',
  ]) {
    const item = memoryTool('m', name, { result: { kind: 'text', text: 'Saved /topics/food.md' } });
    assert.equal(resolveToolRendererId(item), 'memory', name);
    assert.equal(toolRowIcon(item), 'memory', name);
  }
});

test('a memory row says the verb and the file, running and settled', () => {
  const running = memoryTool('a', 'MemoryRead', { status: 'running', result: undefined });
  assert.equal(toolRowTitle(running, 'en'), 'Reading food.md');
  assert.equal(toolRowTitle(running, 'zh-CN'), '正在读取 food.md');
  const read = memoryTool('b', 'MemoryRead', {
    result: {
      kind: 'text',
      text: '[updated: 2026-09-18T01:00:00+00:00] [version: abc]\n- [stated] tea',
    },
  });
  assert.equal(toolRowTitle(read, 'en'), 'Read food.md');
  assert.equal(toolRowMeta(read, 'en'), 'Topics › Food');
  const several = memoryTool('c', 'MemoryRead', {
    args: { path: ['/topics/food.md', '/people/sam.md'] },
    result: { kind: 'text', text: '== /topics/food.md ==\nx' },
  });
  assert.equal(toolRowTitle(several, 'en'), 'Read 2 files');
  assert.equal(toolRowMeta(several, 'en'), undefined);
  const listed = memoryTool('d', 'MemoryList', {
    args: { path_prefix: '/topics/' },
    result: {
      kind: 'text',
      text: '/topics/food.md  (21 bytes, updated 2026-09-18T01:00:00+00:00)\n/topics/music.md  (30 bytes, updated 2026-09-18T01:00:00+00:00)',
    },
  });
  assert.equal(toolRowTitle(listed, 'en'), 'Searched memory');
  assert.equal(toolRowMeta(listed, 'en'), 'Topics · 2 files');
  assert.equal(toolRowTitle(memoryTool('e', 'MemoryDelete'), 'zh-TW'), '刪除了 food.md');
});

// The status line under the transcript names the call in flight. A call the
// MODEL labelled says what it is doing; "Running a command" was the same
// sentence for every command in the session. Computer Use already worked this
// way (`deriveTurnActivity` lets a running action name its target ahead of the
// generic phrase) — this is that rule stopping being a one-family exception.
test('a running call the model labelled says what it is doing', () => {
  const bash = (args: unknown): ToolActivityItem => ({
    toolUseId: 'bash-1',
    toolName: 'Bash',
    activityKind: 'command',
    status: 'running',
    args,
  });
  assert.equal(
    activeToolLabel(
      [bash({ command: 'npm run typecheck', description: 'Typecheck the renderer' })],
      'en',
    ),
    'Typecheck the renderer',
  );
  // Live, before the arguments land, the preview carries it.
  assert.equal(
    activeToolLabel(
      [
        {
          ...bash(undefined),
          argsPreview: { command: 'npm run t', description: 'Typecheck the renderer' },
        },
      ],
      'en',
    ),
    'Typecheck the renderer',
  );
  // Without one, the generic phrase — it is a fallback, not a replacement.
  assert.equal(activeToolLabel([bash({ command: 'ls -la' })], 'en'), 'Running a command');

  // An MCP tool's `description` is its own documentation echoed into the call,
  // so every call of it would read identically; only Bash and Agent opt in.
  assert.equal(
    activeToolLabel(
      [
        {
          toolUseId: 'mcp-1',
          toolName: 'mcp__docs__search',
          activityKind: 'tool',
          status: 'running',
          args: { description: 'Search the documentation for a topic' },
        },
      ],
      'en',
    ),
    'Using a tool',
  );
});

test('a memory version conflict is a merge in progress, not an error', () => {
  const conflictFailure = {
    kind: 'refused' as const,
    class: 'version_conflict',
    message: '/topics/food.md changed since it was read; the change is being merged and retried.',
  };
  const conflict = memoryTool('a', 'MemoryWrite', {
    status: 'errored',
    failure: conflictFailure,
    result: {
      kind: 'text',
      text: 'MemoryWrite failed: version conflict on /topics/food.md — it changed since you read it.',
    },
  });
  assert.equal(toolRowStatus(conflict), 'completed');
  assert.equal(toolRowTitle(conflict, 'en'), 'Saving food.md');
  assert.equal(toolRowStatusLabel(conflict, 'en'), 'merging…');
  assert.equal(canExpandTool(conflict), false);

  // The same write while it is still live, with no result body at all. Read
  // from the body this said `failed` in danger red until the turn ended and
  // then flipped to "merging…"; the class rides the event, so it cannot.
  const live = memoryTool('a-live', 'MemoryWrite', {
    status: 'errored',
    failure: conflictFailure,
    args: undefined,
    argsPreview: { path: '/memories/topics/food.md' },
    result: undefined,
  });
  assert.equal(toolRowStatus(live), 'completed');
  assert.equal(toolRowFailure(live), undefined);
  assert.equal(toolRowStatusLabel(live, 'en'), 'merging…');
  assert.equal(toolRowTitle(live, 'en'), 'Saving food.md');

  // Delete never retries on its own, so its conflict is the failure it is.
  const deleteConflict = memoryTool('b', 'MemoryDelete', {
    status: 'errored',
    failure: conflictFailure,
    result: { kind: 'text', text: 'MemoryDelete failed: version conflict on /topics/food.md' },
  });
  assert.equal(toolRowStatus(deleteConflict), 'errored');
  // The store worked and said no — a refusal, not something broken.
  assert.equal(toolRowFailure(deleteConflict)?.tone, 'warning');
  // The row says what it set out to do, not what it did — and the reason is
  // the one memory actually gave, not the nearest of six guessed phrases.
  assert.equal(toolRowTitle(deleteConflict, 'en'), 'Delete food.md');
  const missing = memoryTool('c', 'MemoryStrReplace', {
    status: 'errored',
    failure: { kind: 'refused', message: 'old_str not found in /topics/food.md' },
    result: { kind: 'text', text: 'MemoryStrReplace failed: old_str not found in /topics/food.md' },
  });
  assert.equal(toolRowTitle(missing, 'en'), 'Update food.md');
  assert.equal(toolRowTitle(missing, 'zh-CN'), '更新 food.md');
  // A reason matching none of the retired regexes used to be unreachable:
  // "Memory action failed", and the row would not open.
  const full = memoryTool('d', 'MemoryWrite', {
    status: 'errored',
    failure: { kind: 'failed', message: 'ENOSPC: no space left on device' },
    result: { kind: 'text', text: 'MemoryWrite failed: ENOSPC: no space left on device' },
  });
  assert.equal(canExpandTool(full), true);
  assert.equal(toolRowFailure(full)?.message, 'ENOSPC: no space left on device');
  const off = memoryTool('e', 'MemoryList', {
    status: 'errored',
    failure: {
      kind: 'refused',
      message: 'memory is turned off in Settings; nothing was read or saved.',
    },
    result: {
      kind: 'text',
      text: 'MemoryList failed: memory is turned off in Settings; nothing was read or saved.',
    },
  });
  assert.equal(toolRowTitle(off, 'en'), 'Search memory');
  assert.equal(
    toolRowFailure(off)?.message,
    'memory is turned off in Settings; nothing was read or saved.',
  );
});

test('memory verbs merge onto one object in the group summary', () => {
  const items = [
    memoryTool('a', 'MemoryList'),
    memoryTool('b', 'MemoryRead'),
    memoryTool('c', 'MemoryRead'),
    memoryTool('d', 'MemoryStrReplace'),
  ];
  assert.equal(summarizeToolGroup(items, 'en'), 'Searched, read, and updated memory');
  assert.equal(summarizeToolGroup(items, 'zh-CN'), '搜索、读取并更新了记忆');
  assert.equal(summarizeToolGroup(items, 'zh-TW'), '搜尋、讀取並更新了記憶');
  assert.equal(summarizeToolGroup([memoryTool('e', 'MemoryRead')], 'en'), 'Read memory');
  assert.equal(
    summarizeToolGroup([memoryTool('f', 'MemoryRead'), memoryTool('g', 'MemoryAppend')], 'en'),
    'Read and updated memory',
  );
  // Beside other work the merged phrase is one phrase, ordered by its steps.
  assert.equal(
    summarizeToolGroup([...items, tool({ toolUseId: 'h' })], 'en'),
    'Searched, read, and updated memory, ran a command',
  );
  assert.equal(
    activeToolLabel([{ ...memoryTool('i', 'MemoryWrite'), status: 'running' }], 'en'),
    'Saving memory',
  );
});

test('memory results are read as the memory, never the handshake', () => {
  const list = parseMemoryListResult(
    [
      '/topics/food.md  (21 bytes, updated 2026-09-18T01:00:00+00:00)',
      '  what they eat',
      '/people/sam.md  (40 bytes, updated 2026-09-18T02:00:00+00:00)',
      'More files follow; pass cursor="/people/sam.md" to continue.',
    ].join('\n'),
  );
  assert.deepEqual(
    list.map((entry) => [entry.path, entry.byteLength, entry.preview]),
    [
      ['/topics/food.md', 21, 'what they eat'],
      ['/people/sam.md', 40, undefined],
    ],
  );
  assert.equal(list[0]?.updatedAt, Date.parse('2026-09-18T01:00:00+00:00'));
  assert.deepEqual(parseMemoryListResult('(empty)'), []);

  const single = parseMemoryReadResult(
    '[updated: 2026-09-18T01:00:00+00:00] [version: abcdef012345] (pass as if_version on your next MemoryWrite to this path)\n---\nname: food\n---\n- [stated] tea',
  );
  assert.equal(single.length, 1);
  assert.equal(single[0]?.body, '---\nname: food\n---\n- [stated] tea');
  assert.equal(single[0]?.updatedAt, Date.parse('2026-09-18T01:00:00+00:00'));

  const several = parseMemoryReadResult(
    [
      '== /topics/food.md ==',
      '[updated: 2026-09-18T01:00:00+00:00] [version: abcdef012345] (pass as if_version on your next MemoryWrite to this path)',
      '- [stated] tea',
      '',
      '== /people/sam.md ==',
      '<error>MemoryRead failed: not found</error>',
    ].join('\n'),
  );
  assert.deepEqual(
    several.map((doc) => [doc.path, doc.body, doc.error]),
    [
      ['/topics/food.md', '- [stated] tea', undefined],
      ['/people/sam.md', '', 'MemoryRead failed: not found'],
    ],
  );
  assert.equal(memoryBreadcrumb('/areas/design-system.md'), 'Areas › Design System');
});

test('a memory row opens onto its content, and a delete has none', () => {
  assert.equal(canExpandTool(memoryTool('a', 'MemoryDelete')), false);
  assert.equal(
    canExpandTool(memoryTool('b', 'MemoryList', { result: { kind: 'text', text: '(empty)' } })),
    false,
  );
  assert.equal(
    canExpandTool(
      memoryTool('c', 'MemoryList', {
        result: {
          kind: 'text',
          text: '/topics/food.md  (21 bytes, updated 2026-09-18T01:00:00+00:00)',
        },
      }),
    ),
    true,
  );
  assert.equal(
    canExpandTool(
      memoryTool('d', 'MemoryWrite', { args: { path: '/x.md', content: '- [stated] x' } }),
    ),
    true,
  );
  assert.equal(
    canExpandTool(
      memoryTool('e', 'MemoryStrReplace', {
        status: 'running',
        result: undefined,
        args: { path: '/x.md', old_str: 'a', new_str: 'b' },
      }),
    ),
    false,
  );
});

test('a group summary counts by kind and leads with the busiest one', () => {
  const items = [
    tool({ toolUseId: 'a', activityKind: 'read' }),
    tool({ toolUseId: 'b', activityKind: 'command' }),
    tool({ toolUseId: 'c', activityKind: 'command' }),
    tool({ toolUseId: 'd', activityKind: 'command' }),
  ];
  const summary = summarizeToolGroup(items, 'en');
  assert.ok(summary.startsWith('Ran 3 commands'), summary);
  assert.ok(summary.includes('read a file'), summary);
});

test('a question to the user is read back as Q&A, answers aligned by position', () => {
  const ask = tool({
    toolUseId: 'q',
    toolName: 'AskUserQuestion',
    activityKind: undefined,
    args: {
      questions: [
        { question: 'Scope?', header: 'Scope', options: [] },
        { question: 'When?', header: 'Timing', options: [] },
      ],
    },
    result: { kind: 'json', value: { answers: [{ question: 'Scope?', answer: 'Invite only' }] } },
  });
  assert.equal(
    activeToolLabel([tool({ ...ask, status: 'running' })], 'en'),
    'Asking you a question…',
  );
  // A missing answer is no lines, never dropped and never the Host's phrasing.
  assert.deepEqual(askUserQuestionRecord(ask), [
    { question: 'Scope?', header: 'Scope', answers: ['Invite only'] },
    { question: 'When?', header: 'Timing', answers: [] },
  ]);
  // A text result that is JSON reads the same; no result is "not yet", not "no answer".
  assert.deepEqual(
    askUserQuestionRecord({
      ...ask,
      result: { kind: 'text', text: '{"answers":[{"answer":"Now"}]}' },
    })?.[0]?.answers,
    ['Now'],
  );
  assert.equal(askUserQuestionRecord({ ...ask, result: undefined }), undefined);
  // The live copy of the call has no name ("Tool"); the id the request named
  // is what tells it apart, for the whole turn.
  assert.equal(isAskUserQuestionTool({ toolUseId: 'q', toolName: 'Tool' }, {}), false);
  assert.equal(isAskUserQuestionTool({ toolUseId: 'q', toolName: 'Tool' }, { q: {} }), true);
  // What was just sent is kept by the call it answers, for the card to show
  // before the transcript carries the result; open, it shows nothing.
  const scope = [{ question: 'Scope?', header: 'Scope', options: [] }];
  assert.equal(rememberedUserQuestionRecord({ questions: scope }), undefined);
  assert.deepEqual(rememberedUserQuestionRecord({ questions: scope, answers: ['Now'] }), [
    { question: 'Scope?', header: 'Scope', answers: ['Now'] },
  ]);
});

test('a running group says what it is doing now, not what it has done', () => {
  const items = [
    tool({ toolUseId: 'a', activityKind: 'read', status: 'completed' }),
    tool({ toolUseId: 'b', activityKind: 'websearch', status: 'running' }),
  ];
  assert.equal(activeToolLabel(items, 'en'), 'Searching the web');
  assert.equal(activeToolLabel([], 'en'), 'Working on it…');
});

test('a proxied MCP tool name splits back into its server and its tool', () => {
  assert.deepEqual(parseMcpToolName('mcp__github__create_issue'), {
    serverId: 'github',
    toolName: 'create_issue',
  });
  assert.equal(parseMcpToolName('Bash'), undefined);
  assert.equal(parseMcpToolName('mcp__onlyserver'), undefined);
});

test('a row title prefers the invocation line over the bare tool name', () => {
  const title = toolRowTitle(tool({ toolName: 'Read', args: { file_path: 'src/a.ts' } }), 'en');
  assert.ok(title.length > 0);
  // Falls back to the display name when nothing formats.
  assert.equal(toolRowTitle(tool({ toolName: 'Mystery', args: undefined }), 'en'), 'Mystery');
});

// ── diff syntax ─────────────────────────────────────────────────────────────

test('the diff tokenizer colours a known language and declines an unknown one', () => {
  const lines = ['const x = 1;', '// note'];
  const tokens = diffSyntaxTokens(['a.ts'], lines);
  assert.equal(tokens.length, 2);
  assert.ok(tokens[0]!.some((token) => token.type === 'keyword'));
  assert.ok(tokens[1]!.some((token) => token.type === 'comment'));
  assert.deepEqual(diffSyntaxTokens(['a.bin'], lines), []);
  // Two languages in one diff render plain rather than picking a winner.
  assert.deepEqual(diffSyntaxTokens(['a.ts', 'b.py'], lines), []);
});

test('a construct that crosses lines is cut at the line boundary', () => {
  const tokens = diffSyntaxTokens(['a.ts'], ['/* one', ' two */ const x = 1']);
  assert.ok(tokens[0]!.some((token) => token.type === 'comment'));
  assert.ok(tokens[1]!.some((token) => token.type === 'comment'));
  // Offsets stay line-relative, so a row can never be shifted by the row above.
  for (const line of tokens) for (const token of line) assert.ok(token.start >= 0);
});

// ── turn presentation ───────────────────────────────────────────────────────

test('footer actions come from the turn status alone', () => {
  const derivation = createTurnPresentationDerivation();
  const running = derivation.derive([turn({ status: 'running' })], {
    activeId: 'session-1',
    pendingTurnActions: new Set(),
    uiLocale: 'en',
  });
  const enabled = (result: typeof running) =>
    new Set(
      (result.footerActionsByTurn['turn-1'] ?? [])
        .filter((action) => action.enabled)
        .map((action) => action.id),
    );
  assert.deepEqual([...enabled(running)], []);

  const settled = createTurnPresentationDerivation().derive(
    [turn({ status: 'completed', assistant: { id: 'a', role: 'assistant', text: 'done' } })],
    { activeId: 'session-1', pendingTurnActions: new Set(), uiLocale: 'en' },
  );
  assert.deepEqual([...enabled(settled)].sort(), ['branch', 'copy', 'regenerate']);
});

test('a pending action disables only that action on that turn', () => {
  const pending = new Set([pendingTurnActionKey('session-1', 'turn-1', 'regenerate')]);
  const result = createTurnPresentationDerivation().derive(
    [turn({ assistant: { id: 'a', role: 'assistant', text: 'done' } }), turn({ turnId: 'turn-2' })],
    { activeId: 'session-1', pendingTurnActions: pending, uiLocale: 'en' },
  );
  const first = result.footerActionsByTurn['turn-1']!.find((a) => a.id === 'regenerate')!;
  const second = result.footerActionsByTurn['turn-2']!.find((a) => a.id === 'regenerate')!;
  assert.equal(first.enabled, false);
  assert.equal(second.enabled, true);
});

test('lineage badges appear only when the turn they point at is present', () => {
  const withTarget = createTurnPresentationDerivation().derive(
    [turn({ turnId: 'origin' }), turn({ turnId: 'turn-2', regeneratedFromTurnId: 'origin' })],
    { activeId: 'session-1', pendingTurnActions: new Set(), uiLocale: 'en' },
  );
  assert.equal(withTarget.lineageBadgesByTurn['turn-2']?.length, 1);
  assert.equal(withTarget.lineageBadgesByTurn['origin']?.length, 1);

  const orphan = createTurnPresentationDerivation().derive(
    [turn({ turnId: 'turn-2', regeneratedFromTurnId: 'gone' })],
    { activeId: 'session-1', pendingTurnActions: new Set(), uiLocale: 'en' },
  );
  assert.equal(orphan.lineageBadgesByTurn['turn-2'], undefined);
});

test('a failed turn names its reason, unless every row already offered the fix', () => {
  const failed = createTurnPresentationDerivation().derive(
    [turn({ status: 'failed', errorClass: 'timeout' })],
    { activeId: 'session-1', pendingTurnActions: new Set(), uiLocale: 'en' },
  );
  assert.ok(failed.failedReasonLabels['turn-1']);

  const sandboxOnly = createTurnPresentationDerivation().derive(
    [
      turn({
        status: 'failed',
        errorClass: 'tool_failed',
        tools: [
          tool({
            status: 'errored',
            failure: { kind: 'denied', class: 'sandbox_denial', message: 'nope' },
            result: { kind: 'text', text: 'nope' },
          }),
        ],
      }),
    ],
    { activeId: 'session-1', pendingTurnActions: new Set(), uiLocale: 'en' },
  );
  assert.equal(sandboxOnly.failedReasonLabels['turn-1'], undefined);

  // A refusal has no control to offer, so the banner is the only thing that
  // can explain the turn and it must not be suppressed.
  const refusedOnly = createTurnPresentationDerivation().derive(
    [
      turn({
        status: 'failed',
        errorClass: 'tool_failed',
        tools: [
          tool({
            status: 'errored',
            failure: { kind: 'refused', class: 'LoopGate', message: 'stop repeating this' },
            result: { kind: 'text', text: 'nope' },
          }),
        ],
      }),
    ],
    { activeId: 'session-1', pendingTurnActions: new Set(), uiLocale: 'en' },
  );
  assert.ok(refusedOnly.failedReasonLabels['turn-1']);
});

test('an interrupted tail turn offers a safe resume', () => {
  const result = createTurnPresentationDerivation().derive(
    [turn({ status: 'failed', errorClass: 'app_restarted' })],
    { activeId: 'session-1', pendingTurnActions: new Set(), uiLocale: 'en' },
  );
  assert.equal(result.resumeCandidateTurnId, 'turn-1');
});

test('identical inputs return the identical result, so rendering twice is safe', () => {
  const derivation = createTurnPresentationDerivation();
  const turns = [turn()];
  const context = {
    activeId: 'session-1',
    pendingTurnActions: new Set<string>(),
    uiLocale: 'en' as const,
  };
  assert.equal(derivation.derive(turns, context), derivation.derive(turns, context));
});

test('a turn whose object did not move keeps its derived actions', () => {
  const derivation = createTurnPresentationDerivation();
  const stable = turn();
  const first = derivation.derive([stable], {
    activeId: 'session-1',
    pendingTurnActions: new Set(),
    uiLocale: 'en',
  });
  const second = derivation.derive([stable, turn({ turnId: 'turn-2' })], {
    activeId: 'session-1',
    pendingTurnActions: new Set(),
    uiLocale: 'en',
  });
  assert.equal(first.footerActionsByTurn['turn-1'], second.footerActionsByTurn['turn-1']);
});

// ── revision draft ──────────────────────────────────────────────────────────

test('a message with attachments or transformed text refuses to be edited', () => {
  assert.equal(revisionRefusalFor(userMessage()), undefined);
  assert.equal(
    revisionRefusalFor(userMessage({ attachments: [{ kind: 'image', name: 'a.png' }] })),
    'attachments',
  );
  assert.equal(
    revisionRefusalFor(userMessage({ text: '/compact', displayText: 'compact it' })),
    'transformed_text',
  );
  // Identical display text is not a transformation.
  assert.equal(revisionRefusalFor(userMessage({ displayText: 'hello' })), undefined);
});

test('one draft at a time, and its copy id is stable across retries', () => {
  const store = createRevisionDraftStore();
  assert.equal(store.begin({ sessionId: 's1', turnId: 't1', text: 'a' }), true);
  const first = store.getState().draft!.copyId;
  assert.equal(store.begin({ sessionId: 's1', turnId: 't2', text: 'b' }), false);
  assert.equal(store.getState().draft!.sourceTurnId, 't1');

  store.markPreparing();
  store.fail('boom');
  assert.equal(store.getState().draft!.phase, 'editing');
  assert.equal(store.getState().draft!.error, 'boom');
  assert.equal(store.getState().draft!.copyId, first);
  // A retry after an ambiguous failure reuses the reservation.
  assert.equal(revisionCopyId('s1', 't1'), first);

  store.setText('edited');
  assert.equal(store.getState().draft!.text, 'edited');
  assert.equal(store.getState().draft!.error, undefined);
  store.markPreparing();
  // Text is frozen once the fork has been asked for.
  store.setText('too late');
  assert.equal(store.getState().draft!.text, 'edited');

  store.markForked('s2');
  assert.equal(store.getState().draft!.phase, 'sending');
  assert.equal(store.getState().draft!.revisionSessionId, 's2');
  store.complete();
  assert.equal(store.getState().draft, undefined);
  // The completed fork releases its reservation, so a re-edit forks again.
  assert.notEqual(revisionCopyId('s1', 't1'), first);
});

test('cancelling a draft leaves nothing behind', () => {
  const store = createRevisionDraftStore();
  store.begin({ sessionId: 's1', turnId: 't9', text: 'a' });
  store.cancel();
  assert.equal(store.getState().draft, undefined);
  assert.equal(store.begin({ sessionId: 's1', turnId: 't9', text: 'a' }), true);
});

// ── context usage ───────────────────────────────────────────────────────────

test('context usage counts cache reads, and says nothing without a request', () => {
  assert.equal(projectContextUsage(undefined), undefined);
  assert.equal(
    projectContextUsage({ status: 'unavailable', reason: 'no_completed_request' }),
    undefined,
  );
  const usage = projectContextUsage({
    status: 'available',
    providerId: 'p',
    modelId: 'm',
    completedAt: 0,
    inputTokens: 30_000,
    cacheReadInputTokens: 50_000,
    contextWindow: 100_000,
  });
  assert.equal(usage?.usedTokens, 80_000);
  assert.equal(usage?.percent, 80);
  assert.equal(usage?.tier, 'warning');
});

test('the usage tiers move where the runtime takes over', () => {
  const at = (used: number) =>
    projectContextUsage({
      status: 'available',
      providerId: 'p',
      modelId: 'm',
      completedAt: 0,
      inputTokens: used,
      contextWindow: 100,
    })?.tier;
  assert.equal(at(50), 'ok');
  assert.equal(at(85), 'warning');
  assert.equal(at(95), 'critical');
});

test('a share of no window is absent rather than zero', () => {
  const usage = projectContextUsage({
    status: 'available',
    providerId: 'p',
    modelId: 'm',
    completedAt: 0,
    inputTokens: 10,
  });
  assert.equal(usage?.percent, undefined);
  assert.equal(usage?.usedTokens, 10);
});

test('a usage read that lands after the task changed is dropped', async () => {
  let resolveFirst: ((value: unknown) => void) | undefined;
  const store = createContextUsageStore({
    readSessionContextDiagnostics: ((sessionId: string) =>
      sessionId === 's1'
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve({
            ok: true,
            data: {
              status: 'available',
              providerId: 'p',
              modelId: 'second',
              completedAt: 0,
              inputTokens: 5,
            },
          })) as never,
    subscribeSessionUsageChanges: () => () => undefined,
  } as never);
  const stop = store.observe('s1');
  stop();
  store.observe('s2');
  await Promise.resolve();
  resolveFirst?.({
    ok: true,
    data: {
      status: 'available',
      providerId: 'p',
      modelId: 'first',
      completedAt: 0,
      inputTokens: 1,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const settled = store.getState().data;
  assert.ok(settled && settled.status === 'available');
  assert.equal(settled.modelId, 'second');
});

// ── composer quotes ─────────────────────────────────────────────────────────

test('quotes are per task, deduped, and removable', () => {
  const store = createComposerDraftStore();
  const added = store.addQuote('s1', { text: 'hello', sourceTurnId: 't1' });
  assert.ok(added);
  assert.equal(store.addQuote('s1', { text: 'hello', sourceTurnId: 't1' }), undefined);
  // The same words from a different turn are a different excerpt.
  assert.ok(store.addQuote('s1', { text: 'hello', sourceTurnId: 't2' }));
  assert.equal(store.quotesFor('s1').length, 2);
  assert.equal(store.quotesFor('s2').length, 0);
  store.removeQuote('s1', added!.id);
  assert.equal(store.quotesFor('s1').length, 1);
  store.clearQuotes('s1');
  assert.equal(store.quotesFor('s1').length, 0);
});

// ── message queue ───────────────────────────────────────────────────────────

test('reordering the queue moves one entry and leaves the rest in order', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(reorderQueue(ids, 2, 0), ['c', 'a', 'b', 'd']);
  assert.deepEqual(reorderQueue(ids, 0, 3), ['b', 'c', 'd', 'a']);
  // A move that changes nothing hands the same array back, so no round trip.
  assert.equal(reorderQueue(ids, 1, 1), ids);
  assert.equal(reorderQueue(ids, 1, 9), ids);
  assert.equal(reorderQueue(ids, -1, 1), ids);
});

test('a queue drag names entries, orders only follow-ups, and survives a re-publish', () => {
  const entry = (entryId: string, placement: 'current_turn' | 'next_turn') =>
    ({
      entryId,
      messageId: `m-${entryId}`,
      content: { text: entryId },
      placement,
      state: 'queued',
    }) as unknown as Parameters<typeof queueOrderAfterMove>[0][number];
  // One steering entry rides the running turn; the other three are the order.
  const entries = [
    entry('s', 'current_turn'),
    entry('a', 'next_turn'),
    entry('b', 'next_turn'),
    entry('c', 'next_turn'),
  ];
  assert.deepEqual(followupOrder(entries), ['a', 'b', 'c']);
  // The steering entry is never part of what the Host is asked to re-place.
  assert.deepEqual(queueOrderAfterMove(entries, 'c', 'a'), ['c', 'a', 'b']);
  assert.equal(queueOrderAfterMove(entries, 's', 'a'), undefined);
  assert.equal(queueOrderAfterMove(entries, 'a', 's'), undefined);
  // Dropping on itself asks for nothing.
  assert.equal(queueOrderAfterMove(entries, 'b', 'b'), undefined);
  // The queue re-published between drag and drop and retired the dragged
  // entry: the drop must move nothing rather than address whoever took its row.
  assert.equal(
    queueOrderAfterMove([entry('a', 'next_turn'), entry('c', 'next_turn')], 'b', 'c'),
    undefined,
  );
});

// A catalog row served from the desktop cache carries no `runningTurnIds` at
// all, and those reads interleave with authoritative ones on every refresh.
// Before the first token there is no live projection, so that field is the only
// witness the wait has: reading its absence as "nothing is running" retracted
// the status line, Stop and the composer lock for the ~340ms until the next
// authoritative read and the rising-edge delay brought them back.
test('an uninformative catalog read cannot retract a running turn', () => {
  const active = (
    runningTurnIds: readonly string[] | undefined,
    retainedRunningTurnIds?: readonly string[] | undefined,
  ) =>
    deriveTurnActive({
      turnPhase: undefined,
      armedTurnId: undefined,
      runningTurnIds,
      retainedRunningTurnIds,
    });
  assert.equal(active(['turn-1']), true);
  // The read that used to end the wait: no set at all, with the authority's
  // last word still standing behind it.
  assert.equal(active(undefined, ['turn-1']), true);
  // An empty set is the authority SAYING the turn is over, so it still ends it.
  assert.equal(active([], ['turn-1']), false);
  // Nothing behind it either: an absent field is not evidence of a turn.
  assert.equal(active(undefined, undefined), false);
  // The live projection outranks both, as before.
  assert.equal(
    deriveTurnActive({
      turnPhase: 'waiting',
      armedTurnId: 'turn-1',
      runningTurnIds: [],
      retainedRunningTurnIds: [],
    }),
    true,
  );
});

test('retaining a running-turn reading keeps the last informative one', () => {
  assert.deepEqual(retainRunningTurnIds(undefined, ['turn-1']), ['turn-1']);
  // The whole point: an absent field leaves the previous answer alone.
  assert.deepEqual(retainRunningTurnIds(['turn-1'], undefined), ['turn-1']);
  // Any set replaces it, the empty one included.
  assert.deepEqual(retainRunningTurnIds(['turn-1'], []), []);
  assert.equal(retainRunningTurnIds(undefined, undefined), undefined);
});
