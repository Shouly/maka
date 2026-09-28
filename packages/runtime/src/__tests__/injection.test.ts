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
  appendUserMessageBlocks,
  collectRecordedInjections,
  formatLongDate,
  injectionPosition,
  prependUserMessageBlocks,
  renderCurrentDateLine,
  renderPlacedBlock,
  textAfterSystemReminders,
  type PlannedInjection,
  type TurnInjectionFacts,
} from '../injection/index.js';

const SENT = Date.UTC(2026, 8, 18, 8, 28, 13); // Fri 2026-09-18 08:28:13Z

describe('around the user message', () => {
  test("the date is said the reference way, in the user's zone", () => {
    assert.equal(
      renderCurrentDateLine(formatLongDate(new Date(SENT), 'Asia/Shanghai')),
      'The current date is Friday, September 18, 2026.',
    );
    // Still the 17th west of Greenwich at that hour.
    assert.equal(
      formatLongDate(new Date(Date.UTC(2026, 8, 18, 2)), 'America/Los_Angeles'),
      'Thursday, September 17, 2026',
    );
  });

  test('each block carries its own break: a line ahead, flush for the date, a blank line after', () => {
    const snapshot = renderPlacedBlock({ name: 'user_memory_snapshot', text: 'fact' });
    const date = renderPlacedBlock({ name: 'date', text: 'The current date is Monday.' });
    const environment = renderPlacedBlock({
      name: 'environment',
      text: '# Environment\n - Platform: darwin',
      data: { position: 'after' },
    });
    const skills = renderPlacedBlock({ name: 'skills', text: 'LIST', data: { position: 'after' } });
    assert.equal(snapshot, '<system-reminder>fact</system-reminder>\n');
    assert.equal(date, '<system-reminder>The current date is Monday.</system-reminder>');
    // After the text a listing wears the envelope too, set off by a blank line.
    assert.equal(
      environment,
      '\n\n<system-reminder>\n# Environment\n - Platform: darwin\n</system-reminder>',
    );

    assert.equal(
      prependUserMessageBlocks('hello', [snapshot, date]),
      '<system-reminder>fact</system-reminder>\n<system-reminder>The current date is Monday.</system-reminder>hello',
    );
    assert.equal(
      appendUserMessageBlocks('hello', [environment, skills]),
      'hello\n\n<system-reminder>\n# Environment\n - Platform: darwin\n</system-reminder>\n\n<system-reminder>LIST</system-reminder>',
    );
    assert.deepEqual(prependUserMessageBlocks([{ type: 'text', text: 'hello' }], [snapshot]), [
      { type: 'text', text: '<system-reminder>fact</system-reminder>\nhello' },
    ]);
    assert.deepEqual(
      prependUserMessageBlocks(
        [{ type: 'image', image: 'data:image/png;base64,AA==' } as never],
        [snapshot],
      ),
      [
        { type: 'text', text: '<system-reminder>fact</system-reminder>' },
        { type: 'image', image: 'data:image/png;base64,AA==' },
      ],
    );
    assert.deepEqual(appendUserMessageBlocks([{ type: 'text', text: 'hello' }], [skills]), [
      { type: 'text', text: 'hello' },
      { type: 'text', text: '<system-reminder>LIST</system-reminder>' },
    ]);
    // With no words to hold them, the blocks stand alone, untrimmed inside.
    assert.equal(
      prependUserMessageBlocks('', [snapshot]),
      '<system-reminder>fact</system-reminder>',
    );
    assert.equal(appendUserMessageBlocks('', [skills]), '<system-reminder>LIST</system-reminder>');
    assert.equal(prependUserMessageBlocks('hello', []), 'hello');
    assert.equal(appendUserMessageBlocks('hello', []), 'hello');
    // The user's own words are what is left after the blocks ahead of them.
    assert.equal(textAfterSystemReminders(`${snapshot}${date}hello`), 'hello');
    assert.equal(textAfterSystemReminders(snapshot), '');
  });
});

describe('around the turn: recorded once, again only on change', () => {
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
    position: 'after' as const,
  };
  const facts = (overrides: Partial<TurnInjectionFacts> = {}): TurnInjectionFacts => ({
    now,
    contexts: [snapshot, skills],
    deferredToolNames: ['ScheduledTaskCreate', 'MemoryDelete'],
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
  /** What a later turn says besides its date. */
  const moved = (planned: PlannedInjection[]) => planned.filter((p) => p.name !== 'date');

  test('a prompt that names the day leaves it out of a first turn that says every listing', () => {
    const planned = session.planTurn([], facts({ datedByPrompt: true }));
    assert.deepEqual(
      planned.map((p) => [p.name, injectionPosition(p)]),
      [
        ['user_memory_snapshot', 'before'],
        ['deferred_tools', 'after'],
        ['skills', 'after'],
      ],
    );
    assert.equal(planned[0]?.text, snapshot.text);
    assert.deepEqual(planned[0]?.data, { revision: 'm1' });
    assert.equal(
      planned[1]?.text,
      'The following deferred tools are now available via ToolSearch. Their schemas are NOT loaded — calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>[,<name>...]" to load tool schemas before calling them:\nMemoryDelete\nScheduledTaskCreate',
    );
    assert.deepEqual(planned[1]?.data, {
      names: ['MemoryDelete', 'ScheduledTaskCreate'],
      position: 'after',
    });
    assert.deepEqual(planned[2]?.data, { revision: 's1', position: 'after' });
  });

  test('a first turn under a prompt without the day still opens with the date', () => {
    assert.deepEqual(
      session.planTurn([], facts()).map((p) => [p.name, injectionPosition(p)]),
      [
        ['user_memory_snapshot', 'before'],
        ['date', 'before'],
        ['deferred_tools', 'after'],
        ['skills', 'after'],
      ],
    );
  });

  test('the environment leads the blocks after the text, ahead of the held tools', () => {
    const environment = {
      name: 'environment',
      text: '# Environment\n…',
      position: 'after' as const,
    };
    const planned = session.planTurn(
      [],
      facts({ datedByPrompt: true, contexts: [snapshot, environment, skills] }),
    );
    assert.deepEqual(
      planned.map((p) => p.name),
      ['user_memory_snapshot', 'environment', 'deferred_tools', 'skills'],
    );
  });

  test('every later turn opens with the date, as a reminder block', () => {
    const ledger = session
      .planTurn([], facts({ datedByPrompt: true }))
      .map((p) => event('turn-1', p));
    const planned = session.planTurn(ledger, facts());
    assert.deepEqual(
      planned.map((p) => [p.name, injectionPosition(p)]),
      [['date', 'before']],
    );
    assert.equal(planned[0]?.text, 'The current date is Friday, September 18, 2026.');
    assert.deepEqual(planned[0]?.data, { date: '2026-09-18' });
    assert.equal(
      session.renderBlock(planned[0]!),
      '<system-reminder>The current date is Friday, September 18, 2026.</system-reminder>',
    );
    // Said again on the next turn, the same day or not.
    assert.deepEqual(
      session.planTurn([...ledger, event('turn-2', planned[0]!)], facts()).map((p) => p.name),
      ['date'],
    );
  });

  test('only what changed is said again: a filed memory, a held tool loaded', () => {
    const ledger = session
      .planTurn([], facts({ datedByPrompt: true }))
      .map((p) => event('turn-1', p));
    const memory = moved(
      session.planTurn(
        ledger,
        facts({ contexts: [{ ...snapshot, text: 'NEW', revision: 'm2' }, skills] }),
      ),
    );
    assert.deepEqual(
      memory.map((p) => [p.name, p.text]),
      [['user_memory_snapshot', 'NEW']],
    );
    // A loaded tool leaves the held list without a word; a new held tool is
    // announced alone, and the record keeps every name ever announced.
    assert.deepEqual(
      moved(session.planTurn(ledger, facts({ deferredToolNames: ['ScheduledTaskCreate'] }))),
      [],
    );
    const tools = moved(
      session.planTurn(ledger, facts({ deferredToolNames: ['ScheduledTaskCreate', 'CronList'] })),
    );
    assert.equal(tools.length, 1);
    assert.match(tools[0]!.text, /before calling them:\nCronList$/u);
    assert.deepEqual(tools[0]!.data, {
      names: ['CronList', 'MemoryDelete', 'ScheduledTaskCreate'],
      position: 'after',
    });
    // Reloaded and held again later: still known, still silent.
    const again = [...ledger, event('turn-2', tools[0]!)];
    assert.deepEqual(
      moved(session.planTurn(again, facts({ deferredToolNames: ['MemoryDelete', 'CronList'] }))),
      [],
    );
    // Midnight in Shanghai: the date moves with it.
    const tomorrow = session.planTurn(
      ledger,
      facts({ now: new Date(Date.UTC(2026, 8, 18, 16, 30)) }),
    );
    assert.deepEqual(
      tomorrow.map((p) => p.text),
      ['The current date is Saturday, September 19, 2026.'],
    );
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
    assert.deepEqual(moved(session.planTurn(ledger, facts({ contexts: [plugin] }))), []);
    assert.deepEqual(
      moved(session.planTurn(ledger, facts({ contexts: [{ ...plugin, text: 'PLUGIN 2' }] }))).map(
        (p) => p.name,
      ),
      ['plugin:x'],
    );
  });

  test('a bare context is recorded bare and read as written, outside the envelope', () => {
    const preferences = {
      name: 'user_preferences',
      text: '<user_preferences>\nBe brief.\n</user_preferences>',
      bare: true,
    };
    const [planned] = session.planTurn([], facts({ contexts: [preferences, snapshot] }));
    assert.deepEqual(planned, {
      name: 'user_preferences',
      text: preferences.text,
      data: { revision: planned?.data?.revision, bare: true },
    });
    assert.equal(
      session.renderBlock(planned!),
      '<user_preferences>\nBe brief.\n</user_preferences>',
    );
    // Being bare is how it is said, not what: it does not make it say itself again.
    const ledger = session
      .planTurn([], facts({ contexts: [preferences] }))
      .map((p) => event('turn-1', p));
    assert.deepEqual(
      session
        .planTurn(ledger, facts({ contexts: [preferences] }))
        .filter((p) => p.name === 'user_preferences'),
      [],
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
