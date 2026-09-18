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
// history, the two mutations the page reaches through, and the copy catalog
// that names all of it.
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
import { UI_LOCALES } from '@maka/core/ui-locale';
import {
  LocaleProvider,
  createScheduledTaskFormSeed,
  describeScheduledTaskCadence,
  getScheduledTaskCopy,
  scheduledTaskDuplicateSeed,
  scheduledTaskEditSeed,
} from '@maka/ui';
import { TooltipProvider } from '../../components/ui/tooltip.js';
import { ListPageHeader } from '../../components/ui/list-page.js';
import {
  ScheduledTaskCard,
  compareForSort,
  scheduledTaskCardActions,
} from '../../components/modules/scheduled/ScheduledTasksModule.js';
import { ScheduledTaskDetail } from '../../components/modules/scheduled/ScheduledTaskDetail.js';
import {
  createScheduledTaskInputFromFields,
  scheduledTaskEffectFromFields,
  updateScheduledTaskInputFromFields,
  type ScheduledTaskFormFields,
} from '../../lib/ported/scheduled-task-form-payload.js';
import {
  scheduledTaskIdForSession,
  unreadRunsByTask,
  unreadHostSessionIds,
} from '../../lib/ported/session-nav-filter.js';
import { SidebarNavButton } from '../../components/layout/sidebar-parts/SidebarNavButton.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import { getScheduledPageCopy } from '../../locales/scheduled-page-copy.js';
import { getModulesCopy } from '../../locales/modules-copy.js';
import { createScheduledTasksStore } from '../scheduled-tasks-store.js';
import { buildSessionListModel } from '../session-list-model.js';

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
    effect: {
      kind: 'agent_run',
      execution: {
        cwd: '/repo',
        projectId: null,
        model: { kind: 'default' },
        permissionMode: 'ask',
        collaborationMode: 'agent',
        orchestrationMode: 'default',
      },
    },
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
  page,
  onToggle: () => {},
  onTrigger: () => {},
  onSnooze: () => {},
  onOpen: () => {},
  onEdit: () => {},
  onDelete: () => {},
};

// ── the page's own top spacing ─────────────────────────────────

// `ListPageHeader` is shared chrome, but Scheduled is the only page that
// passes a subtitle — which is exactly how its title came to sit 8px higher
// than Customize's. The subtitle used to live inside the 48px title row, so
// the row grew to 56 and `items-center` had nothing left to centre.
test('the title row is the same height whether or not the page has a subtitle', () => {
  const titleRow = (subtitle?: string) => {
    const document = renderTree(
      createElement(ListPageHeader, {
        title: 'Scheduled tasks',
        ...(subtitle ? { subtitle } : {}),
      }),
    );
    const header = document.querySelector('header');
    assert.ok(header, 'the title row is a header element');
    return header;
  };
  const bare = titleRow();
  const subtitled = titleRow('Tasks that run on a schedule.');
  assert.equal(bare.getAttribute('class'), subtitled.getAttribute('class'));
  // The h1 is the header's own child in both, so nothing else can stretch the
  // row past its `min-h-12`.
  for (const header of [bare, subtitled]) {
    assert.equal(header.children.length, 1);
    assert.equal(header.children[0]?.tagName.toLowerCase(), 'h1');
  }
  // And the subtitle hangs below the row, carrying the margin that puts the
  // first card 44px under it — 28 here plus `ModulePage`'s own `pt-4`, both
  // measured off the reference.
  const paragraph = subtitled.parentElement?.querySelector('p');
  assert.ok(paragraph?.getAttribute('class')?.includes('mb-7'));
});

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

test('a live card says its title, what it does, and when it runs', () => {
  const document = renderTree(
    createElement(ScheduledTaskCard, {
      ...noopCard,
      task: task({ intent: { kind: 'text', body: 'Summarise the repository' } }),
    }),
  );
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes('Morning briefing'));
  // The cadence WITH its time of day — "Daily" alone never says when.
  assert.ok(text.includes(describeScheduledTaskCadence(task(), 'en')));
  assert.match(text, /9:00/, 'the chip carries the hour the task runs');
  // Two lines of the instructions, because a title the model wrote does not
  // say what the run does.
  assert.ok(text.includes('Summarise the repository'), 'the instructions');
  // One chip, no next-run line and no run-outcome chip: the card is a title,
  // what it does, and when.
  assert.equal(document.querySelectorAll('h3').length, 1);
  assert.ok(document.querySelector(`[aria-label="${modules.rowActions('Morning briefing')}"]`));
  assert.ok(document.querySelector(`[aria-label="${page.openTask('Morning briefing')}"]`));
  for (const button of document.querySelectorAll('button')) {
    const named = (button.textContent ?? '').trim().length > 0 || button.hasAttribute('aria-label');
    assert.ok(named, 'every card control has an accessible name');
  }
});

test('a task that is not running says its status where the cadence would be', () => {
  for (const status of ['paused', 'completed', 'expired'] as const) {
    const document = renderTree(
      createElement(ScheduledTaskCard, {
        ...noopCard,
        task: task({ status, nextFireAt: null }),
      }),
    );
    const text = document.documentElement.textContent ?? '';
    assert.ok(text.includes(catalog.status[status]), `${status} names itself`);
    assert.ok(
      !text.includes(describeScheduledTaskCadence(task(), 'en')),
      `${status} does not advertise a cadence it will not keep`,
    );
  }
});

test('only a paused task offers to be re-armed, and only a live one to be paused', () => {
  assert.deepEqual(scheduledTaskCardActions(task()), {
    pause: true,
    resume: false,
    snooze: true,
    edit: true,
  });
  assert.deepEqual(scheduledTaskCardActions(task({ status: 'paused', nextFireAt: null })), {
    pause: false,
    resume: true,
    snooze: false,
    edit: true,
  });
  // Completed and expired are spent: the Host refuses to re-arm either, so the
  // menu must not offer it.
  for (const status of ['completed', 'expired'] as const) {
    // A spent task refuses every write, editing included.
    assert.deepEqual(scheduledTaskCardActions(task({ status, nextFireAt: null })), {
      pause: false,
      resume: false,
      snooze: false,
      edit: false,
    });
  }
  // A live task whose next fire is already gone has nothing to push back.
  assert.equal(scheduledTaskCardActions(task({ nextFireAt: null })).snooze, false);
});

test('the card menu carries a glyph on every row and repeats nothing the card does', () => {
  // Opening the task is the card's own click, and duplicating one is not
  // something the reference offers — both were rows that made the menu longer
  // without adding a reach.
  const document = renderTree(createElement(ScheduledTaskCard, { ...noopCard, task: task() }));
  const text = document.documentElement.textContent ?? '';
  assert.ok(!text.includes(page.open), 'no Open row');
  assert.ok(!text.includes(catalog.page.duplicate), 'no Duplicate row');
});

test('scheduled cards announce unread output without replacing their open or menu actions', () => {
  for (const unread of [true, false]) {
    const document = renderTree(
      createElement(ScheduledTaskCard, {
        ...noopCard,
        task: task(),
        unread,
      }),
    );
    const body = document.querySelector('[data-card-body]');
    assert.equal(body?.getAttribute('aria-description'), unread ? page.unreadRun : null);
    assert.equal(body?.getAttribute('aria-label'), page.openTask(task().title));
    assert.ok(document.querySelector(`button[aria-label="${modules.rowActions(task().title)}"]`));
  }
});

// ── the detail page ────────────────────────────────────────────────────────

const noopDetail = {
  unreadSessionIds: new Set<string>(),
  busy: null,
  projectName: undefined,
  modelLabel: 'Default model',
  onToggle: () => {},
  onRun: () => {},
  onEdit: () => {},
  onDelete: () => {},
  onOpenSession: () => {},
};

test('the detail page carries everything the card deliberately leaves out', () => {
  const document = renderTree(
    createElement(ScheduledTaskDetail, {
      ...noopDetail,
      task: task({ intent: { kind: 'text', body: 'Summarise the repository' } }),
    }),
  );
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes('Morning briefing'), 'the title');
  assert.ok(text.includes('Summarise the repository'), 'the instructions, in full');
  assert.ok(text.includes(describeScheduledTaskCadence(task(), 'en')), 'the cadence');
  // No breadcrumb here — the window titlebar draws it (`ScheduledTaskIdentity`),
  // because that is the row the reference puts it in.
  assert.ok(!text.includes(catalog.page.title));
});

test('run history links only the runs that produced a session', () => {
  const document = renderTree(
    createElement(ScheduledTaskDetail, {
      ...noopDetail,
      task: task({
        runs: [
          { id: 'r2', at: NOW - 1000, outcome: 'failed', message: 'Delivery refused' },
          { id: 'r1', at: NOW - 9000, outcome: 'ok', message: 'Sent', sessionId: 'session-7' },
        ],
      }),
    }),
  );
  const text = document.documentElement.textContent ?? '';
  assert.equal(document.querySelectorAll('li').length, 2);
  assert.ok(text.includes(catalog.runStatus.failed));
  // The failure message is the point of the record, and the run that failed has
  // no session to open — so it shows the reason instead of a dead row.
  assert.ok(text.includes('Delivery refused'));
  const links = [...document.querySelectorAll('li button')];
  assert.equal(links.length, 1, 'only the run with a session is a button');
});

test('history marks only unread sessions and clears every row sharing a read session', () => {
  const parseKey = (id: string) => ({ sessionId: JSON.parse(id)[1] as string });
  const runs = [
    { id: 'unread', at: NOW, message: '', outcome: 'ok' as const, sessionId: 'shared' },
    {
      id: 'same-session',
      at: NOW - 1000,
      message: '',
      outcome: 'failed' as const,
      sessionId: 'shared',
    },
    { id: 'read', at: NOW - 2000, message: '', outcome: 'ok' as const, sessionId: 'read' },
    { id: 'no-session', at: NOW - 3000, message: '', outcome: 'failed' as const },
  ];
  for (const hasUnread of [true, false]) {
    const unreadSessionIds = unreadHostSessionIds(
      [
        { id: '["host","shared"]', hasUnread },
        { id: '["host","read"]', hasUnread: false },
        { id: 'invalid-key', hasUnread: true },
      ],
      parseKey,
    );
    const document = renderTree(
      createElement(ScheduledTaskDetail, {
        ...noopDetail,
        task: task({ runs }),
        unreadSessionIds,
      }),
    );
    assert.equal(
      document.querySelectorAll(`button[aria-description="${page.unreadRun}"]`).length,
      hasUnread ? 2 : 0,
    );
    assert.equal(
      document.querySelectorAll(`[title="${page.unreadRun}"]`).length,
      hasUnread ? 2 : 0,
    );
    assert.equal(document.querySelectorAll('li button').length, 3);
    assert.ok(document.documentElement.textContent?.includes(catalog.runStatus.failed));
  }
});

test('history badges only the runs that did not happen', () => {
  // The reference's history is a list of times and nothing else — a run that
  // went fine is the ordinary case. Maka keeps a chip for the runs the
  // reference has none of, because a scheduled run has nobody watching and
  // this list is the only place that says it did not happen.
  const document = renderTree(
    createElement(ScheduledTaskDetail, {
      ...noopDetail,
      task: task({
        runs: [
          { id: 'r3', at: NOW - 1000, outcome: 'blocked', message: 'Approval never came' },
          { id: 'r2', at: NOW - 5000, outcome: 'failed', message: 'Delivery refused' },
          { id: 'r1', at: NOW - 9000, outcome: 'ok', message: 'Sent', sessionId: 'session-7' },
        ],
      }),
    }),
  );
  const text = document.documentElement.textContent ?? '';
  assert.ok(!text.includes(catalog.runStatus.ok), 'a successful run says only when it ran');
  assert.ok(text.includes(catalog.runStatus.blocked), 'a blocked run says so');
  assert.ok(text.includes(catalog.runStatus.failed), 'a failed run says so');
});

test('the live chip names the switch beside it, not the page it sits on', () => {
  const document = renderTree(createElement(ScheduledTaskDetail, { ...noopDetail, task: task() }));
  const text = document.documentElement.textContent ?? '';
  assert.ok(text.includes(catalog.status.active), 'the live status names itself');
  assert.equal(catalog.status.active, 'Active');
});

test('a task that has never run says so instead of showing an empty list', () => {
  const document = renderTree(
    createElement(ScheduledTaskDetail, { ...noopDetail, task: task({ runs: [] }) }),
  );
  assert.ok((document.documentElement.textContent ?? '').includes(catalog.detail.noRuns));
  assert.equal(document.querySelectorAll('li').length, 0);
});

test('a paused task does not advertise a next run it will not act on', () => {
  const live = renderTree(createElement(ScheduledTaskDetail, { ...noopDetail, task: task() }));
  assert.ok((live.documentElement.textContent ?? '').includes(catalog.detail.nextRun));
  const paused = renderTree(
    createElement(ScheduledTaskDetail, { ...noopDetail, task: task({ status: 'paused' }) }),
  );
  const text = paused.documentElement.textContent ?? '';
  assert.ok(!text.includes(catalog.detail.nextRun), 'a paused task keeps quiet about it');
  assert.ok(text.includes(catalog.status.paused));
});

// ── the form payload ───────────────────────────────────────────────────────

const fields = (patch: Partial<ScheduledTaskFormFields> = {}): ScheduledTaskFormFields => ({
  ...createScheduledTaskFormSeed({}, NOW),
  title: 'Nightly sweep',
  note: 'Check the queue',
  frequency: 'daily',
  timeLocal: '09:00',
  collaborationMode: 'agent',
  orchestrationMode: 'default',
  ...patch,
});

test('the form authors the session a firing will open, not a delivery channel', () => {
  const effect = scheduledTaskEffectFromFields(
    fields({
      workspace: { projectId: 'project-1', cwd: '/repo' },
      model: { kind: 'pinned', llmConnectionId: 'conn-1', llmConnectionSlug: 'relx', model: 'm' },
      permissionMode: 'ask',
    }),
  );
  assert.equal(effect.kind, 'agent_run');
  if (effect.kind !== 'agent_run') return;
  assert.equal(effect.execution.cwd, '/repo');
  assert.equal(effect.execution.projectId, 'project-1');
  assert.equal(effect.execution.permissionMode, 'ask');
  assert.deepEqual(effect.execution.model, {
    kind: 'pinned',
    llmConnectionId: 'conn-1',
    llmConnectionSlug: 'relx',
    model: 'm',
  });
});

test('following the default model is stored as a choice, not as a snapshot of it', () => {
  const effect = scheduledTaskEffectFromFields(fields());
  assert.equal(effect.kind, 'agent_run');
  if (effect.kind !== 'agent_run') return;
  // Storing today's default would quietly pin it; the point of this choice is
  // that changing the default moves the task.
  assert.deepEqual(effect.execution.model, { kind: 'default' });
});

test('an edit that leaves the cadence alone omits it, so a snoozed fire survives', () => {
  const seeded = scheduledTaskEditSeed(task(), NOW);
  const untouched = { ...fields(), ...seeded, title: 'Renamed briefing' };
  // The Host keeps a pending (snoozed) fire only when the patch says nothing
  // about the schedule; an identical schedule would still reset it (#5226).
  const renamed = updateScheduledTaskInputFromFields(untouched, seeded, NOW);
  assert.equal(renamed?.title, 'Renamed briefing');
  assert.equal(renamed?.schedule, undefined);
  const moved = updateScheduledTaskInputFromFields(
    { ...untouched, timeLocal: '17:30' },
    seeded,
    NOW,
  );
  assert.equal(moved?.schedule?.kind, 'calendar');
  // A create has nothing to leave alone.
  assert.ok(createScheduledTaskInputFromFields(fields(), NOW)?.schedule);
});

test('a rename does not rewrite how the task runs', () => {
  // The form rebuilds the WHOLE execution template on every save, and it shows
  // only three of its settings. A task an agent froze with thinking on, in a
  // non-default collaboration mode, used to come back changed after the user
  // did nothing but rename it — the four fields the dialog does not show were
  // re-defaulted instead of carried.
  const frozen = {
    cwd: '/repo',
    projectId: null,
    model: { kind: 'default' as const },
    permissionMode: 'ask' as const,
    collaborationMode: 'plan' as const,
    orchestrationMode: 'swarm' as const,
    thinkingLevel: 'high' as const,
    toolMode: 'code_mode' as const,
  };
  const source = task({ effect: { kind: 'agent_run', execution: frozen } });
  const seed = scheduledTaskEditSeed(source, NOW);
  const patch = updateScheduledTaskInputFromFields({ ...seed, title: 'Renamed' }, seed, NOW);
  assert.equal(patch?.title, 'Renamed');
  assert.equal(patch?.effect?.kind, 'agent_run');
  if (patch?.effect?.kind !== 'agent_run') return;
  assert.deepEqual(patch.effect.execution, frozen, 'every setting survives the rename');
});

test("a reminder's binding to the session that asked for it outranks the form", () => {
  const bound = { kind: 'session_resume', sessionId: 'session-7' } as const;
  assert.deepEqual(scheduledTaskEffectFromFields(fields({ lockedEffect: bound })), bound);
});

test('duplicating a task drops its identity and keeps the work', () => {
  const source = task({ title: 'Morning briefing' });
  const seed = scheduledTaskDuplicateSeed(source, 'en', NOW);
  assert.equal(seed.editingId, null, 'a duplicate creates rather than overwrites');
  assert.equal(seed.title, `${source.title}${catalog.duplicateSuffix}`);
  assert.equal(seed.note, source.intent.body);
  assert.equal(seed.lockedEffect, undefined, 'a copy is not bound to the original’s session');
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
    assert.ok(copy.openTask('X').includes('X'));
    for (const value of [copy.open, copy.pause, copy.resume]) {
      assert.ok(value.trim().length > 0, `${locale} says something`);
    }
  }
  // Two locales sharing a translated string is how a catalog goes stale
  // unnoticed; the two Chinese scripts differ on the sort orders here.
  const zhCn = getScheduledPageCopy('zh-CN');
  const zhTw = getScheduledPageCopy('zh-TW');
  assert.notEqual(zhCn.sortOptions[0]?.[1], zhTw.sortOptions[0]?.[1]);
});

test('every cadence renders in every locale, and never leaks a bare timestamp', () => {
  const schedules: ScheduledTask['schedule'][] = [
    { kind: 'once', runAt: NOW },
    { kind: 'calendar', recurrence: 'daily', anchorAt: NOW },
    { kind: 'calendar', recurrence: 'weekly', anchorAt: NOW },
    { kind: 'calendar', recurrence: 'monthly', anchorAt: NOW },
    { kind: 'interval', everySeconds: 3600, startAt: NOW },
    { kind: 'cron', expression: '0 9 * * 1-5', startAt: NOW },
  ];
  for (const locale of UI_LOCALES) {
    for (const schedule of schedules) {
      const phrase = describeScheduledTaskCadence(task({ schedule }), locale);
      assert.ok(phrase.trim().length > 0, `${locale}/${schedule.kind} says something`);
      assert.ok(!phrase.includes(String(NOW)), `${locale}/${schedule.kind} formats its time`);
    }
    // The three calendar cadences must read differently from one another, or
    // a weekly task would be indistinguishable from a daily one on the card.
    const [, daily, weekly, monthly] = schedules.map((schedule) =>
      describeScheduledTaskCadence(task({ schedule }), locale),
    );
    assert.equal(new Set([daily, weekly, monthly]).size, 3, `${locale} tells them apart`);
  }
  // The monthly phrase carries the day the schedule is anchored to.
  assert.match(
    describeScheduledTaskCadence(
      task({
        schedule: { kind: 'calendar', recurrence: 'monthly', anchorAt: NOW },
      }),
      'en',
    ),
    /11th/,
  );
});

test('the sidebar counts unread RUNS, by session, and says nothing about the read ones', () => {
  // The reference's trailing slot is "N new" — runs that produced output
  // nobody has opened. Maka already tracks it per Session (`hasUnread`, set by
  // the Host and cleared by opening); this only has to ask the right question.
  const unread = new Set(['s-new-1', 's-new-2']);
  const counts = unreadRunsByTask(
    [
      {
        id: 'two-unread',
        runs: [{ sessionId: 's-new-1' }, { sessionId: 's-new-2' }, { sessionId: 's-read' }],
      },
      // SendLater delivers several fires into ONE session: that is one thing to
      // read, not three, so it counts once.
      {
        id: 'one-session-many-fires',
        runs: [{ sessionId: 's-new-1' }, { sessionId: 's-new-1' }, { sessionId: 's-new-1' }],
      },
      { id: 'all-read', runs: [{ sessionId: 's-read' }] },
      // A run that never produced a session (it failed before admission) is
      // nothing to open, so it is nothing to count.
      { id: 'never-ran', runs: [{}] },
    ],
    unread,
  );
  assert.equal(counts.get('two-unread'), 2);
  assert.equal(counts.get('one-session-many-fires'), 1);
  // Absent, not zero: the row shows the slot only when there is something in it.
  assert.equal(counts.has('all-read'), false);
  assert.equal(counts.has('never-ran'), false);
});

test('Scheduled navigation announces unread results and removes the indicator when read', () => {
  for (const unreadLabel of ['3 new', undefined]) {
    const document = renderTree(
      createElement(SidebarNavButton, {
        icon: null,
        label: 'Scheduled',
        isActive: true,
        unreadLabel,
        onSelect: () => {},
      }),
    );
    const button = document.querySelector('button');
    assert.equal(button?.getAttribute('aria-label'), 'Scheduled');
    assert.equal(button?.getAttribute('aria-current'), 'page');
    assert.equal(button?.getAttribute('aria-description'), unreadLabel ?? null);
    assert.equal(document.querySelector('[title="3 new"]') !== null, !!unreadLabel);
  }
});

test('a run session knows the task it came from, through the key it is stored under', () => {
  // The session header reads "Scheduled / <name>" and its first crumb opens the
  // TASK, so the header has to resolve one from the other. A run records the
  // HOST session id while a Session is keyed by [hostId, sessionId]; comparing
  // those raw once crashed the sidebar, so the parse is part of the contract.
  const parse = (key: string) => ({ sessionId: JSON.parse(key)[1] as string });
  const tasks = [
    { id: 'task-a', runs: [{ sessionId: 'host-1' }, { sessionId: 'host-2' }] },
    { id: 'task-b', runs: [{ sessionId: 'host-3' }] },
  ];
  assert.equal(
    scheduledTaskIdForSession(tasks, JSON.stringify(['host-x', 'host-2']), parse),
    'task-a',
  );
  assert.equal(
    scheduledTaskIdForSession(tasks, JSON.stringify(['host-x', 'host-3']), parse),
    'task-b',
  );
  // An ordinary chat belongs to no task, and the header keeps its project crumb.
  assert.equal(
    scheduledTaskIdForSession(tasks, JSON.stringify(['host-x', 'host-9']), parse),
    undefined,
  );
  // A key this build cannot parse is not a reason to throw inside a header.
  assert.equal(scheduledTaskIdForSession(tasks, 'not-a-key', parse), undefined);
});

test('the session on screen always has a row, even when the rail hides it', () => {
  // A scheduled task's runs are kept out of the rail on purpose. Looking the
  // open Session up in `rows` therefore found nothing, and the window titlebar
  // went blank — no task crumb, no session name — for exactly the sessions this
  // whole band exists to send people into.
  const session = (id: string, labels: readonly string[]) => ({
    id,
    name: id,
    status: 'idle' as const,
    labels,
    isFlagged: false,
    isArchived: false,
    hasUnread: false,
    createdAt: NOW,
    updatedAt: NOW,
    lastMessageAt: NOW,
    statusUpdatedAt: NOW,
    backend: 'ai-sdk' as const,
  });
  const build = (activeId: string | undefined) =>
    buildSessionListModel({
      sessions: [session('chat', []), session('run', ['scheduled-task'])] as never,
      activeId,
      filter: '',
      mode: 'time',
      projects: [],
      now: NOW,
      copy: getSidebarCopy('en'),
    });

  const onRun = build('run');
  assert.equal(onRun.activeRow?.id, 'run', 'the open run has a row to name');
  assert.deepEqual(
    onRun.rows.map((row) => row.id),
    ['chat'],
    'and it still never reaches the rail',
  );

  const onChat = build('chat');
  assert.equal(onChat.activeRow?.id, 'chat');
  assert.deepEqual(
    onChat.rows.map((row) => row.id),
    ['chat'],
  );
  assert.equal(build(undefined).activeRow, undefined, 'nothing open, nothing to name');
});
