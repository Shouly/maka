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

import { COMPOSER_INPUT, awaitSendReady, expect, test } from './fixtures';

test('a folder reference is removable and survives send and reload without reading its files', async ({
  directoryReferenceWindow: { page, folder },
}) => {
  const addFolder = async () => {
    await page.getByRole('button', { name: '添加上下文', exact: true }).click();
    await page.getByRole('menuitem', { name: '添加文件夹', exact: true }).click();
  };
  await addFolder();
  const remove = page.getByRole('button', { name: /移除.*referenced-source/ });
  await expect(remove).toBeVisible();
  await remove.click();
  await expect(remove).toHaveCount(0);
  await addFolder();
  await expect(remove).toBeVisible();
  await page.locator(COMPOSER_INPUT).fill('请检查引用目录');
  await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(page.getByRole('log')).toContainText('referenced-source');
  await expect(page.getByRole('log')).not.toContainText('DO_NOT_READ_FILE_CONTENTS');
  await expect(page.getByRole('button', { name: '重新生成' })).toHaveCount(1);
  const sessions = await page.evaluate(() => window.maka.sessions.list());
  expect(sessions).toHaveLength(1);
  expect(sessions[0]!.cwd).not.toBe(folder);
  await page.reload();
  await expect(page.getByRole('log')).toContainText('referenced-source');
  await expect(page.getByRole('log')).not.toContainText('deep.txt');
});
