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
import { test } from 'node:test';
import {
  decodeSessionTaskQueryInput,
  decodeSessionTaskQueryResult,
  HOST_OPERATION_SPECS,
} from '../protocol/index.js';

const TASK = {
  id: '1',
  subject: 'one',
  description: 'the first task',
  status: 'pending',
  blocks: [],
  blockedBy: [],
  createdAt: 0,
  updatedAt: 0,
} as const;

test('SessionTask protocol accepts one whole bounded document', () => {
  assert.deepEqual(decodeSessionTaskQueryInput({ sessionId: 'session-1' }), {
    sessionId: 'session-1',
  });
  assert.deepEqual(
    decodeSessionTaskQueryResult({ sessionId: 'session-1', nextId: 2, items: [TASK] }),
    { sessionId: 'session-1', nextId: 2, items: [{ ...TASK }] },
  );
  assert.ok(HOST_OPERATION_SPECS['session.task.query']);
  assert.equal(Object.hasOwn(HOST_OPERATION_SPECS, 'task.ledger.query'), false);
});

test('SessionTask protocol rejects extra fields and invalid tasks', () => {
  assert.throws(() => decodeSessionTaskQueryInput({ sessionId: 'session-1', cursor: 'x' }));
  // An unknown status.
  assert.throws(() =>
    decodeSessionTaskQueryResult({
      sessionId: 'session-1',
      nextId: 2,
      items: [{ ...TASK, status: 'blocked' }],
    }),
  );
  // A missing nextId: the counter is what keeps ids from being reused.
  assert.throws(() => decodeSessionTaskQueryResult({ sessionId: 'session-1', items: [TASK] }));
  // Two tasks claiming the same id.
  assert.throws(() =>
    decodeSessionTaskQueryResult({
      sessionId: 'session-1',
      nextId: 2,
      items: [TASK, { ...TASK }],
    }),
  );
});
