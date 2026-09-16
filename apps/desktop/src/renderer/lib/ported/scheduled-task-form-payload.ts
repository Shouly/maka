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
// `ScheduledTaskFormSeed`), the cadence mapping and the validation; what it
// does not own is the submit. Extracted here so the dialog is a form and the
// mapping is testable on its own.
//
// The form now authors an EXECUTION TEMPLATE, not a delivery channel: every
// task opens a session when it fires, so the payload has to say where it runs,
// on what model, and how careful to be. The template's other fields —
// collaboration, orchestration, thinking and tool mode — have no control in
// this dialog and are CARRIED from the task rather than re-defaulted here:
// this module rebuilds the whole template on every save, so anything it does
// not carry is silently dropped on a rename.

import type {
  CreateScheduledTaskInput,
  ScheduledTaskEffect,
  ScheduledTaskExecutionTemplate,
  ScheduledTaskSchedule,
  UpdateScheduledTaskInput,
} from '@maka/core/scheduled-task';
import { scheduledTaskScheduleFromSeed, type ScheduledTaskFormSeed } from '@maka/ui';

/**
 * What the dialog holds — the seed itself.
 *
 * The execution settings the dialog does not show (collaboration, orchestration,
 * thinking, tool mode) live on the seed too, carried from the task rather than
 * re-defaulted here: this module rebuilds the WHOLE template on every save, so
 * anything it does not carry is silently dropped on a rename.
 */
export type ScheduledTaskFormFields = ScheduledTaskFormSeed;

/**
 * Whether the cadence still reads exactly as the edit seeded it.
 *
 * An edit that leaves the cadence alone omits `schedule` from its patch, so the
 * Host keeps a snoozed or otherwise pending fire (#5226) rather than
 * recomputing the next one. Resending an identical schedule would still reset
 * it, so "unchanged" has to mean "not sent", not "sent the same".
 */
export function scheduledTaskScheduleUntouched(
  fields: ScheduledTaskFormFields,
  seed: ScheduledTaskFormSeed,
): boolean {
  if (!seed.originalSchedule) return false;
  return (
    fields.frequency === seed.frequency &&
    fields.timeLocal === seed.timeLocal &&
    fields.dateLocal === seed.dateLocal &&
    fields.weekday === seed.weekday &&
    fields.dayOfMonth === seed.dayOfMonth
  );
}

/** The schedule the fields describe, or `null` when they describe none. */
export function scheduledTaskScheduleFromFields(
  fields: ScheduledTaskFormFields,
  now: number = Date.now(),
): ScheduledTaskSchedule | null {
  return scheduledTaskScheduleFromSeed(fields, now);
}

/** The execution template the fields describe. */
export function scheduledTaskExecutionFromFields(
  fields: ScheduledTaskFormFields,
): ScheduledTaskExecutionTemplate {
  return {
    cwd: fields.workspace.cwd,
    projectId: fields.workspace.projectId,
    model: fields.model,
    permissionMode: fields.permissionMode,
    collaborationMode: fields.collaborationMode,
    orchestrationMode: fields.orchestrationMode,
    ...(fields.thinkingLevel === undefined ? {} : { thinkingLevel: fields.thinkingLevel }),
    ...(fields.toolMode === undefined ? {} : { toolMode: fields.toolMode }),
  };
}

/**
 * The effect the fields describe.
 *
 * A locked effect always wins: a SendLater reminder is bound to the session
 * that asked for it, and the form may rename or move it but never re-point it.
 * Everything else opens a session of its own.
 */
export function scheduledTaskEffectFromFields(
  fields: ScheduledTaskFormFields,
): ScheduledTaskEffect {
  if (fields.lockedEffect) return fields.lockedEffect;
  return { kind: 'agent_run', execution: scheduledTaskExecutionFromFields(fields) };
}

export function createScheduledTaskInputFromFields(
  fields: ScheduledTaskFormFields,
  now: number = Date.now(),
): Omit<CreateScheduledTaskInput, 'createdBy'> | null {
  const schedule = scheduledTaskScheduleFromFields(fields, now);
  if (!schedule) return null;
  return {
    title: fields.title.trim(),
    intentBody: fields.note.trim(),
    schedule,
    effect: scheduledTaskEffectFromFields(fields),
  };
}

export function updateScheduledTaskInputFromFields(
  fields: ScheduledTaskFormFields,
  seed: ScheduledTaskFormSeed,
  now: number = Date.now(),
): UpdateScheduledTaskInput | null {
  const schedule = scheduledTaskScheduleFromFields(fields, now);
  if (!schedule) return null;
  return {
    title: fields.title.trim(),
    intentBody: fields.note.trim(),
    ...(scheduledTaskScheduleUntouched(fields, seed) ? {} : { schedule }),
    effect: scheduledTaskEffectFromFields(fields),
  };
}
