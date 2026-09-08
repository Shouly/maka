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

import { COMPOSER_INPUT, awaitSendReady, ensureSidebarExpanded, expect, test } from './fixtures';

test('a selected skill survives draft navigation and reaches the Host', async ({
  invocableSkillsWindow: page,
}) => {
  const editor = page.locator(COMPOSER_INPUT);
  await editor.fill('/');
  const option = page.getByRole('option').filter({ hasText: 'Project Only' });
  await expect(option).toBeVisible();
  await option.click();
  await editor.press('End');
  await editor.pressSequentially(' check this skill');
  await expect(editor.locator('[data-composer-reference="skill"]')).toHaveCount(1);
  await page.reload();
  await expect(editor).toContainText('Project Only');
  await awaitSendReady(page);
  await editor.press('Enter');
  await expect(page.getByRole('log')).toContainText('check this skill');
  await expect(page.getByRole('button', { name: '重新生成' })).toHaveCount(1);
  await expect(editor).toHaveText('');
});
