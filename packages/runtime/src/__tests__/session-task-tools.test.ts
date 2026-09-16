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

// The four task tools' RESULT TEXT, which is the contract the model learns by
// seeing it. Every row of the reference's result-format table is pinned here,
// together with the places our port deliberately answers differently and why.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSessionTask,
  emptySessionTaskDocument,
  findSessionTask,
  missingSessionTaskMessage,
  updateSessionTask,
  type SessionTaskDocument,
} from '@maka/core/session-task';
import { renderTask, renderTaskList } from '../session-task-tools.js';

const NOW = 1_000;

function create(
  document: SessionTaskDocument,
  input: {
    subject: string;
    description: string;
    activeForm?: string;
    metadata?: Record<string, unknown>;
  },
): SessionTaskDocument {
  const created = createSessionTask(document, input, NOW);
  assert.ok(created.ok, created.ok ? '' : created.message);
  return created.value.document;
}

function update(
  document: SessionTaskDocument,
  input: Record<string, unknown>,
): SessionTaskDocument {
  const updated = updateSessionTask(document, input as never, NOW);
  assert.ok(updated.ok, updated.ok ? '' : updated.message);
  return updated.value.document;
}

function get(document: SessionTaskDocument, taskId: string): string {
  const task = findSessionTask(document, taskId);
  return task ? renderTask(document, task) : missingSessionTaskMessage(document, taskId);
}

test('TaskList renders the reference line shape, blockers included', () => {
  assert.equal(renderTaskList(emptySessionTaskDocument()), 'No tasks found');

  let document = create(emptySessionTaskDocument(), {
    subject: 'Fix the login bug',
    description: 'd',
  });
  document = create(document, { subject: 'Ship it', description: 'd' });
  document = update(document, { taskId: '1', owner: 'agent-a' });
  document = update(document, { taskId: '2', addBlockedBy: ['1'] });

  assert.equal(
    renderTaskList(document),
    ['#1 [pending] Fix the login bug (agent-a)', '#2 [pending] Ship it [blocked by #1]'].join('\n'),
  );

  // A completed blocker stops blocking, on this surface and in TaskGet alike.
  const done = update(document, { taskId: '1', status: 'completed' });
  assert.equal(
    renderTaskList(done),
    ['#1 [completed] Fix the login bug (agent-a)', '#2 [pending] Ship it'].join('\n'),
  );
  assert.ok(!get(done, '2').includes('Blocked by'));
});

test('TaskGet reads back every field TaskUpdate can write', () => {
  // The reference calls this "full task details" and omits activeForm and
  // metadata, so a caller can write them and never confirm them — and cannot
  // tell whether a null metadata value deleted its key.
  let document = create(emptySessionTaskDocument(), {
    subject: 'Fix the login bug',
    description: 'Details here',
    activeForm: 'Fixing the login bug',
    metadata: { a: 1, b: 2 },
  });
  document = update(document, { taskId: '1', owner: 'agent-a' });

  assert.equal(
    get(document, '1'),
    [
      'Task #1: Fix the login bug',
      'Status: pending',
      'Description: Details here',
      'Active form: Fixing the login bug',
      'Owner: agent-a',
      'Metadata: {"a":1,"b":2}',
    ].join('\n'),
  );

  const merged = update(document, { taskId: '1', metadata: { b: null, c: 3 } });
  assert.match(get(merged, '1'), /^Metadata: \{"a":1,"c":3\}$/mu);

  // Emptied out, the line goes rather than reading as an empty object.
  const emptied = update(merged, { taskId: '1', metadata: { a: null, c: null } });
  assert.ok(!get(emptied, '1').includes('Metadata:'));
});

test('a deleted task and a number that was never issued answer differently', () => {
  // The reference answers `Task not found` to both, and the two call for
  // opposite fixes from the caller. `nextId` never goes backwards, so the
  // counter alone separates them — no tombstone is stored.
  let document = create(emptySessionTaskDocument(), { subject: 'first', description: 'd' });
  document = create(document, { subject: 'second', description: 'd' });
  const afterDelete = update(document, { taskId: '2', status: 'deleted' });

  assert.equal(get(afterDelete, '2'), 'Task #2 was deleted');
  assert.equal(get(afterDelete, '9'), 'Task not found');
  assert.equal(get(afterDelete, '0'), 'Task not found');
  assert.equal(get(afterDelete, 'abc'), 'Task not found');

  // TaskUpdate answers with the same distinction.
  const stale = updateSessionTask(afterDelete, { taskId: '2', status: 'completed' }, NOW);
  assert.equal(stale.ok, false);
  assert.equal(stale.ok ? '' : stale.message, 'Task #2 was deleted');
});
