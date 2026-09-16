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
import { describe, it } from 'node:test';
import { markPersisted } from '../persisted-value.js';
import {
  computeNextFireAt,
  decodePersistedScheduledTask,
  isScheduledTaskDue,
  nextScheduledTaskStateAfterFire,
  normalizeCreateScheduledTaskInput,
  pauseScheduledTask,
  resumeScheduledTask,
  type ScheduledTask,
} from '../scheduled-task.js';

describe('scheduled-task catalog', () => {
  // `manual` is the kind the form creates by default and the one nothing here
  // covered. Its invariant is unusual and easy to break by accident: a run does
  // NOT spend it, so a null `nextFireAt` must never be read as an exhausted
  // schedule — only a fire budget or an expiry may end it.
  const manualTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
    id: 'manual-1',
    title: 'Manual',
    intent: { kind: 'text', body: 'run me when asked' },
    schedule: { kind: 'manual' },
    effect: { kind: 'session_resume', sessionId: 'session-1' },
    status: 'active',
    nextFireAt: null,
    lastFireAt: null,
    fireCount: 0,
    maxFires: null,
    expiresAt: null,
    createdBy: { kind: 'user' },
    createdAt: 0,
    updatedAt: 0,
    runs: [],
    lastError: null,
    ...overrides,
  });
  const fire = (at: number) => ({ id: `r${at}`, at, outcome: 'ok' as const, message: 'ran' });

  it('never makes a manual task due, and running one does not spend it', () => {
    assert.equal(computeNextFireAt({ kind: 'manual' }, 1_000), null);
    assert.equal(isScheduledTaskDue(manualTask(), 10_000_000), false);

    const after = nextScheduledTaskStateAfterFire(manualTask(), fire(5_000));
    assert.equal(after.status, 'active', 'still waiting to be asked again');
    assert.equal(after.nextFireAt, null);
    assert.equal(after.fireCount, 1);
    // And again, any number of times.
    const twice = nextScheduledTaskStateAfterFire(after, fire(6_000));
    assert.equal(twice.status, 'active');
    assert.equal(twice.fireCount, 2);
  });

  it('ends a manual task only on its fire budget or its expiry', () => {
    const budgeted = nextScheduledTaskStateAfterFire(manualTask({ maxFires: 1 }), fire(5_000));
    assert.equal(budgeted.status, 'completed');
    assert.equal(budgeted.nextFireAt, null);

    const expired = nextScheduledTaskStateAfterFire(manualTask({ expiresAt: 4_000 }), fire(5_000));
    assert.equal(expired.status, 'expired');
  });

  it('pausing and resuming a manual task leaves it with no next fire', () => {
    const paused = pauseScheduledTask(manualTask(), 1_000);
    assert.equal(paused.status, 'paused');
    const resumed = resumeScheduledTask(paused, 2_000);
    assert.ok(!('error' in resumed), 'a paused manual task can be resumed');
    if ('error' in resumed) return;
    assert.equal(resumed.status, 'active');
    // Resume recomputes the next fire for every other kind; for this one there
    // is nothing to compute, and a number here would make it fire by itself.
    assert.equal(resumed.nextFireAt, null);
  });

  it('advances once schedules to completed after fire', () => {
    const task: ScheduledTask = {
      id: 't1',
      title: 'Once',
      intent: { kind: 'text', body: 'hi' },
      schedule: { kind: 'once', runAt: 1000 },
      effect: { kind: 'session_resume', sessionId: 'session-1' },
      status: 'active',
      nextFireAt: 1000,
      lastFireAt: null,
      fireCount: 0,
      maxFires: null,
      expiresAt: null,
      createdBy: { kind: 'user' },
      createdAt: 0,
      updatedAt: 0,
      runs: [],
      lastError: null,
    };
    const next = nextScheduledTaskStateAfterFire(task, {
      id: 'r1',
      at: 1000,
      outcome: 'ok',
      message: 'done',
    });
    assert.equal(next.status, 'completed');
    assert.equal(next.nextFireAt, null);
    assert.equal(next.fireCount, 1);
  });

  it('pause and resume preserve a pending occurrence', () => {
    const now = Date.UTC(2026, 0, 5, 8, 0, 0);
    const next = computeNextFireAt({ kind: 'interval', everySeconds: 3600, startAt: now }, now);
    assert.ok(next);
    const task: ScheduledTask = {
      id: 't2',
      title: 'Hourly',
      intent: { kind: 'text', body: 'tick' },
      schedule: { kind: 'interval', everySeconds: 3600, startAt: now },
      effect: { kind: 'session_resume', sessionId: 'session-1' },
      status: 'active',
      nextFireAt: next,
      lastFireAt: null,
      fireCount: 0,
      maxFires: null,
      expiresAt: null,
      createdBy: { kind: 'user' },
      createdAt: now,
      updatedAt: now,
      runs: [],
      lastError: null,
    };
    assert.equal(isScheduledTaskDue(task, next), true);
    const paused = pauseScheduledTask(task, now + 1);
    assert.equal(paused.status, 'paused');
    assert.equal(paused.nextFireAt, next);
    assert.equal(isScheduledTaskDue(paused, next), false);
    const resumed = resumeScheduledTask(paused, now + 2);
    assert.ok(!('error' in resumed));
    if ('error' in resumed) return;
    assert.equal(resumed.status, 'active');
    assert.equal(resumed.nextFireAt, next);
  });

  it('resume recomputes an occurrence that elapsed while paused', () => {
    const now = Date.UTC(2026, 0, 5, 8, 0, 0);
    const pending = now + 10 * 60_000;
    const task: ScheduledTask = {
      id: 'snoozed-daily',
      title: 'Daily',
      intent: { kind: 'text', body: 'tick' },
      schedule: { kind: 'calendar', recurrence: 'daily', anchorAt: now },
      effect: { kind: 'session_resume', sessionId: 'session-1' },
      status: 'paused',
      nextFireAt: pending,
      lastFireAt: null,
      fireCount: 0,
      maxFires: null,
      expiresAt: null,
      createdBy: { kind: 'user' },
      createdAt: now,
      updatedAt: now,
      runs: [],
      lastError: null,
    };

    const resumed = resumeScheduledTask(task, pending + 1);
    assert.ok(!('error' in resumed));
    if ('error' in resumed) return;
    assert.equal(resumed.nextFireAt, computeNextFireAt(task.schedule, pending + 1));
  });

  it('does not resume a task whose fire budget is already spent', () => {
    const task: ScheduledTask = {
      id: 'spent',
      title: 'Spent',
      intent: { kind: 'text', body: '' },
      schedule: { kind: 'interval', everySeconds: 60, startAt: 0 },
      effect: { kind: 'session_resume', sessionId: 'session-1' },
      status: 'paused',
      nextFireAt: null,
      lastFireAt: 60_000,
      fireCount: 1,
      maxFires: 1,
      expiresAt: null,
      createdBy: { kind: 'user' },
      createdAt: 0,
      updatedAt: 60_000,
      runs: [],
      lastError: null,
    };
    assert.deepEqual(resumeScheduledTask(task, 120_000), {
      error: 'Scheduled task fire budget is exhausted',
    });
  });

  it('treats resume as a target state: an already-active task comes back untouched', () => {
    const task: ScheduledTask = {
      id: 'live',
      title: 'Live',
      intent: { kind: 'text', body: 'go' },
      schedule: { kind: 'interval', everySeconds: 60, startAt: 0 },
      effect: { kind: 'session_resume', sessionId: 'session-1' },
      status: 'active',
      nextFireAt: 120_000,
      lastFireAt: null,
      fireCount: 0,
      maxFires: null,
      expiresAt: null,
      createdBy: { kind: 'user' },
      createdAt: 0,
      updatedAt: 0,
      runs: [],
      lastError: null,
    };
    // The SAME object, which is what tells the store to write nothing at all.
    // It used to be `{ error: 'Only paused tasks can be resumed' }` — a failure
    // for a request that was already satisfied.
    assert.equal(resumeScheduledTask(task, 60_000), task);
    // The other half of the pair, which always behaved this way.
    const paused = pauseScheduledTask(task, 1);
    assert.equal(pauseScheduledTask(paused, 2), paused);
    // A terminal task is still refused: "already running" is not true of it.
    assert.deepEqual(resumeScheduledTask({ ...task, status: 'completed' }, 60_000), {
      error: 'Only paused tasks can be resumed',
    });
  });

  it('rejects numeric-string coercion and non-canonical cron spacing', () => {
    const now = Date.UTC(2026, 0, 5, 8, 0, 0);
    for (const schedule of [
      { kind: 'once', runAt: String(now + 60_000) },
      { kind: 'interval', everySeconds: '60', startAt: now },
      { kind: 'interval', everySeconds: 60.5, startAt: now },
      { kind: 'interval', everySeconds: 60, startAt: String(now) },
      { kind: 'cron', expression: '0 9 * * *', startAt: String(now) },
      { kind: 'cron', expression: ' 0 9 * * *', startAt: now },
    ]) {
      assert.equal(
        normalizeCreateScheduledTaskInput(
          {
            title: 'Strict boundary',
            intentBody: 'run it',
            schedule,
            effect: { kind: 'session_resume', sessionId: 'session-1' },
            createdBy: { kind: 'user' },
          },
          now,
        ).ok,
        false,
      );
    }
  });

  it('clamps monthly recurrence to the last calendar day', () => {
    const runAt = new Date(2026, 0, 31, 9, 30).getTime();
    const monthly = { kind: 'calendar' as const, recurrence: 'monthly' as const, anchorAt: runAt };
    const february = computeNextFireAt(monthly, runAt);
    assert.equal(new Date(february!).getDate(), 28);
  });

  it('rejects tasks whose first fire is not before expiration', () => {
    const now = Date.UTC(2026, 0, 5, 8, 0, 0);
    const result = normalizeCreateScheduledTaskInput(
      {
        title: 'Already expired before fire',
        intentBody: 'run it',
        schedule: { kind: 'once', runAt: now + 60_000 },
        effect: { kind: 'session_resume', sessionId: 'session-1' },
        createdBy: { kind: 'user' },
        expiresAt: now + 30_000,
      },
      now,
    );
    assert.deepEqual(result, { ok: false, message: 'Schedule must fire before expiresAt' });
  });

  it('drops a backend key from Automation create input', () => {
    // #3306: `backend` left the template. A caller still sending one — any
    // value, including the retired `'fake'` (#3211) — must not get it frozen
    // into a new record.
    const now = Date.UTC(2026, 0, 5, 8, 0, 0);
    const execution = {
      cwd: '/tmp/project',
      model: {
        kind: 'pinned',
        llmConnectionId: 'connection-anthropic',
        llmConnectionSlug: 'anthropic',
        model: 'claude-sonnet-4-5-20250929',
      },
      permissionMode: 'ask',
      collaborationMode: 'agent',
      orchestrationMode: 'default',
    };
    const create = (backend?: string) =>
      normalizeCreateScheduledTaskInput(
        {
          title: 'Nightly run',
          intentBody: 'do the thing',
          schedule: { kind: 'once', runAt: now + 60_000 },
          effect: {
            kind: 'agent_run',
            execution: backend === undefined ? execution : { ...execution, backend },
          },
          createdBy: { kind: 'user' },
        },
        now,
      );

    for (const backend of [undefined, 'ai-sdk', 'fake']) {
      const result = create(backend);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.effect.kind, 'agent_run');
      if (result.value.effect.kind !== 'agent_run') return;
      assert.equal('backend' in result.value.effect.execution, false);
    }
  });

  it('requires an immutable Connection identity from a task that pins its model', () => {
    const now = Date.UTC(2026, 0, 5, 8, 0, 0);
    const create = (model: unknown) =>
      normalizeCreateScheduledTaskInput(
        {
          title: 'Pinned model',
          intentBody: 'run',
          schedule: { kind: 'once', runAt: now + 60_000 },
          effect: {
            kind: 'agent_run',
            execution: {
              cwd: '/tmp/project',
              model,
              permissionMode: 'ask',
              collaborationMode: 'agent',
              orchestrationMode: 'default',
            },
          },
          createdBy: { kind: 'user' },
        },
        now,
      );
    // A slug is reusable: a deleted-and-recreated Connection with the same slug
    // would take over somebody else's scheduled work, so the id is required.
    assert.deepEqual(create({ kind: 'pinned', llmConnectionSlug: 'anthropic', model: 'claude' }), {
      ok: false,
      message: 'a pinned model requires llmConnectionId',
    });
    // Following the owner's default names no Connection at all, and is fine.
    assert.equal(create({ kind: 'default' }).ok, true);
  });

  it('rejects future recurrence anchors outside the scheduling horizon', () => {
    const now = Date.UTC(2026, 0, 5, 8, 0, 0);
    for (const schedule of [
      { kind: 'interval', everySeconds: 60, startAt: now + 367 * 86_400_000 },
      { kind: 'calendar', recurrence: 'monthly', anchorAt: now + 367 * 86_400_000 },
    ]) {
      const result = normalizeCreateScheduledTaskInput(
        {
          title: 'Too far away',
          intentBody: 'run it',
          schedule,
          effect: { kind: 'session_resume', sessionId: 'session-1' },
          createdBy: { kind: 'user' },
        },
        now,
      );
      assert.deepEqual(result, {
        ok: false,
        message: 'Schedule has no fire within one year from now',
      });
    }
  });
});

describe('decodePersistedScheduledTask', () => {
  const base: ScheduledTask = {
    id: 't1',
    title: 'Nightly',
    intent: { kind: 'text', body: 'run it' },
    schedule: { kind: 'once', runAt: 1000 },
    effect: {
      kind: 'agent_run',
      execution: {
        cwd: '/repo',
        model: {
          kind: 'pinned',
          llmConnectionId: 'connection-anthropic',
          llmConnectionSlug: 'anthropic',
          model: 'claude',
        },
        permissionMode: 'ask',
        collaborationMode: 'agent',
        orchestrationMode: 'default',
      },
    },
    status: 'active',
    nextFireAt: 1000,
    lastFireAt: null,
    fireCount: 0,
    maxFires: null,
    expiresAt: null,
    createdBy: { kind: 'user' },
    createdAt: 0,
    updatedAt: 0,
    runs: [],
    lastError: null,
  };

  const execution = base.effect.kind === 'agent_run' ? base.effect.execution : undefined!;

  it('folds a retired permission mode to its live equivalent', () => {
    const stored = JSON.parse(
      JSON.stringify(base).replace('"permissionMode":"ask"', '"permissionMode":"execute"'),
    ) as ScheduledTask;
    const decoded = decodePersistedScheduledTask(markPersisted<ScheduledTask>(stored));
    assert.equal(
      decoded.effect.kind === 'agent_run' ? decoded.effect.execution.permissionMode : undefined,
      'ask',
    );
  });

  it('returns the same task when nothing needs folding', () => {
    assert.equal(decodePersistedScheduledTask(markPersisted<ScheduledTask>(base)), base);
  });

  it('keeps a task that follows the default model readable', () => {
    const following = {
      ...base,
      effect: {
        kind: 'agent_run' as const,
        execution: { ...execution, model: { kind: 'default' } },
      },
    } as ScheduledTask;
    const decoded = decodePersistedScheduledTask(markPersisted<ScheduledTask>(following));
    assert.equal(decoded.effect.kind, 'agent_run');
    if (decoded.effect.kind !== 'agent_run') return;
    assert.equal(decoded.effect.execution.model.kind, 'default');
  });

  it('leaves effects without an execution template alone', () => {
    const resume: ScheduledTask = {
      ...base,
      effect: { kind: 'session_resume', sessionId: 'session-1' },
    };
    assert.equal(decodePersistedScheduledTask(markPersisted<ScheduledTask>(resume)), resume);
  });

  it('rejects unknown permission modes in persisted execution templates', () => {
    assert.throws(
      () =>
        decodePersistedScheduledTask(
          markPersisted<ScheduledTask>({
            ...base,
            effect: {
              ...base.effect,
              execution: {
                ...(base.effect.kind === 'agent_run' ? base.effect.execution : {}),
                permissionMode: 'future-mode',
              },
            },
          }),
        ),
      /Invalid persisted ScheduledTask permission mode/,
    );
  });

  it('rejects unknown effect kinds in persisted records', () => {
    assert.throws(
      () =>
        decodePersistedScheduledTask(
          markPersisted<ScheduledTask>({ ...base, effect: { kind: 'future-effect' } }),
        ),
      /Invalid persisted ScheduledTask effect/,
    );
  });
});
