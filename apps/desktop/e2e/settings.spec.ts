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

test('settings closes with Escape and restores the selected session and workbar', async ({
  window: page,
}) => {
  await sendPrompt(page, 'settings return target');
  // A viewer is what puts the pane in the right column (see
  // session-workbar.spec.ts); the titlebar button now opens the session panel.
  await page.keyboard.press('Control+Shift+g');
  await expect(page.locator('#maka-workbar-pane')).toBeVisible();
  await ensureSidebarExpanded(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('[data-maka-contract="settings-surface"]')).toBeVisible();
  // A dialog over the session: the task and its workbar stay mounted under it.
  await expect(page.locator('#maka-workbar-pane')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-maka-contract="settings-surface"]')).toHaveCount(0);
  await expect(page.locator('#maka-workbar-pane')).toBeVisible();
  await expect(page.getByText('Fake backend received: settings return target')).toBeVisible();
});

test('settings writes persist through a renderer reload and restore the selected section', async ({
  window: page,
}) => {
  await ensureSidebarExpanded(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  // A Runtime Host setting: Memory's switch.
  await page
    .locator('[data-maka-contract="settings-sidebar"] [data-settings-section="memory"]')
    .click();
  const generate = page.getByRole('switch', { name: '从聊天生成记忆' });
  const before = (await generate.getAttribute('aria-checked')) === 'true';
  await generate.click();
  await expect
    .poll(() => page.evaluate(async () => (await window.maka.settings.get()).memory.enabled))
    .toBe(!before);
  await page.reload();
  await expect(page.locator(COMPOSER_INPUT)).toBeVisible();
  await ensureSidebarExpanded(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(generate).toHaveAttribute('aria-checked', String(!before));
});
