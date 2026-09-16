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

// The scheduled-task tool family: what each verb sends to the Host, and the
// two places where a plausible call has to be refused rather than guessed at.
//
// The line worth protecting is the one between ScheduledTaskCreate and
// SendLater. Create opens a FRESH session on every firing; SendLater comes back
// into THIS one, once. A build that let create bind the calling session would
// pass every other test here and quietly turn "every morning at 9" into 365
// turns appended to one conversation.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOOL_NAMES } from '@maka/core/tool-names';
import type { ScheduledTask } from '@maka/core/scheduled-task';
import {
  buildScheduledTaskTools,
  sendLaterTitle,
  type ScheduledTaskToolAuthority,
} from '../scheduled-task-tools.js';
import type { MakaTool } from '../tool-runtime.js';
import { requestCompositionToolSchemas } from '../request-shape.js';

const TASK: ScheduledTask = {
  id: 'task-1',
  title: 'Morning digest',
  intent: { kind: 'text', body: 'summarise the inbox' },
  schedule: { kind: 'cron', expression: '0 9 * * *', startAt: 0 },
  effect: { kind: 'session_resume', sessionId: 's1' },
  status: 'active',
  nextFireAt: 1_000,
  lastFireAt: null,
  fireCount: 0,
  maxFires: null,
  expiresAt: null,
  createdBy: { kind: 'agent', sessionId: 's1' },
  createdAt: 1,
  updatedAt: 1,
  runs: [],
  lastError: null,
};

const NOW = 1_700_000_000_000;

/**
 * What a tool said, whether it succeeded or refused.
 *
 * A refusal is `{ error }` rather than a bare string, because that is the only
 * shape the runtime classifies as a failure — and the loop-gate counts
 * failures. Reading both shapes here keeps the assertions about the WORDS.
 */
function said(result: unknown): string {
  if (
    result &&
    typeof result === 'object' &&
    typeof (result as { error?: unknown }).error === 'string'
  ) {
    return (result as { error: string }).error;
  }
  return String(result);
}

function tools(authority: Partial<ScheduledTaskToolAuthority>): Map<string, MakaTool> {
  const reject = () => {
    throw new Error('unexpected call');
  };
  const built = buildScheduledTaskTools({
    authority: {
      create: reject,
      list: reject,
      update: reject,
      pause: reject,
      resume: reject,
      remove: reject,
      run: reject,
      ...authority,
    } as ScheduledTaskToolAuthority,
    now: () => NOW,
  });
  return new Map(built.map((tool) => [tool.name, tool]));
}

function tool(name: string, authority: Partial<ScheduledTaskToolAuthority>): MakaTool {
  const found = tools(authority).get(name);
  assert.ok(found, `${name} is built`);
  return found;
}

const ctx = { sessionId: 's1' } as never;

// ── the family ─────────────────────────────────────────────────────────────

test('every verb is its own tool, and each says what it is for', () => {
  const built = tools({});
  assert.deepEqual(
    [...built.keys()].sort(),
    [
      TOOL_NAMES.scheduledTaskCreate,
      TOOL_NAMES.scheduledTaskDelete,
      TOOL_NAMES.scheduledTaskList,
      TOOL_NAMES.scheduledTaskRun,
      TOOL_NAMES.scheduledTaskUpdate,
      TOOL_NAMES.sendLater,
    ].sort(),
  );
  for (const one of built.values()) {
    assert.ok(one.description.trim().length > 0, `${one.name} has a description`);
    assert.ok(one.parameters, `${one.name} has a schema`);
  }
  // The one distinction the model must not get wrong is stated in both
  // directions, so whichever tool it is reading points at the other.
  assert.match(built.get(TOOL_NAMES.scheduledTaskCreate)!.description, /FRESH SESSION/u);
  assert.match(built.get(TOOL_NAMES.scheduledTaskCreate)!.description, /SendLater/u);
  assert.match(built.get(TOOL_NAMES.sendLater)!.description, /THIS SESSION/u);
  assert.match(built.get(TOOL_NAMES.sendLater)!.description, /ScheduledTaskCreate/u);
});

// ── create ─────────────────────────────────────────────────────────────────

test('create opens a fresh session, whatever cadence it was given', async () => {
  const seen: unknown[] = [];
  const create = tool(TOOL_NAMES.scheduledTaskCreate, {
    create: async (input) => {
      seen.push(input);
      return TASK;
    },
  });
  await create.impl({ name: 'Digest', prompt: 'do it', cron: '0 9 * * *' }, ctx);
  assert.deepEqual(seen, [
    {
      title: 'Digest',
      intentBody: 'do it',
      schedule: { kind: 'cron', expression: '0 9 * * *' },
      effect: 'agent_run',
      sessionId: 's1',
    },
  ]);
});

test('create with no cadence makes a task that only runs when asked', async () => {
  let schedule: unknown;
  const create = tool(TOOL_NAMES.scheduledTaskCreate, {
    create: async (input) => {
      schedule = input.schedule;
      return { ...TASK, schedule: { kind: 'manual' }, nextFireAt: null };
    },
  });
  const out = await create.impl({ name: 'On demand', prompt: 'do it' }, ctx);
  assert.deepEqual(schedule, { kind: 'manual' });
  assert.match(said(out), /schedule=manual/u);
  // Saying "next fire: never" as a bare em dash would read as a broken task.
  assert.match(said(out), /only runs when asked/u);
});

test('a task the caller wants careful carries its own approval setting', async () => {
  let permissionMode: unknown;
  const create = tool(TOOL_NAMES.scheduledTaskCreate, {
    create: async (input) => {
      permissionMode = input.permissionMode;
      return TASK;
    },
  });
  await create.impl({ name: 'Careful', prompt: 'do it', permissionMode: 'ask' }, ctx);
  assert.equal(permissionMode, 'ask');
});

// ── list ───────────────────────────────────────────────────────────────────

test('list names the id, the schedule and the last run, and nothing longer', async () => {
  const list = tool(TOOL_NAMES.scheduledTaskList, {
    list: async () => [
      { ...TASK, runs: [{ id: 'r1', at: 42, outcome: 'failed', message: 'a page of detail' }] },
    ],
  });
  const out = said(await list.impl({}, ctx));
  assert.match(out, /task-1/u);
  assert.match(out, /cron=0 9 \* \* \*/u);
  assert.match(out, /last=failed@42/u);
  // The run's message belongs to the task's page: a list that carried it would
  // cost the turn a page of context per task.
  assert.ok(!out.includes('a page of detail'));
});

test('list filters by whether a task is running and whether it repeats', async () => {
  const rows: ScheduledTask[] = [
    { ...TASK, id: 'live-cron' },
    { ...TASK, id: 'paused-cron', status: 'paused' },
    { ...TASK, id: 'one-shot', schedule: { kind: 'once', runAt: 5 } },
  ];
  const list = tool(TOOL_NAMES.scheduledTaskList, { list: async () => rows });
  const enabled = said(await list.impl({ enabled: true }, ctx));
  assert.ok(enabled.includes('live-cron') && enabled.includes('one-shot'));
  assert.ok(!enabled.includes('paused-cron'));
  const once = said(await list.impl({ recurring: false }, ctx));
  assert.ok(once.includes('one-shot'));
  assert.ok(!once.includes('live-cron'));
});

test('a long catalog says how much it left out rather than truncating silently', async () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({ ...TASK, id: `task-${index}` }));
  const list = tool(TOOL_NAMES.scheduledTaskList, { list: async () => rows });
  const out = said(await list.impl({ limit: 2 }, ctx));
  assert.match(out, /3 more/u);
});

// ── update ─────────────────────────────────────────────────────────────────

test('update sends only the fields the caller named, and reports them back', async () => {
  const seen: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const update = tool(TOOL_NAMES.scheduledTaskUpdate, {
    update: async (id, patch) => {
      seen.push({ id, patch: patch as Record<string, unknown> });
      return { ...TASK, title: 'Evening digest', nextFireAt: 2_000 };
    },
  });
  const out = said(await update.impl({ taskId: 'task-1', name: 'Evening digest' }, ctx));
  assert.deepEqual(seen, [{ id: 'task-1', patch: { title: 'Evening digest' } }]);
  assert.match(out, /Updated Evening digest \(task-1\)/u);
  assert.match(out, /changed=name/u);
});

test('a one-shot time replaces a cron in place, keeping the task', async () => {
  let patch: Record<string, unknown> | undefined;
  const update = tool(TOOL_NAMES.scheduledTaskUpdate, {
    update: async (_id, next) => {
      patch = next as Record<string, unknown>;
      return { ...TASK, schedule: { kind: 'once', runAt: NOW + 60_000 } };
    },
  });
  await update.impl({ taskId: 'task-1', runOnceAt: NOW + 60_000 }, ctx);
  assert.deepEqual(patch, { schedule: { kind: 'once', runAt: NOW + 60_000 } });
});

test('a repeating task can be cleared back to only-when-asked', async () => {
  // Omitting both cadence fields means "leave the schedule alone", so without
  // an explicit clear the only way back was delete-and-recreate — which
  // ScheduledTaskDelete's own description tells the caller not to do.
  let patch: Record<string, unknown> | undefined;
  const update = tool(TOOL_NAMES.scheduledTaskUpdate, {
    update: async (_id, next) => {
      patch = next as Record<string, unknown>;
      return { ...TASK, schedule: { kind: 'manual' }, nextFireAt: null };
    },
  });
  await update.impl({ taskId: 'task-1', manual: true }, ctx);
  assert.deepEqual(patch, { schedule: { kind: 'manual' } });

  // A second schedule alongside it no longer refuses the call — manual is the
  // most specific of the three and wins, and the caller is told so.
  const clash = await update.impl({ taskId: 'task-1', manual: true, cron: '0 9 * * *' }, ctx);
  assert.match(said(clash), /cron was ignored/u);
  assert.deepEqual(patch, { schedule: { kind: 'manual' } });
});

test('enabled is routed to pause and resume, not to a field the store ignores', async () => {
  const calls: string[] = [];
  const paused = tool(TOOL_NAMES.scheduledTaskUpdate, {
    pause: async (id) => {
      calls.push(`pause:${id}`);
      return { ...TASK, status: 'paused' };
    },
  });
  const out = said(await paused.impl({ taskId: 'task-1', enabled: false }, ctx));
  assert.deepEqual(calls, ['pause:task-1']);
  assert.match(out, /changed=paused/u);
});

test('a refused enabled flip names the fields the same call already wrote', async () => {
  const update = tool(TOOL_NAMES.scheduledTaskUpdate, {
    update: async () => ({ ...TASK, title: 'Renamed' }),
    resume: async () => ({ error: 'Scheduled task fire budget is exhausted' }),
  });
  const result = await update.impl({ taskId: 'task-1', name: 'Renamed', enabled: true }, ctx);
  const out = said(result);
  assert.match(out, /fire budget is exhausted/u);
  // The rename is already committed when the flip refuses. A bare failure
  // hides that, and a caller told only "it failed" sends the whole call again.
  assert.match(out, /the rest of the update was applied \(name\)/u);
});

test('an update that names nothing is refused rather than reported as a success', async () => {
  const update = tool(TOOL_NAMES.scheduledTaskUpdate, {});
  const out = said(await update.impl({ taskId: 'task-1' }, ctx));
  assert.match(out, /requires at least one field/u);
});

// ── run ────────────────────────────────────────────────────────────────────

test('run passes its extra context through for that firing only', async () => {
  const seen: Array<[string, string | undefined]> = [];
  const run = tool(TOOL_NAMES.scheduledTaskRun, {
    run: async (id, text) => {
      seen.push([id, text]);
      return TASK;
    },
  });
  await run.impl({ taskId: 'task-1', text: 'CI failed on main' }, ctx);
  assert.deepEqual(seen, [['task-1', 'CI failed on main']]);
  assert.match(run.description, /outside of its schedule/u);
});

// ── send later ─────────────────────────────────────────────────────────────

test('send later binds THIS session, once, and never repeats', async () => {
  let input: Parameters<ScheduledTaskToolAuthority['create']>[0] | undefined;
  const later = tool(TOOL_NAMES.sendLater, {
    create: async (next) => {
      input = next;
      return { ...TASK, id: 'later-1' };
    },
  });
  const out = said(await later.impl({ message: 'check the build', delayMinutes: 90 }, ctx));
  assert.equal(input?.effect, 'session_resume');
  assert.equal(input?.sessionId, 's1');
  assert.equal(input?.maxFires, 1, 'a reminder fires once and is done');
  assert.deepEqual(input?.schedule, { kind: 'once', runAt: NOW + 90 * 60_000 });
  // The id is the only way to take it back before it fires, so the reply says so.
  assert.match(out, /later-1/u);
  assert.match(out, new RegExp(TOOL_NAMES.scheduledTaskDelete, 'u'));
});

test('send later takes exactly one of a delay and a time', async () => {
  const later = tool(TOOL_NAMES.sendLater, {});
  for (const args of [{ message: 'x' }, { message: 'x', delayMinutes: 10, at: NOW + 60_000 }]) {
    assert.match(said(await later.impl(args, ctx)), /exactly one/u);
  }
  assert.match(said(await later.impl({ message: 'x', at: NOW - 1 }, ctx)), /already passed/u);
});

test('an unnamed reminder is labelled from its own message', () => {
  assert.equal(sendLaterTitle('  check   the build  '), 'check the build');
  const long = sendLaterTitle('x'.repeat(200));
  assert.equal([...long].length, 60);
  assert.ok(long.endsWith('…'));
});

test('the schedule fields say that omitting BOTH of them is a real choice', async () => {
  // A model reported the create tool as unusable: it read the two "Mutually
  // exclusive with …" sentences as "supply one of these", saw that supplying
  // both is refused, and concluded the schema could not be satisfied. Nothing
  // in the parameter descriptions said that a task with no schedule at all is
  // the third option — that fact lived only in the tool blurb, and the
  // reference states it on the field itself.
  const create = tool(TOOL_NAMES.scheduledTaskCreate, {});
  // Read back through the same projection the model is served, so this pins
  // what it actually sees rather than what the Zod source happens to hold.
  const [schema] = requestCompositionToolSchemas([create], [create.name]);
  assert.ok(schema, 'the create tool is projected');
  const inputSchema = schema.inputSchema as {
    required?: string[];
    properties?: Record<string, { description?: string }>;
  };
  const properties = inputSchema.properties;
  assert.deepEqual(
    inputSchema.required,
    ['name', 'prompt'],
    'a schedule is never one of the required fields',
  );
  for (const field of ['cron', 'runOnceAt'] as const) {
    const description = properties?.[field]?.description ?? '';
    assert.match(description, /Mutually exclusive/u, `${field} still excludes the other`);
    assert.match(description, /Omit both/u, `${field} says omitting both is allowed`);
  }
  // And the tool itself says which fields are actually required, so the
  // exclusion can never be read as an obligation.
  assert.match(create.description, /OPTIONAL/u);
  assert.match(create.description, /only name and prompt are required/u);
  // The claim has to stay true of the behaviour, not just the prose.
  let created: { schedule?: unknown } | undefined;
  const runnable = tool(TOOL_NAMES.scheduledTaskCreate, {
    create: async (next) => {
      created = next;
      return TASK;
    },
  });
  await runnable.impl({ name: 'Manual only', prompt: 'say hello' }, ctx);
  assert.deepEqual(created?.schedule, { kind: 'manual' });
});

test('a call that sends both schedules is resolved, not refused', async () => {
  // The refusal this replaces cost a real user 36 consecutive failing calls in
  // one turn: the model wanted one firing, believed it also had to fill cron,
  // and tried "/dev/null", then "0 0 31 2 *" (February 31st — valid syntax, a
  // date that never occurs), then the same instant re-encoded as a cron. The
  // tool knew exactly what was wanted every time and refused anyway.
  let created: { schedule?: unknown } | undefined;
  const create = tool(TOOL_NAMES.scheduledTaskCreate, {
    create: async (next) => {
      created = next;
      return TASK;
    },
  });
  const out = String(
    await create.impl(
      { name: 'One shot', prompt: 'say hello', cron: '0 0 31 2 *', runOnceAt: NOW + 60_000 },
      ctx,
    ),
  );
  assert.deepEqual(created?.schedule, { kind: 'once', runAt: NOW + 60_000 });
  // Resolved, never silently: the caller is told which field won.
  assert.match(out, /fires ONCE at runOnceAt/u);
  assert.match(out, /0 0 31 2 \*/u);
  assert.doesNotMatch(out, /conflicting fields/u);
});

test('update resolves competing schedules by specificity instead of refusing', async () => {
  const patches: unknown[] = [];
  const update = tool(TOOL_NAMES.scheduledTaskUpdate, {
    update: async (_id, patch) => {
      patches.push(patch);
      return { ...TASK, schedule: { kind: 'manual' } };
    },
  });
  // manual beats everything: it is the only one that says "clear the schedule".
  const manualOut = String(
    await update.impl(
      { taskId: 't', manual: true, runOnceAt: NOW + 60_000, cron: '0 9 * * *' },
      ctx,
    ),
  );
  assert.deepEqual(patches[0], { schedule: { kind: 'manual' } });
  assert.match(manualOut, /runOnceAt and cron were ignored/u);

  // and an instant beats a recurrence the caller had no reason to send with it.
  const onceTask = { ...TASK, schedule: { kind: 'once' as const, runAt: NOW + 60_000 } };
  const onceUpdate = tool(TOOL_NAMES.scheduledTaskUpdate, {
    update: async (_id, patch) => {
      patches.push(patch);
      return onceTask;
    },
  });
  const onceOut = String(
    await onceUpdate.impl({ taskId: 't', runOnceAt: NOW + 60_000, cron: '0 9 * * *' }, ctx),
  );
  assert.deepEqual(patches[1], { schedule: { kind: 'once', runAt: NOW + 60_000 } });
  assert.match(onceOut, /cron was ignored/u);
  assert.doesNotMatch(onceOut, /conflicting fields/u);
});

test('a refusal is shaped as a failure, so the loop-gate can count it', async () => {
  // 36 identical failing calls in one real turn got through because every
  // refusal here was a bare string, which `deriveToolResultStatus` classifies
  // as SUCCESS. The loop-gate counts consecutive failures, so it saw an
  // unbroken run of successes and never fired. The shape is the contract.
  const update = tool(TOOL_NAMES.scheduledTaskUpdate, {});
  const refused = await update.impl({ taskId: 'task-1' }, ctx);
  assert.ok(
    refused !== null && typeof refused === 'object',
    'a refusal is an object, not a string',
  );
  assert.equal(typeof (refused as { error?: unknown }).error, 'string');
  assert.ok((refused as { error: string }).error.length > 0);

  const later = tool(TOOL_NAMES.sendLater, {});
  const clash = await later.impl({ message: 'x', delayMinutes: 10, at: NOW + 60_000 }, ctx);
  assert.equal(typeof (clash as { error?: unknown }).error, 'string');

  // A success stays a plain string, so the model reads it as a result.
  const ok = tool(TOOL_NAMES.scheduledTaskUpdate, {
    update: async () => TASK,
  });
  assert.equal(typeof (await ok.impl({ taskId: 'task-1', name: 'Renamed' }, ctx)), 'string');
});
