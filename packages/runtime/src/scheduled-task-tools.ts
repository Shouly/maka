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
 * The model's access to the Runtime Host's ScheduledTask catalog.
 *
 * ONE VERB PER TOOL, like the reference set this is ported from
 * (`create_trigger` / `list_triggers` / `update_trigger` / `delete_trigger` /
 * `fire_trigger` / `send_later`). The previous single tool took a `mode`, which
 * put the verb inside the arguments: a model that meant to update and wrote
 * `mode: "create"` made a valid call that did the wrong thing, and every
 * parameter had to be optional because five verbs shared one schema. Separate
 * tools let each verb require exactly what it needs.
 *
 * The split that matters most is the last one. Everything ScheduledTaskCreate
 * builds runs in a FRESH SESSION — the user reads each run on its own, and the
 * task's instructions are all it will ever know. SendLater is the opposite and
 * the only one of its kind: a one-shot message delivered back into THIS
 * conversation, for "remind me in an hour to come back to this".
 */

import { TOOL_NAMES } from '@maka/core/tool-names';
import { z } from 'zod';
import {
  SCHEDULED_TASK_CRON_MAX_CHARS,
  SCHEDULED_TASK_INTENT_MAX_CHARS,
  SCHEDULED_TASK_TITLE_MAX_CHARS,
  type ScheduledTask,
  type ScheduledTaskExecutionTemplate,
} from '@maka/core/scheduled-task';
import type { MakaTool } from './tool-runtime.js';

export const SCHEDULED_TASK_TOOL_NAMES = [
  TOOL_NAMES.scheduledTaskCreate,
  TOOL_NAMES.scheduledTaskList,
  TOOL_NAMES.scheduledTaskUpdate,
  TOOL_NAMES.scheduledTaskDelete,
  TOOL_NAMES.scheduledTaskRun,
  TOOL_NAMES.sendLater,
] as const;

/** How long a SendLater reminder may be pushed out. One year, like every other schedule. */
export const SEND_LATER_MAX_DELAY_MINUTES = 366 * 24 * 60;

export type ScheduledTaskToolSchedule =
  | { kind: 'once'; runAt: number }
  | { kind: 'cron'; expression: string }
  | { kind: 'manual' };

export interface ScheduledTaskToolAuthority {
  create(input: {
    title: string;
    intentBody: string;
    schedule: ScheduledTaskToolSchedule;
    /** `agent_run` opens a fresh Session; `session_resume` is SendLater's alone. */
    effect: 'session_resume' | 'agent_run';
    sessionId: string;
    maxFires?: number;
    /** Only a task the user asked to be careful with sets this. */
    permissionMode?: 'ask';
  }): Promise<ScheduledTask | { error: string }>;
  list(): Promise<readonly ScheduledTask[]>;
  update(
    id: string,
    patch: {
      title?: string;
      intentBody?: string;
      schedule?: ScheduledTaskToolSchedule;
      maxFires?: number | null;
    },
  ): Promise<ScheduledTask | { error: string }>;
  pause(id: string): Promise<ScheduledTask | { error: string }>;
  resume(id: string): Promise<ScheduledTask | { error: string }>;
  remove(id: string): Promise<{ ok: true } | { error: string }>;
  /** Fire once, outside the schedule. `text` rides along for this run only. */
  run(id: string, text?: string): Promise<ScheduledTask | { error: string }>;
}

/* ------------------------------------------------------------------ *
 * Shared vocabulary. Every tool says "scheduled task" the same way.
 * ------------------------------------------------------------------ */

const NAMING_RULE =
  'When telling the user what you did, call these "scheduled tasks" (or whatever the user is calling them) — never "triggers", "routines", or "cron jobs"; those are internal names.';

const taskId = z.string().min(1).describe('The scheduled task id, from ScheduledTaskList.');

// The closing sentence is the reference's, and it is not decoration: without
// it the two fields say only that they exclude each other, and a model reading
// the parameters alone concludes it must supply one — which, paired with the
// refusal of both, reads as a schema that cannot be satisfied. That the fields
// are optional lives in `required`, and that omitting BOTH is a real choice
// has to be said where the fields are described.
const cron = z
  .string()
  .trim()
  .min(9)
  .max(SCHEDULED_TASK_CRON_MAX_CHARS)
  .describe(
    'Standard 5-field cron (minute hour day-of-month month day-of-week), evaluated in the machine’s local time. Mutually exclusive with runOnceAt — if both are sent, runOnceAt wins and this is ignored. Omit both for a scheduled task that never fires on its own schedule and runs only when it is asked to.',
  );

const runOnceAt = z
  .number()
  .int()
  .positive()
  .describe(
    'Epoch milliseconds for a one-shot fire. Must be in the future. Mutually exclusive with cron — if both are sent, this one wins. Omit both for a scheduled task that never fires on its own schedule and runs only when it is asked to.',
  );

/**
 * Both, one, or neither — and none of the three is an error.
 *
 * Neither means a MANUAL task: it never fires on its own and only runs when
 * ScheduledTaskRun or the desktop page asks it to.
 *
 * BOTH used to be refused. That refusal cost a real user 36 consecutive failed
 * calls in one turn: the model wanted a one-shot, believed it had to fill
 * `cron` as well, and tried `/dev/null`, then `0 0 31 2 *` (February 31st — a
 * valid expression that can never occur), then the same instant re-encoded as
 * a cron. It never found the way out, because there was none: the tool knew
 * exactly what was wanted and refused anyway.
 *
 * So both now resolves rather than rejects, and `runOnceAt` wins. The
 * asymmetry is the point: a caller that wants recurrence has no reason to send
 * an instant, while a caller that wants one firing has an obvious reason to
 * send a filler cron. The choice is never silent — `ignoredCron` is reported
 * back so the caller learns what its extra field did.
 */
function scheduleFrom(input: {
  cron?: string | undefined;
  runOnceAt?: number | undefined;
}): ScheduledTaskToolSchedule & { ignoredCron?: string } {
  if (input.runOnceAt !== undefined) {
    return {
      kind: 'once',
      runAt: input.runOnceAt,
      ...(input.cron === undefined ? {} : { ignoredCron: input.cron }),
    };
  }
  if (input.cron !== undefined) return { kind: 'cron', expression: input.cron };
  return { kind: 'manual' };
}

/**
 * A refusal the runtime can SEE.
 *
 * `deriveToolResultStatus` only marks a result as an error when it is an object
 * carrying a non-empty `error` string; a bare string is a successful result
 * whose text happens to read like a complaint. Returning the plain string cost
 * a real user 36 identical failing calls in one turn: the model was never told
 * the call failed, and the loop-gate — which counts consecutive FAILED calls —
 * saw an unbroken run of successes and never fired.
 */
function refusal(message: string): { error: string } {
  return { error: message };
}

function scheduleLine(task: ScheduledTask): string {
  const schedule = task.schedule;
  if (schedule.kind === 'cron') return `cron=${schedule.expression}`;
  if (schedule.kind === 'once') return `once=${schedule.runAt}`;
  if (schedule.kind === 'interval') return `every=${schedule.everySeconds}s`;
  if (schedule.kind === 'calendar') return `${schedule.recurrence}@${schedule.anchorAt}`;
  return 'manual';
}

/**
 * What a task's runs do about approval, in the two words the tool's own
 * description promises. `bypass` is the Host's name for going ahead; every
 * other mode stops and waits, which for an unattended run means stopping for
 * good.
 */
function approvalOf(task: ScheduledTask): 'auto' | 'ask' {
  if (task.effect.kind !== 'agent_run') return 'auto';
  return task.effect.execution.permissionMode === 'bypass' ? 'auto' : 'ask';
}

function confirm(task: ScheduledTask, verb: string): string {
  return [
    `${verb} ${task.title} (${task.id})`,
    `schedule=${scheduleLine(task)}`,
    `status=${task.status}`,
    `nextFireAt=${task.nextFireAt ?? '— (only runs when asked)'}`,
    `approval=${approvalOf(task)}`,
  ].join('\n');
}

/* ------------------------------------------------------------------ *
 * The tools.
 * ------------------------------------------------------------------ */

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(SCHEDULED_TASK_TITLE_MAX_CHARS)
    .describe('Human-readable scheduled task name.'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(SCHEDULED_TASK_INTENT_MAX_CHARS)
    .describe(
      'The message each firing sends. Write it as a complete standalone instruction — every firing starts a fresh session with no memory of this conversation.',
    ),
  cron: cron.optional(),
  runOnceAt: runOnceAt.optional(),
  maxFires: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .optional()
    .describe('Stop the task after this many firings.'),
  permissionMode: z
    .literal('ask')
    .optional()
    .describe(
      'Pass "ask" only when the user wants this task’s runs to stop for approval even if this conversation does not. Automatic approval cannot be requested here — a task inherits it from this conversation or the user turns it on in the task’s settings.',
    ),
});

function buildCreateTool(deps: { authority: ScheduledTaskToolAuthority }): MakaTool {
  return {
    name: TOOL_NAMES.scheduledTaskCreate,
    displayName: 'Create scheduled task',
    activityKind: 'schedule',
    description: [
      'Create a scheduled task. Each firing starts a FRESH SESSION on this computer, never this conversation — the user views each run independently. To schedule a one-off reminder that should arrive back in THIS conversation, use SendLater instead.',
      '',
      'Both cron and runOnceAt are OPTIONAL and only name and prompt are required: pass cron to repeat, runOnceAt to fire once, or NEITHER for a task with no schedule of its own, which runs only when ScheduledTaskRun or the user asks it to. Sending both is not an error — the task fires once at runOnceAt and the cron is ignored, and the result says so.',
      '',
      'Each task has its own approval setting, reported in the result as approval: "auto" means its runs go ahead without waiting for approval; "ask" means a run stops whenever an action needs approval, and a scheduled run usually has no one there to approve it. Left unset, a task takes this conversation’s setting. When you confirm the task, say in one sentence which setting it got; if its runs will ask, mention that the user can switch the task to automatic approval ("Automatically approve") in its settings.',
      '',
      'The task runs in this session’s folder or project, on this session’s model. The user can change both on the task’s page.',
      '',
      NAMING_RULE,
    ].join('\n'),
    parameters: createSchema,
    impl: async (raw, ctx) => {
      const input = createSchema.parse(raw);
      const { ignoredCron, ...schedule } = scheduleFrom(input);
      const result = await deps.authority.create({
        title: input.name,
        intentBody: input.prompt,
        schedule,
        effect: 'agent_run',
        sessionId: ctx.sessionId,
        ...(input.maxFires !== undefined ? { maxFires: input.maxFires } : {}),
        ...(input.permissionMode !== undefined ? { permissionMode: input.permissionMode } : {}),
      });
      if ('error' in result) return refusal(result.error);
      return ignoredCron === undefined
        ? confirm(result, 'Created')
        : // Never silent: the caller sent two schedules and gets told which one
          // the task actually has, in the same breath as the confirmation.
          `${confirm(result, 'Created')}\nBoth runOnceAt and cron were sent, so this task fires ONCE at runOnceAt; the cron ${JSON.stringify(ignoredCron)} was ignored. Send only cron if it should repeat instead.`;
    },
  };
}

const listSchema = z.object({
  enabled: z
    .boolean()
    .optional()
    .describe('When set, only tasks whose enabled state matches. Omit for both.'),
  recurring: z
    .boolean()
    .optional()
    .describe(
      'true keeps only repeating tasks, false only one-shot and manual ones. Omit for both.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Maximum tasks to return (default 20, max 100).'),
});

function buildListTool(deps: { authority: ScheduledTaskToolAuthority }): MakaTool {
  return {
    name: TOOL_NAMES.scheduledTaskList,
    displayName: 'List scheduled tasks',
    activityKind: 'schedule',
    description: [
      'List the scheduled tasks on this computer. Use it to find task ids for ScheduledTaskUpdate, ScheduledTaskDelete and ScheduledTaskRun.',
      '',
      "Each entry has the task's id, title, status, schedule, next fire time and last run. last is the most recent recorded run and is absent when none was recorded (e.g. never fired). For a task that wakes an existing session, last records that the wake was delivered, not how the turn went. A failed or repeatedly non-ok last run means the task is not doing its job.",
      '',
      'A paused task still computes a next fire time — it just will not act on it — so read status, never next, to tell whether a task is running.',
    ].join('\n'),
    parameters: listSchema,
    impl: async (raw) => {
      const input = listSchema.parse(raw);
      let tasks = await deps.authority.list();
      if (input.enabled !== undefined) {
        tasks = tasks.filter((task) => (task.status === 'active') === input.enabled);
      }
      if (input.recurring !== undefined) {
        const repeats = (task: ScheduledTask) =>
          task.schedule.kind === 'cron' ||
          task.schedule.kind === 'interval' ||
          task.schedule.kind === 'calendar';
        tasks = tasks.filter((task) => repeats(task) === input.recurring);
      }
      const limit = input.limit ?? 20;
      const page = tasks.slice(0, limit);
      if (page.length === 0) return 'No scheduled tasks.';
      const lines = page.map((task) => {
        // The last recorded run, so a task that is not doing its job can be
        // told from one that is. Outcome and time only: the run's message
        // belongs to the task's own page, and a list that carried it would
        // cost the turn a page of context per task.
        // Newest first: `appendScheduledTaskRun` unshifts, so `at(-1)` was the
        // OLDEST run — the model was told about the first time a task ran, not
        // the last, which is the one that says whether it still works.
        const lastRun = task.runs[0];
        const last = lastRun ? ` | last=${lastRun.outcome}@${lastRun.at}` : '';
        return `- ${task.id} | ${task.title} | ${task.status} | ${scheduleLine(task)} | next=${task.nextFireAt ?? '—'}${last}`;
      });
      if (tasks.length > page.length) {
        lines.push(`(${tasks.length - page.length} more; raise limit to see them)`);
      }
      return lines.join('\n');
    },
  };
}

const updateSchema = z.object({
  taskId,
  name: z
    .string()
    .trim()
    .min(1)
    .max(SCHEDULED_TASK_TITLE_MAX_CHARS)
    .optional()
    .describe('Rename the task. Its id and its run history are unchanged.'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(SCHEDULED_TASK_INTENT_MAX_CHARS)
    .optional()
    .describe(
      'Replace the message each firing sends. Prefer this over delete-and-recreate when only the instruction needs to change.',
    ),
  cron: cron.optional().describe('Setting this clears runOnceAt.'),
  runOnceAt: runOnceAt.optional().describe('Setting this clears cron.'),
  manual: z
    .literal(true)
    .optional()
    .describe(
      'Set true to clear the schedule entirely, leaving a task that only runs when ScheduledTaskRun or the user asks it to. Mutually exclusive with cron and runOnceAt.',
    ),
  enabled: z
    .boolean()
    .optional()
    .describe(
      'The state the task should end up in: false pauses it, true starts it again. Setting it to the state the task is already in changes nothing and is not an error.',
    ),
  maxFires: z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .nullable()
    .optional()
    .describe('Stop the task after this many firings in total. null removes the limit.'),
});

function buildUpdateTool(deps: { authority: ScheduledTaskToolAuthority }): MakaTool {
  return {
    name: TOOL_NAMES.scheduledTaskUpdate,
    displayName: 'Update scheduled task',
    activityKind: 'schedule',
    description: [
      "Update a scheduled task's name, schedule, enabled state or instructions. Only provided fields are changed; omit a field to leave it as-is. The task keeps its id and its run history.",
      '',
      'Setting cron clears runOnceAt and setting runOnceAt clears cron, so a repeating task can become one-shot and back; manual: true clears both, leaving a task that only runs when it is asked to. Sending more than one of the three is not an error — manual wins over runOnceAt, which wins over cron, and the result says which was used.',
      '',
      'Prefer this over delete-and-recreate whenever only the instructions or the schedule need to change. Use ScheduledTaskList to find the task id if it is no longer in context.',
    ].join('\n'),
    parameters: updateSchema,
    impl: async (raw) => {
      const input = updateSchema.parse(raw);
      // Same precedence as create, and for the same reason: a caller that sent
      // more than one cadence is told which one won rather than refused. The
      // order is most-specific-first — an explicit "clear it" beats a single
      // instant, which beats a recurrence the caller had no reason to send
      // alongside one.
      const overruled: string[] = [];
      if (input.manual) {
        if (input.runOnceAt !== undefined) overruled.push('runOnceAt');
        if (input.cron !== undefined) overruled.push('cron');
      } else if (input.runOnceAt !== undefined && input.cron !== undefined) {
        overruled.push('cron');
      }
      const changed: string[] = [];
      const patch: Parameters<ScheduledTaskToolAuthority['update']>[1] = {};
      if (input.name !== undefined) {
        patch.title = input.name;
        changed.push('name');
      }
      if (input.prompt !== undefined) {
        patch.intentBody = input.prompt;
        changed.push('prompt');
      }
      if (input.manual) {
        // Without this there was no way back to "only when asked": omitting
        // every cadence field means "leave the schedule alone", so the only
        // route was delete-and-recreate — which ScheduledTaskDelete's own
        // description tells the caller not to do.
        patch.schedule = { kind: 'manual' };
        changed.push('schedule');
      } else if (input.runOnceAt !== undefined) {
        patch.schedule = { kind: 'once', runAt: input.runOnceAt };
        changed.push('schedule');
      } else if (input.cron !== undefined) {
        patch.schedule = { kind: 'cron', expression: input.cron };
        changed.push('schedule');
      }
      if (input.maxFires !== undefined) {
        patch.maxFires = input.maxFires;
        changed.push('maxFires');
      }
      // An update that names nothing is refused rather than reported as a
      // success: a caller that built its arguments wrong should hear about it.
      if (changed.length === 0 && input.enabled === undefined) {
        return refusal(
          'update requires at least one field besides taskId: name, prompt, cron, runOnceAt, manual, enabled or maxFires',
        );
      }
      let task: ScheduledTask | { error: string } | undefined;
      if (changed.length > 0) {
        task = await deps.authority.update(input.taskId, patch);
        if ('error' in task) return refusal(task.error);
      }
      if (input.enabled !== undefined) {
        const toggled = input.enabled
          ? await deps.authority.resume(input.taskId)
          : await deps.authority.pause(input.taskId);
        // This refusal lands AFTER the field patch was committed, so it has to
        // say what did take. A bare failure for a call that half succeeded is
        // what makes a caller send the whole thing again: nothing in the
        // message tells it the rename already happened.
        if ('error' in toggled) {
          return refusal(
            changed.length === 0
              ? toggled.error
              : `${toggled.error} — the rest of the update was applied (${changed
                  .slice()
                  .sort()
                  .join(', ')}); only the enabled change did not take.`,
          );
        }
        task = toggled;
        changed.push(input.enabled ? 'resumed' : 'paused');
      }
      if (!task || 'error' in task) return refusal('update did not change anything');
      const lines = [confirm(task, 'Updated'), `changed=${changed.sort().join(', ')}`];
      if (overruled.length > 0) {
        lines.push(
          `More than one schedule was sent; the task now uses ${scheduleLine(task)} and ${overruled.join(' and ')} ${overruled.length === 1 ? 'was' : 'were'} ignored.`,
        );
      }
      return lines.join('\n');
    },
  };
}

function buildDeleteTool(deps: { authority: ScheduledTaskToolAuthority }): MakaTool {
  const schema = z.object({ taskId });
  return {
    name: TOOL_NAMES.scheduledTaskDelete,
    displayName: 'Delete scheduled task',
    activityKind: 'schedule',
    description: [
      'Delete a scheduled task. Use this to undo a ScheduledTaskCreate call or to clean up a task whose work is done.',
      '',
      "A bad schedule or a wrong instruction does not need deletion — ScheduledTaskUpdate fixes those in place, keeping the task's run history. Deletion is permanent and has no undo.",
    ].join('\n'),
    parameters: schema,
    impl: async (raw) => {
      const input = schema.parse(raw);
      const result = await deps.authority.remove(input.taskId);
      if ('error' in result) return refusal(result.error);
      return `Deleted scheduled task ${input.taskId}`;
    },
  };
}

function buildRunTool(deps: { authority: ScheduledTaskToolAuthority }): MakaTool {
  const schema = z.object({
    taskId,
    text: z
      .string()
      .trim()
      .min(1)
      .max(SCHEDULED_TASK_INTENT_MAX_CHARS)
      .optional()
      .describe(
        'Extra context appended after the task’s own instructions for THIS run only. Use it to pass a run-specific fact (an error message, a link, a diff). Bounded to 8000 characters. It is not stored on the task.',
      ),
  });
  return {
    name: TOOL_NAMES.scheduledTaskRun,
    displayName: 'Run scheduled task',
    activityKind: 'schedule',
    description: [
      'Run a scheduled task immediately, outside of its schedule. Use this to kick off a task on demand — e.g. after noticing a condition the task is meant to handle, or to re-run a task whose last scheduled run failed.',
      '',
      "Optionally include a text message that is appended after the task's configured instructions, so you can pass run-specific context (an error message, a PR link, a diff) into that one firing.",
      '',
      'The run opens a fresh session exactly as a scheduled firing would, and costs the same.',
    ].join('\n'),
    parameters: schema,
    impl: async (raw) => {
      const input = schema.parse(raw);
      const result = await deps.authority.run(input.taskId, input.text);
      if ('error' in result) return refusal(result.error);
      return confirm(result, 'Ran');
    },
  };
}

const sendLaterSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1)
      .max(SCHEDULED_TASK_INTENT_MAX_CHARS)
      .describe(
        'The text to deliver as a user turn. Write it assuming your current conversation context — this session continues, it does not start fresh.',
      ),
    delayMinutes: z
      .number()
      .int()
      .min(1)
      .max(SEND_LATER_MAX_DELAY_MINUTES)
      .optional()
      .describe('Fire this many minutes from now. Mutually exclusive with `at` — set exactly one.'),
    at: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Epoch milliseconds for the fire time. Must be in the future. Mutually exclusive with `delayMinutes`.',
      ),
    name: z
      .string()
      .trim()
      .min(1)
      .max(SCHEDULED_TASK_TITLE_MAX_CHARS)
      .optional()
      .describe('Short label for the task list. Omit and one is derived from the message.'),
  })
  .describe('Deliver one message back into this session later.');

/** The label a reminder gets when the caller did not name one. */
export function sendLaterTitle(message: string, max = 60): string {
  const line = message.replace(/\s+/gu, ' ').trim();
  return [...line].length <= max ? line : `${[...line].slice(0, max - 1).join('')}…`;
}

function buildSendLaterTool(deps: {
  authority: ScheduledTaskToolAuthority;
  now?: () => number;
}): MakaTool {
  const now = deps.now ?? Date.now;
  return {
    name: TOOL_NAMES.sendLater,
    displayName: 'Send later',
    activityKind: 'schedule',
    description: [
      'Schedule a message to be delivered back into THIS SESSION at a future time. The message arrives as an ordinary user turn, so you can use it to remind yourself to resume work, check on something, or continue after a delay.',
      '',
      'Delivery survives restarting the app — the reminder is stored, not held in memory. Granularity is one minute, because the scheduler wakes once a minute. This is a thin wrapper over ScheduledTaskCreate (a self-bound, one-shot task); the returned task id can be passed to ScheduledTaskDelete to cancel before it fires, and the task disables itself after firing once.',
      '',
      'Anything that should run on its own, repeatedly, or without this conversation belongs in ScheduledTaskCreate instead.',
    ].join('\n'),
    parameters: sendLaterSchema,
    impl: async (raw, ctx) => {
      const input = sendLaterSchema.parse(raw);
      if ((input.delayMinutes === undefined) === (input.at === undefined)) {
        return refusal("set exactly one of 'delayMinutes' or 'at'");
      }
      const runAt = input.at !== undefined ? input.at : now() + (input.delayMinutes ?? 0) * 60_000;
      if (runAt <= now()) return refusal('that time has already passed');
      const result = await deps.authority.create({
        title: input.name ?? sendLaterTitle(input.message),
        intentBody: input.message,
        schedule: { kind: 'once', runAt },
        effect: 'session_resume',
        sessionId: ctx.sessionId,
        maxFires: 1,
      });
      if ('error' in result) return refusal(result.error);
      return `Will deliver at ${runAt} (${result.id}). Pass that id to ${TOOL_NAMES.scheduledTaskDelete} to cancel it.`;
    },
  };
}

export function buildScheduledTaskTools(deps: {
  authority: ScheduledTaskToolAuthority;
  now?: () => number;
}): MakaTool[] {
  return [
    buildCreateTool(deps),
    buildListTool(deps),
    buildUpdateTool(deps),
    buildDeleteTool(deps),
    buildRunTool(deps),
    buildSendLaterTool(deps),
  ];
}

/** Build create payload for the SQLite store from tool + session execution snapshot. */
export function buildAgentScheduledTaskCreatePayload(input: {
  title: string;
  intentBody: string;
  schedule: ScheduledTaskToolSchedule;
  effect: 'session_resume' | 'agent_run';
  sessionId: string;
  execution?: ScheduledTaskExecutionTemplate;
  maxFires?: number;
  now?: number;
}):
  | {
      title: string;
      intentBody: string;
      schedule: ScheduledTask['schedule'];
      effect: ScheduledTask['effect'];
      createdBy: ScheduledTask['createdBy'];
      maxFires?: number;
    }
  | { error: string } {
  const now = input.now ?? Date.now();
  if (input.effect === 'agent_run' && !input.execution) {
    return { error: 'agent_run requires a frozen execution template from the creator session' };
  }
  const schedule: ScheduledTask['schedule'] =
    input.schedule.kind === 'cron'
      ? { kind: 'cron', expression: input.schedule.expression, startAt: now }
      : input.schedule;
  const createdBy = { kind: 'agent' as const, sessionId: input.sessionId };
  if (input.effect === 'agent_run') {
    return {
      title: input.title,
      intentBody: input.intentBody,
      schedule,
      effect: { kind: 'agent_run', execution: input.execution! },
      createdBy,
      ...(input.maxFires !== undefined ? { maxFires: input.maxFires } : {}),
    };
  }
  return {
    title: input.title,
    intentBody: input.intentBody,
    schedule,
    effect: { kind: 'session_resume', sessionId: input.sessionId },
    createdBy,
    ...(input.maxFires !== undefined ? { maxFires: input.maxFires } : {}),
  };
}
