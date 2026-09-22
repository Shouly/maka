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
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect } from '@playwright/test';

export async function seedProjectlessSkill(home) {
  const skill = path.join(home, '.maka', 'skills', 'global-workspace-check');
  await mkdir(skill, { recursive: true });
  await writeFile(
    path.join(skill, 'SKILL.md'),
    '---\nname: Global Workspace Check\ndescription: A global skill for workspace isolation checks.\n---\nRead the user request and reply briefly.',
  );
}

/** Uses the public preload bridge to inspect the workspace admitted by the real Host. */
export async function checkProjectlessWorkspaces({ restart, userDataDir, projectRoot, checks }) {
  let page = await restart();
  const newTask = async () => {
    const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true }).first();
    if (await expand.isVisible()) await expand.click();
    await page
      .locator('#app-sidebar')
      .getByRole('button', { name: 'New task', exact: true })
      .click();
    await page.locator('[data-maka-contract="welcome-surface"]').waitFor();
  };
  await newTask();
  const catalog = await page.evaluate(() => window.maka.newTasks.getCatalog());
  const host = catalog.hosts.find(
    (entry) => entry.readiness === 'ready' && entry.state === 'available',
  );
  assert.ok(host);
  const project = host.projects.find((entry) => entry.name === 'composer-project');
  assert.ok(project);
  const target = { profileId: host.profile.id, hostId: host.hostId, projectId: project.id };
  const none = { ...target, projectId: null };
  const picker = page.getByRole('button', { name: /^Project: / });
  await picker.click();
  const option = page
    .getByRole('listbox', { name: 'Project' })
    .getByRole('option')
    .filter({ hasText: project.name });
  if ((await option.getAttribute('aria-selected')) !== 'true') {
    await option.click();
    await picker.click();
  }
  await option.click();
  await page.getByRole('button', { name: 'Project: Project', exact: true }).waitFor();

  const [projectFiles, emptyFiles, projectSkills, globalSkills] = await page.evaluate(
    async ({ target, none }) =>
      Promise.all([
        window.maka.newTasks.searchFiles(target, 'mention-example'),
        window.maka.newTasks.searchFiles(none, 'mention-example'),
        window.maka.newTasks.listInvocableSkills(target),
        window.maka.newTasks.listInvocableSkills(none),
      ]),
    { target, none },
  );
  assert.ok(
    projectFiles.ok &&
      projectFiles.files.some((file) => file.relativePath === 'mention-example.txt'),
  );
  assert.deepEqual(emptyFiles, { ok: true, files: [] });
  assert.ok(projectSkills.some((skill) => skill.name === 'Composer Review'));
  assert.ok(globalSkills.some((skill) => skill.name === 'Global Workspace Check'));
  assert.ok(!globalSkills.some((skill) => skill.name === 'Composer Review'));
  checks.push(
    'deselecting a Project clears file search and project Skills while retaining global Skills',
  );

  const createTask = async (prompt) => {
    const before = await page.evaluate(async () =>
      (await window.maka.sessions.list()).map((row) => row.id),
    );
    await page.getByLabel('Task', { exact: true }).fill(prompt);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page
      .locator('[data-maka-contract="transcript"]')
      .getByText('renderer loop are connected.', { exact: false })
      .waitFor();
    await page.waitForFunction(() => !document.querySelector('[data-turn-status="running"]'));
    const rows = await page.evaluate(() => window.maka.sessions.list());
    const created = rows.filter((row) => !before.includes(row.id));
    assert.equal(created.length, 1);
    return created[0];
  };
  const first = await createTask('Projectless workspace A');
  const firstInfo = await page.evaluate((id) => window.maka.app.sessionProjectInfo(id), first.id);
  const root = await realpath(path.join(userDataDir, 'Documents', 'Maka'));
  const relative = path.relative(root, firstInfo.projectPath);
  assert.match(relative.replaceAll(path.sep, '/'), /^\d{4}-\d{2}-\d{2}\/task-[a-f0-9-]+$/);
  assert.ok(first.projectId == null);
  assert.deepEqual((await readdir(firstInfo.projectPath)).sort(), [
    '.maka-workspace.json',
    'AGENTS.md',
    'outputs',
    'work',
  ]);
  await writeFile(
    path.join(firstInfo.projectPath, 'outputs', 'workspace-proof.txt'),
    'Persistent first task output',
  );
  const files = await page.evaluate(
    (id) => window.maka.workspace.searchFiles('workspace-proof', { sessionId: id }),
    first.id,
  );
  assert.ok(
    files.ok && files.files.some((file) => file.relativePath === 'outputs/workspace-proof.txt'),
  );

  if (process.platform !== 'win32') {
    const terminal = await page.evaluate((id) => window.maka.shellRuns.start(id), first.id);
    const control = { sessionId: first.id, ref: terminal.result.ref };
    try {
      await page.waitForFunction(
        async (control) => {
          const snapshot = await window.maka.shellRuns.attach(control);
          const text = snapshot?.buffer ?? '';
          const previous = window.__workspaceTerminalSettle;
          window.__workspaceTerminalSettle = {
            text,
            since: previous?.text === text ? previous.since : Date.now(),
          };
          return text.length > 0 && Date.now() - window.__workspaceTerminalSettle.since > 750;
        },
        control,
        { timeout: 30000, polling: 100 },
      );
      await page.evaluate(
        (control) =>
          window.maka.shellRuns.write({
            ...control,
            input: 'pwd -P > work/terminal-cwd.txt\r',
          }),
        control,
      );
      await expect
        .poll(async () =>
          (
            await readFile(
              path.join(firstInfo.projectPath, 'work', 'terminal-cwd.txt'),
              'utf8',
            ).catch(() => '')
          ).trim(),
        )
        .toBe(firstInfo.projectPath);
    } finally {
      await page.evaluate((control) => window.maka.shellRuns.stop(control), control);
      await page.evaluate((control) => window.maka.shellRuns.detach(control), control);
    }
    checks.push(
      'a real projectless terminal executes in its allocated cwd and writes relative files there',
    );
  }

  // Later turns use this Session's directory, with no new allocation.
  await page.getByLabel('Message input', { exact: true }).fill('Continue in the same workspace');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page
    .locator('[data-maka-contract="transcript"]')
    .getByText('Continue in the same workspace', { exact: true })
    .waitFor();
  await page
    .locator('[data-maka-contract="transcript"]')
    .getByText('renderer loop are connected.', { exact: false })
    .nth(1)
    .waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-turn-status="running"]'));
  assert.deepEqual(
    await page.evaluate((id) => window.maka.app.sessionProjectInfo(id), first.id),
    firstInfo,
  );
  const day = path.dirname(firstInfo.projectPath);
  assert.equal((await readdir(day)).length, 1);

  page = await restart();
  await page.waitForFunction(
    async (id) => (await window.maka.sessions.list()).some((row) => row.id === id),
    first.id,
  );
  assert.deepEqual(
    await page.evaluate((id) => window.maka.app.sessionProjectInfo(id), first.id),
    firstInfo,
  );
  assert.equal(
    await readFile(path.join(firstInfo.projectPath, 'outputs', 'workspace-proof.txt'), 'utf8'),
    'Persistent first task output',
  );
  await newTask();
  await page.getByRole('button', { name: 'Project: Project', exact: true }).waitFor();
  const second = await createTask('Projectless workspace B');
  const secondInfo = await page.evaluate((id) => window.maka.app.sessionProjectInfo(id), second.id);
  assert.notEqual(secondInfo.projectPath, firstInfo.projectPath);
  assert.deepEqual(await readdir(path.join(secondInfo.projectPath, 'outputs')), []);
  checks.push(
    'projectless tasks allocate separate work/output directories and preserve cwd and files across app restart',
  );

  await newTask();
  await page.getByRole('button', { name: /^Project: / }).click();
  await page
    .getByRole('listbox', { name: 'Project' })
    .getByRole('option')
    .filter({ hasText: project.name })
    .click();
  await page.locator('[data-maka-file-drop-target]').evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(['Only for the first Project session'], 'project-session-only.txt', {
        type: 'text/plain',
      }),
    );
    element.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await page
    .getByRole('button', { name: 'Remove project-session-only.txt', exact: true })
    .waitFor();
  const associated = await createTask('Project workspace regression');
  assert.equal(associated.projectId, project.id);
  const associatedInfo = await page.evaluate(
    (id) => window.maka.app.sessionProjectInfo(id),
    associated.id,
  );
  assert.equal(associatedInfo.projectPath, await realpath(projectRoot));
  const firstArtifacts = await page.evaluate((id) => window.maka.artifacts.list(id), associated.id);
  assert.ok(firstArtifacts.some((artifact) => artifact.name === 'project-session-only.txt'));
  assert.ok(!(await readdir(projectRoot)).includes('project-session-only.txt'));
  await newTask();
  const sibling = await createTask('Second conversation in the same Project');
  assert.notEqual(sibling.id, associated.id);
  assert.equal(sibling.projectId, project.id);
  assert.deepEqual(
    await page.evaluate((id) => window.maka.app.sessionProjectInfo(id), sibling.id),
    associatedInfo,
  );
  assert.equal(
    await page
      .locator('[data-maka-contract="transcript"]')
      .getByText('Project workspace regression', { exact: true })
      .count(),
    0,
  );
  assert.deepEqual(await page.evaluate((id) => window.maka.artifacts.list(id), sibling.id), []);
  assert.deepEqual(
    await page.evaluate((id) => window.maka.artifacts.list(id), associated.id),
    firstArtifacts,
  );
  assert.equal(
    (await readdir(day)).length,
    2,
    'a Project task must not allocate a standalone directory',
  );
  checks.push(
    'selecting a Project keeps the original project cwd and does not create a dated workspace',
  );
  checks.push(
    'two Project sessions share the project cwd while their transcripts and attachments stay independent',
  );
}
