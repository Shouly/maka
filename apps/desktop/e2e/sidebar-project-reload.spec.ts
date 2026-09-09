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

test('project tasks stay out of Recents before and after reload', async ({
  newTaskTargetWindow: page,
}) => {
  await sendPrompt(page, 'project reload contract');
  await page.evaluate(async () => {
    const catalog = await window.maka.newTasks.getCatalog();
    const host = catalog.hosts.find((entry) => entry.readiness === 'ready' && entry.state === 'available');
    if (!host || host.readiness !== 'ready') throw new Error('Missing fixture Host');
    await window.maka.newTasks.create(
      { profileId: host.profile.id, hostId: host.hostId, projectId: null },
      { name: 'standalone sidebar task' },
    );
  });
  await ensureSidebarExpanded(page);
  const projects = page.getByRole('region', { name: '项目', exact: true });
  const recents = page.getByRole('region', { name: '最近', exact: true });
  const projectRow = page.locator('#app-sidebar [data-maka-contract="project-row"]').first();
  const toggle = projectRow.locator('button[data-roving-row]');
  const projectIcon = projectRow.locator('[data-anthropicon="projects"]');
  const caret = projectRow.locator('[data-anthropicon="caretRight"]');
  await page.locator(COMPOSER_INPUT).hover();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(projectIcon).toHaveCSS('opacity', '1');
  await expect(caret).toHaveCSS('opacity', '0');
  await expect(toggle).toHaveText(/new-task-project$/);
  await page.bringToFront();
  await toggle.getByText('new-task-project', { exact: true }).hover();
  await expect(projectIcon).toHaveCSS('opacity', '0');
  await expect(caret).toHaveCSS('opacity', '1');
  await expect(caret).toHaveCSS('rotate', '90deg');
  await toggle.getByText('new-task-project', { exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(caret).toHaveCSS('rotate', 'none');
  await page.locator(COMPOSER_INPUT).hover();
  await expect(projectIcon).toHaveCSS('opacity', '1');
  await expect(caret).toHaveCSS('opacity', '0');
  // The full-width button includes its trailing blank space.
  const bounds = await toggle.boundingBox();
  if (!bounds) throw new Error('Missing project row');
  await toggle.click({ position: { x: bounds.width - 40, y: bounds.height / 2 } });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await projectRow.getByRole('button', { name: '项目「new-task-project」的操作', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await expect(projects.getByRole('option', { name: 'project reload contract' })).toBeVisible();
  await expect(recents.getByRole('option', { name: 'project reload contract' })).toHaveCount(0);
  await expect(projects.getByText('未归入项目', { exact: true })).toHaveCount(0);
  await expect(recents.getByRole('option', { name: 'standalone sidebar task' })).toBeVisible();
  await expect(projects.getByRole('option', { name: 'standalone sidebar task' })).toHaveCount(0);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await sendPrompt(page, 'newer project task');
  await ensureSidebarExpanded(page);
  const projectRows = projects.locator('[data-maka-contract="session-row"]');
  await expect(projectRows.first()).toContainText('newer project task');
  const olderRow = projectRows.filter({ hasText: 'project reload contract' });
  await olderRow.hover();
  await olderRow.getByRole('button', { name: '「project reload contract」的操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  await expect(projectRows.first()).toContainText('project reload contract');
  const pinned = page.getByRole('region', { name: '置顶', exact: true });
  await expect(pinned.getByRole('option', { name: 'project reload contract' })).toBeVisible();
  await expect(recents.getByRole('option', { name: 'project reload contract' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator(COMPOSER_INPUT)).toBeVisible();
  await ensureSidebarExpanded(page);
  await expect(projects.getByRole('option', { name: 'project reload contract' })).toBeVisible();
  await expect(recents.getByRole('option', { name: 'project reload contract' })).toHaveCount(0);
  await expect(projects.getByText('未归入项目', { exact: true })).toHaveCount(0);
  await expect(recents.getByRole('option', { name: 'standalone sidebar task' })).toBeVisible();
  await expect(projects.getByRole('option', { name: 'standalone sidebar task' })).toHaveCount(0);
  await expect(projectRows.first()).toContainText('project reload contract');
  // The pin survived the reload; assert it before the menu opens, since an
  // open menu hides the rest of the app from the accessibility tree.
  await expect(pinned.getByRole('option', { name: 'project reload contract' })).toBeVisible();
  await olderRow.hover();
  await olderRow.getByRole('button', { name: '「project reload contract」的操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '取消置顶', exact: true }).click();
  await expect(projectRows.first()).toContainText('newer project task');
  await expect(pinned).toHaveCount(0);
});
