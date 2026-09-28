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

import { ensureSidebarExpanded, expect, test } from './fixtures';

// The language lives in the account menu; nobody is signed in
// here, so it is written through the client settings IPC the menu writes.
test('switches the app from Simplified to Traditional Chinese, live and after a reload', async ({
  window: page,
}) => {
  await ensureSidebarExpanded(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const content = page.locator('[data-maka-contract="settings-content"]');
  await expect(content.getByText('对话字号', { exact: true })).toBeVisible();

  await page.evaluate(async () => {
    await window.maka.settings.updateClient({ personalization: { uiLocale: 'zh-TW' } });
  });
  // The open dialog re-renders in place, and so does the sidebar under it.
  await expect(content.getByText('對話字型大小', { exact: true })).toBeVisible();
  await expect(
    page.locator('[data-maka-contract="settings-sidebar"]').getByText('通用', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-maka-locale', 'zh-TW');
  await page.keyboard.press('Escape');

  await page.reload();
  await page.waitForSelector('[data-maka-contract="composer-input"]');
  await ensureSidebarExpanded(page);
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(
    page.locator('[data-maka-contract="settings-content"]').getByText('對話字型大小', {
      exact: true,
    }),
  ).toBeVisible();
});
