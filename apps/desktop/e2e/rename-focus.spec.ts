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

import type { ElectronApplication, Locator } from '@playwright/test';
import { expect, test } from './fixtures';

async function focusWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('Maka window is missing');
    window.show();
    window.focus();
    window.webContents.focus();
  });
}

async function sendNativeText(app: ElectronApplication, value: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, text) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error('Maka window is missing');
    for (const character of text) {
      window.webContents.sendInputEvent({ type: 'char', keyCode: character });
    }
  }, value);
}

async function expectSelected(input: Locator): Promise<void> {
  await expect
    .poll(() =>
      input.evaluate((element: HTMLInputElement) => ({
        start: element.selectionStart,
        end: element.selectionEnd,
        length: element.value.length,
      })),
    )
    .toEqual(expect.objectContaining({ start: 0 }));
  await expect
    .poll(() => input.evaluate((element: HTMLInputElement) => element.selectionEnd))
    .toBe(await input.inputValue().then((value) => value.length));
}

test('rename inputs own native focus for menu and double-click entry', async ({
  renameFocusWindow: { page, app },
}) => {
  await focusWindow(app);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-maka-contract="search-modal"]')).not.toBeVisible();

  const sidebar = page.getByLabel('任务列表', { exact: true });
  const rowButton = sidebar.getByRole('option', { name: /^任务 00/ }).first();
  const row = rowButton.locator('..');
  const taskActions = row.getByRole('button', { name: /操作/ });

  await row.hover();
  await taskActions.click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '任务名称' })).toBeFocused();
  await sendNativeText(app, 'MENU');
  const taskInput = page.getByRole('textbox', { name: '任务名称' });
  await expect(taskInput).toHaveValue('MENU');
  await page.keyboard.press('Escape');
  await expect(taskActions).toBeFocused();

  await rowButton.dblclick();
  const doubleClickInput = page.getByRole('textbox', { name: '任务名称' });
  await expectSelected(doubleClickInput);
  await sendNativeText(app, 'DOUBLE');
  await expect(doubleClickInput).toHaveValue('DOUBLE');
  await page.keyboard.press('Escape');
  await expect(rowButton).toBeFocused();

  const projectActions = page.getByRole('button', {
    name: '项目「示例项目」的操作',
    exact: true,
  });
  await projectActions.locator('xpath=ancestor::*[@data-maka-contract="project-row"][1]').hover();
  await projectActions.click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '重命名' })).toBeFocused();
  await sendNativeText(app, 'PROJECT');
  const projectInput = page.getByRole('textbox', { name: '重命名' });
  await expect(projectInput).toHaveValue('PROJECT');
  await page.keyboard.press('Escape');
  await expect(projectActions).toBeFocused();

  await rowButton.click();
  const header = page.locator('[data-maka-contract="titlebar-identity"]');
  const title = header.getByRole('button', { name: '重命名', exact: true });
  await expect(title).toHaveCSS('font-size', '14px');
  await expect(title).toHaveCSS('font-weight', '400');
  const headerMenu = header.getByRole('button', { name: /操作/ });
  await headerMenu.click();
  await expect(page.getByRole('menuitem')).toHaveCount(4);
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  const headerInput = header.getByRole('textbox', { name: '任务名称' });
  await expect(headerInput).toBeFocused();
  await sendNativeText(app, 'HEADER');
  await expect(headerInput).toHaveValue('HEADER');
  await page.keyboard.press('Escape');
  await expect(headerMenu).toBeFocused();
  await title.click();
  await expect(headerInput).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(title).toBeFocused();
  await headerMenu.click();
  await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  await headerMenu.click();
  await expect(page.getByRole('menuitem', { name: '取消置顶', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: '取消置顶', exact: true }).click();


});
