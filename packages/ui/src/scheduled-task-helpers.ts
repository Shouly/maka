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

/**
 * Pure helpers and presentation data for the ScheduledTaskPanel.
 *
 * PR-UI-LIB-EXTRACT-0 (WAWQAQ msg `510fef52`): pulled out of the
 * 8753-line `components.tsx` kitchen-sink. All 24 helpers in this
 * file are pure logic (no React, no JSX); the example-templates const
 * and its type were also lifted here so the panel file imports a
 * single coherent helper module instead of intermingling logic with
 * its JSX. The cut is byte-for-byte equivalent — nothing renamed, no
 * behavior change, no consumers outside `components.tsx` so the
 * surface is unchanged.
 *
 * Why this file exists separately from the panel: pure helpers are
 * far cheaper to unit-test in isolation than nested inside a 6700-
 * line tsx file, and the file split documents the natural seam
 * between "what to render" and "how to compute display state".
 */

import type { CollaborationMode } from '@maka/core/collaboration';
import type { ThinkingLevel } from '@maka/core/model-thinking';
import type { OrchestrationMode } from '@maka/core/orchestration';
import type { PermissionMode } from '@maka/core/permission';
import type { ToolMode } from '@maka/core/tool-mode';
import type {
  ScheduledTask,
  ScheduledTaskEffect,
  ScheduledTaskModelChoice,
  ScheduledTaskSchedule,
  ScheduledTaskStatus,
} from '@maka/core/scheduled-task';

import type { UiLocale } from '@maka/core/ui-locale';
import { compileCronExpression } from '@maka/core/cron-expression';
import { uiLocaleToIntlLocale } from '@maka/core/ui-locale';
import { getScheduledTaskCopy } from './scheduled-task-copy.js';

/**
 * How often a task runs, as the FORM offers it.
 *
 * Six rows rather than the schedule union's four kinds, because the two do not
 * line up: `weekdays` is a cron the form authors on the user's behalf, and
 * `interval` is a cadence only an agent can create and the form only ever
 * shows back. Read `ScheduledTaskSchedule` for what is stored.
 */
export type ScheduledTaskFrequency =
  | 'manual'
  | 'once'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly';

/**
 * The cadences the FORM offers, which is not all of them.
 *
 * `once` is missing on purpose: a task that fires once and is spent is what
 * SendLater builds and what a model asks for with `runOnceAt`, not something a
 * person sets up on this page — they came here to make something recurring, and
 * "Manual" already covers "only when I say so". A stored one-shot still opens
 * here; it is shown read-only, like any other cadence the form cannot author.
 */
export const SCHEDULED_TASK_FORM_FREQUENCIES: readonly ScheduledTaskFrequency[] = [
  'manual',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
];

/** The frequencies that need a day as well as a time. */
export function scheduledTaskFrequencyNeeds(frequency: ScheduledTaskFrequency): {
  time: boolean;
  date: boolean;
  weekday: boolean;
  dayOfMonth: boolean;
} {
  return {
    time: frequency !== 'manual',
    date: frequency === 'once',
    weekday: frequency === 'weekly',
    dayOfMonth: frequency === 'monthly',
  };
}


export type ScheduledTaskValidationField = 'title' | 'note' | 'workspace' | 'time';

export function scheduledTaskFormValidation(input: {
  title: string;
  note: string;
  /** Whether a project or folder has been chosen to run in. */
  hasWorkspace: boolean;
  parsedRunAt: number;
  /** A one-off must be in the future; a repeating cadence need not be. */
  oneOff: boolean;
  now: number;
}, locale: UiLocale): { field: ScheduledTaskValidationField; message: string } | null {
  const copy = getScheduledTaskCopy(locale).validation;
  if (input.title.trim().length === 0) {
    return { field: 'title', message: copy.title };
  }
  // Every task now RUNS something, so the instructions are as required as the
  // name: a task with nothing to do would open a session and sit there.
  if (input.note.trim().length === 0) {
    return { field: 'note', message: copy.note };
  }
  // The form opens with nothing chosen, like the reference — but the reference
  // can fall back to its own cloud sandbox and Maka cannot: a run happens in a
  // real directory on this machine, and the Host rejects a template with a
  // blank cwd. So the choice is asked for here rather than guessed at.
  if (!input.hasWorkspace) {
    return { field: 'workspace', message: copy.workspace };
  }
  if (!Number.isFinite(input.parsedRunAt)) {
    return { field: 'time', message: copy.timeInvalid };
  }
  // Only a ONE-OFF can be scheduled into the past. A repeating cadence whose
  // next slot today has already gone simply runs tomorrow.
  if (input.oneOff && input.parsedRunAt <= input.now) {
    return { field: 'time', message: copy.timePast };
  }
  return null;
}

export function compareScheduledTaskForDisplay(a: ScheduledTask, b: ScheduledTask, locale: UiLocale): number {
  const statusDelta = scheduledTaskStatusDisplayRank(a) - scheduledTaskStatusDisplayRank(b);
  if (statusDelta !== 0) return statusDelta;
  if (a.status === 'active' && b.status === 'active') {
    return scheduledTaskNextRunSortValue(a) - scheduledTaskNextRunSortValue(b);
  }
  if (a.status === 'completed' && b.status === 'completed') {
    return scheduledTaskLastRunSortValue(b) - scheduledTaskLastRunSortValue(a);
  }
  return a.title.localeCompare(b.title, uiLocaleToIntlLocale(locale));
}

export function compareScheduledTaskBySort(a: ScheduledTask, b: ScheduledTask, sort: 'created-desc' | 'next-run-asc' | 'updated-desc', locale: UiLocale): number {
  if (sort === 'created-desc') {
    return b.createdAt - a.createdAt || compareScheduledTaskForDisplay(a, b, locale);
  }
  if (sort === 'updated-desc') {
    return b.updatedAt - a.updatedAt || compareScheduledTaskForDisplay(a, b, locale);
  }
  return compareScheduledTaskForDisplay(a, b, locale);
}

function scheduledTaskStatusDisplayRank(task: ScheduledTask): number {
  if (task.status === 'active') return 0;
  if (task.status === 'paused') return 1;
  if (task.status === 'completed') return 2;
  return 3;
}

function scheduledTaskNextRunSortValue(task: ScheduledTask): number {
  return task.nextFireAt ?? Number.MAX_SAFE_INTEGER;
}

function scheduledTaskLastRunSortValue(task: ScheduledTask): number {
  return task.runs[0]?.at ?? 0;
}

export function normalizeScheduledTaskSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function scheduledTaskMatchesSearch(task: ScheduledTask, query: string, locale: UiLocale): boolean {
  return scheduledTaskSearchText(task, locale).toLocaleLowerCase().includes(query);
}

export function scheduledTaskSearchText(task: ScheduledTask, locale: UiLocale): string {
  return [
    task.title,
    task.intent.body,
    task.status,
    formatScheduledTaskRecurrence(task, locale),
    formatScheduledTaskDeliveryTargetLabel(task.effect, locale),
    task.runs[0]?.message,
    ...task.runs.map((run) => `${runStatusLabel(run.outcome, locale)} ${run.message}`),
  ].filter(Boolean).join('\n');
}

export function scheduledTaskStatusGroupLabel(status: ScheduledTaskStatus, locale: UiLocale): string {
  return getScheduledTaskCopy(locale).status[status];
}

export function scheduledTaskStatusLabel(status: ScheduledTaskStatus, locale: UiLocale): string {
  return scheduledTaskStatusGroupLabel(status, locale);
}


/**
 * The moment the form should show when an existing task is opened for editing.
 *
 * The next fire if there is one, else whatever the schedule was anchored at,
 * else an hour from now — a manual task has neither, and the form still has to
 * put something in the time field for the moment the user picks a cadence.
 */
export function scheduledTaskEditableRunAt(task: ScheduledTask, now: number = Date.now()): number {
  if (task.nextFireAt !== null && task.nextFireAt > now) return task.nextFireAt;
  const schedule = task.schedule;
  const scheduledAt =
    schedule.kind === 'once'
      ? schedule.runAt
      : schedule.kind === 'calendar'
        ? schedule.anchorAt
        : schedule.kind === 'manual'
          ? null
          : schedule.startAt;
  if (scheduledAt !== null && scheduledAt > now) return scheduledAt;
  return now + 60 * 60 * 1000;
}

export function duplicateScheduledTaskTitle(title: string, locale: UiLocale): string {
  const suffix = getScheduledTaskCopy(locale).duplicateSuffix;
  if (title.endsWith(suffix)) return title;
  return `${title}${suffix}`.slice(0, 120);
}

/**
 * A moment this task ran or will run, written the way the reference writes it:
 * "yesterday at 9:10 AM", "Sep 13 at 9:09 AM".
 *
 * Only TODAY and YESTERDAY get names. The reference names no other day, and
 * the two places this appears already carry the rest: the next-run line has a
 * countdown beside it ("in 2 days"), and history only ever looks backwards.
 *
 * The year is added only when it is not this one — a bare "Sep 13" a year old
 * reads as last week.
 */
export function formatTaskTime(ts: number, locale: UiLocale, now: number = Date.now()): string {
  const copy = getScheduledTaskCopy(locale).dayTime;
  const intlLocale = uiLocaleToIntlLocale(locale);
  const at = new Date(ts);
  const time = new Intl.DateTimeFormat(intlLocale, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
  const elapsedDays = calendarDaysBetween(now, ts);
  if (elapsedDays === 0) return copy.today(time);
  if (elapsedDays === 1) return copy.yesterday(time);
  const day = new Intl.DateTimeFormat(intlLocale, {
    ...(at.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
  }).format(at);
  return copy.on(day, time);
}

/**
 * Whole LOCAL calendar days from `to` back to `from` — not elapsed hours, so a
 * run at 23:50 is "yesterday" at 00:10 rather than "today". Rounding absorbs
 * the 23- and 25-hour days a DST change makes.
 */
function calendarDaysBetween(from: number, to: number): number {
  const a = new Date(from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(to);
  b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Small chip next to the absolute
 * next-run time so the user sees both "what" and "when from now"
 * in one glance. Past-due tasks read as "已过期"; very near
 * (< 60s) reads "马上"; the rest read in minute / hour / day
 * buckets so screen-reader users get a single self-contained
 * label.
 */
export function formatTaskCountdown(ts: number, locale: UiLocale, now: number = Date.now()): string {
  const copy = getScheduledTaskCopy(locale).countdown;
  const diffMs = ts - now;
  if (diffMs <= -60_000) return copy.overdue;
  if (diffMs < 60_000) return copy.soon;
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 60) return copy.minutes(diffMin);
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return copy.hours(diffHour);
  const diffDay = Math.round(diffHour / 24);
  if (diffDay === 1) return copy.tomorrow;
  if (diffDay < 7) return copy.days(diffDay);
  if (diffDay < 30) return copy.weeks(Math.round(diffDay / 7));
  return copy.months(Math.round(diffDay / 30));
}

export function formatScheduledTaskRecurrence(task: ScheduledTask, locale: UiLocale): string {
  const copy = getScheduledTaskCopy(locale).recurrence;
  const schedule = task.schedule;
  if (schedule.kind === 'once') return copy.once;
  if (schedule.kind === 'manual') return copy.manual;
  if (schedule.kind === 'cron') return copy.cron(schedule.expression);
  if (schedule.kind === 'calendar') return copy.recurring[schedule.recurrence];
  return copy.interval(schedule.everySeconds);
}

/**
 * Just the clock face, for a cadence that already says which days it means.
 *
 * `hour: 'numeric'`, so English reads "9:00 AM" like the reference's Repeats
 * line rather than "09:00 AM" — and so a cadence and a run time on the same
 * page are written the same way.
 */
export function formatTaskTimeOfDay(ts: number, locale: UiLocale): string {
  return new Intl.DateTimeFormat(uiLocaleToIntlLocale(locale), {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts));
}

/**
 * The same clock face from a bare hour and minute.
 *
 * A cron expression carries wall-clock numbers and no date, so there is
 * nothing to hand `Intl` directly; this borrows an arbitrary local day to get
 * the reader's own 12- or 24-hour convention applied to them.
 */
export function formatClockTime(hour: number, minute: number, locale: UiLocale): string {
  const borrowed = new Date();
  borrowed.setHours(hour, minute, 0, 0);
  return formatTaskTimeOfDay(borrowed.getTime(), locale);
}

/**
 * The whole schedule in one chip's worth of words — the reference design's
 * `describeSchedule`: "Every day at 09:00", "Every Monday at 09:00",
 * "Once on 09/15, 09:00".
 *
 * A calendar schedule carries its `anchorAt`, so the time of day is read off
 * the schedule itself rather than off `nextFireAt`: a task that has been
 * snoozed, or that has no next fire because it is paused, still says the hour
 * it normally runs.
 *
 * Interval and cron keep `formatScheduledTaskRecurrence`'s wording. A cron
 * expression is the one cadence with no sentence to render it into — the user
 * wrote the expression, and inventing "every weekday at 9" out of `0 9 * * 1-5`
 * would be a guess about a grammar this app does not otherwise parse.
 */
/** "Monday" in the reader's language, from a 0–6 weekday. */
function weekdayName(weekday: number, locale: UiLocale): string {
  // 2026-01-04 is a Sunday, so adding the index lands on the right day.
  const date = new Date(Date.UTC(2026, 0, 4 + weekday));
  return new Intl.DateTimeFormat(uiLocaleToIntlLocale(locale), {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(date);
}

export function describeScheduledTaskCadence(task: ScheduledTask, locale: UiLocale): string {
  const copy = getScheduledTaskCopy(locale).cadence;
  const schedule = task.schedule;
  if (schedule.kind === 'once') return copy.once(formatTaskTime(schedule.runAt, locale));
  // A cron the FORM wrote has a sentence, because the form wrote it from one of
  // the six rows and `scheduledTaskFrequencyOf` reads it back. Only a cron with
  // no row of its own falls through to its raw expression — that one really is
  // the user's own grammar, not ours. Without this the sidebar said "Weekdays"
  // and the card beside it said `Cron: 0 9 * * 1-5` about the same task.
  if (schedule.kind === 'cron') {
    const read = scheduledTaskFrequencyOf(schedule);
    if (read?.hour === undefined) return formatScheduledTaskRecurrence(task, locale);
    const cronTime = formatClockTime(read.hour, read.minute ?? 0, locale);
    if (read.frequency === 'daily') return copy.daily(cronTime);
    if (read.frequency === 'weekdays') return copy.weekdays(cronTime);
    if (read.frequency === 'weekly' && read.weekday !== undefined) {
      return copy.weekly(weekdayName(read.weekday, locale), cronTime);
    }
    if (read.frequency === 'monthly' && read.dayOfMonth !== undefined) {
      return copy.monthly(read.dayOfMonth, cronTime);
    }
    return formatScheduledTaskRecurrence(task, locale);
  }
  if (schedule.kind !== 'calendar') return formatScheduledTaskRecurrence(task, locale);
  const anchor = new Date(schedule.anchorAt);
  const time = formatTaskTimeOfDay(schedule.anchorAt, locale);
  if (schedule.recurrence === 'daily') return copy.daily(time);
  if (schedule.recurrence === 'weekly') {
    return copy.weekly(weekdayName(anchor.getDay(), locale), time);
  }
  return copy.monthly(anchor.getDate(), time);
}

export function runStatusLabel(status: ScheduledTask['runs'][number]['outcome'], locale: UiLocale): string {
  return getScheduledTaskCopy(locale).runStatus[status];
}

/**
 * Where a firing lands, in one phrase.
 *
 * Two answers now, not four: a task opens its own session, or — SendLater's
 * alone — it comes back into the one that made it.
 */
export function formatScheduledTaskDeliveryTargetLabel(
  effect: ScheduledTaskEffect,
  locale: UiLocale,
): string {
  const copy = getScheduledTaskCopy(locale).detail;
  return effect.kind === 'session_resume' ? copy.resumeDelivery : copy.agentDelivery;
}

/**
 * Initial field values for the scheduled-task form dialog
 * (ScheduledTaskFormDialog, issue #1044). The panel builds one seed per open
 * (create / template / edit / duplicate) and the dialog mounts with it, so
 * the seeds are pure mappings — they live here with the other form helpers,
 * not in the component file.
 */
/**
 * What the create/edit dialog holds.
 *
 * The dialog authors an EXECUTION TEMPLATE now, not a delivery channel: a task
 * is a session that will be opened, so the form has to say where it runs
 * (`workspace`), on what (`model`) and how careful to be (`permissionMode`).
 *
 * The cadence is kept as separate day/time fields rather than one timestamp
 * because that is how it is chosen — "every Monday at 09:00" is a weekday and
 * a clock face, and rebuilding it from a single `datetime-local` loses which
 * half the user meant.
 */
export interface ScheduledTaskFormSeed {
  editingId: string | null;
  /** The form calls this Name; the domain calls it title. */
  title: string;
  /** The form calls this Instructions; the domain calls it the intent body. */
  note: string;
  frequency: ScheduledTaskFrequency;
  /** `YYYY-MM-DD`, for a one-off. */
  dateLocal: string;
  /** `HH:MM`, for every cadence that has a time of day. */
  timeLocal: string;
  /** 0 = Sunday, for a weekly cadence. */
  weekday: number;
  /** 1–31, for a monthly cadence. A short month clamps to its last day. */
  dayOfMonth: number;
  workspace: { projectId: string | null; cwd: string };
  model: ScheduledTaskModelChoice;
  permissionMode: PermissionMode;
  /**
   * The execution settings the dialog does NOT show.
   *
   * They are carried on the seed rather than defaulted at submit time because
   * the form rebuilds the whole execution template on every save: a task an
   * agent froze in a session with thinking on, or in a non-default
   * collaboration mode, would come back changed after the user did nothing but
   * rename it. Carried verbatim, a rename is a rename.
   */
  collaborationMode: CollaborationMode;
  orchestrationMode: OrchestrationMode;
  thinkingLevel?: ThinkingLevel;
  toolMode?: ToolMode;
  /**
   * A cadence this form cannot author: an agent's `interval`, or a cron whose
   * shape does not map onto one of the six rows. Shown read-only and preserved
   * verbatim, because the alternative — rebuilding it from the six rows —
   * silently turns a repeating job into something else.
   */
  lockedSchedule?: ScheduledTaskSchedule;
  /** The schedule the task had when editing began. */
  originalSchedule?: ScheduledTaskSchedule;
  /**
   * A SendLater reminder is bound to the session that asked for it. The form
   * may rename it or move it, never re-point it.
   */
  lockedEffect?: Extract<ScheduledTaskEffect, { kind: 'session_resume' }>;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `HH:MM` for a timestamp, in the machine's own time. */
export function toScheduledTaskTimeValue(ts: number): string {
  const date = new Date(ts);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** `YYYY-MM-DD` for a timestamp, in the machine's own time. */
export function toScheduledTaskDateValue(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseTimeOfDay(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || hour > 23 || !Number.isInteger(minute) || minute > 59) return null;
  return { hour, minute };
}

/**
 * The instant a repeating cadence should be anchored to: the NEXT time it
 * comes round.
 *
 * `computeNextFireAt` walks forward from the anchor, so an anchor in the past
 * would still work — but the anchor is also what the detail page reads back as
 * "every Monday at 09:00", and one pointing at a Monday five weeks ago reads as
 * a stale task. Walking forward here keeps the stored anchor and the sentence
 * about it the same fact.
 */
export function scheduledTaskAnchorAt(
  seed: Pick<ScheduledTaskFormSeed, 'frequency' | 'timeLocal' | 'weekday' | 'dayOfMonth' | 'dateLocal'>,
  now: number = Date.now(),
): number {
  const time = parseTimeOfDay(seed.timeLocal);
  if (!time) return Number.NaN;
  if (seed.frequency === 'once') {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(seed.dateLocal.trim());
    if (!day) return Number.NaN;
    return new Date(
      Number(day[1]),
      Number(day[2]) - 1,
      Number(day[3]),
      time.hour,
      time.minute,
      0,
      0,
    ).getTime();
  }
  const at = (offsetDays: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + offsetDays);
    date.setHours(time.hour, time.minute, 0, 0);
    return date;
  };
  // 400 days covers a monthly cadence on the 29th through a non-leap year.
  for (let offset = 0; offset < 400; offset += 1) {
    const candidate = at(offset);
    if (candidate.getTime() <= now) continue;
    if (seed.frequency === 'daily') return candidate.getTime();
    if (seed.frequency === 'weekdays') {
      const day = candidate.getDay();
      if (day >= 1 && day <= 5) return candidate.getTime();
      continue;
    }
    if (seed.frequency === 'weekly') {
      if (candidate.getDay() === seed.weekday) return candidate.getTime();
      continue;
    }
    if (candidate.getDate() === seed.dayOfMonth) return candidate.getTime();
  }
  return Number.NaN;
}

/**
 * The schedule the form's fields describe.
 *
 * `weekdays` is the one row with no schedule kind of its own, so it is written
 * as the cron the reference writes: Monday to Friday at one time. Keeping it
 * as a first-class row matters because an agent creating `0 9 * * 1-5` would
 * otherwise come back into the form as a single weekday.
 */
export function scheduledTaskScheduleFromSeed(
  seed: ScheduledTaskFormSeed,
  now: number = Date.now(),
): ScheduledTaskSchedule | null {
  // A locked cadence wins over every row, `manual` included: the row is only
  // the fallback the seed picked because the stored schedule had none, and
  // letting it through would turn an agent's hourly job into a task that never
  // runs on its own again.
  if (seed.lockedSchedule) return seed.lockedSchedule;
  if (seed.frequency === 'manual') return { kind: 'manual' };
  const anchorAt = scheduledTaskAnchorAt(seed, now);
  if (!Number.isFinite(anchorAt)) return null;
  // Reachable only from a seed built by hand (a test, or a caller that set the
  // row directly); the form's own dropdown no longer offers it.
  if (seed.frequency === 'once') return { kind: 'once', runAt: anchorAt };
  if (seed.frequency === 'weekdays') {
    const time = parseTimeOfDay(seed.timeLocal);
    if (!time) return null;
    return { kind: 'cron', expression: `${time.minute} ${time.hour} * * 1-5`, startAt: now };
  }
  return { kind: 'calendar', recurrence: seed.frequency, anchorAt };
}

/**
 * The cadence a stored schedule reads back as.
 *
 * A cron is matched against the four shapes the form can write, so a task an
 * agent created with `0 9 * * 1-5` opens on the Weekdays row rather than as
 * raw cron. Anything else — `*\/15 * * * *`, a multi-field list — has no row
 * and comes back `null`, which is the form's signal to show it read-only.
 */
export function scheduledTaskFrequencyOf(
  schedule: ScheduledTaskSchedule,
): { frequency: ScheduledTaskFrequency; hour?: number; minute?: number; weekday?: number; dayOfMonth?: number } | null {
  if (schedule.kind === 'manual') return { frequency: 'manual' };
  if (schedule.kind === 'once') {
    const at = new Date(schedule.runAt);
    return { frequency: 'once', hour: at.getHours(), minute: at.getMinutes() };
  }
  if (schedule.kind === 'calendar') {
    const at = new Date(schedule.anchorAt);
    return {
      frequency: schedule.recurrence,
      hour: at.getHours(),
      minute: at.getMinutes(),
      weekday: at.getDay(),
      dayOfMonth: at.getDate(),
    };
  }
  if (schedule.kind !== 'cron') return null;
  const fields = schedule.expression.trim().split(/\s+/u);
  if (fields.length !== 5) return null;
  const [rawMinute, rawHour, rawDayOfMonth, rawMonth, rawWeekday] = fields as [
    string,
    string,
    string,
    string,
    string,
  ];
  const minute = Number(rawMinute);
  const hour = Number(rawHour);
  if (!Number.isInteger(minute) || minute > 59 || !Number.isInteger(hour) || hour > 23) return null;
  if (rawMonth !== '*') return null;
  if (rawDayOfMonth === '*' && rawWeekday === '*') return { frequency: 'daily', hour, minute };
  if (rawDayOfMonth === '*' && rawWeekday === '1-5') {
    return { frequency: 'weekdays', hour, minute };
  }
  if (rawDayOfMonth === '*' && /^[0-6]$/u.test(rawWeekday)) {
    return { frequency: 'weekly', hour, minute, weekday: Number(rawWeekday) };
  }
  if (rawWeekday === '*' && /^([1-9]|[12]\d|3[01])$/u.test(rawDayOfMonth)) {
    return { frequency: 'monthly', hour, minute, dayOfMonth: Number(rawDayOfMonth) };
  }
  return null;
}

/**
 * Blank create-mode seed: manual, on the default model, in NO workspace.
 *
 * A caller that knows where the task belongs — an agent authoring one from the
 * session it is running in — passes a `workspace`; the page's own New button
 * does not, so the person chooses it themselves.
 */
export function createScheduledTaskFormSeed(
  context: {
    workspace?: { projectId: string | null; cwd: string };
    model?: ScheduledTaskModelChoice;
    permissionMode?: PermissionMode;
  } = {},
  now: number = Date.now(),
): ScheduledTaskFormSeed {
  const soon = now + 60 * 60 * 1000;
  return {
    editingId: null,
    title: '',
    note: '',
    // Manual, like the reference's own blank form: a task with no cadence is
    // complete and runnable, and choosing one is a decision the user makes
    // after they know what the task does.
    frequency: 'manual',
    dateLocal: toScheduledTaskDateValue(soon),
    timeLocal: '09:00',
    weekday: new Date(now).getDay(),
    dayOfMonth: new Date(now).getDate(),
    workspace: context.workspace ?? { projectId: null, cwd: '' },
    model: context.model ?? { kind: 'default' },
    // A scheduled run has nobody there to approve anything, so the form starts
    // on the setting that lets one finish. The user can still ask for the
    // careful one; the help line under the control says what that costs.
    permissionMode: context.permissionMode ?? 'bypass',
    collaborationMode: 'agent',
    orchestrationMode: 'default',
  };
}

function scheduledTaskFormSeedFromTask(task: ScheduledTask, now: number): ScheduledTaskFormSeed {
  const read = scheduledTaskFrequencyOf(task.schedule);
  const fallback = scheduledTaskEditableRunAt(task, now);
  const execution = task.effect.kind === 'agent_run' ? task.effect.execution : undefined;
  return {
    editingId: task.id,
    title: task.title,
    note: task.intent.body,
    frequency: read?.frequency ?? 'manual',
    dateLocal: toScheduledTaskDateValue(
      task.schedule.kind === 'once' ? task.schedule.runAt : fallback,
    ),
    timeLocal:
      read?.hour === undefined
        ? toScheduledTaskTimeValue(fallback)
        : `${pad2(read.hour)}:${pad2(read.minute ?? 0)}`,
    weekday: read?.weekday ?? new Date(fallback).getDay(),
    dayOfMonth: read?.dayOfMonth ?? new Date(fallback).getDate(),
    workspace: {
      projectId: execution?.projectId ?? null,
      cwd: execution?.cwd ?? '',
    },
    model: execution?.model ?? { kind: 'default' },
    permissionMode: execution?.permissionMode ?? 'bypass',
    // Verbatim, so a rename does not rewrite how the task runs.
    collaborationMode: execution?.collaborationMode ?? 'agent',
    orchestrationMode: execution?.orchestrationMode ?? 'default',
    ...(execution?.thinkingLevel === undefined ? {} : { thinkingLevel: execution.thinkingLevel }),
    ...(execution?.toolMode === undefined ? {} : { toolMode: execution.toolMode }),
    originalSchedule: task.schedule,
    // A cadence with no row of its own is carried, not rebuilt.
    ...(read === null || !SCHEDULED_TASK_FORM_FREQUENCIES.includes(read.frequency)
      ? { lockedSchedule: task.schedule }
      : {}),
    ...(task.effect.kind === 'session_resume' ? { lockedEffect: task.effect } : {}),
  };
}

/** Edit-mode seed prefilled from an existing task. */
export function scheduledTaskEditSeed(
  task: ScheduledTask,
  now: number = Date.now(),
): ScheduledTaskFormSeed {
  return scheduledTaskFormSeedFromTask(task, now);
}

/** Create-mode seed copying an existing task under a "copy" title. */
export function scheduledTaskDuplicateSeed(
  task: ScheduledTask,
  locale: UiLocale,
  now: number = Date.now(),
): ScheduledTaskFormSeed {
  const seed = scheduledTaskFormSeedFromTask(task, now);
  // A copy is a NEW task, so it may not inherit the original's binding to the
  // session that asked for it — that session is not asking for this one.
  const { lockedEffect: _bound, originalSchedule: _was, ...rest } = seed;
  return { ...rest, editingId: null, title: duplicateScheduledTaskTitle(task.title, locale) };
}
