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

// The Scheduled page's own pieces: the list's order, the card, one task's run
// history, the templates, the two mutations the page reaches through, and the
// copy catalog that names all of it.
//
// The page component itself is NOT rendered here. `useStore` reads
// `getInitialState()` on the server, so a store seeded with tasks still
// renders the loading skeleton — a test of the whole page would assert the
// skeleton and call it coverage. What the page composes is exported instead
// and rendered with props.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import type { ScheduledTask } from '@maka/core/scheduled-task';
import { compileCronExpression } from '@maka/core/cron-expression';
import { UI_LOCALES } from '@maka/core/ui-locale';
import {
  LocaleProvider,
  getScheduledTaskCopy,
  scheduledTaskDuplicateSeed,
  scheduledTaskEditSeed,
  scheduledTaskTemplateSeed,
} from '@maka/ui';
import { TooltipProvider } from '../../components/ui/tooltip.js';
import {
  ScheduledTaskCard,
  compareForSort,
} from '../../components/modules/scheduled/ScheduledTasksModule.js';
import { RunHistoryList } from '../../components/modules/scheduled/RunHistoryDialog.js';
import { ScheduleTemplates } from '../../components/modules/scheduled/ScheduleTemplates.js';
import {
  createScheduledTaskInputFromFields,
  scheduledTaskEffectFromFields,
  updateScheduledTaskInputFromFields,
  type ScheduledTaskFormFields,
} from '../../lib/ported/scheduled-task-form-payload.js';
import { getScheduledPageCopy } from '../../locales/scheduled-page-copy.js';
import { getModulesCopy } from '../../locales/modules-copy.js';
import { createScheduledTasksStore } from '../scheduled-tasks-store.js';

const catalog = getScheduledTaskCopy('en');
const page = getScheduledPageCopy('en');
const modules = getModulesCopy('en').scheduled;
const NOW = new Date(2026, 8, 11, 9, 0, 0).getTime();

function renderTree(node: Parameters<typeof renderToStaticMarkup>[0]) {
  const html = renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale: 'en',
      children: createElement(TooltipProvider, { children: node }),
    }),
  );
  return parseHTML(html).document;
}

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'task-1',
    title: 'Morning briefing',
    intent: { kind: 'text', body: 'Summarise the repository' },
    schedule: { kind: 'calendar', recurrence: 'daily', anchorAt: NOW },
    effect: { kind: 'notify', channel: 'local' },
    status: 'active',
    nextFireAt: NOW + 60 * 60 * 1000,
    lastFireAt: null,
    fireCount: 0,
    maxFires: null,
    expiresAt: null,
    createdBy: { kind: 'user' },
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
    runs: [],
    lastError: null,
    ...overrides,
  };
}

const noopCard = {
  busy: null,
  locale: 'en' as const,
  catalog,
  copy: modules,
  runHistoryLabel: page.viewRunHistory,
  onToggle: () => {},
  onTrigger: () => {},
  onSnooze: () => {},
  onHistory: () => {},
  onEdit: () => {},
  onDuplicate: () => {},
  onDelete: () => {},
};

// ── the list's order ───────────────────────────────────────────────────────

test('each sort agrees with itself, and next run stays the order the page has always had', () => {
  const soon = task({ id: 'b', title: 'Zulu', nextFireAt: NOW + 1000, createdAt: 1 });
  const later = task({ id: 'a', title: 'Alpha', nextFireAt: NOW + 9000, createdAt: 2 });
  const rows = [later, soon];

  // Next run: the one about to fire leads, whatever it is called or when it
  // was made. This is the default, and arriving at the page must not reorder.
  assert.deepEqual(
    [...rows].sort((x, y) => compareForSort(x, y, 'next-run', 'en')).map((row) => row.id),
    ['b', 'a'],
  );
  assert.deepEqual(
    [...rows].sort((x, y) => compareForSort(x, y, 'name', 'en')).map((row) => row.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    [...rows].sort((x, y) => compareForSort(x, y, 'created', 'en')).map((row) => row.id),
    ['a', 'b'],
  );
  // Antisymmetric: a comparator that disagrees with itself sorts differently
  // depending on the order the rows arrived in.
  for (const sort of ['next-run', 'name', 'created'] as const) {
    assert.equal(
      Math.sign(compareForSort(later, soon, sort, 'en')),
      -Math.sign(compareForSort(soon, later, sort, 'en')),
      `${sort} is antisymmetric`,
    );
  }
});

// ── the card ───────────────────────────────────────────────────────────────

test('a card names its schedule, its delivery target and every control it owns', () => {
  const document = renderTree(
    createElement(ScheduledTaskCard, {
      ...noopCard,
      task: task({
        effect: { kind: 'notify', channel: 'bot', platform: 'telegram', chatId: '42' },
        runs: [{ id: 'r1', at: NOW - 5000, outcome: 'failed', message: 'Bot chat is not linked' }],
      }),
    }),
  );
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes('Morning briefing'));
  assert.ok(text.includes(catalog.recurrence.recurring.daily));
  // Bot delivery reads as its target, not as "local notification" — the card
  // is where a task that delivers somewhere else has to say so.
  assert.ok(text.includes(catalog.delivery.bot('Telegram', '42')));
  assert.ok(text.includes(catalog.status.active));
  assert.ok(text.includes(catalog.runStatus.failed));
  assert.ok(document.querySelector(`[aria-label="${modules.rowActions('Morning briefing')}"]`));
  assert.ok(document.querySelector(`[aria-label="${modules.enableTask('Morning briefing')}"]`));
  for (const button of document.querySelectorAll('button')) {
    const named = (button.textContent ?? '').trim().length > 0 || button.hasAttribute('aria-label');
    assert.ok(named, 'every card control has an accessible name');
  }
});

test('a spent task cannot be re-armed from its card', () => {
  const document = renderTree(
    createElement(ScheduledTaskCard, {
      ...noopCard,
      task: task({ status: 'completed', nextFireAt: null }),
    }),
  );
  const toggle = document.querySelector(`[aria-label="${modules.enableTask('Morning briefing')}"]`);
  assert.ok(toggle?.hasAttribute('disabled'), 'the switch is disabled for a completed task');
  assert.ok((document.documentElement.textContent ?? '').includes(catalog.page.unscheduled));
});

// ── run history ────────────────────────────────────────────────────────────

test('run history says when, how it went, why it failed, and where to look', () => {
  const runs = [
    { id: 'r2', at: NOW - 1000, outcome: 'failed' as const, message: 'Delivery refused' },
    { id: 'r1', at: NOW - 9000, outcome: 'ok' as const, message: 'Sent', sessionId: 'session-7' },
  ];
  const document = renderTree(createElement(RunHistoryList, { runs, onOpenSession: () => {} }));
  const text = document.documentElement.textContent ?? '';
  assert.equal(document.querySelectorAll('li').length, 2);
  assert.ok(text.includes(catalog.runStatus.failed));
  assert.ok(text.includes('Delivery refused'), 'the failure message is the point of the record');
  // Only the run that produced one offers the way into it.
  const links = [...document.querySelectorAll('button')].filter((button) =>
    (button.textContent ?? '').includes(page.openSession),
  );
  assert.equal(links.length, 1);
});

test('a task that has never run says so instead of showing an empty list', () => {
  const document = renderTree(createElement(RunHistoryList, { runs: [], onOpenSession: () => {} }));
  assert.ok((document.documentElement.textContent ?? '').includes(catalog.detail.noRuns));
  assert.equal(document.querySelectorAll('li').length, 0);
});

// ── templates ──────────────────────────────────────────────────────────────

test('every template is one named control that seeds a create form', () => {
  const seeds: string[] = [];
  const document = renderTree(
    createElement(ScheduleTemplates, {
      disabled: false,
      onUse: (seed) => seeds.push(seed.title),
    }),
  );
  assert.equal(document.querySelectorAll('button').length, page.templates.length);
  for (const template of page.templates) {
    assert.ok(
      document.querySelector(`[aria-label="${page.useTemplate(template.title)}"]`),
      `${template.id} is reachable by name`,
    );
    assert.ok((document.documentElement.textContent ?? '').includes(template.scheduleLabel));
  }
  // The seed is a CREATE seed: a template must never open the edit form for
  // whatever task happened to be selected.
  for (const template of page.templates) {
    const seed = scheduledTaskTemplateSeed(template, NOW);
    assert.equal(seed.editingId, null);
    assert.equal(seed.title, template.title);
    assert.equal(seed.recurrence, template.recurrence);
    assert.ok(Date.parse(seed.runAtLocal) > NOW, 'the seeded time is in the future');
  }
  assert.deepEqual(seeds, []);
});

test('every template names a cadence the Host can compile', () => {
  for (const locale of UI_LOCALES) {
    for (const template of getScheduledPageCopy(locale).templates) {
      assert.ok(
        compileCronExpression(template.cronExpression).ok,
        `${locale}/${template.id} has a valid cron expression`,
      );
    }
  }
});

// ── the form payload ───────────────────────────────────────────────────────

const fields = (patch: Partial<ScheduledTaskFormFields> = {}): ScheduledTaskFormFields => ({
  title: 'Nightly sweep',
  note: 'Check the queue',
  runAtLocal: '2026-09-12T09:00',
  recurrence: 'none',
  cronExpression: '',
  ...patch,
});

test('a bot delivery survives the round trip the form used to flatten', () => {
  const bot = fields({
    deliveryMethod: 'bot',
    deliveryPlatform: 'telegram',
    deliveryChatId: ' 42 ',
  });
  assert.deepEqual(scheduledTaskEffectFromFields(bot), {
    kind: 'notify',
    channel: 'bot',
    platform: 'telegram',
    chatId: '42',
  });
  assert.deepEqual(createScheduledTaskInputFromFields(bot)?.effect, {
    kind: 'notify',
    channel: 'bot',
    platform: 'telegram',
    chatId: '42',
  });
  // Editing one is where the old form silently dropped the platform and the
  // chat id, turning a bot task into a local reminder.
  const seeded = scheduledTaskEditSeed(
    task({ effect: { kind: 'notify', channel: 'bot', platform: 'discord', chatId: 'c9' } }),
  );
  assert.deepEqual(
    updateScheduledTaskInputFromFields(
      fields({
        deliveryMethod: seeded.deliveryMethod,
        deliveryPlatform: seeded.deliveryPlatform,
        deliveryChatId: seeded.deliveryChatId,
      }),
    )?.effect,
    { kind: 'notify', channel: 'bot', platform: 'discord', chatId: 'c9' },
  );
});

test('saying nothing about delivery still means a local reminder', () => {
  assert.deepEqual(scheduledTaskEffectFromFields(fields()), { kind: 'notify', channel: 'local' });
  assert.deepEqual(scheduledTaskEffectFromFields(fields({ deliveryMethod: 'local' })), {
    kind: 'notify',
    channel: 'local',
  });
});

test("an agent's own effect outranks whatever the delivery controls say", () => {
  const locked = {
    kind: 'agent_run',
    execution: {
      cwd: '/repo',
      llmConnectionId: 'conn-1',
      llmConnectionSlug: 'relx',
      model: 'm',
      permissionMode: 'ask',
      collaborationMode: 'agent',
      orchestrationMode: 'default',
    },
  } as const;
  assert.deepEqual(
    scheduledTaskEffectFromFields(fields({ deliveryMethod: 'bot', lockedEffect: locked })),
    locked,
  );
});

test('duplicating a task drops its identity and keeps everything else', () => {
  const source = task({
    effect: { kind: 'notify', channel: 'bot', platform: 'slack', chatId: 'ops' },
  });
  const seed = scheduledTaskDuplicateSeed(source, 'en');
  assert.equal(seed.editingId, null, 'a duplicate creates rather than overwrites');
  assert.equal(seed.title, `${source.title}${catalog.duplicateSuffix}`);
  assert.equal(seed.deliveryMethod, 'bot');
  assert.equal(seed.deliveryChatId, 'ops');
});

// ── the two mutations the page reaches through ─────────────────────────────

test('snooze and clear-history go to the Host and re-read the list they changed', async () => {
  const calls: string[] = [];
  const rows: ScheduledTask[] = [task({ runs: [{ id: 'r', at: 1, outcome: 'ok', message: '' }] })];
  const store = createScheduledTasksStore({
    listScheduledTasks: async () => [...rows],
    subscribeScheduledTaskChanges: () => () => {},
    snoozeScheduledTask: async (id: string) => {
      calls.push(`snooze:${id}`);
      rows[0] = { ...rows[0]!, nextFireAt: NOW + 600_000 };
      return rows[0];
    },
    clearScheduledTaskRunHistory: async (id: string) => {
      calls.push(`clear:${id}`);
      rows[0] = { ...rows[0]!, runs: [], lastError: null };
      return rows[0];
    },
  } as never);
  const stop = store.start();
  await new Promise((settle) => setTimeout(settle, 0));
  assert.equal(store.getState().data?.[0]?.runs.length, 1);

  await store.snooze('task-1');
  assert.equal(store.getState().data?.[0]?.nextFireAt, NOW + 600_000);
  await store.clearRunHistory('task-1');
  // The Host also pushes a change event, but it is not ordered against the
  // promise; the re-read is what keeps the cleared runs from coming back for
  // a frame.
  assert.equal(store.getState().data?.[0]?.runs.length, 0);
  assert.deepEqual(calls, ['snooze:task-1', 'clear:task-1']);
  stop();
});

// ── the catalog ────────────────────────────────────────────────────────────

test('the Scheduled page speaks all three locales and repeats none of them', () => {
  const catalogs = UI_LOCALES.map((locale) => [locale, getScheduledPageCopy(locale)] as const);
  const reference = Object.keys(getScheduledPageCopy('en')).sort();
  for (const [locale, copy] of catalogs) {
    assert.deepEqual(Object.keys(copy).sort(), reference, `${locale} has the same keys`);
    assert.equal(copy.sortOptions.length, 3);
    assert.ok(copy.sortBy.trim().length > 0, `${locale} names the sort menu`);
    assert.ok(copy.runHistoryTitle('X').includes('X'));
    assert.ok(copy.useTemplate('X').includes('X'));
    for (const value of [copy.openSession, copy.viewRunHistory, copy.templatesTitle]) {
      assert.ok(value.trim().length > 0, `${locale} says something`);
    }
    // The ids are the contract between the copy and the icon table; a locale
    // that renamed one would silently lose its glyph.
    assert.deepEqual(
      copy.templates.map((template) => template.id),
      getScheduledPageCopy('en').templates.map((template) => template.id),
    );
    for (const template of copy.templates) {
      assert.ok(template.title.trim().length > 0);
      assert.ok(template.note.trim().length > 0);
      assert.ok(template.scheduleLabel.trim().length > 0);
    }
  }
  // Two locales sharing a translated string is how a catalog goes stale
  // unnoticed; the two Chinese scripts differ on every template title here.
  const zhCn = getScheduledPageCopy('zh-CN');
  const zhTw = getScheduledPageCopy('zh-TW');
  assert.notEqual(zhCn.templatesDescription, zhTw.templatesDescription);
});
