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

  // 3a.2 The model chip on the composer's meta row lists the seeded model.
  const switcher = page.locator('[data-maka-contract="composer-model"]');
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
  checks.push('the composer model chip lists the seeded connection');

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
  // The Send button only exists once there is something to send, so the
  // composer being editable is the "ready for input" signal here.
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[data-turn-status="running"]').length === 0 &&
      document.querySelectorAll(
        '[data-maka-contract="transcript"] [data-maka-contract="composer-input"][contenteditable="true"]',
      ).length === 1,
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

  // The permission mode is a quiet icon menu beside ＋ (upstream's footer).
  await page.getByRole('button', { name: /Permission mode/ }).click();
  await page.getByRole('menuitemradio', { name: 'Full access', exact: true }).click();
  const bypass = page.getByRole('dialog', { name: 'Switch to full access?', exact: true });
  await bypass.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: /Permission mode/ }).click();
  await page.getByRole('menuitemradio', { name: 'Full access', exact: true }).click();
  await bypass.getByRole('button', { name: 'Switch to full access', exact: true }).click();
  await bypass.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /Permission mode: Full access/ }).waitFor();
  // Plan is the mode row under the ＋ menu's divider; while on, its readout
  // mark sits after the permission icon and is the way out.
  await page.getByRole('button', { name: 'Add context', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Plan', exact: true }).click();
  await page.keyboard.press('Escape');
  const planMark = page.locator('button[data-mode="plan"]');
  await planMark.waitFor();
  await planMark.click();
  await planMark.waitFor({ state: 'detached' });
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

  // ── Phase 4: the right pane ───────────────────────────────────────────────
  //
  // These run on the task the earlier steps built, so the faces have a real
  // session behind them: a Host with a trace and a usage ledger, a workspace
  // that is not a git repository, an artifact catalog with nothing user-visible
  // in it, and a Runtime Host that can start a real PTY.

  // 4.1 ⌘⌥S reveals the pane, and the titlebar toggle reports what is open.
  const pane = page.locator('#maka-workbar-pane');
  const toggle = page.locator('[data-maka-contract="session-workbar-toggle"]');
  await toggle.waitFor();
  await page.keyboard.press('ControlOrMeta+Alt+s');
  await pane.waitFor();
  await page.locator('[data-maka-contract="session-artifacts"]').waitFor();
  await page.locator('[data-maka-contract="session-workbar-count"]').waitFor();
  checks.push('⌘⌥S opens the right pane on the Files face and the titlebar counts it');

  // 4.2 The Files face lists the task's artifacts. The deterministic backend
  //     writes none that are user-visible, so what must be on screen is the
  //     empty state — not a spinner and not a blank panel.
  await page
    .locator('[data-maka-contract="session-artifacts"]')
    .getByText('No generated files', { exact: false })
    .waitFor();
  await page.screenshot({ path: SHOT('phase4-files-light.png') });
  checks.push('the Files face reads the artifact catalog and states that it is empty');

  // 4.3 ⌃⇧G opens Changes. The fixture workspace is not a git repository, and
  //     that is a FAILURE with a retry, never the "nothing changed" empty state.
  await page.keyboard.press('Control+Shift+G');
  const review = page.locator('[data-maka-contract="session-review"]');
  await review.waitFor();
  await review.getByRole('status').first().waitFor();
  await page.screenshot({ path: SHOT('phase4-review-light.png') });
  checks.push('⌃⇧G opens Changes and it reports why there is no diff');

  // 4.4 ⌃` opens Terminal, starts a real PTY through the Runtime Host, and the
  //     shell's own output comes back into xterm.
  await page.keyboard.press('Control+`');
  const terminal = page.locator('[data-maka-contract="session-terminal"]');
  await terminal.waitFor();
  await terminal.getByRole('button', { name: 'New terminal', exact: true }).first().click();
  const xterm = page.locator('[data-maka-contract="session-terminal-xterm"]');
  await xterm.waitFor();
  await xterm.locator('.xterm-rows').waitFor();
  // Wait for the shell to finish starting: zsh redraws its line while it reads
  // its rc files, and characters typed into that redraw are reordered on
  // screen. The prompt is settled when the rows stop changing.
  await page.waitForFunction(
    () => {
      const rows = document.querySelector(
        '[data-maka-contract="session-terminal-xterm"] .xterm-rows',
      );
      const text = rows?.textContent?.trim() ?? '';
      const previous = window.__makaTerminalSettle;
      window.__makaTerminalSettle = {
        text,
        since: previous?.text === text ? previous.since : Date.now(),
      };
      return text.length > 0 && Date.now() - window.__makaTerminalSettle.since > 750;
    },
    undefined,
    { timeout: 30000, polling: 100 },
  );
  await xterm.click();
  await page.keyboard.type('echo mk-p4-$((2+2))', { delay: 30 });
  await page.keyboard.press('Enter');
  // The echoed input reads `mk-p4-$((2+2))`; only the shell can produce this.
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-maka-contract="session-terminal-xterm"] .xterm-rows')
        ?.textContent?.includes('mk-p4-4') === true,
    undefined,
    { timeout: 30000 },
  );
  await page.screenshot({ path: SHOT('phase4-terminal-light.png') });
  checks.push('⌃` opens Terminal, starts a PTY, and a typed command prints its output');

  // 4.5 The Trace face, opened from the strip's [+] menu (it has no chord).
  await page.locator('[data-maka-contract="session-workbar-launcher"]').click();
  await page.getByRole('menuitemcheckbox', { name: 'Trace', exact: true }).click();
  await page.keyboard.press('Escape');
  const inspector = page.locator('[data-maka-contract="session-inspector"]');
  await inspector.waitFor();
  // The task has run several turns, so the causal timeline has turns in it and
  // each one is priced or explicitly says it could not be. The session-wide
  // usage ledger is NOT asserted: the deterministic backend meters no tokens,
  // and the overview correctly draws nothing rather than a row of zeros.
  await page.locator('[data-maka-contract="session-inspector-trace"]').waitFor();
  const turn = page.locator('[data-maka-contract="session-inspector-turn"]').first();
  await turn.waitFor();
  await turn.getByText('cost unknown', { exact: false }).waitFor();
  await page.screenshot({ path: SHOT('phase4-inspector-light.png') });
  checks.push('the Trace face renders the turn timeline and states an unpriced cost as words');

  // 4.6 ⌘T opens Browser. No page is loaded, so the chrome is what must be
  //     there — and the reserved strip must show the DOM empty state through it.
  await page.keyboard.press('ControlOrMeta+t');
  const browser = page.locator('[data-maka-contract="session-browser"]');
  await browser.waitFor();
  await browser.getByLabel('Browser address', { exact: true }).waitFor();
  await browser.getByRole('button', { name: 'Go back in browser', exact: true }).waitFor();
  await page.screenshot({ path: SHOT('phase4-browser-light.png') });
  checks.push('⌘T opens the Browser face with its address bar and navigation controls');

  // 4.7 Five faces open, and the strip lists every one of them.
  assert.equal(await page.locator('[role="tab"][data-maka-workbar-tab]').count(), 5);
  assert.equal(await page.locator('[data-maka-contract="session-workbar-count"]').innerText(), '5');
  checks.push('all five faces stay open in the strip and the titlebar badge counts them');

  // 4.8 The pane in the dark theme.
  await runPaletteCommand(page, 'Theme · Dark');
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await pane.waitFor();
  await page.screenshot({ path: SHOT('phase4-pane-dark.png') });
  await runPaletteCommand(page, 'Theme · Light');
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  checks.push('the right pane renders in both themes');

  // 4.9 The toggle puts the pane away and records that, per task, under the v2
  //     key. (v1 was global and has no owner; `workbar-layout.ts` removes it.)
  await toggle.click();
  await pane.waitFor({ state: 'detached' });
  const collapsed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('maka-session-workbar-collapsed-v2') ?? '{}'),
  );
  assert.equal(
    Object.values(collapsed).some((value) => value === true),
    true,
  );
  // The pre-rewrite GLOBAL collapse key has no owner and must not come back.
  assert.equal(
    await page.evaluate(() => localStorage.getItem('maka-session-workbar-collapsed-v1')),
    null,
  );
  const panels = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('maka-session-workbar-panels-v3') ?? '{}'),
  );
  assert.equal(panels.version, 3);
  // Terminal is transient by definition; the other four survive a restart.
  assert.deepEqual(panels.right.tabs.map((tab) => tab.kind).sort(), [
    'browser',
    'files',
    'inspector',
    'review',
  ]);
  checks.push('the titlebar toggle collapses the pane and persists the workbar keys');

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

  // The rail's three bands (owner decision 2026-09-08): the menu on top, then
  // Projects with each project disclosing its tasks, then a flat Recents band.
  // The seeded project is listed even before it has a task of its own; both
  // tasks belong to it here, so neither appears in Recents.
  await ensureSidebarExpanded(page);
  const rail = page.locator('#app-sidebar');
  await rail.getByRole('button', { name: 'New task', exact: true }).waitFor();
  await rail.getByRole('button', { name: 'Extensions', exact: true }).waitFor();
  await rail.getByRole('button', { name: 'Scheduled', exact: true }).waitFor();
  assert.equal(await rail.getByLabel('Filter tasks', { exact: true }).count(), 0);
  const projectRow = rail.locator('[data-maka-contract="project-row"]').first();
  await projectRow.waitFor();
  const projectName = await projectRow.getAttribute('data-project-id');
  assert.ok(projectName);
  // The active task's project is open; its tasks sit under the project row.
  await page.waitForFunction(
    () =>
      document.querySelector('[data-maka-contract="project-row"][data-project-expanded="true"]') !==
      null,
  );
  const nested = rail.locator('[role="group"] [data-maka-contract="session-row"]');
  assert.ok((await nested.count()) >= 2, 'the project discloses its tasks');
  await rail
    .getByRole('button', { name: /^Collapse project /, exact: false })
    .first()
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-maka-contract="project-row"][data-project-expanded="true"]') ===
      null,
  );
  await rail
    .getByRole('button', { name: /^Expand project /, exact: false })
    .first()
    .click();
  await nested.first().waitFor();
  // Recents lists only the tasks without a project, and the band is not
  // rendered while there are none — both seeded tasks belong to the project.
  const recents = rail.locator('section').filter({ hasText: 'Recents' });
  assert.equal(await recents.count(), 0, 'project tasks do not also appear in Recents');
  assert.equal(await rail.getByText('No project', { exact: true }).count(), 0);
  await page.screenshot({ path: SHOT('phase2-session-list.png') });
  checks.push(
    'the rail shows menu, Projects with disclosed tasks, and Recents, with no filter box',
  );

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

  // ── Phase 5a: Settings ────────────────────────────────────────────────────
  //
  // Settings replaces the CONTENT column only (plan §2.12), so every check
  // below also asserts that the window titlebar still carries the sidebar
  // toggle — a Settings surface that swallowed the way back to the tasks
  // would pass every functional assertion and still be broken.

  // 5a.1 ⌘, opens Settings, and the titlebar keeps its shape.
  await page.keyboard.press('ControlOrMeta+,');
  const settings = page.locator('[data-maka-contract="settings-surface"]');
  await settings.waitFor();
  await page.locator('[data-maka-contract="settings-sidebar"]').waitFor();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).first().waitFor();
  await page.locator('[data-maka-contract="shell-topbar-rail"]').waitFor();
  await page.locator('[data-maka-contract="titlebar-identity"]').getByText('Settings').waitFor();
  checks.push('⌘, opens Settings with the sidebar toggle still in the window titlebar');

  // 5a.2 The nav hides the three deferred pages and shows the eleven that ship.
  const navRows = page.locator('[data-maka-contract="settings-sidebar"] [data-settings-section]');
  const navSections = await navRows.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-settings-section')),
  );
  assert.deepEqual(navSections, [
    'general',
    'appearance',
    'projects',
    'models',
    'subagents',
    'memory',
    'search',
    'usage',
    'archived-tasks',
    'data',
    'permissions',
    'health',
    'about',
  ]);
  for (const deferred of ['daily-review', 'import-tasks', 'bot-chat']) {
    assert.equal(navSections.includes(deferred), false, deferred);
  }
  checks.push('the settings nav lists the shipped pages and hides the deferred ones');

  const openSettingsSection = async (label, section) => {
    await navRows.filter({ hasText: label }).first().click();
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector('[data-maka-contract="settings-content"]')
          ?.getAttribute('data-settings-section') === expected,
      section,
    );
    // The nav row and the content column read the same state; a highlight that
    // disagrees with the page is the kind of bug a screenshot rationalizes away.
    assert.equal(
      await page.evaluate(() =>
        document
          .querySelector('[data-maka-contract="settings-sidebar"] [aria-current="page"]')
          ?.getAttribute('data-settings-section'),
      ),
      section,
    );
  };

  // 5a.3 About reads the real app info, and the section it left off on is the
  //      one ⌘, comes back to.
  await openSettingsSection('About', 'about');
  await settings
    .getByText(/^v\d+\.\d+\.\d+/u)
    .first()
    .waitFor();
  await page.screenshot({ path: SHOT('phase5a-about-light.png') });
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => localStorage.getItem('maka-settings-section-v1')),
    'about',
  );
  await page.keyboard.press('ControlOrMeta+,');
  await settings.waitFor();
  assert.equal(
    await page
      .locator('[data-maka-contract="settings-content"]')
      .getAttribute('data-settings-section'),
    'about',
  );
  checks.push('About shows the running build version and ⌘, reopens the section it left off on');

  // 5a.4 Appearance flips the theme through the same settings IPC the palette uses.
  await openSettingsSection('Appearance', 'appearance');
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  // The theme change animates; a frame captured mid-transition is a lie.
  await new Promise((settle) => setTimeout(settle, 400));
  await page.screenshot({ path: SHOT('phase5a-appearance-dark.png') });
  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
  await new Promise((settle) => setTimeout(settle, 400));
  await page.screenshot({ path: SHOT('phase5a-appearance-light.png') });
  checks.push('the Appearance theme control flips .dark through the real settings IPC');

  // 5a.5 General writes a client-owned setting that reads back through the IPC.
  await openSettingsSection('General', 'general');
  const notificationsLabel = 'Send a system notification when finished';
  const notifications = page.getByRole('switch', { name: notificationsLabel, exact: true });
  await notifications.waitFor();
  const notificationsBefore = await notifications.getAttribute('aria-checked');
  await notifications.click();
  await page.waitForFunction(
    ([label, previous]) =>
      document
        .querySelector(`button[role="switch"][aria-label="${label}"]`)
        ?.getAttribute('aria-checked') !== previous,
    [notificationsLabel, notificationsBefore],
  );
  const notificationsAfter = await notifications.getAttribute('aria-checked');
  await page.screenshot({ path: SHOT('phase5a-general-light.png') });
  // Prove it reached the Host, not just the DOM that wrote it: a reload throws
  // away every store and reads the settings back over IPC.
  await page.reload();
  await page.locator('.appFrame').waitFor();
  await page.keyboard.press('ControlOrMeta+,');
  await settings.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-maka-contract="settings-content"]')
        ?.getAttribute('data-settings-section') === 'general',
  );
  await page.waitForFunction(
    ([label, expected]) =>
      document
        .querySelector(`button[role="switch"][aria-label="${label}"]`)
        ?.getAttribute('aria-checked') === expected,
    [notificationsLabel, notificationsAfter],
  );
  checks.push('a General switch round-trips through the settings IPC and survives a reload');

  // 5a.6 The UI language re-renders the whole app, sidebar included.
  await page.getByRole('combobox', { name: 'Interface language', exact: true }).click();
  await page.getByRole('option', { name: 'Simplified Chinese', exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-maka-locale') === 'zh-CN',
  );
  await page.getByRole('button', { name: '新建任务', exact: true }).first().waitFor();
  await page.locator('[data-maka-contract="settings-sidebar"]').getByText('通用').first().waitFor();
  await page.screenshot({ path: SHOT('phase5a-general-zh.png') });
  await page.getByRole('combobox', { name: '界面语言', exact: true }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-maka-locale') === 'en',
  );
  await page.getByRole('button', { name: 'New task', exact: true }).first().waitFor();
  checks.push('switching the UI language re-renders the sidebar and the nav, and back again');

  // 5a.7 Workspace, Usage, Data, Permissions and Health each render their own page.
  for (const [name, section, shot] of [
    ['Workspace', 'projects', 'phase5a-workspace-light.png'],
    ['Usage', 'usage', 'phase5a-usage-light.png'],
    ['Data', 'data', 'phase5a-data-light.png'],
    ['Permissions & Capabilities', 'permissions', 'phase5a-permissions-light.png'],
    ['Health', 'health', 'phase5a-health-light.png'],
  ]) {
    await openSettingsSection(name, section);
    await page.locator('[data-maka-contract="settings-content"] section').first().waitFor();
    // Each of these pages opens with a read in flight; a screenshot taken on
    // the skeleton says nothing about the page.
    await new Promise((settle) => setTimeout(settle, 600));
    await page.screenshot({ path: SHOT(shot) });
  }
  checks.push('Workspace, Usage, Data, Permissions and Health each render against the real Host');

  // ── Phase 5b: Models, Subagents, Memory, Web Search ───────────────────────

  // 5b.1 Models lists the seeded connection and opens its detail.
  await openSettingsSection('Models', 'models');
  const providers = page.locator('[data-maka-contract="providers-panel"]');
  await providers.waitFor();
  await providers.getByText('E2E', { exact: true }).first().waitFor();
  await new Promise((settle) => setTimeout(settle, 400));
  await page.screenshot({ path: SHOT('phase5b-models-light.png') });
  await page.getByRole('button', { name: 'Open connection E2E', exact: true }).click();
  const connectionDetail = page.locator('[data-maka-contract="connection-detail"]');
  await connectionDetail.waitFor();
  // The detail face replaces the CONTENT column and nothing else: the window
  // titlebar still carries the way back to the tasks (plan §2.12).
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).first().waitFor();
  await new Promise((settle) => setTimeout(settle, 400));
  await page.screenshot({ path: SHOT('phase5b-connection-detail-light.png') });
  await page.getByRole('button', { name: 'Back to model connections', exact: true }).click();
  await connectionDetail.waitFor({ state: 'detached' });
  checks.push('Models lists the seeded connection and opens its detail');

  // 5b.2 The catalog offers the company gateway, and its setup form refuses to
  //      go out to an empty address rather than failing at the network.
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await page.locator('[data-maka-contract="add-connection"]').waitFor();
  await page.locator('[data-maka-contract="provider-catalog"]').waitFor();
  const gatewayCard = page
    .getByRole('button', { name: /^Add model provider: RELX Gateway/u })
    .first();
  await gatewayCard.waitFor();
  // The catalog opens on the account sign-ins; the capture is of the grid, so
  // it has to be looking at the grid.
  await gatewayCard.scrollIntoViewIfNeeded();
  await new Promise((settle) => setTimeout(settle, 300));
  await page.screenshot({ path: SHOT('phase5b-provider-catalog-light.png') });
  await gatewayCard.click();
  const setup = page.locator('[data-maka-contract="provider-setup"]');
  await setup.waitFor();
  // A key and no endpoint: the gateway registry entry ships neither a baseUrl
  // nor a template, so the endpoint is the field the operator has to hand out.
  await page.getByLabel('API key', { exact: true }).fill('smoke-gateway-key');
  await page.getByRole('button', { name: 'Verify and choose models', exact: true }).click();
  await setup
    .getByRole('alert')
    .getByText('This provider requires a service URL', { exact: true })
    .waitFor();
  await page.screenshot({ path: SHOT('phase5b-provider-setup-light.png') });
  await page.getByRole('button', { name: 'Back to the provider list', exact: true }).click();
  await setup.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Back to model connections', exact: true }).click();
  await providers.waitFor();
  checks.push('the add-connection catalog offers RELX Gateway and blocks on its missing endpoint');

  // 5b.3 A subagent preset round-trips through the settings IPC and back out.
  const PRESET = 'Smoke reader';
  await openSettingsSection('Subagents', 'subagents');
  await settings.getByRole('button', { name: 'Add subagent', exact: true }).first().click();
  const subagentEditor = page.locator('[data-maka-contract="subagent-detail"]');
  await subagentEditor.waitFor();
  await page.getByLabel('Display name', { exact: true }).fill(PRESET);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await subagentEditor.waitFor({ state: 'detached' });
  // The list re-reads the Host's settings after the write, so a row here is
  // proof the preset was stored rather than proof a form was filled in.
  await settings.getByText(PRESET, { exact: true }).first().waitFor();
  await new Promise((settle) => setTimeout(settle, 300));
  await page.screenshot({ path: SHOT('phase5b-subagents-light.png') });
  await page.getByRole('button', { name: `Configure “${PRESET}”`, exact: true }).click();
  await subagentEditor.waitFor();
  await subagentEditor.getByRole('button', { name: 'Remove', exact: true }).click();
  const removeConfirm = page.locator('[data-app-dialog]');
  await removeConfirm.waitFor();
  await removeConfirm.getByRole('button', { name: 'Remove', exact: true }).click();
  await subagentEditor.waitFor({ state: 'detached' });
  await settings.getByText(PRESET, { exact: true }).waitFor({ state: 'detached' });
  checks.push('Subagents creates a preset through the settings IPC and deletes it again');

  // 5b.4 Memory's agent-read switch is written to the Host, and reads back.
  const AGENT_READ = 'Allow model context to read local memory';
  await openSettingsSection('Memory', 'memory');
  const agentRead = page.getByRole('switch', { name: AGENT_READ, exact: true });
  await agentRead.waitFor();
  const agentReadBefore = await agentRead.getAttribute('aria-checked');
  await agentRead.click();
  await page.waitForFunction(
    ([label, previous]) =>
      document
        .querySelector(`button[role="switch"][aria-label="${label}"]`)
        ?.getAttribute('aria-checked') !== previous,
    [AGENT_READ, agentReadBefore],
  );
  const agentReadAfter = await agentRead.getAttribute('aria-checked');
  await new Promise((settle) => setTimeout(settle, 300));
  await page.screenshot({ path: SHOT('phase5b-memory-light.png') });

  // 5b.5 Web Search renders its credential test, and leaving Memory and coming
  //      back re-reads the state from the Host rather than from a cache.
  await openSettingsSection('Web Search', 'search');
  await settings.getByRole('switch', { name: 'Enable web search', exact: true }).waitFor();
  // The probe is on every source; it is the page's own test control, and it
  // says Beta rather than pretending otherwise.
  await settings.getByLabel('Test search', { exact: true }).waitFor();
  await settings.getByRole('button', { name: 'Search', exact: true }).waitFor();
  // The credential test only exists for a source that HAS a credential: the
  // default source is the task's own model connection, which carries none.
  await settings.getByRole('combobox', { name: 'Search source', exact: true }).click();
  await page.getByRole('option', { name: 'Tavily', exact: true }).click();
  await settings.getByRole('button', { name: 'Test credentials', exact: true }).waitFor();
  await new Promise((settle) => setTimeout(settle, 300));
  await page.screenshot({ path: SHOT('phase5b-web-search-light.png') });
  await settings.getByRole('combobox', { name: 'Search source', exact: true }).click();
  await page.getByRole('option', { name: 'Current model', exact: true }).click();
  await openSettingsSection('Memory', 'memory');
  await page.waitForFunction(
    ([label, expected]) =>
      document
        .querySelector(`button[role="switch"][aria-label="${label}"]`)
        ?.getAttribute('aria-checked') === expected,
    [AGENT_READ, agentReadAfter],
  );
  checks.push(
    'Memory toggles agent-read through the Host and reads it back; Web Search renders its test',
  );

  // 5a.9 Archived tasks lists a task archived from the rail, and restores it.
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'detached' });
  await ensureSidebarExpanded(page);
  // The second task, not the renamed one: the renamed task is an
  // edit-and-resend FAMILY, and archiving a family from the rail is currently
  // a no-op in the Host (see the phase report). A single task is what this
  // check is about.
  const ARCHIVED_TASK = 'Second smoke task';
  const toArchive = page
    .locator('[data-maka-contract="session-row"]')
    .filter({ hasText: ARCHIVED_TASK })
    .first();
  const archivedKey = await toArchive.getAttribute('data-session-key');
  await toArchive.hover();
  await toArchive.getByRole('button', { name: /Actions for/u }).click();
  await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
  await page.waitForFunction(
    (key) =>
      document.querySelector(
        `[data-maka-contract="session-row"][data-session-key=${JSON.stringify(key)}]`,
      ) === null,
    archivedKey,
  );
  await page.keyboard.press('ControlOrMeta+,');
  await settings.waitFor();
  await openSettingsSection('Archived tasks', 'archived-tasks');
  await settings.getByText(ARCHIVED_TASK, { exact: false }).waitFor();
  await page.screenshot({ path: SHOT('phase5a-archived-light.png') });
  await settings.getByRole('button', { name: `Restore ${ARCHIVED_TASK}`, exact: true }).click();
  await settings.getByText(ARCHIVED_TASK, { exact: false }).waitFor({ state: 'detached' });
  checks.push('Archived tasks lists a task archived from the rail and restores it');

  // 5a.10 Escape closes Settings and gives the content column back.
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'detached' });
  await ensureSidebarExpanded(page);
  await page
    .locator('[data-maka-contract="session-row"]')
    .filter({ hasText: ARCHIVED_TASK })
    .first()
    .waitFor();
  checks.push('Escape closes Settings and the restored task is back in the rail');

  // ── Phase 5b: the module pages ────────────────────────────────────────────
  //
  // The sidebar's three nav rows own the content column the same way Settings
  // does: the window titlebar keeps its toggle, and the page underneath is a
  // real page rather than a placeholder.
  const moduleMain = page.locator('[data-maka-contract="module-main"]');
  // Extensions is one row with two faces; Scheduled is its own row.
  await page
    .locator('#app-sidebar')
    .getByRole('button', { name: 'Extensions', exact: true })
    .click();
  await moduleMain.waitFor();
  await moduleMain.locator('[data-maka-contract="module-actions"]').waitFor();
  await moduleMain.getByRole('radio', { name: 'Skills', exact: true }).waitFor();
  await moduleMain.getByText('Installed', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).first().waitFor();
  await new Promise((settle) => setTimeout(settle, 700));
  await page.screenshot({ path: SHOT('phase5b-skills-light.png') });
  await moduleMain.getByRole('radio', { name: 'MCP', exact: true }).click();
  await moduleMain.getByText('Configured servers', { exact: true }).first().waitFor();
  await new Promise((settle) => setTimeout(settle, 700));
  await page.screenshot({ path: SHOT('phase5b-mcp-light.png') });
  await page
    .locator('#app-sidebar')
    .getByRole('button', { name: 'Scheduled', exact: true })
    .click();
  await moduleMain.getByText('Scheduled tasks', { exact: true }).first().waitFor();
  await new Promise((settle) => setTimeout(settle, 700));
  await page.screenshot({ path: SHOT('phase5b-scheduled-light.png') });
  checks.push(
    'the sidebar Extensions row opens Skills and MCP as two faces; Scheduled opens its page',
  );

  // A scheduled task, created and deleted through the page's own dialog.
  const REMINDER = 'Smoke reminder';
  await moduleMain.getByRole('button', { name: 'New scheduled task', exact: true }).first().click();
  const scheduleDialog = page.locator('[data-app-dialog]');
  await scheduleDialog.waitFor();
  await scheduleDialog.getByLabel('Title', { exact: true }).fill(REMINDER);
  await scheduleDialog.getByRole('button', { name: 'Create', exact: true }).click();
  await scheduleDialog.waitFor({ state: 'detached' });
  await moduleMain.getByText(REMINDER, { exact: true }).first().waitFor();
  await page.screenshot({ path: SHOT('phase5b-scheduled-task-light.png') });
  await page.getByRole('button', { name: `More actions for ${REMINDER}`, exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const deleteConfirm = page.locator('[data-app-dialog]');
  await deleteConfirm.waitFor();
  await deleteConfirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await moduleMain.getByText(REMINDER, { exact: true }).waitFor({ state: 'detached' });
  checks.push('the Scheduled page creates a scheduled task and deletes it again');

  // Dark, once, on a module page: the pages are new surfaces and the palette
  // has to hold on all of them, not only on the ones Settings owns.
  await runPaletteCommand(page, 'Theme · Dark');
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await new Promise((settle) => setTimeout(settle, 500));
  await page.screenshot({ path: SHOT('phase5b-scheduled-dark.png') });
  await runPaletteCommand(page, 'Theme · Light');
  await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));

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
          'phase4-files-light.png',
          'phase4-review-light.png',
          'phase4-terminal-light.png',
          'phase4-inspector-light.png',
          'phase4-browser-light.png',
          'phase4-pane-dark.png',
          'phase5a-about-light.png',
          'phase5a-appearance-light.png',
          'phase5a-appearance-dark.png',
          'phase5a-general-light.png',
          'phase5a-general-zh.png',
          'phase5a-workspace-light.png',
          'phase5a-usage-light.png',
          'phase5a-data-light.png',
          'phase5a-permissions-light.png',
          'phase5a-health-light.png',
          'phase5a-archived-light.png',
          'phase5b-models-light.png',
          'phase5b-connection-detail-light.png',
          'phase5b-provider-catalog-light.png',
          'phase5b-provider-setup-light.png',
          'phase5b-subagents-light.png',
          'phase5b-memory-light.png',
          'phase5b-web-search-light.png',
          'phase5b-skills-light.png',
          'phase5b-mcp-light.png',
          'phase5b-scheduled-light.png',
          'phase5b-scheduled-task-light.png',
          'phase5b-scheduled-dark.png',
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
