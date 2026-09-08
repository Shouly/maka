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

test('history pages stay bounded and can return to the latest persisted turn', async ({
  partialHistoryWindow: page,
}) => {
  const turns = page.locator('[data-maka-transcript-turn]');
  await expect(turns.last()).toHaveAttribute('data-turn-id', 'turn-partial-history-18');
  expect(await turns.count()).toBeLessThanOrEqual(10);
  const earlier = page.locator('[data-maka-transcript-gap="older"] button');
  await expect(earlier).toBeVisible();
  // One page can still include the tail. Cross the bounded range before
  // asserting a jump that reloads newer history rather than merely scrolling.
  for (let pageIndex = 0; pageIndex < 18; pageIndex += 1) {
    if (await page.locator('[data-maka-transcript-gap="newer"]').count()) break;
    const initial = await turns.first().getAttribute('data-turn-id');
    await earlier.click();
    await expect(turns.first()).not.toHaveAttribute('data-turn-id', initial!);
    expect(await turns.count()).toBeLessThanOrEqual(10);
  }
  await expect(page.locator('[data-maka-transcript-gap="newer"]')).toBeVisible();
  const latest = page.getByRole('button', { name: /滚动.*底部|最新|Scroll.*bottom/ });
  await latest.click();
  await expect(turns.last()).toHaveAttribute('data-turn-id', 'turn-partial-history-18');
  await expect(page.locator('[data-maka-transcript-gap="newer"]')).toHaveCount(0);
});
