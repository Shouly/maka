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

import { COMPOSER_INPUT, ensureSidebarExpanded, test, expect, sendPrompt } from './fixtures';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('right workbar visibility belongs to each session and survives reload', async ({
  window: page,
}) => {
  await sendPrompt(page, 'first workbar owner');
  await ensureSidebarExpanded(page);
  await page.getByRole('button', { name: '展开任务工作栏' }).click();
  const panel = page.locator('#maka-workbar-pane');
  await expect(panel).toBeVisible();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await sendPrompt(page, 'second workbar owner');
  await expect(panel).toHaveCount(0);
  await page
    .getByRole('region', { name: '最近', exact: true })
    .getByRole('option', { name: 'first workbar owner' })
    .click();
  await expect(panel).toBeVisible();
  await page.reload();
  await expect(page.locator(COMPOSER_INPUT)).toBeVisible();
  await ensureSidebarExpanded(page);
  await page
    .getByRole('region', { name: '最近', exact: true })
    .getByRole('option', { name: 'first workbar owner' })
    .click();
  await expect(panel).toBeVisible();
  await page
    .getByRole('region', { name: '最近', exact: true })
    .getByRole('option', { name: 'second workbar owner' })
    .click();
  await expect(panel).toHaveCount(0);
});

test('Git changes re-read the workspace after focus returns', async ({
  gitReviewWindow: { page, projectRoot },
}) => {
  await sendPrompt(page, 'create review session');
  await page.keyboard.press('Control+Shift+g');
  const review = page.locator('[data-maka-contract="session-review"]');
  await expect(review).toContainText('base.txt');
  await writeFile(join(projectRoot, 'focus-refresh.txt'), 'unique focus refresh content\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(review).toContainText('focus-refresh.txt');
});

test('a real PTY belongs to its session and can be stopped explicitly', async ({
  window: page,
}) => {
  await sendPrompt(page, 'terminal owner');
  const id = await page.evaluate(async () => (await window.maka.sessions.list())[0]!.id);
  await page.keyboard.press('Control+Backquote');
  const terminal = page.locator('[data-maka-contract="session-terminal"]');
  await terminal.getByRole('button', { name: '新建终端', exact: true }).first().click();
  const input = terminal.locator('.xterm-helper-textarea');
  await input.pressSequentially('echo phase-six-$((3+3))');
  await input.press('Enter');
  await expect(terminal.locator('.xterm-rows')).toContainText('phase-six-6');
  await ensureSidebarExpanded(page);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await sendPrompt(page, 'another terminal owner');
  const second = await page.evaluate(
    async (first) => (await window.maka.sessions.list()).find((row) => row.id !== first)!.id,
    id,
  );
  expect(await page.evaluate((owner) => window.maka.shellRuns.list(owner), second)).toHaveLength(0);
  await page
    .getByRole('region', { name: '最近', exact: true })
    .getByRole('option', { name: 'terminal owner', exact: true })
    .click();
  await expect(terminal).toBeVisible();
  await terminal.getByRole('button', { name: '停止当前终端', exact: true }).click();
  await expect
    .poll(async () =>
      (await page.evaluate((owner) => window.maka.shellRuns.list(owner), id)).every(
        (run) => run.result.status !== 'running',
      ),
    )
    .toBe(true);
});
