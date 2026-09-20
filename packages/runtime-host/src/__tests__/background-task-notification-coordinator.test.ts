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
import type { ShellRunRecord } from '@maka/core/shell-run';
import type { SessionEvent } from '@maka/core/events';
import { HostBackgroundTaskNotificationCoordinator } from '../server/background-task-notification-coordinator.js';
import type {
  HostedExecutionAdmission,
  HostedExecutionAdmissionResult,
  HostedExecutionPreparation,
} from '../server/hosted-execution-authority.js';

function finishedRecord(shellRunId: string): ShellRunRecord {
  return {
    shellRunId,
    sessionId: 'session-1',
    sourceTurnId: 'turn-0',
    sourceToolCallId: `call-${shellRunId}`,
    cwd: '/workspace',
    command: 'npm test',
    background: true,
    description: 'Run the suite',
    status: 'completed',
    exitCode: 0,
    startedAt: 1,
    updatedAt: 2,
    completedAt: 2,
    revision: 2,
    output: {
      mode: 'pipes',
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      redacted: false,
    },
  };
}

function harness(pending: ShellRunRecord[]) {
  const log: string[] = [];
  const admissions: HostedExecutionAdmission[] = [];
  let sent: { text: string; origin: unknown } | undefined;
  let preparation: HostedExecutionPreparation = {
    kind: 'prepared',
    admission: {
      sessionId: 'session-1',
      admit: async (input) => {
        admissions.push(input);
        log.push('admit');
        const events: SessionEvent[] = [];
        for await (const event of input.start({
          runId: input.runId,
          userMessageId: input.userMessageId,
          onRunStarted: () => undefined,
        })) {
          events.push(event);
        }
        return {
          snapshot: { status: 'completed' },
          completion: Promise.resolve({ status: 'completed' }),
          settled: Promise.resolve(),
        } as unknown as HostedExecutionAdmissionResult;
      },
      release: () => log.push('release'),
    },
  };
  const coordinator = new HostBackgroundTaskNotificationCoordinator({
    executions: { prepare: () => preparation },
    runtime: {
      sendMessage: ((_sessionId: string, input: { text: string; origin?: unknown }) => {
        log.push('send');
        sent = { text: input.text, origin: input.origin };
        return (async function* () {})();
      }) as never,
    },
    shellRuns: {
      pendingTaskNotifications: async () => [...pending],
      markTaskNotified: async (_sessionId, shellRunId) => {
        log.push(`notified:${shellRunId}`);
        const index = pending.findIndex((record) => record.shellRunId === shellRunId);
        const [record] = pending.splice(index, 1);
        return { ...record!, notifiedAt: 3 };
      },
    },
    newId: (() => {
      let id = 0;
      return () => `id-${++id}`;
    })(),
    onError: (_sessionId, error) => log.push(`error:${String(error)}`),
  });
  return {
    coordinator,
    log,
    admissions,
    sent: () => sent,
    setPreparation: (next: HostedExecutionPreparation) => {
      preparation = next;
    },
  };
}

describe('waking an idle session with what its background tasks owe', () => {
  test('an idle session gets one turn carrying every owed notification, settled before the run starts', async () => {
    const h = harness([finishedRecord('sr_1'), finishedRecord('sr_2')]);
    h.coordinator.taskFinished(finishedRecord('sr_2'));
    await h.coordinator.settled('session-1');

    assert.deepEqual(h.log, ['admit', 'notified:sr_1', 'notified:sr_2', 'send']);
    const [admission] = h.admissions;
    assert.deepEqual(admission?.execution, {
      kind: 'background_task',
      ref: 'maka://runtime/background-tasks/sr_1',
      toolUseId: 'call-sr_1',
    });
    const text = h.sent()?.text ?? '';
    assert.equal(admission?.content?.text, text);
    assert.equal(text.match(/<system-reminder>/g)?.length, 2);
    assert.match(text, /<task-id>maka:\/\/runtime\/background-tasks\/sr_2<\/task-id>/);
    assert.deepEqual(h.sent()?.origin, admission?.execution);
  });

  test('a busy session is left to its running turn and looked at again once idle', async () => {
    const pending = [finishedRecord('sr_1')];
    const h = harness(pending);
    let release!: () => void;
    const whenIdle = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.setPreparation({ kind: 'busy', whenIdle });
    h.coordinator.taskFinished(pending[0]!);
    await Promise.resolve();
    assert.deepEqual(h.log, []);
    // The turn's own boundary drain announced it meanwhile.
    pending.length = 0;
    release();
    await h.coordinator.settled('session-1');
    assert.deepEqual(h.log, []);
  });

  test('nothing owed means nothing admitted', async () => {
    const h = harness([]);
    h.coordinator.taskFinished(finishedRecord('sr_1'));
    await h.coordinator.settled('session-1');
    assert.deepEqual(h.log, []);
  });
});
