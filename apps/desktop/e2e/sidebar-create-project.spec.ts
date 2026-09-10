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

import { realpath } from 'node:fs/promises';
import { ensureSidebarExpanded, expect, test, sendPrompt } from './fixtures';

test('project creation commits only on confirmation and the quick task uses its directory', async ({ directoryReferenceWindow: { page, folder } }) => {
  await ensureSidebarExpanded(page);
  const before = await page.evaluate(() => window.maka.projects.getLocalSnapshot());
  const group = page.locator('button[aria-controls="sidebar-group-projects-items"]');
  if (await group.getAttribute('aria-expanded') === 'true') await group.click();
  const add = page.getByRole('button', { name: '创建项目', exact: true });
  await add.click();
  const modal = page.locator('[data-maka-contract="create-project-dialog"]');
  await expect(modal).toBeVisible();
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  const choose = modal.getByRole('button', { name: '选择 Maka 可以读取和编辑的文件夹', exact: true });
  await choose.click();
  await expect(modal.getByText(folder, { exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.maka.projects.getLocalSnapshot())).projects.length).toBe(before.projects.length);
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(add).toBeFocused();
  expect((await page.evaluate(() => window.maka.projects.getLocalSnapshot())).projects.length).toBe(before.projects.length);
  await add.click();
  await choose.click();
  await modal.getByRole('textbox', { name: '项目名称', exact: true }).fill('Sidebar created project');
  await modal.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  const row = page.locator('[data-maka-contract="project-row"]').filter({ hasText: 'Sidebar created project' });
  await expect(row).toBeVisible();
  const toggle = row.locator('[data-roving-row]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await row.hover();
  await row.getByRole('button', { name: '在「Sidebar created project」中新建任务', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: '项目: Sidebar created project', exact: true })).toBeVisible();
  await sendPrompt(page, 'created project quick task');
  const projects = await page.evaluate(() => window.maka.projects.getLocalSnapshot());
  const project = projects.projects.find((entry) => entry.name === 'Sidebar created project');
  expect(project).toBeDefined();
  await expect.poll(async () => {
    const rows = await page.evaluate(() => window.maka.sessions.list());
    return rows.map((entry) => ({ projectId: entry.projectId, cwd: entry.cwd }));
  }).toEqual([{ projectId: project!.id, cwd: await realpath(folder) }]);
});
