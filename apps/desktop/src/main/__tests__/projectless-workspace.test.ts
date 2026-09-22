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
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { buildWorkspaceInstructionsPromptFragment } from '@maka/runtime/system-prompt/workspace-instructions';
import { createProjectlessWorkspaces } from '../projectless-workspace.js';

async function fixture(t: TestContext) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'maka-projectless-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const options = {
    root: join(base, 'Documents', 'Maka'),
    previewRoot: join(base, 'app-data', 'projectless-preview'),
    reservationsRoot: join(base, 'app-data', 'task-workspace-reservations'),
    now: () => new Date(2026, 8, 22),
  };
  return { base, options, workspaces: createProjectlessWorkspaces(options) };
}

test('preview does not allocate a task directory or expose earlier task files', async (t) => {
  const { options, workspaces } = await fixture(t);
  assert.equal(await workspaces.preview(), options.previewRoot);
  assert.deepEqual(await readdir(options.previewRoot), []);
  await assert.rejects(readdir(options.root), { code: 'ENOENT' });
  const cwd = await workspaces.create();
  await writeFile(join(cwd, 'report.txt'), 'One task only');
  assert.deepEqual(await readdir(await workspaces.preview()), []);
});

test('parallel tasks get distinct empty persistent directories without injected workspace instructions', async (t) => {
  const { base, options, workspaces } = await fixture(t);
  const cwds = await Promise.all([workspaces.create(), workspaces.create(), workspaces.create()]);
  assert.equal(new Set(cwds).size, 3);
  for (const cwd of cwds) {
    assert.equal(dirname(cwd), join(options.root, '2026-09-22'));
    assert.deepEqual(await readdir(cwd), []);
    const instructions = await buildWorkspaceInstructionsPromptFragment(cwd, { homeDir: base });
    assert.equal(instructions, undefined);
  }
  const output = join(cwds[0]!, 'report.txt');
  await writeFile(output, 'Saved output');
  // Recreating the manager (app restart) never clears previously created tasks.
  const next = await createProjectlessWorkspaces(options).create();
  assert.ok(!cwds.includes(next));
  assert.equal(await readFile(output, 'utf8'), 'Saved output');
  assert.deepEqual(await readdir(next), []);
});

test('a workspace or date symlink cannot redirect allocation into a project', async (t) => {
  const { base, options } = await fixture(t);
  const project = join(base, 'project');
  await mkdir(project);
  const redirectedRoot = join(base, 'redirected');
  await symlink(project, redirectedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    createProjectlessWorkspaces({ ...options, root: redirectedRoot }).create(),
    /must be a directory/,
  );
  await mkdir(options.root, { recursive: true });
  await symlink(project, join(options.root, '2026-09-22'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createProjectlessWorkspaces(options).create(), /must be a directory/);
  assert.deepEqual(await readdir(project), []);
});

test('a replayable creation retains its directory across concurrency, restart and date changes', async (t) => {
  const { options, workspaces } = await fixture(t);
  const paths = await Promise.all([workspaces.create('action-1'), workspaces.create('action-1')]);
  assert.equal(paths[0], paths[1]);
  await writeFile(join(paths[0]!, 'report.txt'), 'Keep this');
  const restarted = createProjectlessWorkspaces({ ...options, now: () => new Date(2026, 8, 23) });
  assert.equal(await restarted.create('action-1'), paths[0]);
  assert.equal(await readFile(join(paths[0]!, 'report.txt'), 'utf8'), 'Keep this');
  assert.notEqual(await restarted.create('action-2'), paths[0]);
});

test('replaying an initialized workspace preserves edits and refuses to recreate a deleted directory', async (t) => {
  const { options, workspaces } = await fixture(t);
  const cwd = await workspaces.create('action-1');
  await writeFile(join(cwd, 'AGENTS.md'), 'User-owned instructions');
  await writeFile(join(cwd, 'report.txt'), 'User-owned output');
  const restarted = createProjectlessWorkspaces(options);
  assert.equal(await restarted.create('action-1'), cwd);
  assert.deepEqual((await readdir(cwd)).sort(), ['AGENTS.md', 'report.txt']);
  assert.equal(await readFile(join(cwd, 'AGENTS.md'), 'utf8'), 'User-owned instructions');
  assert.equal(await readFile(join(cwd, 'report.txt'), 'utf8'), 'User-owned output');
  await rm(cwd, { recursive: true });
  await assert.rejects(restarted.create('action-1'), { code: 'ENOENT' });
  await assert.rejects(readdir(cwd), { code: 'ENOENT' });
});
