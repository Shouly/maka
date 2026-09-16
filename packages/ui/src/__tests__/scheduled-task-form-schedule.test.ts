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

// The two directions between a stored schedule and the six rows the form
// offers. They have to agree: a task opened for editing and saved again
// without touching anything must come back as the schedule it went in as.

import assert from 'node:assert/strict';
import test from 'node:test';
import type { ScheduledTask, ScheduledTaskSchedule } from '@maka/core/scheduled-task';
import {
  createScheduledTaskFormSeed,
  describeScheduledTaskCadence,
  scheduledTaskAnchorAt,
  scheduledTaskEditSeed,
  scheduledTaskFrequencyOf,
  scheduledTaskScheduleFromSeed,
  formatTaskTime,
} from '../scheduled-task-helpers.js';

// A Sunday, so "next Monday" and "tomorrow" are different days.
const NOW = new Date(2026, 8, 13, 9, 0).getTime();

function task(schedule: ScheduledTaskSchedule): ScheduledTask {
  return {
    id: 'task-1',
    title: 'Briefing',
    intent: { kind: 'text', body: 'do it' },
    schedule,
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
    nextFireAt: NOW + 60_000,
    lastFireAt: null,
    fireCount: 0,
    maxFires: null,
    expiresAt: null,
    createdBy: { kind: 'user' },
    createdAt: NOW,
    updatedAt: NOW,
    runs: [],
    lastError: null,
  };
}

// ── reading a schedule back into the form ──────────────────────────────────

test('the four cron shapes the form writes are the four it can read back', () => {
  assert.deepEqual(scheduledTaskFrequencyOf({ kind: 'cron', expression: '30 9 * * *', startAt: 0 }), {
    frequency: 'daily',
    hour: 9,
    minute: 30,
  });
  // Weekdays is why this mapping exists: without its own row, "0 9 * * 1-5"
  // would open as a single weekday and be saved back as one.
  assert.deepEqual(scheduledTaskFrequencyOf({ kind: 'cron', expression: '0 9 * * 1-5', startAt: 0 }), {
    frequency: 'weekdays',
    hour: 9,
    minute: 0,
  });
  assert.deepEqual(scheduledTaskFrequencyOf({ kind: 'cron', expression: '0 17 * * 5', startAt: 0 }), {
    frequency: 'weekly',
    hour: 17,
    minute: 0,
    weekday: 5,
  });
  assert.deepEqual(scheduledTaskFrequencyOf({ kind: 'cron', expression: '0 10 15 * *', startAt: 0 }), {
    frequency: 'monthly',
    hour: 10,
    minute: 0,
    dayOfMonth: 15,
  });
});

test('a cadence with no row of its own reads back as none, not as a wrong row', () => {
  for (const expression of ['*/15 * * * *', '0 9 * * 1,3,5', '0 9 1 1 *', 'not a cron']) {
    assert.equal(
      scheduledTaskFrequencyOf({ kind: 'cron', expression, startAt: 0 }),
      null,
      `${expression} has no row`,
    );
  }
  // An agent's interval cadence likewise.
  assert.equal(
    scheduledTaskFrequencyOf({ kind: 'interval', everySeconds: 3600, startAt: 0 }),
    null,
  );
});

test('a cadence the form cannot author is carried verbatim rather than rebuilt', () => {
  const interval: ScheduledTaskSchedule = { kind: 'interval', everySeconds: 3600, startAt: 0 };
  const seed = scheduledTaskEditSeed(task(interval), NOW);
  assert.deepEqual(seed.lockedSchedule, interval);
  // Saving without touching it returns the same schedule, not a one-shot.
  assert.deepEqual(scheduledTaskScheduleFromSeed(seed, NOW), interval);
});

test('a manual task reads back as manual and stays manual', () => {
  const seed = scheduledTaskEditSeed(task({ kind: 'manual' }), NOW);
  assert.equal(seed.frequency, 'manual');
  assert.equal(seed.lockedSchedule, undefined, 'manual is a row, not an unreadable cadence');
  assert.deepEqual(scheduledTaskScheduleFromSeed(seed, NOW), { kind: 'manual' });
});

// ── writing the form back out ──────────────────────────────────────────────

test('each row writes the schedule kind that can express it', () => {
  const base = { ...createScheduledTaskFormSeed({}, NOW), timeLocal: '09:30' };
  assert.deepEqual(scheduledTaskScheduleFromSeed({ ...base, frequency: 'manual' }, NOW), {
    kind: 'manual',
  });
  assert.equal(
    scheduledTaskScheduleFromSeed({ ...base, frequency: 'daily' }, NOW)?.kind,
    'calendar',
  );
  // Weekdays has no calendar recurrence, so it is the cron the reference writes.
  assert.deepEqual(scheduledTaskScheduleFromSeed({ ...base, frequency: 'weekdays' }, NOW), {
    kind: 'cron',
    expression: '30 9 * * 1-5',
    startAt: NOW,
  });
});

test('a repeating cadence is anchored to the next time it comes round, never the last', () => {
  const base = { ...createScheduledTaskFormSeed({}, NOW), timeLocal: '08:00' };
  // 08:00 today is already gone at 09:00, so daily anchors tomorrow.
  const daily = scheduledTaskAnchorAt({ ...base, frequency: 'daily' }, NOW);
  assert.ok(daily > NOW);
  assert.equal(new Date(daily).getDate(), new Date(NOW).getDate() + 1);

  // Weekly on a Friday, asked on a Sunday.
  const weekly = scheduledTaskAnchorAt({ ...base, frequency: 'weekly', weekday: 5 }, NOW);
  assert.equal(new Date(weekly).getDay(), 5);
  assert.ok(weekly > NOW);

  // Weekdays skips the weekend rather than anchoring on it.
  const weekdays = scheduledTaskAnchorAt({ ...base, frequency: 'weekdays' }, NOW);
  const day = new Date(weekdays).getDay();
  assert.ok(day >= 1 && day <= 5, 'a weekday cadence anchors on a weekday');
});

test('a round trip through the form leaves an editable cadence unchanged', () => {
  const cases: ScheduledTaskSchedule[] = [
    { kind: 'manual' },
    { kind: 'cron', expression: '0 9 * * 1-5', startAt: NOW },
    { kind: 'calendar', recurrence: 'daily', anchorAt: new Date(2026, 8, 14, 9, 0).getTime() },
    { kind: 'calendar', recurrence: 'weekly', anchorAt: new Date(2026, 8, 18, 17, 0).getTime() },
  ];
  for (const schedule of cases) {
    const seed = scheduledTaskEditSeed(task(schedule), NOW);
    const written = scheduledTaskScheduleFromSeed(seed, NOW);
    assert.ok(written, `${schedule.kind} round-trips`);
    assert.equal(written.kind, schedule.kind, `${schedule.kind} keeps its kind`);
    if (written.kind === 'cron' && schedule.kind === 'cron') {
      assert.equal(written.expression, schedule.expression);
    }
    if (written.kind === 'calendar' && schedule.kind === 'calendar') {
      assert.equal(written.recurrence, schedule.recurrence);
      const wrote = new Date(written.anchorAt);
      const was = new Date(schedule.anchorAt);
      assert.equal(wrote.getHours(), was.getHours(), 'the hour survives');
      assert.equal(wrote.getMinutes(), was.getMinutes(), 'the minute survives');
      if (schedule.recurrence === 'weekly') {
        assert.equal(wrote.getDay(), was.getDay(), 'the weekday survives');
      }
    }
  }
});

test('a cron the form wrote reads back as its own row, not as a raw expression', () => {
  // The sidebar recognised these and the card did not, so one task described
  // itself two ways: "Weekdays" in the rail, `Cron: 0 9 * * 1-5` on the card.
  const say = (expression: string) =>
    describeScheduledTaskCadence(task({ kind: 'cron', expression, startAt: NOW }), 'en');
  assert.equal(say('0 9 * * *'), 'Every day at 9:00 AM');
  assert.equal(say('0 9 * * 1-5'), 'Every weekday at 9:00 AM');
  assert.equal(say('30 17 * * 5'), 'Every Friday at 5:30 PM');
  assert.equal(say('0 10 15 * *'), '15th of every month at 10:00 AM');
  // A cron with no row of its own is still the user's own grammar, and is
  // shown as what they wrote rather than guessed at.
  assert.match(say('*/15 * * * *'), /\*\/15/u);
});

test('a run time names the day only when the day has a name', () => {
  // The reference's history reads "yesterday at 9:10 AM" and "Sep 13 at
  // 9:09 AM" — today and yesterday by name, everything else by date. The
  // names stay lowercase: the same phrase leads a history row, where CSS
  // capitalizes it, and sits inside "Next run: today at 9:00 AM".
  const at = (year: number, month: number, day: number, hour: number, minute: number) =>
    new Date(year, month, day, hour, minute).getTime();
  assert.equal(formatTaskTime(at(2026, 8, 13, 9, 0), 'en', NOW), 'today at 9:00 AM');
  assert.equal(formatTaskTime(at(2026, 8, 12, 9, 10), 'en', NOW), 'yesterday at 9:10 AM');
  assert.equal(formatTaskTime(at(2026, 8, 11, 9, 9), 'en', NOW), 'Sep 11 at 9:09 AM');
  // A bare "Sep 11" a year old would read as last week.
  assert.equal(formatTaskTime(at(2025, 8, 11, 21, 9), 'en', NOW), 'Sep 11, 2025 at 9:09 PM');
  // Whole CALENDAR days, not elapsed hours: 23:50 last night is yesterday at
  // 00:10 this morning, however few minutes ago it was.
  const justAfterMidnight = new Date(2026, 8, 13, 0, 10).getTime();
  assert.equal(
    formatTaskTime(at(2026, 8, 12, 23, 50), 'en', justAfterMidnight),
    'yesterday at 11:50 PM',
  );
  assert.equal(formatTaskTime(at(2026, 8, 12, 9, 10), 'zh-CN', NOW), '昨天 9:10');
});

test('a blank form is a manual task, so nothing is scheduled by accident', () => {
  const seed = createScheduledTaskFormSeed({}, NOW);
  assert.equal(seed.frequency, 'manual');
  assert.deepEqual(seed.model, { kind: 'default' });
  assert.deepEqual(scheduledTaskScheduleFromSeed(seed, NOW), { kind: 'manual' });
});

test('a duplicate drops the original binding to the session that asked for it', () => {
  const bound = {
    ...task({ kind: 'once', runAt: NOW + 60_000 }),
    effect: { kind: 'session_resume' as const, sessionId: 'session-7' },
  };
  const seed = scheduledTaskEditSeed(bound, NOW);
  assert.deepEqual(seed.lockedEffect, { kind: 'session_resume', sessionId: 'session-7' });
});
