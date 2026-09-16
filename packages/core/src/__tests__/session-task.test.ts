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

// The task document's own rules, including the three places the reference
// implementation reports success for something it does not do (see the
// task-tools test report). Those are refusals here, and each one is pinned.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSessionTask,
  emptySessionTaskDocument,
  findSessionTask,
  missingSessionTaskMessage,
  normalizeSessionTaskDocument,
  openBlockers,
  openBlockersOf,
  projectSessionTasksForDisplay,
  updateSessionTask,
  type SessionTask,
  type SessionTaskDocument,
} from '../session-task.js';

const NOW = 1_000;

function seed(count: number): SessionTaskDocument {
  let document = emptySessionTaskDocument();
  for (let index = 1; index <= count; index += 1) {
    const created = createSessionTask(
      document,
      { subject: `task ${index}`, description: `describe ${index}` },
      NOW,
    );
    assert.ok(created.ok);
    document = created.value.document;
  }
  return document;
}

test('ids are monotonic and never reused, so a stale reference cannot name a new task', () => {
  const document = seed(2);
  assert.deepEqual(
    document.items.map((task) => task.id),
    ['1', '2'],
  );
  const deleted = updateSessionTask(document, { taskId: '1', status: 'deleted' }, NOW);
  assert.ok(deleted.ok);
  assert.equal(deleted.value.deleted, true);
  const created = createSessionTask(
    deleted.value.document,
    { subject: 'after the delete', description: 'takes the next id' },
    NOW,
  );
  assert.ok(created.ok);
  assert.equal(created.value.task.id, '3');
});

test('a dependency edge writes both ends, from either end', () => {
  const document = seed(2);
  const blocked = updateSessionTask(document, { taskId: '2', addBlockedBy: ['1'] }, NOW);
  assert.ok(blocked.ok);
  assert.deepEqual(blocked.value.changed, ['blockedBy']);
  assert.deepEqual(findSessionTask(blocked.value.document, '1')?.blocks, ['2']);
  assert.deepEqual(findSessionTask(blocked.value.document, '2')?.blockedBy, ['1']);

  const other = updateSessionTask(seed(2), { taskId: '1', addBlocks: ['2'] }, NOW);
  assert.ok(other.ok);
  assert.deepEqual(findSessionTask(other.value.document, '2')?.blockedBy, ['1']);
});

test('a completed blocker stops blocking, and both read surfaces agree', () => {
  const linked = updateSessionTask(seed(2), { taskId: '2', addBlockedBy: ['1'] }, NOW);
  assert.ok(linked.ok);
  const done = updateSessionTask(linked.value.document, { taskId: '1', status: 'completed' }, NOW);
  assert.ok(done.ok);
  const task = findSessionTask(done.value.document, '2');
  assert.ok(task);
  // The stored edge survives; only the open view drops it.
  assert.deepEqual(task.blockedBy, ['1']);
  assert.deepEqual(openBlockers(done.value.document, task), []);
});

test('an edge that would close a cycle is refused, not stored', () => {
  const self = updateSessionTask(seed(1), { taskId: '1', addBlockedBy: ['1'] }, NOW);
  assert.equal(self.ok, false);
  assert.match(self.ok ? '' : self.message, /cannot block itself/);

  const first = updateSessionTask(seed(3), { taskId: '2', addBlockedBy: ['1'] }, NOW);
  assert.ok(first.ok);
  const second = updateSessionTask(first.value.document, { taskId: '3', addBlockedBy: ['2'] }, NOW);
  assert.ok(second.ok);
  const closing = updateSessionTask(
    second.value.document,
    { taskId: '1', addBlockedBy: ['3'] },
    NOW,
  );
  assert.equal(closing.ok, false);
  assert.match(closing.ok ? '' : closing.message, /would create a cycle/);
});

test('an edge onto an unknown id is refused rather than dropped while reporting success', () => {
  const ghost = updateSessionTask(seed(1), { taskId: '1', addBlockedBy: ['888'] }, NOW);
  assert.equal(ghost.ok, false);
  assert.match(ghost.ok ? '' : ghost.message, /#888 not found/);
});

test('an update that names no field is refused rather than reporting a silent success', () => {
  const empty = updateSessionTask(seed(1), { taskId: '1' }, NOW);
  assert.equal(empty.ok, false);
  assert.match(empty.ok ? '' : empty.message, /at least one field/);
});

test('deleting a task takes every edge that named it', () => {
  const linked = updateSessionTask(seed(2), { taskId: '2', addBlockedBy: ['1'] }, NOW);
  assert.ok(linked.ok);
  const deleted = updateSessionTask(linked.value.document, { taskId: '1', status: 'deleted' }, NOW);
  assert.ok(deleted.ok);
  assert.equal(findSessionTask(deleted.value.document, '1'), undefined);
  assert.deepEqual(findSessionTask(deleted.value.document, '2')?.blockedBy, []);
});

test('metadata merges, and a null value deletes its key', () => {
  const withMeta = createSessionTask(
    emptySessionTaskDocument(),
    { subject: 'meta', description: 'carries metadata', metadata: { a: 1, b: 2 } },
    NOW,
  );
  assert.ok(withMeta.ok);
  const merged = updateSessionTask(
    withMeta.value.document,
    { taskId: '1', metadata: { b: null, c: 3 } },
    NOW,
  );
  assert.ok(merged.ok);
  assert.deepEqual(findSessionTask(merged.value.document, '1')?.metadata, { a: 1, c: 3 });
});

test('changed fields come back as stored names, alphabetically', () => {
  const updated = updateSessionTask(
    seed(1),
    { taskId: '1', status: 'in_progress', activeForm: 'running it' },
    NOW,
  );
  assert.ok(updated.ok);
  assert.deepEqual(updated.value.changed, ['activeForm', 'status']);
});

test('a wire document is refused when its ids collide or its counter is missing', () => {
  const document = seed(1);
  const wire = JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
  assert.ok(normalizeSessionTaskDocument(wire).ok);
  assert.equal(normalizeSessionTaskDocument({ items: document.items }).ok, false);
  assert.equal(
    normalizeSessionTaskDocument({ nextId: 2, items: [...document.items, ...document.items] }).ok,
    false,
  );
});

test('re-asserting the status a task already has is a success, not an error', () => {
  // A model re-asserts constantly: after a retry, after its context is
  // compacted, whenever it reconciles its own list against the document. The
  // guard is on what the caller NAMED, so a correct call is never answered
  // with an error, and every named field is reported whether or not it moved.
  const running = updateSessionTask(seed(1), { taskId: '1', status: 'in_progress' }, NOW);
  assert.ok(running.ok);
  const again = updateSessionTask(
    running.value.document,
    { taskId: '1', status: 'in_progress' },
    NOW,
  );
  assert.ok(again.ok);
  assert.deepEqual(again.value.changed, ['status']);

  const sameSubject = updateSessionTask(
    running.value.document,
    { taskId: '1', subject: 'task 1' },
    NOW,
  );
  assert.ok(sameSubject.ok);
  assert.deepEqual(sameSubject.value.changed, ['subject']);
});

test('an edge array that is present but empty names no field either', () => {
  const empty = updateSessionTask(seed(1), { taskId: '1', addBlocks: [] }, NOW);
  assert.equal(empty.ok, false);
  assert.match(empty.ok ? '' : empty.message, /at least one field/);
});

test('a description keeps its line structure while a label collapses to one line', () => {
  const created = createSessionTask(
    emptySessionTaskDocument(),
    {
      subject: '  Fix   the\n  login  bug ',
      description: 'First paragraph.\r\n\r\n\r\n- one\n- two   \n',
    },
    NOW,
  );
  assert.ok(created.ok);
  assert.equal(created.value.task.subject, 'Fix the login bug');
  assert.equal(created.value.task.description, 'First paragraph.\n\n- one\n- two');

  // And the display projection must not undo it on the way to a reader.
  const [projected] = projectSessionTasksForDisplay(created.value.document.items);
  assert.equal(projected?.description, 'First paragraph.\n\n- one\n- two');
});

test('linking bumps both ends, because both ends were rewritten', () => {
  let document = emptySessionTaskDocument();
  for (const subject of ['first', 'second']) {
    const created = createSessionTask(document, { subject, description: 'd' }, NOW);
    assert.ok(created.ok);
    document = created.value.document;
  }
  const later = NOW + 500;
  const linked = updateSessionTask(document, { taskId: '2', addBlockedBy: ['1'] }, later);
  assert.ok(linked.ok);
  assert.deepEqual(
    linked.value.document.items.map((task) => task.updatedAt),
    [later, later],
  );
});

const wireTask = (id: string, extra: Partial<SessionTask> = {}): Record<string, unknown> => ({
  id,
  subject: `subject ${id}`,
  description: 'described',
  status: 'pending',
  blocks: [],
  blockedBy: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

test('a wire document is refused when its dependency graph is one the write path cannot produce', () => {
  const refusals: Array<[string, Record<string, unknown>]> = [
    [
      'an edge onto an id that does not exist',
      { nextId: 2, items: [wireTask('1', { blockedBy: ['99'] })] },
    ],
    [
      'an edge written at one end only',
      { nextId: 3, items: [wireTask('1', { blockedBy: ['2'] }), wireTask('2')] },
    ],
    [
      'a two-task cycle',
      {
        nextId: 3,
        items: [
          wireTask('1', { blocks: ['2'], blockedBy: ['2'] }),
          wireTask('2', { blocks: ['1'], blockedBy: ['1'] }),
        ],
      },
    ],
    [
      'a three-task cycle',
      {
        nextId: 4,
        items: [
          wireTask('1', { blocks: ['2'], blockedBy: ['3'] }),
          wireTask('2', { blocks: ['3'], blockedBy: ['1'] }),
          wireTask('3', { blocks: ['1'], blockedBy: ['2'] }),
        ],
      },
    ],
    [
      'the same id listed twice on one edge list',
      {
        nextId: 3,
        items: [wireTask('1', { blockedBy: ['2', '2'] }), wireTask('2', { blocks: ['1'] })],
      },
    ],
  ];
  for (const [why, document] of refusals) {
    assert.equal(normalizeSessionTaskDocument(document).ok, false, why);
  }

  // The healthy shape the write path does produce still decodes.
  assert.ok(
    normalizeSessionTaskDocument({
      nextId: 3,
      items: [wireTask('1', { blocks: ['2'] }), wireTask('2', { blockedBy: ['1'] })],
    }).ok,
  );
});

test('a wire counter at or below an existing id is refused, because ids would repeat', () => {
  const low = normalizeSessionTaskDocument({ nextId: 1, items: [wireTask('5')] });
  assert.equal(low.ok, false);
  assert.match(low.ok ? '' : low.message, /greater than every task id/);
});

test('an id that names no task cannot gate anything, on either read surface', () => {
  // Unreachable through the decoders above; this is what the rule degrades to,
  // and the tools and the renderer panel must degrade the same way or one will
  // call a task blocked while the other draws it ready.
  const orphaned: SessionTask = {
    id: '1',
    subject: 'orphaned edge',
    description: 'd',
    status: 'pending',
    blocks: [],
    blockedBy: ['99'],
    createdAt: NOW,
    updatedAt: NOW,
  };
  assert.deepEqual(openBlockers({ nextId: 2, items: [orphaned] }, orphaned), []);
  assert.deepEqual(openBlockersOf([orphaned], orphaned), []);
});

test('the counter alone tells a deleted task from a number that was never issued', () => {
  const document = seed(2);
  const deleted = updateSessionTask(document, { taskId: '1', status: 'deleted' }, NOW);
  assert.ok(deleted.ok);

  assert.equal(missingSessionTaskMessage(deleted.value.document, '1'), 'Task #1 was deleted');
  assert.equal(missingSessionTaskMessage(deleted.value.document, '3'), 'Task not found');
  assert.equal(missingSessionTaskMessage(deleted.value.document, '0'), 'Task not found');
  assert.equal(missingSessionTaskMessage(deleted.value.document, 'abc'), 'Task not found');

  // An update against the deleted id carries the same answer, so a caller
  // holding a stale id learns which mistake it made.
  const stale = updateSessionTask(
    deleted.value.document,
    { taskId: '1', status: 'completed' },
    NOW,
  );
  assert.equal(stale.ok, false);
  assert.equal(stale.ok ? '' : stale.message, 'Task #1 was deleted');
});
