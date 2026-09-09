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

import { COMPOSER_INPUT, ensureSidebarExpanded, expect, test, sendPrompt } from './fixtures';

test('manual sidebar expansion survives reload, project rename and application restart', async ({ sidebarPersistenceWindow: fixture }) => {
  let page = fixture.page;
  const projectRow = () => page.locator('[data-maka-contract="project-row"]').first();
  const projectToggle = () => projectRow().locator('button[data-roving-row]');
  const sectionToggle = (key: string) => page.locator(`button[aria-controls="sidebar-group-${key}-items"]`);
  await sendPrompt(page, 'sidebar remembered state');
  await ensureSidebarExpanded(page);
  await expect(projectToggle()).toHaveAttribute('aria-expanded', 'true');
  await projectToggle().click();
  await expect(projectToggle()).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(page.locator(COMPOSER_INPUT)).toBeVisible();
  await ensureSidebarExpanded(page);
  await expect(projectToggle()).toHaveAttribute('aria-expanded', 'false');
  await projectRow().hover();
  await projectRow().getByRole('button', { name: /的操作/ }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const rename = projectRow().getByRole('textbox', { name: '重命名', exact: true });
  await rename.fill('renamed-project');
  await rename.press('Enter');
  await expect(projectToggle()).toContainText('renamed-project');
  page = await fixture.restart();
  await ensureSidebarExpanded(page);
  await expect(projectToggle()).toContainText('renamed-project');
  await expect(projectToggle()).toHaveAttribute('aria-expanded', 'false');
  await projectToggle().click();
  await expect(projectToggle()).toHaveAttribute('aria-expanded', 'true');
  await page.locator('[data-maka-contract="titlebar-identity"]').getByRole('button', { name: /的操作/ }).click();
  await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  for (const key of ['pinned', 'projects', 'recents']) {
    await expect(sectionToggle(key)).toHaveAttribute('aria-expanded', 'true');
    await sectionToggle(key).click();
    await expect(sectionToggle(key)).toHaveAttribute('aria-expanded', 'false');
  }
  page = await fixture.restart();
  await ensureSidebarExpanded(page);
  for (const key of ['pinned', 'projects', 'recents']) {
    await expect(sectionToggle(key)).toHaveAttribute('aria-expanded', 'false');
  }
  await sectionToggle('projects').click();
  await expect(projectToggle()).toHaveAttribute('aria-expanded', 'true');
  await sectionToggle('projects').click();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await sendPrompt(page, 'navigate to project after restore');
  await expect(sectionToggle('projects')).toHaveAttribute('aria-expanded', 'true');
  await expect(projectToggle()).toHaveAttribute('aria-expanded', 'true');
});
