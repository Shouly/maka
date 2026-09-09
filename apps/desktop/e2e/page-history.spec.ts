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

test('header back and forward restore tasks, welcome drafts and settings without creating extra history', async ({ newTaskTargetWindow: page }) => {
  const controls = page.locator('[data-maka-contract="shell-topbar-rail"]');
  const back = controls.getByRole('button', { name: '后退', exact: true });
  const forward = controls.getByRole('button', { name: '前进', exact: true });
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();
  await sendPrompt(page, 'history task A');
  await ensureSidebarExpanded(page);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.locator(COMPOSER_INPUT).fill('welcome draft retained');
  await back.click();
  await expect(page.getByText('Fake backend received: history task A', { exact: true })).toBeVisible();
  await forward.click();
  await expect(page.locator(COMPOSER_INPUT)).toHaveText('welcome draft retained');
  await sendPrompt(page, 'history task B');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.locator('[data-maka-contract="settings-surface"]');
  const content = page.locator('[data-maka-contract="settings-content"]');
  await expect(content).toHaveAttribute('data-settings-section', 'general');
  await page.locator('[data-maka-contract="settings-sidebar"] [data-settings-section="appearance"]').click();
  await expect(content).toHaveAttribute('data-settings-section', 'appearance');
  await back.click();
  await expect(content).toHaveAttribute('data-settings-section', 'general');
  await back.click();
  await expect(settings).toHaveCount(0);
  await expect(page.getByText('Fake backend received: history task B', { exact: true })).toBeVisible();
  await forward.click();
  await expect(content).toHaveAttribute('data-settings-section', 'general');
  await forward.click();
  await expect(content).toHaveAttribute('data-settings-section', 'appearance');
  await back.click();
  await expect(content).toHaveAttribute('data-settings-section', 'general');
  await back.click();
  await expect(settings).toHaveCount(0);
  await back.click();
  await expect(page.locator('[data-maka-contract="welcome-surface"]')).toBeVisible();
  await page.locator('#app-sidebar').getByRole('option', { name: 'history task A', exact: true }).click();
  await expect(page.getByText('Fake backend received: history task A', { exact: true })).toBeVisible();
  await expect(forward).toBeDisabled();
  // Hovering the history arrows must not open the sidebar preview.
  await controls.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  await page.locator(COMPOSER_INPUT).hover();
  await expect(page.locator('#app-sidebar')).toHaveAttribute('aria-hidden', 'true');
  await back.hover();
  await expect(page.locator('#app-sidebar')).toHaveAttribute('aria-hidden', 'true');
  await ensureSidebarExpanded(page);
  await page.getByRole('button', { name: '扩展', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(settings).toBeVisible();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await back.click();
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('maka-nav-selection-v1')!).selection.section)).toBe('extensions');

});
