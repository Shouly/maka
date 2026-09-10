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
  const frame = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  // The gutter is read rather than hardcoded: on Windows it widens to clear the
  // caption buttons.
  const gutter = await page.evaluate(() => {
    const actions = document.querySelector('.maka-titlebar-actions');
    return actions ? Number.parseFloat(getComputedStyle(actions).paddingRight) : Number.NaN;
  });
  const paneFrame = async () => {
    const pane = await panel.boundingBox();
    const toggle = await page
      .locator('[data-maka-contract="session-workbar-toggle"]')
      .boundingBox();
    if (!pane || !toggle) return null;
    return {
      top: Math.round(pane.y),
      right: Math.round(frame.width - (pane.x + pane.width)),
      bottom: Math.round(frame.height - (pane.y + pane.height)),
      seam: Math.round(pane.x - (toggle.x + toggle.width)),
    };
  };
  // Polled, because the column animates open — and measured, because two
  // separate claims about the layout ride on it. The pane is a full-height
  // COLUMN of the window, so its frame is the same 8px eave on all four sides
  // (it used to hang 56px below the top, under a window-wide titlebar, with
  // 8px on the other three). And the titlebar belongs to the column left of
  // it, so the workbar toggle ends one gutter short of the seam rather than
  // pinned above the pane it controls.
  await expect.poll(paneFrame).toEqual({
    top: 8,
    right: 8,
    bottom: 8,
    seam: Math.round(gutter),
  });
  // The column itself never clips — the window does. The pane's frame is a
  // box-shadow drawn outside its box, hairline ring included, so a clip here
  // would cut its left edge away, and it would do it for good on any pane that
  // was already open when the window loaded and so never played its move.
  await expect
    .poll(() =>
      page
        .locator('[data-maka-contract="session-workbar-column"]')
        .evaluate((element) => getComputedStyle(element).overflowX),
    )
    .toBe('visible');
  // The pane opens at half the window, and half is also as far as the handle
  // drags: wider than that it stops being a pane beside the transcript, and a
  // reader who wants the whole frame has full screen for it. The column is
  // what is measured — the 8px eave on the right is inside it.
  const column = page.locator('[data-maka-contract="session-workbar-column"]');
  await expect
    .poll(async () => Math.round((await column.boundingBox())!.width))
    .toBe(Math.round(frame.width / 2));
  // And the handle has to move the pane's edge. It moved nothing for a while:
  // the column held a width of its own, measured once as it opened, so a pane
  // dragged wider just hung off the window while the edge under the pointer
  // stayed where it was.
  const before = (await panel.boundingBox())!;
  await page.getByRole('separator', { name: '调整工作栏宽度' }).hover();
  await page.mouse.down();
  await page.mouse.move(before.x + 120, before.y + 200, { steps: 8 });
  await page.mouse.up();
  // The LEFT edge is the assertion, not the width: a pane whose column is
  // pinned still reports the width it was given, it just wears it off the far
  // side of the window — which shows up here as an eave that is no longer 8.
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      if (!box) return null;
      return {
        x: Math.round(box.x),
        right: Math.round(frame.width - (box.x + box.width)),
      };
    })
    .toEqual({ x: Math.round(before.x) + 120, right: 8 });
  // Full screen is this column growing to the whole frame — measured, because
  // it is one `absolute inset-0` against `.appFrame` and any `overflow-hidden`
  // or `transform` introduced between the two would silently clip it back.
  await page.getByRole('button', { name: '全屏显示工作栏', exact: true }).click();
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return box
        ? {
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
          }
        : null;
    })
    .toEqual({ x: 0, y: 0, width: frame.width, height: frame.height });
  // The titlebar is not drawn while the pane owns the window: its controls all
  // point at things underneath the pane.
  await expect(page.locator('.maka-window-titlebar')).toBeHidden();
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  await expect(page.locator('.maka-window-titlebar')).toBeVisible();
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
