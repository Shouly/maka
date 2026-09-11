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
import { diffSyntaxTokens } from '@maka/ui';
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
  toolRowStatus,
  toolRowTitle,
} from '../../components/session/tools/tool-presentation.js';
import { parseMcpToolName } from '../../components/session/tools/ToolRow.js';
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

test('a sandbox denial is its own row status, not a generic error', () => {
  const denied = tool({
    status: 'errored',
    result: { kind: 'text', text: 'nope', sandboxDenial: { likely: true } },
  });
  assert.equal(toolRowStatus(denied), 'sandbox_blocked');
  // The same failure without the signal stays an ordinary error.
  assert.equal(
    toolRowStatus(tool({ status: 'errored', result: { kind: 'text', text: 'nope' } })),
    'errored',
  );
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
  const title = toolRowTitle(tool({ toolName: 'Read', args: { path: 'src/a.ts' } }), 'en');
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

test('a failed turn names its reason, unless the sandbox already explained it', () => {
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
            result: { kind: 'text', text: 'nope', sandboxDenial: { likely: true } },
          }),
        ],
      }),
    ],
    { activeId: 'session-1', pendingTurnActions: new Set(), uiLocale: 'en' },
  );
  assert.equal(sandboxOnly.failedReasonLabels['turn-1'], undefined);
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
