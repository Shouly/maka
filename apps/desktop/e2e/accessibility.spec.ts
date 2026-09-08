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

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  findUnnamedActionableAxNodes,
  findAxLandmarkProblems,
} from '../../../scripts/ax-tree-audit.mjs';
import { ensureSidebarExpanded, expect, test, sendPrompt } from './fixtures';

test('native accessibility names cover the shell, transcript, settings and modules', async ({
  window: page,
}, testInfo) => {
  const shots = resolve('../../.maka-shots/enterprise');
  await mkdir(shots, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const audit = async (surface: string) => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    const unnamed = findUnnamedActionableAxNodes(nodes);
    await testInfo.attach(`ax-${surface}`, {
      body: JSON.stringify({ nodes, unnamed }),
      contentType: 'application/json',
    });
    expect(unnamed, `unnamed actionable controls on ${surface}`).toEqual([]);
    expect(findAxLandmarkProblems(nodes), `landmarks on ${surface}`).toEqual([]);
  };
  await ensureSidebarExpanded(page);
  await audit('welcome');
  await sendPrompt(page, 'accessibility transcript');
  await audit('transcript');
  await page.getByRole('button', { name: '搜索任务', exact: true }).click();
  await expect(page.locator('[data-maka-contract="search-modal"]')).toBeVisible();
  await audit('search');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  for (const section of [
    'general',
    'appearance',
    'projects',
    'models',
    'subagents',
    'memory',
    'search',
    'usage',
    'archived-tasks',
    'data',
    'permissions',
    'health',
    'about',
  ]) {
    await page
      .locator(`[data-maka-contract="settings-sidebar"] [data-settings-section="${section}"]`)
      .click();
    await expect(page.locator('[data-maka-contract="settings-content"]')).toHaveAttribute(
      'data-settings-section',
      section,
    );
    await audit(section);
    if (section === 'appearance')
      await page.screenshot({
        path: resolve(shots, 'phase6-settings-light.png'),
        animations: 'disabled',
      });
  }
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '扩展', exact: true }).click();
  await expect(page.locator('[data-maka-contract="module-main"]')).toBeVisible();
  await audit('skills');
  await page.getByRole('radio', { name: 'MCP', exact: true }).click();
  await audit('mcp');
  await page.getByRole('button', { name: '定时任务', exact: true }).click();
  await audit('scheduled');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page
    .locator('[data-maka-contract="settings-sidebar"] [data-settings-section="appearance"]')
    .click();
  await page.evaluate(() => window.maka.settings.updateClient({ appearance: { theme: 'dark' } }));
  await expect(page.locator('html')).toHaveClass(/dark/);
  await audit('appearance-dark');
  await page.getByRole('radio', { name: '深色', exact: true }).focus();
  await expect(page.getByRole('radio', { name: '深色', exact: true })).toBeChecked();
  await page.screenshot({
    path: resolve(shots, 'phase6-settings-dark.png'),
    animations: 'disabled',
  });
  await cdp.detach();
});
