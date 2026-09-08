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

import { awaitSendReady, COMPOSER_INPUT, expect, test } from './fixtures';

test('a session gets the commands that need one, and /compact compacts it', async ({
  invocableSkillsWindow: page,
}) => {
  const composer = page.locator(COMPOSER_INPUT);
  await composer.fill('seed session');
  await awaitSendReady(page);
  await composer.press('Enter');
  await expect(page.getByText('Fake backend received: seed session')).toBeVisible({
    timeout: 20_000,
  });

  const sessionId = await page.evaluate(async () => (await window.maka.sessions.list())[0]?.id);
  expect(sessionId).toBeTruthy();
  await page.evaluate((activeSessionId) => {
    const testWindow = window as typeof window & {
      __makaObservedCompactCompletion?: boolean;
    };
    testWindow.__makaObservedCompactCompletion = false;
    window.maka.sessions.subscribeChanges((event) => {
      if (event.reason === 'status-change' && event.sessionId === activeSessionId) {
        testWindow.__makaObservedCompactCompletion = true;
      }
    });
  }, sessionId!);

  await composer.click();
  await composer.pressSequentially('/');

  const menu = page.getByRole('listbox', { name: '命令和技能' });
  const commands = menu;
  // Four, not the two a shell without a Session offers: this is the binding a
  // story cannot see, because a story is handed the answer.
  await expect(commands.getByRole('option', { name: /compact/ })).toHaveCount(1);
  await expect(commands.getByRole('option', { name: /\/side|\/graph|\/swarm/ })).toHaveCount(0);

  await commands.getByRole('option', { name: /compact/ }).click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __makaObservedCompactCompletion?: boolean })
            .__makaObservedCompactCompletion,
      ),
    )
    .toBe(true);
  await expect.poll(() => composer.textContent()).toBe('');
  await expect(page.getByText('压缩失败')).toHaveCount(0);

  // After the compact completes the composer clears and can remount. `fill()`
  // can land before the contentEditable is focused again, so the draft never
  // populates and Enter submits nothing — the flake in issue #3289. Type
  // through the focused element and require the draft to have settled before
  // dispatching.
  await composer.click();
  await composer.pressSequentially('after compact');
  await expect.poll(() => composer.textContent()).toBe('after compact');
  await awaitSendReady(page);
  await composer.press('Enter');
  await expect(page.getByText('Fake backend received: after compact')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Fake backend received: /compact')).toHaveCount(0);
});
