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

// Upstream's first case (the WorkHub attachment rejection) needs the WorkHub
// surface, which this renderer does not ship; the IPC round trip below is
// renderer-independent and is what #4878 guarantees.

import { FAKE_HOLD_OPEN_PROMPT } from '@maka/runtime/test-only/fake-backend';
import { awaitSendReady, COMPOSER_INPUT, expect, test } from './fixtures';

test('setting and Plan failures retain their codes through Electron', async ({ window: page }) => {
  const composer = page.locator(COMPOSER_INPUT);
  await composer.fill(FAKE_HOLD_OPEN_PROMPT);
  await awaitSendReady(page);
  await composer.press('Enter');
  await expect.poll(async () => {
    const sessions = await page.evaluate(() => window.maka.sessions.list());
    return sessions.some(({ status }) => status === 'running');
  }).toBe(true);
  const sessionId = await page.evaluate(async () => {
    const sessions = await window.maka.sessions.list();
    return sessions.find(({ status }) => status === 'running')!.id;
  });

  const result = await page.evaluate(async (id) => ({
    setting: await window.maka.sessions.setPermissionMode(id, 'explore'),
    plan: await window.maka.sessions.abandonPlanProposal(id, 'missing-proposal'),
  }), sessionId);
  expect(result.setting).toEqual({ ok: false, code: 'session_busy' });
  expect(result.plan).toMatchObject({
    ok: false,
    error: { code: 'session_busy' },
  });
  await page.evaluate((id) => window.maka.sessions.stop(id), sessionId);
});
