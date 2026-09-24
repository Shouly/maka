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
import type { RuntimeEvent } from '@maka/core/runtime-event';
import {
  SessionInjections,
  collectRecordedInjections,
  prependUserMessageReminders,
  renderMessageSentReminder,
  textAfterSystemReminders,
  wrapSystemReminder,
  type TurnInjectionFacts,
} from '../injection/index.js';

const SENT = Date.UTC(2026, 8, 18, 8, 28, 13); // Fri 2026-09-18 08:28:13Z

describe('on every user message', () => {
  test('the sent-time reminder names the zone, its offset and the local moment', () => {
    assert.equal(
      renderMessageSentReminder({ ts: SENT, timeZone: 'America/New_York' }),
      "<system-reminder>The user's timezone is America/New_York (UTC-04:00). Message sent at Fri 2026-09-18 04:28 local time.</system-reminder>",
    );
    assert.equal(
      renderMessageSentReminder({ ts: SENT, timeZone: 'Asia/Shanghai' }),
      "<system-reminder>The user's timezone is Asia/Shanghai (UTC+08:00). Message sent at Fri 2026-09-18 16:28 local time.</system-reminder>",
    );
    // No zone, or a zone the runtime does not know, says UTC rather than failing.
    assert.match(
      renderMessageSentReminder({ ts: SENT }),
      /UTC \(UTC\+00:00\)\. Message sent at Fri 2026-09-18 08:28/u,
    );
    assert.match(
      renderMessageSentReminder({ ts: SENT, timeZone: 'Mars/Olympus' }),
      /timezone is UTC/u,
    );
  });

  test('reminders go ahead of the text, whatever shape the content has', () => {
    const block = wrapSystemReminder('fact');
    assert.equal(prependUserMessageReminders('hello', [block]), `${block}\nhello`);
    assert.deepEqual(prependUserMessageReminders([{ type: 'text', text: 'hello' }], [block]), [
      { type: 'text', text: `${block}\nhello` },
    ]);
    assert.deepEqual(
      prependUserMessageReminders(
        [{ type: 'image', image: 'data:image/png;base64,AA==' } as never],
        [block],
      ),
      [
        { type: 'text', text: block },
        { type: 'image', image: 'data:image/png;base64,AA==' },
      ],
    );
    assert.equal(prependUserMessageReminders('hello', []), 'hello');
    // The user's own words are what is left after the blocks.
    assert.equal(textAfterSystemReminders(`${block}\n${block}\nhello`), 'hello');
    assert.equal(textAfterSystemReminders(block), '');
  });
});

describe('ahead of the turn: recorded once, again only on change', () => {
  const now = new Date(SENT);
  const snapshot = {
    name: 'user_memory_snapshot',
    text: '<user_memory_snapshot>SNAP</user_memory_snapshot>',
    revision: 'm1',
  };
  const skills = {
    name: 'skills',
    text: 'The following skills are available for use with the Skill tool:…',
    revision: 's1',
  };
  const facts = (overrides: Partial<TurnInjectionFacts> = {}): TurnInjectionFacts => ({
    now,
    contexts: [snapshot, skills],
    deferredToolNames: ['ScheduledTaskCreate', 'MemoryDelete'],
    modelId: 'claude-opus-5',
    permissionMode: 'ask',
    executionBoundary: { kind: 'managed', revision: 3, profile: 'workspace-write' } as never,
    ...overrides,
  });
  const event = (
    turnId: string,
    content: { name: string; text: string; data?: Record<string, unknown> },
  ): RuntimeEvent =>
    ({
      id: `${turnId}-${content.name}`,
      invocationId: 'inv',
      runId: 'run',
      sessionId: 's',
      turnId,
      ts: 1,
      partial: false,
      role: 'system',
      author: 'system',
      content: { kind: 'injection', ...content },
    }) as RuntimeEvent;
  const session = new SessionInjections({ sessionId: 's', timeZone: 'Asia/Shanghai' });

  test('a first turn says everything, in reading order', () => {
    const planned = session.planTurn([], facts());
    assert.deepEqual(
      planned.map((p) => p.name),
      ['user_memory_snapshot', 'skills', 'deferred_tools', 'session_facts', 'date'],
    );
    assert.equal(planned[0]?.text, snapshot.text);
    assert.deepEqual(planned[0]?.data, { revision: 'm1' });
    assert.equal(
      planned[2]?.text,
      'The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:\nMemoryDelete\nScheduledTaskCreate',
    );
    assert.deepEqual(planned[2]?.data, { names: ['MemoryDelete', 'ScheduledTaskCreate'] });
    assert.match(
      planned[3]?.text ?? '',
      /serving this session is claude-opus-5[\s\S]*Permission mode: ask, reads anywhere on this machine, writes inside the workspace[\s\S]*managed, revision 3/u,
    );
    assert.equal(planned[4]?.text, "Today's date is 2026-09-18.");
    assert.deepEqual(planned[4]?.data, { date: '2026-09-18' });
    // The model reads each as a reminder block.
    assert.equal(
      session.renderBlock(planned[4]!),
      "<system-reminder>Today's date is 2026-09-18.</system-reminder>",
    );
  });

  test('a turn where nothing moved says nothing', () => {
    const ledger = session.planTurn([], facts()).map((p) => event('turn-1', p));
    assert.deepEqual(session.planTurn(ledger, facts()), []);
  });

  test('only what changed is said again: a filed memory, a held tool loaded, a new day', () => {
    const ledger = session.planTurn([], facts()).map((p) => event('turn-1', p));
    const memory = session.planTurn(
      ledger,
      facts({ contexts: [{ ...snapshot, text: 'NEW', revision: 'm2' }, skills] }),
    );
    assert.deepEqual(
      memory.map((p) => [p.name, p.text]),
      [['user_memory_snapshot', 'NEW']],
    );
    // A loaded tool leaves the held list without a word; a new held tool is
    // announced alone, and the record keeps every name ever announced.
    assert.deepEqual(
      session.planTurn(ledger, facts({ deferredToolNames: ['ScheduledTaskCreate'] })),
      [],
    );
    const tools = session.planTurn(
      ledger,
      facts({ deferredToolNames: ['ScheduledTaskCreate', 'CronList'] }),
    );
    assert.equal(tools.length, 1);
    assert.match(tools[0]!.text, /before calling them:\nCronList$/u);
    assert.deepEqual(tools[0]!.data, {
      names: ['CronList', 'MemoryDelete', 'ScheduledTaskCreate'],
    });
    // Reloaded and held again later: still known, still silent.
    const again = [...ledger, event('turn-2', tools[0]!)];
    assert.deepEqual(
      session.planTurn(again, facts({ deferredToolNames: ['MemoryDelete', 'CronList'] })),
      [],
    );
    // Midnight in Shanghai.
    const tomorrow = session.planTurn(
      ledger,
      facts({ now: new Date(Date.UTC(2026, 8, 18, 16, 30)) }),
    );
    assert.deepEqual(
      tomorrow.map((p) => p.text),
      [
        "The date has changed. Today's date is now 2026-09-19. No need to announce the new date — the user's own clock shows it.",
      ],
    );
    // A permission change re-says the facts; the same facts do not.
    const bypass = session.planTurn(
      ledger,
      facts({
        permissionMode: 'bypass',
        executionBoundary: { kind: 'bypass', revision: 1 } as never,
      }),
    );
    assert.deepEqual(
      bypass.map((p) => p.name),
      ['session_facts'],
    );
    assert.match(
      bypass[0]!.text,
      /Permission mode: bypass, full access[\s\S]*Sandbox boundary: bypass/u,
    );
    // Codex's wording: nothing to ask for, and a destructive command waits
    // only when the user did not clearly ask for it — not a blanket confirm.
    assert.match(bypass[0]!.text, /Nothing needs the user's approval\./u);
    assert.match(bypass[0]!.text, /unless the user has clearly asked for that operation/u);
    assert.doesNotMatch(bypass[0]!.text, /confirm before anything irreversible/u);
  });

  test('a context without a revision is compared by its text, and an empty one is never said', () => {
    const plugin = { name: 'plugin:x', text: 'PLUGIN' };
    const first = session.planTurn(
      [],
      facts({ contexts: [plugin, { name: 'empty', text: '  ' }] }),
    );
    assert.deepEqual(
      first.filter((p) => p.name.startsWith('plugin') || p.name === 'empty').map((p) => p.name),
      ['plugin:x'],
    );
    const ledger = first.map((p) => event('turn-1', p));
    assert.deepEqual(session.planTurn(ledger, facts({ contexts: [plugin] })), []);
    assert.deepEqual(
      session
        .planTurn(ledger, facts({ contexts: [{ ...plugin, text: 'PLUGIN 2' }] }))
        .map((p) => p.name),
      ['plugin:x'],
    );
  });

  test('the ledger is read for the last word under each name', () => {
    const ledger = [
      event('turn-1', { name: 'date', text: 'x', data: { date: '2026-09-17' } }),
      event('turn-2', { name: 'date', text: 'y', data: { date: '2026-09-18' } }),
    ];
    assert.deepEqual(
      [...collectRecordedInjections(ledger).values()],
      [{ name: 'date', data: { date: '2026-09-18' } }],
    );
  });
});
