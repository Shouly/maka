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

// The scheduled-task form's fields turned into the Host's payload.
//
// `@maka/ui`'s `scheduled-task-helpers.ts` owns the other direction (task →
// `ScheduledTaskFormSeed`) and the validation; what it does not own is the
// submit, because the pre-rewrite dialog built the payload inline. Extracted
// here so the dialog is a form and the mapping is testable on its own.
//
// Two rules the pre-rewrite dialog encoded and this keeps:
//
//   - an interval cadence is NOT editable in the UI. A task an agent created
//     with `{ kind: 'interval' }` keeps that schedule verbatim rather than
//     being coerced to a one-shot, which is what would happen if the form
//     rebuilt the schedule from its own three recurrence options.
//   - an `agent_run` / `session_resume` effect is frozen at creation. The form
//     may edit title, note and schedule around it, but must never rewrite it
//     as notification delivery.

import type {
  CreateScheduledTaskInput,
  ScheduledTaskEffect,
  ScheduledTaskSchedule,
  UpdateScheduledTaskInput,
} from '@maka/core/scheduled-task';
import type { ScheduledTaskFormSeed } from '@maka/ui';

export interface ScheduledTaskFormFields {
  readonly title: string;
  readonly note: string;
  /** `datetime-local` value; `Date.parse` of it is the run time. */
  readonly runAtLocal: string;
  readonly recurrence: ScheduledTaskFormSeed['recurrence'];
  readonly cronExpression: string;
  /**
   * Where a notification goes. Optional so that a caller describing a plain
   * local reminder — which is every caller that predates bot delivery — keeps
   * describing one by saying nothing.
   */
  readonly deliveryMethod?: ScheduledTaskFormSeed['deliveryMethod'];
  readonly deliveryPlatform?: ScheduledTaskFormSeed['deliveryPlatform'];
  readonly deliveryChatId?: ScheduledTaskFormSeed['deliveryChatId'];
  readonly lockedSchedule?: ScheduledTaskFormSeed['lockedSchedule'];
  readonly lockedEffect?: ScheduledTaskFormSeed['lockedEffect'];
}

/** The schedule the fields describe, or `null` when they describe none. */
export function scheduledTaskScheduleFromFields(
  fields: ScheduledTaskFormFields,
): ScheduledTaskSchedule | null {
  const runAt = Date.parse(fields.runAtLocal);
  if (fields.recurrence === 'interval') return fields.lockedSchedule ?? null;
  if (!Number.isFinite(runAt)) return null;
  if (fields.recurrence === 'none') return { kind: 'once', runAt };
  if (fields.recurrence === 'cron') {
    return { kind: 'cron', expression: fields.cronExpression.trim(), startAt: runAt };
  }
  return { kind: 'calendar', recurrence: fields.recurrence, anchorAt: runAt };
}

/**
 * The effect the fields describe.
 *
 * A locked effect always wins: it is the one part of the task the form is not
 * allowed to author. Otherwise the delivery fields decide, and `local` is the
 * answer whenever they say nothing — a bot channel with no chat id is not a
 * delivery target, and the form's own validation refuses it before submit, so
 * falling back here keeps a half-filled bot choice from being sent as one.
 */
export function scheduledTaskEffectFromFields(
  fields: ScheduledTaskFormFields,
): ScheduledTaskEffect {
  if (fields.lockedEffect) return fields.lockedEffect;
  if (fields.deliveryMethod !== 'bot') return { kind: 'notify', channel: 'local' };
  return {
    kind: 'notify',
    channel: 'bot',
    platform: fields.deliveryPlatform ?? 'telegram',
    chatId: (fields.deliveryChatId ?? '').trim(),
  };
}

export function createScheduledTaskInputFromFields(
  fields: ScheduledTaskFormFields,
): Omit<CreateScheduledTaskInput, 'createdBy'> | null {
  const schedule = scheduledTaskScheduleFromFields(fields);
  if (!schedule) return null;
  return {
    title: fields.title.trim(),
    intentBody: fields.note.trim(),
    schedule,
    effect: scheduledTaskEffectFromFields(fields),
  };
}

/**
 * The patch for an existing task.
 *
 * A pre-#3927 slug-only `agent_run` target is preserved by OMITTING `effect`
 * rather than resubmitting it: the row carries no `llmConnectionId`, and
 * sending it back would re-save an identity the Host has since stopped
 * minting. Title, intent and schedule stay editable either way.
 */
export function updateScheduledTaskInputFromFields(
  fields: ScheduledTaskFormFields,
): UpdateScheduledTaskInput | null {
  const schedule = scheduledTaskScheduleFromFields(fields);
  if (!schedule) return null;
  const base = {
    title: fields.title.trim(),
    intentBody: fields.note.trim(),
    schedule,
  };
  const locked = fields.lockedEffect;
  if (locked?.kind === 'agent_run' && !locked.execution.llmConnectionId) return base;
  return { ...base, effect: scheduledTaskEffectFromFields(fields) };
}
