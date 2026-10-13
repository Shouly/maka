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
import { registerToolResultFileIpc, type RevealToolResultFileResult } from '../tool-result-file-ipc-main.js';

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>;
const REF = 'maka://runtime/attachments/stable-output';
const NOT_ALLOWED = { ok: false, reason: 'not-allowed' };
function fixture(result: RevealToolResultFileResult = { ok: true }) {
  const handlers = new Map<string, Handler>();
  const calls: Array<{ sessionId: string; artifactId: string }> = [];
  registerToolResultFileIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler as Handler) },
    revealArtifact: async (sessionId, artifactId) => { calls.push({ sessionId, artifactId }); return result; },
  });
  assert.equal(handlers.has('app:openToolResultFile'), false, 'revealing must never execute a file');
  return { calls, reveal: (sessionId: unknown, ref: unknown) => handlers.get('app:revealToolResultFile')!({}, sessionId, ref) };
}

test('saved output always uses Session-authorized Host materialization, locally or remotely', async () => {
  const { calls, reveal } = fixture();
  assert.deepEqual(await reveal('session-a', REF), { ok: true });
  assert.deepEqual(calls, [{ sessionId: 'session-a', artifactId: 'stable-output' }]);
});

test('renderer filesystem paths are never opened, resolved, or revealed', async () => {
  const { calls, reveal } = fixture();
  for (const ref of ['/tmp/tool-results/session-a/output.txt', 'C:\\state\\output.txt', '../output.txt', 'file:///tmp/output.txt', 'output.txt', '', undefined, 42]) {
    assert.deepEqual(await reveal('session-a', ref), NOT_ALLOWED, String(ref));
  }
  assert.deepEqual(calls, []);
});

test('invalid or non-file resource refs are refused before invoking the Host', async () => {
  const { calls, reveal } = fixture();
  for (const ref of [REF + '?path=/tmp/a', REF + '#fragment', REF + '/nested', 'maka://runtime/attachments/../secret', 'maka://runtime/attachments/%2fsecret', 'maka://runtime/task-outputs/live-task', 'maka://other/attachments/id']) {
    assert.deepEqual(await reveal('session-a', ref), NOT_ALLOWED, ref);
  }
  assert.deepEqual(calls, []);
});

test('invalid Session identities cannot reach file materialization', async () => {
  const { calls, reveal } = fixture();
  for (const sessionId of [undefined, 42, '', '..', '../session-a', 'a b']) assert.deepEqual(await reveal(sessionId, REF), NOT_ALLOWED);
  assert.deepEqual(calls, []);
});

for (const reason of ['missing', 'open-failed'] as const) test(`Host ${reason} is preserved with no local-path fallback`, async () => {
  const { calls, reveal } = fixture({ ok: false, reason });
  assert.deepEqual(await reveal('session-a', REF), { ok: false, reason });
  assert.equal(calls.length, 1);
});
