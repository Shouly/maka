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
  taskOutputResourceRef,
  parseTaskOutputResourceRef,
  toolResultStorageRefs,
} from '../file-resources.js';
import { decodeCanonicalToolResultContent } from '../tool-result-record-schema.js';
import { SAVED_OUTPUT_FILE_NAME } from '../saved-output-paths.js';

test('task output refs are portable, scoped by the caller, and distinct from file refs', () => {
  const ref = taskOutputResourceRef('sr_task');
  assert.equal(ref, 'maka://runtime/task-outputs/sr_task');
  assert.deepEqual(parseTaskOutputResourceRef(ref), { shellRunId: 'sr_task' });
  for (const bad of [
    '/tmp/tasks/s/sr_task.output',
    `${ref}?session=other`,
    `${ref}#x`,
    `${ref}/more`,
    'maka://runtime/attachments/sr_task',
  ])
    assert.equal(parseTaskOutputResourceRef(bad), null);
  assert.equal(SAVED_OUTPUT_FILE_NAME.test('sr_task.output'), true);
  assert.equal(SAVED_OUTPUT_FILE_NAME.test('../sr_task.output'), false);
});

test('opaque output dependencies are explicit; paths and refs in prose are not authorities', () => {
  const ref = 'maka://runtime/attachments/report';
  const content = decodeCanonicalToolResultContent({
    kind: 'json',
    value: { content: [{ type: 'text', text: `Read ${ref}` }] },
    fileRefs: [ref],
  });
  assert.deepEqual(toolResultStorageRefs(content, 's'), [
    { kind: 'session_file', sessionId: 's', relativePath: 'report' },
  ]);
  assert.deepEqual(
    toolResultStorageRefs({ kind: 'text', text: `Read ${ref} or /old/tasks/s/task.output` }, 's'),
    [],
  );
  assert.throws(() =>
    decodeCanonicalToolResultContent({ kind: 'text', text: '', fileRefs: ['/tmp/output'] }),
  );
});

test('detached child snapshots retain explicit file dependencies in the owning Session', () => {
  const snapshot = decodeCanonicalToolResultContent({
    kind: 'agent_swarm',
    status: 'completed',
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    items: [
      {
        itemId: 'item',
        index: 0,
        profile: 'default',
        started: true,
        status: 'completed',
        summary: 'done',
        artifactIds: ['report'],
      },
    ],
  });
  assert.deepEqual(toolResultStorageRefs(snapshot, 'branch'), [
    { kind: 'session_file', sessionId: 'branch', relativePath: 'report' },
  ]);
});
