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
  await page.getByRole('button', { name: '展开任务工作栏' }).click();
  await expect(page.locator('#maka-workbar-pane')).toBeVisible();
  await ensureSidebarExpanded(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('[data-maka-contract="settings-surface"]')).toBeVisible();
  await expect(page.locator('#maka-workbar-pane')).toHaveCount(0);
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
  await page
    .locator('[data-maka-contract="settings-sidebar"] [data-settings-section="general"]')
    .click();
  const tone = page.getByRole('textbox', { name: '助手语气偏好' });
  await tone.fill('Concise and concrete');
  await tone.press('Tab');
  await expect
    .poll(() =>
      page.evaluate(async () => (await window.maka.settings.get()).personalization.assistantTone),
    )
    .toBe('Concise and concrete');
  await page.reload();
  await expect(page.locator(COMPOSER_INPUT)).toBeVisible();
  await ensureSidebarExpanded(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(tone).toHaveValue('Concise and concrete');
});
