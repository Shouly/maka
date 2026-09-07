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
const userDataDir = await mkdtemp(path.join(tmpdir(), 'maka-phase2-smoke-'));
await mkdir(path.join(userDataDir, 'home'));
await mkdir(shots, { recursive: true });
let app;
let page;
const errors = [];
const checks = [];

const SHOT = (name) => path.join(shots, name);
/** The rail animates its width over 200ms; a screenshot mid-transition is a lie. */
async function settleSidebar(page) {
  await page.waitForFunction(() => {
    const rail = document.querySelector('#app-sidebar');
    if (!rail) return false;
    const width = rail.getBoundingClientRect().width;
    return width >= Number.parseInt(getComputedStyle(rail).getPropertyValue('--sidebar-expanded-width'), 10) - 1;
  });
}
/** The theme control lives in Settings (Phase 5); the palette is how the shell changes it. */
async function runPaletteCommand(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('[data-maka-contract="command-palette"]').waitFor();
  await page.getByRole('option', { name: label, exact: true }).first().click();
  await page.locator('[data-maka-contract="command-palette"]').waitFor({ state: 'detached' });
}

async function startTask(page, prompt) {
  await page.locator('[data-maka-contract="welcome-surface"]').waitFor();
  await page.getByLabel('Task', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

try {
  await seedE2eConnection(userDataDir);
  app = await electron.launch({
    args: ['.'],
    cwd: desktop,
    env: buildFixtureEnv(userDataDir, path.join(userDataDir, 'home'), { showWindow: true }),
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));

  // 1. The shell paints: the app frame, the rail, and the welcome surface.
  //
  // A fresh profile starts with the rail COLLAPSED (`maka-chat-list-collapsed-v1`
  // defaults to true, as it did before the rewrite), so the first thing the
  // test does is what a first-run user does: open it.
  await page.locator('.appFrame').waitFor();
  await page.locator('[data-maka-contract="welcome-surface"]').waitFor();
  await page.waitForFunction(
    () => document.querySelector('.appFrame')?.getAttribute('data-sidebar-state') === 'collapsed',
  );
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).first().click();
  await page.locator('#app-sidebar').waitFor();
  await page.locator('[data-maka-contract="shell-topbar-rail"]').waitFor();
  await settleSidebar(page);
  assert.equal(await page.locator('[data-maka-runtime-debug]').count(), 0);
  checks.push('shell mounts with the sidebar and the welcome surface, not the debug page');
  await page.screenshot({ path: SHOT('phase2-welcome-light.png') });

  // 2. A task created from the welcome composer streams a reply.
  const firstPrompt = 'Phase 2 smoke test';
  await startTask(page, firstPrompt);
  await page.locator('[data-maka-contract="titlebar-identity"]').waitFor();
  await page.locator('[data-maka-contract="transcript"]').waitFor();
  await page
    .locator('[data-maka-contract="transcript"]')
    .getByText('renderer loop are connected.', { exact: false })
    .waitFor();
  checks.push('new task from the welcome composer creates a session and streams a reply');

  // 3. The sidebar lists it.
  const rows = page.locator('[data-maka-contract="session-row"]');
  await rows.first().waitFor();
  const firstKey = await rows.first().getAttribute('data-session-key');
  assert.ok(firstKey);
  checks.push('the sidebar lists the session it just created');

  // 4. Rename through the row menu, and read it back after a reload — a rename
  // that only changed the DOM would not survive one.
  const rowFor = (key) =>
    page.locator(`[data-maka-contract="session-row"][data-session-key=${JSON.stringify(key)}]`);
  const RENAMED = 'Renamed by the smoke test';
  await rowFor(firstKey).hover();
  await rowFor(firstKey).getByRole('button', { name: /Actions for/u }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const renameInput = page.getByLabel('Task name', { exact: true });
  await renameInput.fill(RENAMED);
  await renameInput.press('Enter');
  await page.waitForFunction(
    ([key, name]) =>
      document
        .querySelector(`[data-maka-contract="session-row"][data-session-key=${JSON.stringify(key)}]`)
        ?.textContent?.includes(name) === true,
    [firstKey, RENAMED],
  );
  await page.reload();
  await rows.first().waitFor();
  await page.waitForFunction(
    ([key, name]) =>
      document
        .querySelector(`[data-maka-contract="session-row"][data-session-key=${JSON.stringify(key)}]`)
        ?.textContent?.includes(name) === true,
    [firstKey, RENAMED],
  );
  checks.push('rename from the row menu persists through the Host');

  // A second task, so filtering has something to exclude.
  await page.getByRole('button', { name: 'New task', exact: true }).first().click();
  await startTask(page, 'Second smoke task');
  await page.locator('[data-maka-contract="transcript"]').waitFor();
  await page
    .locator('[data-maka-contract="transcript"]')
    .getByText('renderer loop are connected.', { exact: false })
    .waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-maka-contract="session-row"]').length >= 2,
  );
  await page.screenshot({ path: SHOT('phase2-session-list.png') });

  const before = await rows.count();
  assert.ok(before >= 2);
  await page.getByLabel('Filter tasks', { exact: true }).fill('Renamed by');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-maka-contract="session-row"]').length === 1,
  );
  await page.getByLabel('Clear filter', { exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-maka-contract="session-row"]').length === count,
    before,
  );
  checks.push('the sidebar filter narrows the list to one row and clears back');

  // 5. ⌘K opens the palette and its rows are reachable.
  await page.keyboard.press('ControlOrMeta+k');
  const palette = page.locator('[data-maka-contract="command-palette"]');
  await palette.waitFor();
  assert.ok((await palette.getByRole('option').count()) > 0);
  await page.screenshot({ path: SHOT('phase2-palette.png') });
  await page.keyboard.press('Escape');
  await palette.waitFor({ state: 'detached' });
  checks.push('⌘K opens the command palette and Escape closes it');

  // 6. The search modal, and the attribute the main process probes for.
  await page.getByRole('button', { name: 'Search tasks', exact: true }).first().click();
  const search = page.locator('[data-maka-contract="search-modal"]');
  await search.waitFor();
  await page.getByLabel('Search', { exact: true }).fill('smoke');
  await page.getByRole('option').first().waitFor();
  await page.screenshot({ path: SHOT('phase2-search.png') });
  assert.equal(
    await page.evaluate(
      () => document.querySelectorAll('[data-maka-contract="search-modal"]').length,
    ),
    1,
  );
  await page.keyboard.press('Escape');
  await search.waitFor({ state: 'detached' });
  checks.push('the search modal opens, finds a thread, and carries its contract attribute');

  // 7. Theme through the palette, which round-trips settings IPC.
  await runPaletteCommand(page, 'Theme · Dark');
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.locator('[data-maka-contract="session-row"]').first().waitFor();
  await settleSidebar(page);
  await page.screenshot({ path: SHOT('phase2-welcome-dark.png') });
  checks.push('the palette switches the theme through the real settings IPC');
  await runPaletteCommand(page, 'Theme · Light');
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));

  // 8. Collapse, which must publish the shell state the main process reads.
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).first().click();
  await page.waitForFunction(
    () => document.querySelector('.appFrame')?.getAttribute('data-sidebar-state') === 'collapsed',
  );
  await page.screenshot({ path: SHOT('phase2-sidebar-collapsed.png') });
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).first().click();
  await page.waitForFunction(
    () => document.querySelector('.appFrame')?.getAttribute('data-sidebar-state') === null,
  );
  checks.push('sidebar collapse publishes data-sidebar-state and restores');

  assert.deepEqual(errors, []);
  await writeFile(
    path.join(shots, 'phase2-smoke-result.json'),
    JSON.stringify(
      {
        checks,
        rendererErrors: errors,
        modelBackend: 'FakeBackend through real Electron preload, Runtime Host and SQLite',
        screenshots: [
          'phase2-welcome-light.png',
          'phase2-welcome-dark.png',
          'phase2-session-list.png',
          'phase2-palette.png',
          'phase2-search.png',
          'phase2-sidebar-collapsed.png',
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, rendererErrors: errors }));
} catch (error) {
  if (page && !page.isClosed()) {
    console.error((await page.locator('body').innerText()).slice(-7000));
    await page.screenshot({ path: SHOT('phase2-failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (app) await closeElectronApplication(app, 4000);
  await rm(userDataDir, { recursive: true, force: true });
}
