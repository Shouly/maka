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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createWorkHubCreationContexts, type WorkHubCreationContext } from '../workhub-creation-context.js';

test('a creation retry retains its Project, directory and defaults after settings change and restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'maka-workhub-context-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const workspace of [
    { kind: 'host_path', path: join(root, 'task') } as const,
    { kind: 'project', projectId: 'project-a' } as const,
  ]) {
    const key = workspace.kind;
    let reads = 0;
    let current: WorkHubCreationContext = { workspace, defaults: { permissionMode: 'ask' } };
    const load = async () => { reads++; return current; };
    const store = createWorkHubCreationContexts(root);
    const [first, concurrent] = await Promise.all([store.resolve(key, load), store.resolve(key, load)]);
    assert.deepEqual(first, concurrent);
    current = { workspace: { kind: 'project', projectId: 'project-b' }, defaults: { permissionMode: 'bypass' } };
    assert.deepEqual(await store.resolve(key, load), first);
    assert.deepEqual(await createWorkHubCreationContexts(root).resolve(key, load), first);
    assert.equal(reads, 1);
    assert.deepEqual(await store.resolve(`${key}-next`, load), current);
  }
});

test('a failed resolution can retry without publishing a partial context', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'maka-workhub-context-failed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createWorkHubCreationContexts(root);
  await assert.rejects(store.resolve('action', async () => { throw new Error('not ready'); }), /not ready/);
  const context: WorkHubCreationContext = { workspace: { kind: 'project', projectId: 'project' }, defaults: {} };
  assert.deepEqual(await store.resolve('action', async () => context), context);
});
