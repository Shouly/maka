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

test('project tasks and Recents are rebuilt from the Host after reload', async ({
  newTaskTargetWindow: page,
}) => {
  await sendPrompt(page, 'project reload contract');
  await ensureSidebarExpanded(page);
  const projects = page.getByRole('region', { name: '项目', exact: true });
  const recents = page.getByRole('region', { name: '最近', exact: true });
  await expect(projects.getByRole('option', { name: 'project reload contract' })).toBeVisible();
  await expect(recents.getByRole('option', { name: 'project reload contract' })).toBeVisible();
  await page.reload();
  await expect(page.locator(COMPOSER_INPUT)).toBeVisible();
  await ensureSidebarExpanded(page);
  await expect(projects.getByRole('option', { name: 'project reload contract' })).toBeVisible();
  await expect(recents.getByRole('option', { name: 'project reload contract' })).toBeVisible();
});
