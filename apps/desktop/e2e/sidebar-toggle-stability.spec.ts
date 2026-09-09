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

import { COMPOSER_INPUT, ensureSidebarExpanded, expect, test } from './fixtures';

test('the titlebar toggle stays in place when a hover preview is pinned open', async ({ newTaskTargetWindow: page }, testInfo) => {
  await ensureSidebarExpanded(page);
  const toggle = page.locator('[data-maka-contract="shell-topbar-rail"] button[aria-controls="app-sidebar"]');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.locator(COMPOSER_INPUT).hover();
  await expect(page.locator('#app-sidebar')).toHaveAttribute('aria-hidden', 'true');
  await page.bringToFront();
  await toggle.hover();
  await expect(page.locator('#app-sidebar')).toHaveCSS('position', 'fixed');
  const recording = page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('[data-maka-contract="shell-topbar-rail"] button[aria-controls="app-sidebar"]')!;
    const icon = button.querySelector<HTMLElement>('[data-anthropicon]')!;
    const rail = button.closest<HTMLElement>('[data-maka-contract="shell-topbar-rail"]')!;
    const first = button.getBoundingClientRect();
    const firstIconX = icon.getBoundingClientRect().x;
    const samples: { x: number; width: number; iconX: number; railWidth: number; sameNode: boolean }[] = [];
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const frame = () => {
        const rect = button.getBoundingClientRect();
        samples.push({ x: rect.x, width: rect.width, iconX: icon.getBoundingClientRect().x, railWidth: rail.getBoundingClientRect().width, sameNode: button.isConnected });
        if (performance.now() - start < 500) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
    return { initial: { x: first.x, width: first.width, iconX: firstIconX }, samples };
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const data = await recording;
  await testInfo.attach('toggle-geometry', { body: JSON.stringify(data), contentType: 'application/json' });
  expect(Math.max(...data.samples.map((sample) => Math.abs(sample.iconX - data.initial.iconX)))).toBeLessThan(1);
  expect(data.samples.every((sample) => sample.sameNode)).toBe(true);
  expect(Math.max(...data.samples.map((sample) => Math.abs(sample.x - data.initial.x)))).toBeLessThan(1);
  expect(Math.min(...data.samples.map((sample) => sample.width))).toBeGreaterThan(27);
});
