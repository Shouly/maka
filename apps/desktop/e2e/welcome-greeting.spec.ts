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

import { expect, test } from './fixtures';

test('welcome updates on return with stable localized text and the brand mark', async ({ window: page }) => {
  const greeting = page.locator('[data-maka-contract="welcome-surface"] h1');
  const showAt = async (hour: number, minutes = 0, awayMinutes = 0) => {
    await page.evaluate(({ hour, minutes, awayMinutes }) => {
      const now = new Date(2026, 8, 9, hour, minutes).getTime();
      Date.now = () => now;
      localStorage.setItem('maka-welcome-visit-v1', JSON.stringify({ lastVisitAt: now - awayMinutes * 60_000, returningUntil: 0 }));
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    }, { hour, minutes, awayMinutes });
  };
  await showAt(8);
  await expect(greeting).toHaveText('今天先做点什么？');
  await showAt(8, 10);
  await expect(greeting).toHaveText('今天先做点什么？');
  await showAt(14);
  await expect(greeting).toHaveText('一起完成点事情吧');
  const icon = greeting.locator('[data-maka-contract="welcome-brand"]');
  await expect(icon).toBeVisible();
  expect(await icon.locator('span').evaluate((element) => getComputedStyle(element).maskImage)).not.toBe('none');
  await expect(icon.locator('span')).toHaveCSS('background-color', 'rgb(198, 97, 63)');
  await page.screenshot({ path: '/tmp/maka-welcome-relx.png', animations: 'disabled' });
  await showAt(14, 40, 31);
  await expect(greeting).toHaveText('我们上次聊到哪了？');
});
