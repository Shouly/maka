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
import type {
  ScheduledTask,
  ScheduledTaskEffect,
  ScheduledTaskExecutionTemplate,
  ScheduledTaskSchedule,
} from '@maka/core/scheduled-task';
import { normalizeCreateScheduledTaskInput } from '@maka/core/scheduled-task';
import {
  decodeScheduledTaskQueryResult,
  decodeHostFrame,
  REMOTE_OWNER_OPERATION_GRANTS,
  SCHEDULED_TASK_PAGE_MAX_ITEMS,
  type RequestFrame,
} from '../protocol/index.js';
import {
  authorizeRuntimeHostOperation,
  createRuntimeHostConnectionAuthority,
} from '../server/connection-authority.js';
import { decodeScheduledTaskMutateInput } from '../protocol/scheduled-task.js';

describe('ScheduledTask protocol', () => {
  test('requires Host-path authority only when a mutation submits a Host path', () => {
    const authority = createRuntimeHostConnectionAuthority({
      principalKind: 'remote_owner',
      principalId: 'remote-client',
      credentialId: 'remote-credential',
      operationGrants: REMOTE_OWNER_OPERATION_GRANTS,
      canPublishClientCapabilities: false,
      canUseHostPaths: false,
    });

    for (const frame of [createMutationFrame('project-1'), updateMutationFrame('project-1')]) {
      assert.equal(authorizeRuntimeHostOperation(authority, frame), true);
    }
    for (const projectId of [undefined, null, '']) {
      for (const frame of [createMutationFrame(projectId), updateMutationFrame(projectId)]) {
        assert.equal(authorizeRuntimeHostOperation(authority, frame), false);
      }
    }
  });

  test('a backend key from an older build is tolerated and dropped, both directions', () => {
    // #3306: `backend` left the template, but Automations frozen by older
    // builds still carry it — including the retired `'fake'` (#3211). The
    // execution decoder is a closed shape, so the key must stay tolerated on
    // the way in while never landing on the decoded value.
    const withRetiredBackend = (effect: ScheduledTaskEffect): unknown =>
      effect.kind === 'agent_run'
        ? { ...effect, execution: { ...effect.execution, backend: 'fake' } }
        : effect;
    const template = agentRunEffect('project-1');
    const expectedExecution = template.kind === 'agent_run' ? template.execution : assert.fail();
    const assertDropped = (effect: ScheduledTaskEffect | undefined) => {
      assert.equal(effect?.kind, 'agent_run');
      if (effect?.kind !== 'agent_run') return;
      assert.deepEqual(effect.execution, expectedExecution);
    };

    // Stored direction, through the full query-result frame.
    const fetched = decodeScheduledTaskQueryResult({
      kind: 'task',
      task: { ...scheduledTask('task-1'), effect: withRetiredBackend(template) },
    });
    assertDropped(fetched.kind === 'task' ? fetched.task?.effect : undefined);

    const created = decodeScheduledTaskMutateInput({
      kind: 'create',
      input: {
        title: 'Inspect workspace',
        intentBody: 'Summarize the workspace.',
        schedule: { kind: 'once', runAt: 1 },
        effect: withRetiredBackend(template),
      },
    });
    assertDropped(created.kind === 'create' ? created.input.effect : undefined);

    const updated = decodeScheduledTaskMutateInput({
      kind: 'update',
      taskId: 'task-1',
      patch: { effect: withRetiredBackend(template) },
    });
    assertDropped(updated.kind === 'update' ? updated.patch.effect : undefined);
  });

  test('no layer silently drops a field: every schedule x model x optional set', () => {
    // Both of this module's field bugs were the same shape — one layer wrote
    // something another could not read or would not carry — and each was found
    // by a user, not a test. Reading the codecs is how they were missed, so
    // this walks the whole product instead: every schedule kind, both model
    // choices, and every subset of the optional template fields, through core
    // normalization and both protocol directions. Storage passes `value.effect`
    // through from core verbatim, so it rides on the same guarantee.
    const NOW = 1_700_000_000_000;
    const SOON = NOW + 3_600_000;
    const schedules: Record<string, ScheduledTaskSchedule> = {
      once: { kind: 'once', runAt: SOON },
      interval: { kind: 'interval', everySeconds: 3600, startAt: SOON },
      calendar: { kind: 'calendar', recurrence: 'daily', anchorAt: SOON },
      cron: { kind: 'cron', expression: '0 9 * * *', startAt: SOON },
      manual: { kind: 'manual' },
    };
    const models = {
      default: { kind: 'default' as const },
      pinned: {
        kind: 'pinned' as const,
        llmConnectionId: 'c1',
        llmConnectionSlug: 's1',
        model: 'm1',
      },
    };
    const optionals = {
      projectId: 'p1',
      thinkingLevel: 'medium',
      toolMode: 'code_mode',
    } as const;
    const names = Object.keys(optionals) as (keyof typeof optionals)[];

    let checked = 0;
    for (const [scheduleName, schedule] of Object.entries(schedules)) {
      for (const [modelName, model] of Object.entries(models)) {
        for (let mask = 0; mask < 1 << names.length; mask += 1) {
          const carried = names.filter((_, index) => mask & (1 << index));
          const execution = {
            cwd: '/w',
            model,
            permissionMode: 'ask',
            collaborationMode: 'agent',
            orchestrationMode: 'default',
            ...Object.fromEntries(carried.map((name) => [name, optionals[name]])),
          } as unknown as ScheduledTaskExecutionTemplate;
          const where = `${scheduleName}/${modelName}/[${carried.join(',') || 'none'}]`;
          const effect: ScheduledTaskEffect = { kind: 'agent_run', execution };

          const normalized = normalizeCreateScheduledTaskInput(
            { title: 't', intentBody: 'b', schedule, effect, createdBy: { kind: 'user' } },
            NOW,
          );
          assert.ok(normalized.ok, `${where} core normalize: ${JSON.stringify(normalized)}`);
          if (!normalized.ok || normalized.value.effect.kind !== 'agent_run') assert.fail(where);
          assert.deepEqual(normalized.value.effect.execution, execution, `${where} core`);

          const read = decodeScheduledTaskQueryResult({
            kind: 'task',
            task: { ...scheduledTask('task-1'), schedule, effect },
          });
          if (read.kind !== 'task' || read.task?.effect.kind !== 'agent_run') assert.fail(where);
          assert.deepEqual(read.task.effect.execution, execution, `${where} protocol read`);
          assert.deepEqual(read.task.schedule, schedule, `${where} protocol read schedule`);

          const created = decodeScheduledTaskMutateInput({
            kind: 'create',
            input: { title: 't', intentBody: 'b', schedule, effect },
          });
          if (created.kind !== 'create' || created.input.effect.kind !== 'agent_run') {
            assert.fail(where);
          }
          assert.deepEqual(created.input.effect.execution, execution, `${where} protocol create`);
          checked += 1;
        }
      }
    }
    assert.equal(checked, 5 * 2 * 8, 'the whole matrix ran');
  });

  test('every field the template can carry survives the protocol, toolMode included', () => {
    // The Host froze `toolMode` into templates it created for an agent and the
    // decoder did not list it, so it wrote tasks it could not read back. One
    // such task made EVERY `scheduled-task.query` throw, and the desktop list
    // sat on "Could not refresh. These are the last results." for good — one
    // row poisoning the whole page, with no way to see or remove it.
    const base = agentRunEffect('project-1');
    if (base.kind !== 'agent_run') return;
    const full = {
      ...base.execution,
      thinkingLevel: 'medium' as const,
      toolMode: 'code_mode' as const,
    };
    const fetched = decodeScheduledTaskQueryResult({
      kind: 'task',
      task: { ...scheduledTask('task-1'), effect: { kind: 'agent_run', execution: full } },
    });
    assert.equal(fetched.kind, 'task');
    if (fetched.kind !== 'task' || fetched.task?.effect.kind !== 'agent_run') assert.fail();
    // Carried, not merely tolerated: a template that loses its tool mode would
    // silently move the task onto the default at its next run.
    assert.deepEqual(fetched.task.effect.execution, full);

    const created = decodeScheduledTaskMutateInput({
      kind: 'create',
      input: {
        title: 'Frozen from a code-mode session',
        intentBody: 'Summarize the workspace.',
        schedule: { kind: 'once', runAt: 1 },
        effect: { kind: 'agent_run', execution: full },
      },
    });
    if (created.kind !== 'create' || created.input.effect.kind !== 'agent_run') assert.fail();
    assert.deepEqual(created.input.effect.execution, full);

    assert.throws(
      () =>
        decodeScheduledTaskQueryResult({
          kind: 'task',
          task: {
            ...scheduledTask('task-1'),
            effect: { kind: 'agent_run', execution: { ...base.execution, toolMode: 'nonsense' } },
          },
        }),
      /tool mode/u,
    );
  });

  test('a task may follow the default model, but a pinned one must name its Connection', () => {
    const base = agentRunEffect('project-1');
    if (base.kind !== 'agent_run') return;
    // Following the owner's default names no Connection ON PURPOSE — it is
    // resolved at every run — so this is an ordinary create, not a rejection.
    const following = { ...base.execution, model: { kind: 'default' as const } };
    assert.doesNotThrow(() =>
      decodeScheduledTaskMutateInput({
        kind: 'create',
        input: {
          title: 'Follows the default',
          intentBody: 'Run it',
          schedule: { kind: 'once', runAt: 1 },
          effect: { kind: 'agent_run', execution: following },
        },
      }),
    );
    // A PINNED choice is the one that must carry the immutable id: the slug
    // beside it is reusable, and resolving that would hand the task to
    // whichever Connection holds the slug now.
    const { llmConnectionId: _dropped, ...slugOnly } =
      base.execution.model.kind === 'pinned' ? base.execution.model : ({} as never);
    assert.throws(
      () =>
        decodeScheduledTaskMutateInput({
          kind: 'create',
          input: {
            title: 'Pinned without an id',
            intentBody: 'Run it',
            schedule: { kind: 'once', runAt: 1 },
            effect: {
              kind: 'agent_run',
              execution: { ...base.execution, model: slugOnly },
            },
          },
        }),
      /ScheduledTask pinned model/u,
    );
    // Reading one back is the same shape it went in as.
    assert.deepEqual(
      decodeScheduledTaskQueryResult({
        kind: 'task',
        task: {
          ...scheduledTask('following-task'),
          effect: { kind: 'agent_run', execution: following },
        },
      }),
      {
        kind: 'task',
        task: {
          ...scheduledTask('following-task'),
          effect: { kind: 'agent_run', execution: following },
        },
      },
    );
  });

  test('every schedule kind survives the frame, manual included', () => {
    // The one that was missing: the form's default cadence is `manual`, and a
    // decoder that did not know the kind refused every task the page created.
    const schedules = [
      { kind: 'manual' as const },
      { kind: 'once' as const, runAt: 1_000 },
      { kind: 'interval' as const, everySeconds: 3_600, startAt: 1 },
      { kind: 'calendar' as const, recurrence: 'daily' as const, anchorAt: 1 },
      { kind: 'cron' as const, expression: '0 9 * * 1-5', startAt: 1 },
    ];
    for (const schedule of schedules) {
      const decoded = decodeScheduledTaskMutateInput({
        kind: 'create',
        input: {
          title: 'Round trip',
          intentBody: 'Run it',
          schedule,
          effect: agentRunEffect('project-1'),
        },
      });
      assert.equal(decoded.kind, 'create');
      if (decoded.kind !== 'create') return;
      assert.deepEqual(decoded.input.schedule, schedule, `${schedule.kind} survives`);
    }
  });

  test('accepts signal-only catalog changes', () => {
    const frame = {
      kind: 'scheduled-task.changed' as const,
      revision: 3,
      reason: 'fired' as const,
      taskId: 'task-1',
    };
    assert.deepEqual(decodeHostFrame(frame), frame);
    assert.throws(() => decodeHostFrame({ ...frame, runtimePayload: { secret: true } }));
  });

  test('bounds catalog pages by item count and encoded bytes', () => {
    const tasks = Array.from({ length: SCHEDULED_TASK_PAGE_MAX_ITEMS }, (_, index) =>
      scheduledTask(`task-${index}`),
    );
    const page = { kind: 'page' as const, revision: 1, tasks, nextCursor: null };
    assert.equal(decodeScheduledTaskQueryResult(page).kind, 'page');
    assert.throws(
      () =>
        decodeScheduledTaskQueryResult({
          ...page,
          tasks: [...tasks, scheduledTask('task-overflow')],
        }),
      /item limit/,
    );
    assert.throws(
      () =>
        decodeScheduledTaskQueryResult({
          ...page,
          tasks: Array.from({ length: 12 }, (_, index) =>
            scheduledTask(`large-${index}`, '"'.repeat(8_000)),
          ),
        }),
      /byte limit/,
    );
  });
});

function createMutationFrame(projectId: string | null | undefined): RequestFrame {
  return {
    requestId: 'request-1',
    operation: 'scheduled-task.mutate',
    input: {
      kind: 'create',
      input: {
        title: 'Inspect workspace',
        intentBody: 'Summarize the workspace.',
        schedule: { kind: 'once', runAt: 1 },
        effect: agentRunEffect(projectId),
      },
    },
  };
}

function updateMutationFrame(projectId: string | null | undefined): RequestFrame {
  return {
    requestId: 'request-2',
    operation: 'scheduled-task.mutate',
    input: {
      kind: 'update',
      taskId: 'task-1',
      patch: { effect: agentRunEffect(projectId) },
    },
  };
}

function agentRunEffect(projectId: string | null | undefined): ScheduledTaskEffect {
  return {
    kind: 'agent_run',
    execution: {
      cwd: '/workspace',
      ...(projectId === undefined ? {} : { projectId }),
      model: {
        kind: 'pinned',
        llmConnectionId: 'connection-openai',
        llmConnectionSlug: 'openai',
        model: 'gpt-5',
      },
      permissionMode: 'ask',
      collaborationMode: 'agent',
      orchestrationMode: 'default',
    },
  };
}

function scheduledTask(id: string, intentBody = ''): ScheduledTask {
  return {
    id,
    title: id,
    intent: { kind: 'text', body: intentBody },
    schedule: { kind: 'once', runAt: 1 },
    effect: { kind: 'session_resume', sessionId: 'session-1' },
    status: 'active',
    nextFireAt: 1,
    lastFireAt: null,
    fireCount: 0,
    maxFires: null,
    expiresAt: null,
    createdBy: { kind: 'user' },
    createdAt: 1,
    updatedAt: 1,
    runs: [],
    lastError: null,
  };
}
