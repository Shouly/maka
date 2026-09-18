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
import { describe, test } from 'node:test';
import {
  applyMemoryAppend,
  applyMemoryStrReplace,
  memoryFileByteLength,
  memoryFileVersion,
} from '@maka/core/memory-filesystem';
import { createDefaultRuntimePolicy, type RuntimePolicy } from '@maka/core/runtime-policy';
import type { SessionHeader, StoredMessage } from '@maka/core/session';
import type { MemoryFileRecord, MemoryMutationResult } from '@maka/storage/memory-file-store';
import type { HostMemoryPassModel } from '../server/execution-model-authority.js';
import {
  HostMemoryPassCoordinator,
  type MemoryPassEvent,
} from '../server/memory-pass-coordinator.js';
import { SessionOperationLane } from '../server/session-operation-lane.js';

const FOOD = [
  '---',
  'name: food',
  'description: what they eat',
  'sources: [chat]',
  '---',
  '',
  '- [stated] drinks coffee every morning',
].join('\n');

/** The store the pass writes through, in memory, with the real version rules. */
class FakeStore {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];

  seed(path: string, content: string): void {
    this.files.set(path, content);
  }

  #record(path: string): MemoryFileRecord | undefined {
    const content = this.files.get(path);
    if (content === undefined) return undefined;
    return {
      path,
      content,
      version: memoryFileVersion(content),
      byteLength: memoryFileByteLength(content),
      updatedAt: 1,
    };
  }

  async snapshot() {
    const files = [...this.files.keys()].sort().map((path) => this.#record(path)!);
    return { revision: files.map((file) => file.version).join(','), files };
  }

  async write(input: {
    path: string;
    content: string;
    ifVersion: string;
  }): Promise<MemoryMutationResult> {
    const current = this.#record(input.path);
    if (input.ifVersion === 'new' && current) return { kind: 'exists', current };
    if (input.ifVersion !== 'new' && (!current || current.version !== input.ifVersion)) {
      return current ? { kind: 'version_conflict', current } : { kind: 'not_found' };
    }
    this.files.set(input.path, input.content);
    this.writes.push(`write ${input.path}`);
    return {
      kind: 'written',
      created: !current,
      version: memoryFileVersion(input.content),
      byteLength: memoryFileByteLength(input.content),
    };
  }

  async append(input: {
    path: string;
    content: string;
    ifVersion: string;
  }): Promise<MemoryMutationResult> {
    const current = this.#record(input.path);
    if (input.ifVersion === 'new' && current) return { kind: 'exists', current };
    if (input.ifVersion !== 'new' && (!current || current.version !== input.ifVersion)) {
      return current ? { kind: 'version_conflict', current } : { kind: 'not_found' };
    }
    const content = applyMemoryAppend(current?.content ?? '', input.content);
    this.files.set(input.path, content);
    this.writes.push(`append ${input.path}`);
    return {
      kind: 'written',
      created: !current,
      version: memoryFileVersion(content),
      byteLength: memoryFileByteLength(content),
    };
  }

  async strReplace(input: {
    path: string;
    oldStr: string;
    newStr: string;
    ifVersion: string;
  }): Promise<MemoryMutationResult> {
    const current = this.#record(input.path);
    if (!current) return { kind: 'not_found' };
    if (current.version !== input.ifVersion) return { kind: 'version_conflict', current };
    const edited = applyMemoryStrReplace(current.content, input.oldStr, input.newStr);
    if (!edited.ok) return { kind: 'old_str_not_found', current };
    this.files.set(input.path, edited.content);
    this.writes.push(`str_replace ${input.path}`);
    return {
      kind: 'written',
      created: false,
      version: memoryFileVersion(edited.content),
      byteLength: memoryFileByteLength(edited.content),
    };
  }
}

interface Harness {
  readonly store: FakeStore;
  readonly coordinator: HostMemoryPassCoordinator;
  readonly prompts: { system: string; prompt: string }[];
  readonly events: MemoryPassEvent[];
  readonly settled: () => Promise<void>;
}

function harness(options: {
  answers: readonly string[];
  policy?: Partial<RuntimePolicy>;
  header?: Partial<SessionHeader>;
  messages?: readonly StoredMessage[];
}): Harness {
  const store = new FakeStore();
  const prompts: { system: string; prompt: string }[] = [];
  const events: MemoryPassEvent[] = [];
  const answers = [...options.answers];
  const model: HostMemoryPassModel = {
    generate: async ({ system, prompt }) => {
      prompts.push({ system, prompt });
      const text = answers.shift();
      return text === undefined ? { ok: false, errorClass: 'provider' } : { ok: true, text };
    },
  };
  const coordinator = new HostMemoryPassCoordinator({
    store,
    policy: {
      getSnapshot: async () => ({
        revision: 1,
        policy: { ...createDefaultRuntimePolicy(), ...options.policy },
      }),
    },
    sessions: {
      readHeader: async () => ({ ...sessionHeader(), ...options.header }),
      readMessages: async () => options.messages ?? [],
    },
    model,
    lane: new SessionOperationLane(),
    acquireResidency: () => ({ release() {} }) as never,
    rules: 'RULES_SENTINEL',
    observe: (event) => events.push(event),
  });
  return {
    store,
    coordinator,
    prompts,
    events,
    settled: () => coordinator.close(),
  };
}

const turn = {
  sessionId: 'session-1',
  runId: 'run-1',
  turnId: 'turn-1',
  userText: "actually I'm off coffee these days — tea only",
  assistantText: 'Tea it is.',
  wroteMemory: false,
};

describe('background memory pass', () => {
  test('opens the file it would edit, then edits it with the version it was shown', async () => {
    const fixture = harness({
      answers: [
        JSON.stringify({ open: ['/topics/food.md'] }),
        JSON.stringify({
          operations: [
            {
              op: 'str_replace',
              path: '/topics/food.md',
              old_str: '- [stated] drinks coffee every morning',
              new_str: '- [stated] drinks tea now (previously coffee)',
              if_version: memoryFileVersion(FOOD),
            },
          ],
        }),
      ],
    });
    fixture.store.seed('/topics/food.md', FOOD);
    fixture.coordinator.turnCompleted(turn);
    await fixture.settled();

    assert.equal(fixture.prompts.length, 2);
    // The same rules the main model reads, framed for the pass.
    assert.match(fixture.prompts[0]!.system, /background memory pass for Copilot/);
    // The rulebook is Copilot's, so the preface says which parts are the pass's
    // and that "you do NOT file" in it is about Copilot.
    assert.match(fixture.prompts[0]!.system, /Filing is your job/);
    assert.match(fixture.prompts[0]!.system, /From "What counts, for the pass and for you" onward/);
    assert.match(fixture.prompts[0]!.system, /<rules>\nRULES_SENTINEL\n<\/rules>/);
    // Stage one sees the listing and the exchange, not file bodies.
    assert.match(
      fixture.prompts[0]!.prompt,
      /<memory_listing>\n[^]*\/topics\/food\.md — what they eat/,
    );
    assert.match(fixture.prompts[0]!.prompt, /user: actually I'm off coffee/);
    assert.doesNotMatch(fixture.prompts[0]!.prompt, /drinks coffee every morning/);
    // Stage two sees the opened file with its version.
    assert.match(
      fixture.prompts[1]!.prompt,
      new RegExp(`== /topics/food.md ==\\n\\[version: ${memoryFileVersion(FOOD)}\\]\\n---`),
    );
    assert.deepEqual(fixture.store.writes, ['str_replace /topics/food.md']);
    assert.match(
      fixture.store.files.get('/topics/food.md')!,
      /drinks tea now \(previously coffee\)/,
    );
    assert.deepEqual(fixture.events, [
      { kind: 'settled', sessionId: 'session-1', turnId: 'turn-1', applied: 1, dropped: [] },
    ]);
  });

  test('files nothing for an exchange with nothing durable, in one call', async () => {
    const fixture = harness({ answers: [JSON.stringify({ operations: [] })] });
    fixture.coordinator.turnCompleted({ ...turn, userText: 'thanks!', assistantText: 'Any time.' });
    await fixture.settled();
    assert.equal(fixture.prompts.length, 1);
    assert.match(fixture.prompts[0]!.prompt, /<memory_listing>\n[^\n]*\n\(empty\)/);
    assert.deepEqual(fixture.store.writes, []);
  });

  test('creates a new file with if_version new and drops a write whose version is stale', async () => {
    const fixture = harness({
      answers: [
        JSON.stringify({
          operations: [
            {
              op: 'write',
              path: '/people/sam.md',
              content: '---\nname: sam\n---\n- [stated] sister',
              if_version: 'new',
            },
            {
              op: 'append',
              path: '/topics/food.md',
              content: '- [stated] no cilantro',
              if_version: 'stale',
            },
          ],
        }),
      ],
    });
    fixture.store.seed('/topics/food.md', FOOD);
    fixture.coordinator.turnCompleted(turn);
    await fixture.settled();
    assert.deepEqual(fixture.store.writes, ['write /people/sam.md']);
    assert.deepEqual(fixture.events, [
      {
        kind: 'settled',
        sessionId: 'session-1',
        turnId: 'turn-1',
        applied: 1,
        dropped: [{ path: '/topics/food.md', reason: 'version_conflict' }],
      },
    ]);
  });

  test('leaves alone a turn that wrote memory itself, an empty turn, and a session memory is off for', async () => {
    const wrote = harness({ answers: [] });
    wrote.coordinator.turnCompleted({ ...turn, wroteMemory: true });
    wrote.coordinator.turnCompleted({ ...turn, turnId: 'turn-2', userText: '   ' });
    await wrote.settled();
    assert.equal(wrote.prompts.length, 0);
    assert.deepEqual(
      wrote.events.map((event) => (event.kind === 'skipped' ? event.reason : event.kind)),
      ['turn wrote memory', 'empty user text'],
    );

    const off = harness({ answers: [], policy: { memory: { enabled: false } } });
    off.coordinator.turnCompleted(turn);
    await off.settled();
    assert.equal(off.prompts.length, 0);
    assert.deepEqual(off.events, [
      { kind: 'skipped', sessionId: 'session-1', turnId: 'turn-1', reason: 'disabled' },
    ]);

    const incognito = harness({ answers: [], policy: { privacy: { incognitoActive: true } } });
    incognito.coordinator.turnCompleted(turn);
    await incognito.settled();
    assert.equal(incognito.prompts.length, 0);

    const child = harness({
      answers: [],
      header: { subagentParent: { sessionId: 'parent', subagentId: 'x' } as never },
    });
    child.coordinator.turnCompleted(turn);
    await child.settled();
    assert.equal(child.prompts.length, 0);
    assert.deepEqual(child.events, [
      { kind: 'skipped', sessionId: 'session-1', turnId: 'turn-1', reason: 'ineligible session' },
    ]);
  });

  test('shows the turns before the exchange for context, steering and all steps folded in', async () => {
    const fixture = harness({
      answers: [JSON.stringify({ operations: [] })],
      messages: [
        user('turn-a', 'first question'),
        assistant('turn-a', 'first answer'),
        user('turn-b', 'is it 12 Elm St?'),
        { ...user('turn-b', 'the one in Holton'), steeringEventId: 'steer-1' },
        assistant('turn-b', 'Let me look.'),
        assistant('turn-b', 'Yes: 12 Elm St, Holton.'),
        user('turn-c', 'a third question'),
        assistant('turn-c', 'a third answer'),
        user('turn-1', "yes, that's my address"),
        assistant('turn-1', 'Noted.'),
      ],
    });
    fixture.coordinator.turnCompleted({
      ...turn,
      userText: "yes, that's my address",
      assistantText: 'Noted.',
    });
    await fixture.settled();
    const prompt = fixture.prompts[0]!.prompt;
    assert.match(
      prompt,
      /<earlier_exchanges>\n[^\n]*\nuser: is it 12 Elm St\?\nthe one in Holton\nassistant: Let me look\.\n\nYes: 12 Elm St, Holton\.\n\nuser: a third question\nassistant: a third answer\n<\/earlier_exchanges>\n\n<exchange>\nuser: yes, that's my address/,
    );
    // Only the two turns before the exchange, and never the exchange's own messages twice.
    assert.doesNotMatch(prompt, /first question/);
    assert.equal(prompt.match(/yes, that's my address/g)?.length, 1);
  });

  test('a turn a scheduled task authored is not the user speaking', async () => {
    const fixture = harness({
      answers: [],
      messages: [
        {
          ...user('turn-1', 'Summarize the news.'),
          origin: { kind: 'scheduled_task', scheduledTaskId: 'task-1' },
        },
      ],
    });
    fixture.coordinator.turnCompleted({ ...turn, userText: 'Summarize the news.' });
    await fixture.settled();
    assert.equal(fixture.prompts.length, 0);
    assert.deepEqual(fixture.events, [
      {
        kind: 'skipped',
        sessionId: 'session-1',
        turnId: 'turn-1',
        reason: 'automated turn (scheduled_task)',
      },
    ]);
  });

  test("a second operation on the same file is applied to the first one's result", async () => {
    const fixture = harness({
      answers: [
        JSON.stringify({ open: ['/topics/food.md'] }),
        JSON.stringify({
          operations: [
            {
              op: 'str_replace',
              path: '/topics/food.md',
              old_str: 'drinks coffee every morning',
              new_str: 'drinks tea now (previously coffee)',
              if_version: memoryFileVersion(FOOD),
            },
            {
              op: 'append',
              path: '/topics/food.md',
              content: '- [stated] no cilantro',
              if_version: memoryFileVersion(FOOD),
            },
            {
              op: 'write',
              path: '/people/sam.md',
              content: '---\nname: sam\n---\n- [stated] sister',
              if_version: 'new',
            },
            {
              op: 'append',
              path: '/people/sam.md',
              content: '- [stated] lives in Holton',
              if_version: 'new',
            },
          ],
        }),
      ],
    });
    fixture.store.seed('/topics/food.md', FOOD);
    fixture.coordinator.turnCompleted(turn);
    await fixture.settled();
    assert.deepEqual(fixture.store.writes, [
      'str_replace /topics/food.md',
      'append /topics/food.md',
      'write /people/sam.md',
      'append /people/sam.md',
    ]);
    assert.match(fixture.store.files.get('/topics/food.md')!, /drinks tea now[^]*no cilantro/);
    assert.match(
      fixture.store.files.get('/people/sam.md')!,
      /sister\n- \[stated\] lives in Holton/,
    );
    assert.deepEqual(fixture.events, [
      { kind: 'settled', sessionId: 'session-1', turnId: 'turn-1', applied: 4, dropped: [] },
    ]);
  });

  test('an unparseable answer or a failed call writes nothing', async () => {
    const garbage = harness({ answers: ['Sure! Here is what I would file: nothing.'] });
    garbage.coordinator.turnCompleted(turn);
    await garbage.settled();
    assert.deepEqual(garbage.store.writes, []);
    assert.deepEqual(garbage.events, [
      { kind: 'failed', sessionId: 'session-1', turnId: 'turn-1', reason: 'unparseable answer' },
    ]);

    const failed = harness({ answers: [] });
    failed.coordinator.turnCompleted(turn);
    await failed.settled();
    assert.deepEqual(failed.events, [
      { kind: 'failed', sessionId: 'session-1', turnId: 'turn-1', reason: 'provider' },
    ]);
  });
});

function user(turnId: string, text: string): Extract<StoredMessage, { type: 'user' }> {
  return { type: 'user', id: `${turnId}-u-${text.length}`, turnId, ts: 1, text };
}

function assistant(turnId: string, text: string): Extract<StoredMessage, { type: 'assistant' }> {
  return { type: 'assistant', id: `${turnId}-a-${text.length}`, turnId, ts: 1, text, modelId: 'm' };
}

function sessionHeader(): SessionHeader {
  return {
    id: 'session-1',
    workspaceRoot: '/tmp',
    cwd: '/tmp',
    createdAt: 1,
    name: 'test',
    titleIsManual: false,
    isFlagged: false,
    labels: [],
    isArchived: false,
    status: 'active',
    statusUpdatedAt: 1,
    hasUnread: false,
    backend: 'ai-sdk',
    llmConnectionSlug: 'connection-1',
    connectionLocked: true,
    model: 'model-1',
    permissionMode: 'ask',
    schemaVersion: 1,
  };
}
