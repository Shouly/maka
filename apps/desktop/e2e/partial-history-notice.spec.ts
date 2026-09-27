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

/** Turns the partial-history fixture seeds. */
const PARTIAL_HISTORY_TURN_COUNT = 18;

// The Renderer owns the transcript window (upstream #5170): the first open
// reads a bounded tail, older pages come in as the reader asks for them or
// nears the top (within two screens it prefetches), and the window
// is trimmed by how far the reader is from a Turn — beyond six screens, to four
// — not to a count. This fixture's Turns render a line each (their padding is
// collapsed whitespace), so its whole history legitimately fits; the bound on
// a long history is transcript-scroll-cost's paging test.
test('the first open is a bounded tail, older pages reach the whole history, and the latest comes back', async ({
  partialHistoryWindow: page,
}) => {
  const turns = page.locator('[data-maka-transcript-turn]');
  await expect(turns.last()).toHaveAttribute(
    'data-turn-id',
    `turn-partial-history-${PARTIAL_HISTORY_TURN_COUNT}`,
  );
  expect(await turns.count()).toBeLessThan(PARTIAL_HISTORY_TURN_COUNT);
  const earlier = page.locator('[data-maka-transcript-gap="older"] button');
  await expect(earlier).toBeVisible();
  // Only a press marks the gap busy (`historyPending`); a prefetch never
  // does. Seeing it busy is what says the press itself reached the loader.
  await page.evaluate(() => {
    const state = window as unknown as { __gapPressed?: boolean };
    state.__gapPressed = false;
    new MutationObserver((records) => {
      const busy = records.some(
        (record) =>
          record.type === 'attributes' &&
          record.oldValue === null &&
          (record.target as Element).closest('[data-maka-transcript-gap="older"]') !== null,
      );
      if (busy || document.querySelector('[data-maka-transcript-gap="older"] button[disabled]'))
        state.__gapPressed = true;
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled'],
      attributeOldValue: true,
    });
  });
  // The first press asks for its page and must land it.
  const opened = await turns.first().getAttribute('data-turn-id');
  await earlier.click();
  await expect(turns.first()).not.toHaveAttribute('data-turn-id', opened!);
  expect(
    await page.evaluate(() => (window as unknown as { __gapPressed?: boolean }).__gapPressed),
  ).toBe(true);
  // The page lands above the reader, who keeps their place; the window fetches
  // more only as they near the top (within two screens), so the rest of the
  // history comes in as they read up to the first Turn, and the gap goes.
  const scroller = page.locator('[data-maka-transcript-boundary]');
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(async () => {
    await page.mouse.wheel(0, -1_200);
    await expect(page.locator('[data-turn-id="turn-partial-history-1"]')).toBeInViewport({
      timeout: 500,
    });
  }).toPass({ timeout: 20_000 });
  await expect(turns.first()).toHaveAttribute('data-turn-id', 'turn-partial-history-1');
  await expect(earlier).toHaveCount(0);
  const latest = page.getByRole('button', { name: '回到最新', exact: true });
  await latest.click();
  await expect(
    page.locator(`[data-turn-id="turn-partial-history-${PARTIAL_HISTORY_TURN_COUNT}"]`),
  ).toBeInViewport();
});
