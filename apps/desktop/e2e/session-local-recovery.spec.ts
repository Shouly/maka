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

import { resolve } from 'node:path';
import {
  COMPOSER_INPUT,
  awaitSendReady,
  ensureSidebarExpanded,
  expect,
  test,
  sendPrompt,
} from './fixtures';

// The preload durably admits through the desktop outbox. Its pending status
// and offline cache UI are not ported; phase-6.md records those gaps.
test('a submitted turn and an unsent draft survive an application restart', async ({
  sessionLocalWindow,
}) => {
  let { page } = sessionLocalWindow;
  await sendPrompt(page, 'durable history before restart');
  await page.locator(COMPOSER_INPUT).fill('unsent across application restart');
  page = await sessionLocalWindow.restart();
  await expect(page.getByRole('log')).toContainText(
    'Fake backend received: durable history before restart',
  );
  await expect(page.locator(COMPOSER_INPUT)).toHaveText('unsent across application restart');
  await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(
    page.getByText('Fake backend received: unsent across application restart'),
  ).toHaveCount(1);
});

test('an admission failure keeps the draft and retry sends it once', async ({
  sessionLocalWindow: { page, app },
}) => {
  await sendPrompt(page, 'admission retry source');
  // Fail one IPC invocation while keeping the original handler for retry.
  await app.evaluate(({ ipcMain }) => {
    const handlers = (
      ipcMain as typeof ipcMain & { _invokeHandlers: Map<string, (...args: any[]) => any> }
    )._invokeHandlers;
    const original = handlers.get('session-local:submit');
    if (!original) throw new Error('Missing submit handler');
    ipcMain.removeHandler('session-local:submit');
    ipcMain.handle('session-local:submit', (...args) => {
      ipcMain.removeHandler('session-local:submit');
      ipcMain.handle('session-local:submit', original);
      throw new Error('E2E admission unavailable');
    });
  });
  await page.locator(COMPOSER_INPUT).fill('retry keeps this draft');
  await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(
    page.getByRole('alert').filter({ hasText: 'E2E admission unavailable' }).first(),
  ).toBeVisible();
  await expect(page.locator(COMPOSER_INPUT)).toHaveText('retry keeps this draft');
  await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(page.getByText('Fake backend received: retry keeps this draft')).toHaveCount(1);
});

test('a durably admitted message survives reload and executes once after restarting delivery', async ({
  sessionLocalWindow,
}) => {
  let { page } = sessionLocalWindow;
  await sendPrompt(page, 'outbox recovery source');
  const sessionId = await page.evaluate(async () => (await window.maka.sessions.list())[0]!.id);
  await sessionLocalWindow.app.evaluate((_electron, modulePath) => {
    const require = process.getBuiltinModule('module').createRequire(`${process.cwd()}/`);
    const { DesktopSessionLocalService } = require(modulePath);
    DesktopSessionLocalService.prototype.wake = () => {};
  }, resolve('dist/main/session-local-service.js'));
  const pending = 'durable outbox pending message';
  await page.locator(COMPOSER_INPUT).fill(pending);
  await awaitSendReady(page);
  await page.locator(COMPOSER_INPUT).press('Enter');
  await expect(page.locator(COMPOSER_INPUT)).toHaveText('');
  const messages = await page.evaluate(
    (id) => window.maka.sessionLocal.listMessages(id),
    sessionId,
  );
  const saved = messages.find((item) => item.text === pending)!;
  expect(saved.state).toBe('saved');
  await page.reload();
  await expect(page.locator(COMPOSER_INPUT)).toBeVisible();
  expect(
    (await page.evaluate((id) => window.maka.sessionLocal.listMessages(id), sessionId)).find(
      (item) => item.text === pending,
    )?.messageId,
  ).toBe(saved.messageId);
  page = await sessionLocalWindow.restart();
  await expect(page.getByText(`Fake backend received: ${pending}`)).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect
    .poll(() =>
      page.evaluate(
        async (id) => (await window.maka.sessionLocal.listMessages(id)).length,
        sessionId,
      ),
    )
    .toBe(0);
});
