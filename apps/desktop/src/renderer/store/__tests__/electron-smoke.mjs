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
import { createProjectCatalog } from '@maka/storage/project-catalog';
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
    return (
      width >=
      Number.parseInt(getComputedStyle(rail).getPropertyValue('--sidebar-expanded-width'), 10) - 1
    );
  });
}
/** The theme control lives in Settings (Phase 5); the palette is how the shell changes it. */
async function runPaletteCommand(page, label) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('[data-maka-contract="command-palette"]').waitFor();
  await page.getByRole('option', { name: label, exact: true }).first().click();
  await page.locator('[data-maka-contract="command-palette"]').waitFor({ state: 'detached' });
}

/** Open the rail if it is collapsed, and wait for it to finish widening. */
async function ensureSidebarExpanded(page) {
  const collapsed = await page.evaluate(
    () => document.querySelector('.appFrame')?.getAttribute('data-sidebar-state') === 'collapsed',
  );
  if (collapsed) {
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).first().click();
  }
  await page.locator('#app-sidebar').waitFor();
  await settleSidebar(page);
}

async function startTask(page, prompt) {
  await page.locator('[data-maka-contract="welcome-surface"]').waitFor();
  await page.getByLabel('Task', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

try {
  await seedE2eConnection(userDataDir);
  const workspaceRoot = path.join(userDataDir, 'workspaces', 'default');
  const projectRoot = path.join(userDataDir, 'composer-project');
  await mkdir(path.join(projectRoot, '.maka', 'skills', 'composer-review'), { recursive: true });
  await writeFile(path.join(projectRoot, 'mention-example.txt'), 'Composer reference test.');
  await writeFile(
    path.join(projectRoot, '.maka', 'skills', 'composer-review', 'SKILL.md'),
    '---\nname: Composer Review\ndescription: Check composer references.\n---\nRead the user request and reply briefly.',
  );
  const rootAuthority = await resolveStorageRoot({ path: workspaceRoot, kind: 'interactive' });
  const catalog = createProjectCatalog(workspaceRoot);
  try {
    const project = await catalog.register(projectRoot);
    await writeFile(
      path.join(workspaceRoot, 'project-preferences.json'),
      JSON.stringify({ version: 1, selections: { [rootAuthority.rootId]: project.id } }),
    );
  } finally {
    catalog.close();
  }
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

  // ── Phase 3a: the transcript ──────────────────────────────────────────────

  // These run on the task step 2 just created, before any rail interaction:
  // the transcript and the titlebar are what they exercise, and neither needs
  // the sidebar open.
  //
  // 3a.1 The streamed reply settles as rendered markdown, not as raw text.
  const transcript = page.locator('[data-maka-contract="transcript"]');
  await transcript.waitFor();
  await transcript
    .locator('[data-maka-contract="markdown"]')
    .getByText('renderer loop are connected.', { exact: false })
    .waitFor();
  const turns = page.locator('[data-turn-id]');
  await page.waitForFunction(() => document.querySelectorAll('[data-turn-id]').length === 1);
  checks.push('a streamed reply settles inside rendered markdown');
  await page.screenshot({ path: SHOT('phase3a-session-light.png') });

  // 3a.2 The model switcher lives in the titlebar and lists the seeded model.
  const switcher = page.locator('[data-maka-contract="model-switcher"]');
  await switcher.waitFor();
  await switcher.click();
  await page
    .getByRole('menuitem', { name: /Sonnet/u })
    .first()
    .waitFor();
  await page.screenshot({ path: SHOT('phase3a-model-switcher.png') });
  await page.keyboard.press('Escape');
  await page
    .getByRole('menuitem', { name: /Sonnet/u })
    .first()
    .waitFor({ state: 'detached' });
  checks.push('the titlebar model switcher lists the seeded connection');

  // 3a.3 Regenerate produces a second turn from the same ask.
  const firstTurnId = await turns.first().getAttribute('data-turn-id');
  await turns.first().hover();
  await transcript.getByRole('button', { name: 'Regenerate', exact: true }).first().click();
  await page.waitForFunction((previous) => {
    const ids = [...document.querySelectorAll('[data-turn-id]')].map((node) =>
      node.getAttribute('data-turn-id'),
    );
    return ids.length >= 1 && ids.some((id) => id !== previous);
  }, firstTurnId);
  checks.push('regenerate produces a new turn');

  // 3a.4 A tool request row renders, and the interaction it is waiting on is
  //      visible while the prompt itself waits for Phase 3b.
  // A message sent while a turn is still running is STEERING — the Host folds
  // it into that turn instead of starting one, and no new tool call follows.
  // So this waits for the regenerated turn to settle first.
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-turn-status="running"]').length === 0 &&
      document.querySelectorAll('[data-maka-contract="transcript"] button[aria-label="Send"]')
        .length === 1,
  );
  await page.getByLabel('Message input', { exact: true }).fill('__e2e_ask_user_question__');
  await transcript.getByRole('button', { name: 'Send', exact: true }).click();
  await transcript.locator('[data-maka-tool-row]').first().waitFor();
  await page.locator('[data-maka-contract="interaction-pending"]').waitFor();
  await page.screenshot({ path: SHOT('phase3a-tool-row.png') });
  checks.push('a tool request renders a timeline row and the pending answer is announced');
  const promptPanel = page.locator('[data-maka-contract="interaction-prompt"]');
  // The wizard advances on each pick; the last pick submits (relx AskUserPanel).
  await promptPanel.getByRole('option', { name: /邀请制/ }).click();
  await promptPanel.getByRole('option', { name: /下周/ }).click();
  await promptPanel.getByRole('option', { name: /^是/ }).click();
  await promptPanel.waitFor({ state: 'detached' });
  await page.locator('[data-maka-contract="interaction-pending"]').waitFor({ state: 'detached' });
  checks.push('multi-question prompt submits answers through the real Host');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-turn-status="running"]').length === 0,
  );
  const composer = page.getByRole('textbox', { name: 'Message input', exact: true });
  await composer.fill('@mention');
  await page.getByRole('option', { name: 'mention-example.txt', exact: true }).click();
  assert.equal(await composer.locator('[data-composer-reference="file"]').count(), 1);
  await composer.press('End');
  await composer.pressSequentially(' /Composer');
  await page.getByRole('option', { name: /Composer Review/ }).click();
  assert.equal(await composer.locator('[data-composer-reference="skill"]').count(), 1);
  await page.locator('[data-maka-file-drop-target]').evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(['attachment content'], 'composer-note.txt', { type: 'text/plain' }),
    );
    element.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await page.getByRole('button', { name: 'Remove composer-note.txt', exact: true }).waitFor();
  await composer.press('End');
  await composer.pressSequentially(' Check these references.');
  await transcript.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-turn-status="completed"]')].some((e) =>
        e.textContent?.includes('Check these references'),
      ) && document.querySelector('[data-maka-contract="composer-input"]')?.textContent === '',
  );
  await page
    .getByRole('button', { name: 'Remove composer-note.txt', exact: true })
    .waitFor({ state: 'detached' });
  checks.push(
    'file and skill mention atoms, dropped attachment, transmission and successful draft cleanup',
  );

  await page.getByRole('combobox', { name: /Permission mode/ }).click();
  await page.getByRole('option', { name: 'Full access', exact: true }).click();
  const bypass = page.getByRole('dialog', { name: 'Switch to full access?', exact: true });
  await bypass.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('combobox', { name: /Permission mode/ }).click();
  await page.getByRole('option', { name: 'Full access', exact: true }).click();
  await bypass.getByRole('button', { name: 'Switch to full access', exact: true }).click();
  await bypass.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('button[aria-pressed="true"]')?.textContent?.includes('Plan') ||
      [...document.querySelectorAll('button[aria-pressed="true"]')].some(
        (e) => e.textContent === 'Plan',
      ),
  );
  await page.getByRole('button', { name: 'Plan', exact: true }).click();
  checks.push('full-access confirmation can cancel or commit, and Plan mode round-trips');
  await page.screenshot({ path: SHOT('phase3b-composer.png') });

  // 3a.5 Edit-and-resend forks a revision and says so.
  const editable = transcript.locator('[data-turn-id]').first();
  await editable.hover();
  await editable.getByRole('button', { name: 'Edit and resend', exact: true }).first().click();
  // The editor and every other turn's Edit button share an accessible name,
  // so this names the control by element rather than by label.
  const editor = transcript.locator('textarea[aria-label="Edit and resend"]');
  await editor.waitFor();
  await editor.fill('Phase 3a transcript, revised');
  await transcript.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('group', { name: 'Task versions' }).waitFor();
  // The fork is a different Session with its own transcript, so the edited
  // text landing there is what proves the resend went through rather than
  // just the banner appearing.
  await transcript.getByText('Phase 3a transcript, revised', { exact: false }).waitFor();
  await page.screenshot({ path: SHOT('phase3a-revision-banner.png') });
  checks.push('edit and resend forks a revision and the version navigation appears');

  // 3a.6 The same transcript in the dark theme.
  await runPaletteCommand(page, 'Theme · Dark');
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await transcript.waitFor();
  await page.screenshot({ path: SHOT('phase3a-session-dark.png') });
  await runPaletteCommand(page, 'Theme · Light');
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  checks.push('the transcript renders in both themes');

  // 3a.7 The four timeline shapes, opened.
  //
  // The deterministic test backend emits text and one tool call and nothing
  // else — no reasoning, no diff, no shell run — so the only place all four
  // renderers can be SEEN is the design preview's fixture turn. These are the
  // real components with fixture data, opened by clicking, not a mock.
  await runPaletteCommand(page, 'Open runtime debug');
  await page.getByRole('button', { name: 'Design system', exact: true }).click();
  const preview = page.locator('[data-maka-contract="transcript-preview"]');
  await preview.scrollIntoViewIfNeeded();
  await preview.locator('[data-maka-tool-group] button[aria-expanded]').first().click();
  const previewRows = preview.locator('[data-maka-tool-row] button[aria-expanded]');
  await previewRows.first().waitFor();
  await previewRows.nth(0).click();
  await previewRows.nth(1).click();
  await preview.locator('.custom-code-highlight').first().waitFor();
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT('phase3a-transcript-light.png') });
  await runPaletteCommand(page, 'Theme · Dark');
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT('phase3a-transcript-dark.png') });
  await runPaletteCommand(page, 'Theme · Light');
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  checks.push('every timeline renderer opens: reasoning, a diff, a shell run and a subtask');

  // 3. The sidebar lists it.
  //
  // The rail can be collapsed at this point — a first-run profile starts
  // collapsed, and the hover peek that opened it in step 1 closes as soon as
  // the pointer leaves the toggle. A collapsed rail's rows are laid out but
  // clipped, which Playwright reads as hidden, so the rail is opened again
  // rather than waited on.
  await ensureSidebarExpanded(page);
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
  await rowFor(firstKey)
    .getByRole('button', { name: /Actions for/u })
    .click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const renameInput = page.getByLabel('Task name', { exact: true });
  await renameInput.fill(RENAMED);
  await renameInput.press('Enter');
  await page.waitForFunction(
    ([key, name]) =>
      document
        .querySelector(
          `[data-maka-contract="session-row"][data-session-key=${JSON.stringify(key)}]`,
        )
        ?.textContent?.includes(name) === true,
    [firstKey, RENAMED],
  );
  await page.reload();
  await rows.first().waitFor();
  await page.waitForFunction(
    ([key, name]) =>
      document
        .querySelector(
          `[data-maka-contract="session-row"][data-session-key=${JSON.stringify(key)}]`,
        )
        ?.textContent?.includes(name) === true,
    [firstKey, RENAMED],
  );
  checks.push('rename from the row menu persists through the Host');

  // A second task, so filtering has something to exclude.
  await ensureSidebarExpanded(page);
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

  await ensureSidebarExpanded(page);
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
    path.join(shots, 'phase3a-smoke-result.json'),
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
          'phase3a-session-light.png',
          'phase3a-session-dark.png',
          'phase3a-transcript-light.png',
          'phase3a-transcript-dark.png',
          'phase3a-model-switcher.png',
          'phase3a-revision-banner.png',
          'phase3a-tool-row.png',
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
    await page.screenshot({ path: SHOT('phase3a-failure.png') }).catch(() => {});
  }
  throw error;
} finally {
  if (app) await closeElectronApplication(app, 4000);
  await rm(userDataDir, { recursive: true, force: true });
}
