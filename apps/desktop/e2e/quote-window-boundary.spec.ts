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

import { awaitSendReady, expect, test, COMPOSER_INPUT } from './fixtures';

// This stays in Electron: the physical pointer leaves the renderer viewport,
// and Chromium pointer capture must route its release back to the owning Turn.
test('a transcript drag releases outside the window through its owning Turn', async ({
  window: page,
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  const composer = page.locator(COMPOSER_INPUT);
  await composer.fill('pointer capture source');
  await awaitSendReady(page);
  await composer.press('Enter');

  // Select from a settled answer. Selecting from a streaming one is broken for
  // outside this test's settled-text contract; this test exists to pin the
  // pointer-capture contract, not Selection survival across a stream close.
  //
  // Settled is three things, each landing on its own schedule after the
  // footer: the lazy Markdown body has replaced its plain-text fallback (a
  // drag begun in the fallback selects nodes about to be discarded), the
  // stored turn has rendered (its timestamp row moves the answer down), and
  // the transcript has written itself back to the tail.
  const reply = page
    .locator('[data-maka-contract="markdown"]')
    .getByText(/Fake backend received: pointer capture source/);
  await expect(reply).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: '重新生成' })).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(page.locator('[data-role="user"] time')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.querySelector('[data-maka-transcript-boundary]')!;
        return root.scrollHeight - root.scrollTop - root.clientHeight;
      }),
    )
    .toBeLessThanOrEqual(4);
  await expect(page.locator('.stream-pop')).toHaveCount(0);
  const turn = reply.locator('xpath=ancestor::*[@data-turn-id][1]');
  const quoteLayer = page.locator('[data-maka-contract="selection-quote"]');
  await turn.evaluate((element) => {
    (window as any).__quoteEvents = [];
    for (const type of [
      'pointerdown',
      'pointerup',
      'pointercancel',
      'lostpointercapture',
      'selectionchange',
    ])
      document.addEventListener(type, () => (window as any).__quoteEvents.push(type), true);
    const owner = element as HTMLElement;
    owner.addEventListener('gotpointercapture', (event) => {
      owner.dataset.e2eCapturedPointer = String((event as PointerEvent).pointerId);
    });
    owner.addEventListener('pointerup', () => {
      owner.dataset.e2eCapturedPointerUp = 'true';
    });
    document.addEventListener('selectionchange', () => {
      owner.dataset.e2eSelectionChanged = 'true';
    });
  });

  // Measure the FIRST text line, not the whole answer: the fake reply is two
  // paragraphs, and the vertical midpoint of the whole block lands in the gap
  // between them, where a mousedown anchors no text and the drag selects
  // nothing.
  const bounds = await reply.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.querySelector('p') ?? element);
    const rect = range.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  if (bounds.width < 8 || bounds.height < 1) {
    throw new Error('quote selection source has no visible text bounds');
  }
  const y = bounds.y + bounds.height / 2;
  const startX = bounds.x + 2;
  const selectedX = bounds.x + bounds.width - 2;

  await turn.evaluate((element) => {
    const owner = element as HTMLElement;
    delete owner.dataset.e2eSelectionChanged;
  });

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(selectedX, y, { steps: 5 });
  await expect(turn).toHaveAttribute('data-e2e-captured-pointer', /\d+/);
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.isCollapsed === false))
    .toBe(true);
  await expect(turn).toHaveAttribute('data-e2e-selection-changed', 'true');
  await page.mouse.move(1220, y, { steps: 5 });
  await page.mouse.up();

  await expect(turn).toHaveAttribute('data-e2e-captured-pointer-up', 'true');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const selection = window.getSelection();
        const node = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
        const element = node instanceof Element ? node : node?.parentElement;
        return {
          text: selection?.toString(),
          turn: element?.closest('[data-turn-id]')?.getAttribute('data-turn-id'),
        };
      }),
    )
    .toMatchObject({
      text: expect.stringContaining('Fake backend'),
      turn: await turn.getAttribute('data-turn-id'),
    });
  const selectionDiagnostic = await page.evaluate(() => {
    const range = window.getSelection()?.getRangeAt(0);
    const box = range?.getBoundingClientRect();
    const band = document.querySelector('[data-maka-transcript-boundary]')?.getBoundingClientRect();
    return {
      box: box?.toJSON(),
      band: band?.toJSON(),
      selected: window.getSelection()?.toString(),
      events: (window as any).__quoteEvents,
    };
  });
  await testInfo.attach('selection-boundary', {
    body: JSON.stringify(selectionDiagnostic),
    contentType: 'application/json',
  });
  await expect(quoteLayer).toBeVisible();
});
