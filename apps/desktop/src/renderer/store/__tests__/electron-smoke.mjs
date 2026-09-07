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

import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStorageRoot, tryAcquireInteractiveRootOwner } from '@maka/storage/root-authority';
import { openInteractiveRuntimePolicyStoresForWrite } from '@maka/storage/runtime-policy-stores';
import { buildFixtureEnv } from '../../../../../../scripts/fixture-env.mjs';
import { closeElectronApplication } from '../../../../../../scripts/electron-lifecycle.mjs';

async function seedE2eConnection(userDataDir) {
  const workspaceRoot = path.join(userDataDir, 'workspaces', 'default');
  const capability = await resolveStorageRoot({ path: workspaceRoot, kind: 'interactive' });
  const owner = await tryAcquireInteractiveRootOwner(capability);
  if (!owner) throw new Error('E2E fixture could not acquire its isolated Runtime Host root');
  try {
    const stores = await openInteractiveRuntimePolicyStoresForWrite(owner.lease);
    const catalog = await stores.connectionCatalog.getSnapshot();
    const created = await stores.connectionCatalog.create({
      expectedCatalogRevision: catalog.revision,
      connection: {
        slug: 'e2e',
        name: 'E2E',
        providerType: 'anthropic',
        enabled: true,
        enabledModelIds: ['claude-sonnet-4-5-20250929'],
      },
    });
    if (created.kind !== 'committed') {
      throw new Error(`E2E connection seed was not committed: ${created.kind}`);
    }
    const connection = created.snapshot.connections.find(({ slug }) => slug === 'e2e');
    if (!connection) throw new Error('E2E connection seed is missing from the committed catalog');
    const credential = await stores.credentialVault.set({
      locator: {
        scope: 'connection',
        connectionId: connection.connectionId,
        kind: 'api_key',
      },
      expected: null,
      secret: 'e2e-placeholder',
    });
    if (credential.kind !== 'committed') {
      throw new Error(`E2E credential seed was not committed: ${credential.kind}`);
    }
    const modelFetch = await stores.operations.beginModelFetch(connection.connectionId);
    if (modelFetch.kind !== 'ready') {
      throw new Error(`E2E model inventory seed could not start: ${modelFetch.kind}`);
    }
    const modelInventory = await stores.operations.completeModelFetch(modelFetch.ticket, {
      models: [{ id: 'claude-sonnet-4-5-20250929' }],
      source: 'fallback',
      fetchedAt: 0,
    });
    if (modelInventory.kind !== 'committed') {
      throw new Error(`E2E model inventory seed was not committed: ${modelInventory.kind}`);
    }
    const defaultTarget = await stores.connectionCatalog.setDefaultTarget({
      expectedCatalogRevision: modelInventory.snapshot.revision,
      target: {
        connectionId: connection.connectionId,
        modelId: 'claude-sonnet-4-5-20250929',
      },
    });
    if (defaultTarget.kind !== 'committed') {
      throw new Error(`E2E default target seed was not committed: ${defaultTarget.kind}`);
    }
  } finally {
    await owner.close();
  }
}

const desktop = fileURLToPath(new URL('../../../../', import.meta.url));
const shots = fileURLToPath(new URL('../../../../../../.maka-shots/enterprise/', import.meta.url));
const userDataDir = await mkdtemp(path.join(tmpdir(), 'maka-phase1-smoke-'));
await mkdir(path.join(userDataDir, 'home'));
await mkdir(shots, { recursive: true });
let app;
let page;
const errors = [];
const checks = [];
try {
  await seedE2eConnection(userDataDir);
  app = await electron.launch({
    args: ['.'],
    cwd: desktop,
    env: buildFixtureEnv(userDataDir, path.join(userDataDir, 'home'), { showWindow: true }),
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('[data-maka-runtime-debug]').waitFor();
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await page.getByText('Event stream connected', { exact: true }).waitFor();
  const prompt = 'Phase 1 smoke test';
  await page.getByLabel('Message', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(
    () => {
      const turns = JSON.parse(
        document.querySelector('[data-maka-turn-projection]')?.textContent ?? '[]',
      );
      return turns.some(
        (turn) =>
          turn.assistant?.text?.includes('renderer loop are connected.') &&
          turn.status === 'completed',
      );
    },
    undefined,
    { timeout: 20000 },
  );
  checks.push('new session, send, streamed assistant, terminal projection');
  const before = await page.locator('[data-maka-turn-projection]').textContent();
  assert.ok(before.includes(prompt));
  const firstKey = await page
    .locator('aside button[aria-pressed="true"]')
    .getAttribute('data-session-key');
  await page.screenshot({ path: path.join(shots, 'phase1-light.png') });

  // A second session must not inherit the first session's transcript or draft.
  await page.getByRole('button', { name: 'New session', exact: true }).click();
  await page.waitForFunction(
    (key) =>
      document.querySelector('[data-maka-runtime-debug]')?.getAttribute('data-active-session') !==
      key,
    firstKey,
  );
  await page.getByText('Event stream connected', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Message', { exact: true }).inputValue(), '');
  assert.equal(await page.locator('[data-maka-turn-projection]').textContent(), '[]');
  await page.locator(`aside button[data-session-key=${JSON.stringify(firstKey)}]`).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-maka-turn-projection]')
      ?.textContent?.includes('Phase 1 smoke test'),
  );
  checks.push('switch sessions without leaked messages');

  await page.getByLabel('Message', { exact: true }).fill('__e2e_ask_user_question__');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByLabel('Response JSON', { exact: true }).waitFor();
  const request = JSON.parse(
    await page
      .locator('details')
      .filter({ has: page.getByText('Pending interactions', { exact: true }) })
      .locator('pre')
      .textContent(),
  )[0];
  await page.getByLabel('Response JSON', { exact: true }).fill(
    JSON.stringify({
      requestId: request.requestId,
      answers: ['invite only', 'next week', 'yes'],
    }),
  );
  await page.getByRole('button', { name: 'Submit response', exact: true }).click();
  await page.getByLabel('Response JSON', { exact: true }).waitFor({ state: 'detached' });
  await page.waitForFunction(() => {
    const turns = JSON.parse(
      document.querySelector('[data-maka-turn-projection]')?.textContent ?? '[]',
    );
    return turns.some(
      (turn) => turn.user?.text === '__e2e_ask_user_question__' && turn.status === 'completed',
    );
  });
  checks.push('tool request, live interaction, response acknowledgement and completed turn');

  await page.getByLabel('Message', { exact: true }).fill('__e2e_hold_open__');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-maka-turn-projection]')
      ?.textContent?.includes('waiting for the test to stop'),
  );
  await page.getByLabel('Message', { exact: true }).fill('Phase 1 steering');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-maka-turn-projection]')
      ?.textContent?.includes('Acknowledged steering: Phase 1 steering'),
  );
  checks.push('steering admission and event projection while running');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.waitForFunction(() => {
    const turns = JSON.parse(
      document.querySelector('[data-maka-turn-projection]')?.textContent ?? '[]',
    );
    return turns.some(
      (turn) =>
        turn.user?.text === '__e2e_hold_open__' &&
        (turn.status === 'interrupted' || turn.status === 'aborted'),
    );
  });
  checks.push('stop an open streaming turn');

  await page.reload();
  await page.locator('aside button[aria-pressed]').first().waitFor();
  await page.locator(`aside button[data-session-key=${JSON.stringify(firstKey)}]`).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-maka-turn-projection]')
      ?.textContent?.includes('Phase 1 smoke test'),
  );
  checks.push('reload persisted transcript through Runtime Host');
  // Change appearance through the real settings IPC. Renderer must consume the change subscription.
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.screenshot({ path: path.join(shots, 'phase1-dark.png') });
  checks.push('settings round-trip and dark theme');
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Design system', exact: true }).click();
  await page.screenshot({ path: path.join(shots, 'design-review-light.png') });
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.screenshot({ path: path.join(shots, 'design-review-dark.png') });
  if (process.platform === 'darwin') {
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.__modalVisibility = [];
      for (const win of BrowserWindow.getAllWindows()) {
        const original = win.setWindowButtonVisibility.bind(win);
        win.setWindowButtonVisibility = (visible) => {
          globalThis.__modalVisibility.push(visible);
          return original(visible);
        };
      }
    });
  }
  await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
  await page.locator('[data-app-dialog-overlay][data-state="open"]').waitFor();
  if (process.platform === 'darwin') {
    await page.waitForTimeout(50);
    assert.equal((await app.evaluate(() => globalThis.__modalVisibility)).at(-1), false);
  }
  await page.screenshot({ path: path.join(shots, 'design-review-dialog.png') });
  await page.keyboard.press('Escape');
  await page.locator('[data-app-dialog-overlay][data-state="open"]').waitFor({ state: 'detached' });
  if (process.platform === 'darwin') {
    await page.waitForTimeout(50);
    assert.equal((await app.evaluate(() => globalThis.__modalVisibility)).at(-1), true);
  }
  checks.push('Radix modal dims native chrome and restores it on close');
  const visibilityBeforePopover =
    process.platform === 'darwin'
      ? await app.evaluate(() => globalThis.__modalVisibility.length)
      : 0;
  await page.getByRole('button', { name: 'Popover', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.locator('[data-app-dialog-overlay][data-state="open"]').count(), 0);
  if (process.platform === 'darwin')
    assert.equal(
      await app.evaluate(() => globalThis.__modalVisibility.length),
      visibilityBeforePopover,
    );
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === 'Popover');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.focus(); });
  await page.waitForFunction(() => document.hasFocus());
  await page.keyboard.press('Tab');
  const link = page.getByRole('link', { name: 'external link', exact: true });
  await link.focus();
  assert.equal(await link.evaluate((element) => element.matches(':focus-visible')), true);
  assert.notEqual(await link.evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
  checks.push(
    'nonmodal Popover leaves native chrome unchanged; Markdown links retain keyboard focus',
  );

  assert.deepEqual(errors, []);
  await writeFile(
    path.join(shots, 'phase1-smoke-result.json'),
    JSON.stringify(
      {
        checks,
        rendererErrors: errors,
        modelBackend: 'FakeBackend through real Electron preload, Runtime Host and SQLite',
        screenshots: ['phase1-light.png', 'phase1-dark.png'],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, rendererErrors: errors }));
} catch (error) {
  if (page && !page.isClosed()) {
    console.error((await page.locator('body').innerText()).slice(-7000));
    await page.screenshot({ path: path.join(shots, 'phase1-failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (app) await closeElectronApplication(app, 4000);
  await rm(userDataDir, { recursive: true, force: true });
}
