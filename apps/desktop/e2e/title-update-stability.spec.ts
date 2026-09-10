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

import { COMPOSER_INPUT, awaitSendReady, expect, test, sendPrompt } from './fixtures';

test('a title update during streaming preserves visible text and the answer keeps growing', async ({ sessionLocalWindow: { page, app } }) => {
  const nativeWindow = await app.browserWindow(page);
  await nativeWindow.evaluate(window => window.show());
  await page.locator(COMPOSER_INPUT).fill('title changes while streaming ' + 'more text '.repeat(180));
  await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  const response = page.locator('[data-maka-contract="markdown"]').first();
  await expect(response.locator('.stream-pop').first()).toBeVisible();
  const existing = await response.locator('.stream-pop').first().elementHandle();
  const waiting = page.locator('[data-maka-contract="turn-running-status"]');
  await expect(waiting).toBeVisible();
  const waitingNode = await waiting.elementHandle();
  const before = (await response.textContent())!.length;
  const session = await page.evaluate(async () => (await window.maka.sessions.list())[0]!);
  await page.evaluate(id => window.maka.sessions.rename(id, 'Title changed during answer'), session.id);
  await expect(page.locator('[data-maka-contract="titlebar-identity"]')).toContainText('Title changed during answer');
  await expect(waiting).toBeVisible();
  expect(await waitingNode!.evaluate(node => node.isConnected)).toBe(true);
  expect(await existing!.evaluate(node => node.isConnected)).toBe(true);
  await expect.poll(async () => (await response.textContent())!.length).toBeGreaterThan(before);
  expect(await existing!.evaluate(node => node.isConnected)).toBe(true);
  const stop = page.getByRole('button', { name: '停止', exact: true });
  if (await stop.isVisible()) await stop.click();
  await expect(waiting).toHaveCount(0);
});

// The same title write, landing BEFORE the first token rather than during the
// stream, which is a different failure and the one a new Session always meets:
// naming a Session from its first message fires a burst of catalog refreshes
// into the only window where `runningTurnIds` is the sole witness that a turn
// is running. Reads served from the desktop cache carry no `runningTurnIds` at
// all, and one of those landing mid-burst used to retract the whole wait —
// status line, Stop and the composer lock — until the next authoritative read
// plus the rising-edge delay brought it back, some 340ms later.
test('a title landing before the first token does not retract the wait', async ({
  sessionLocalWindow: { page, app },
}) => {
  const nativeWindow = await app.browserWindow(page);
  await nativeWindow.evaluate((window) => window.show());
  await page.bringToFront();
  // A turn that runs and yields nothing, so the wait stays on screen for as
  // long as the assertions need it.
  await page.locator(COMPOSER_INPUT).fill('__e2e_wait_for_steering__');
  await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  const waiting = page.locator('[data-maka-contract="turn-running-status"]');
  await expect(waiting).toBeVisible({ timeout: 20_000 });
  // Per frame, because the retraction is shorter than any polled assertion:
  // both that the line is there at all, and that it is the SAME element.
  await page.evaluate(() => {
    const state = window as unknown as Record<string, unknown>;
    state.__first = document.querySelector('[data-maka-contract="turn-running-status"]');
    state.__frames = [];
    state.__recording = true;
    const record = () => {
      const node = document.querySelector('[data-maka-contract="turn-running-status"]');
      (state.__frames as unknown[]).push({
        waiting: Boolean(node),
        same: node === state.__first,
        stop: Boolean(document.querySelector('button[aria-label="停止"]')),
      });
      if (state.__recording) requestAnimationFrame(record);
    };
    requestAnimationFrame(record);
  });
  const session = await page.evaluate(async () => (await window.maka.sessions.list())[0]!);
  await page.evaluate(
    (id) => window.maka.sessions.rename(id, 'Named from its first message'),
    session.id,
  );
  await expect(page.locator('[data-maka-contract="titlebar-identity"]')).toContainText(
    'Named from its first message',
  );
  // Long enough to cover the retraction plus the delay that used to follow it.
  await expect
    .poll(async () => (await page.evaluate(() => (window as never as { __frames: unknown[] }).__frames.length)) , {
      timeout: 5_000,
    })
    .toBeGreaterThan(60);
  const frames = await page.evaluate(() => {
    const state = window as unknown as Record<string, unknown>;
    state.__recording = false;
    return state.__frames as { waiting: boolean; same: boolean; stop: boolean }[];
  });
  expect(frames.filter((frame) => !frame.waiting || !frame.same)).toEqual([]);
  expect(frames.filter((frame) => !frame.stop)).toEqual([]);
  const stop = page.getByRole('button', { name: '停止', exact: true });
  if (await stop.isVisible()) await stop.click();
});
