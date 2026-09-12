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

// Switching away from a streaming task and back must show what the turn had
// already produced. The fake backend streams 9 characters every 45ms, so a
// long prompt keeps one turn streaming for tens of seconds; the test leaves
// and returns several times during it and reads the transcript each time.

import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
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
    if (created.kind !== 'committed') throw new Error(`connection seed: ${created.kind}`);
    const connection = created.snapshot.connections.find(({ slug }) => slug === 'e2e');
    const credential = await stores.credentialVault.set({
      locator: { scope: 'connection', connectionId: connection.connectionId, kind: 'api_key' },
      expected: null,
      secret: 'e2e-placeholder',
    });
    if (credential.kind !== 'committed') throw new Error(`credential seed: ${credential.kind}`);
    const modelFetch = await stores.operations.beginModelFetch(connection.connectionId);
    if (modelFetch.kind !== 'ready') throw new Error(`model fetch: ${modelFetch.kind}`);
    const inventory = await stores.operations.completeModelFetch(modelFetch.ticket, {
      models: [{ id: 'claude-sonnet-4-5-20250929' }],
      source: 'fallback',
      fetchedAt: 0,
    });
    if (inventory.kind !== 'committed') throw new Error(`inventory seed: ${inventory.kind}`);
    const target = await stores.connectionCatalog.setDefaultTarget({
      expectedCatalogRevision: inventory.snapshot.revision,
      target: { connectionId: connection.connectionId, modelId: 'claude-sonnet-4-5-20250929' },
    });
    if (target.kind !== 'committed') throw new Error(`default target seed: ${target.kind}`);
  } finally {
    await owner.close();
  }
}

const desktop = fileURLToPath(new URL('../../../../', import.meta.url));
const shots = fileURLToPath(new URL('../../../../../../.maka-shots/enterprise/', import.meta.url));
const userDataDir = await mkdtemp(path.join(tmpdir(), 'maka-streaming-switch-'));
await mkdir(path.join(userDataDir, 'home'));
await mkdir(shots, { recursive: true });
const SHOT = (name) => path.join(shots, name);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let app;
let page;
const errors = [];
const findings = [];

async function startTask(prompt) {
  await page.locator('[data-maka-contract="welcome-surface"]').waitFor();
  await page.getByLabel('Task', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}

async function ensureSidebarExpanded() {
  const collapsed = await page.evaluate(
    () => document.querySelector('.appFrame')?.getAttribute('data-sidebar-state') === 'collapsed',
  );
  if (collapsed) {
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).first().click();
  }
  await page.locator('#app-sidebar').waitFor();
}

const transcript = () => page.locator('[data-maka-contract="transcript"]');
const transcriptText = () => transcript().evaluate((node) => node.textContent ?? '');
const rowNamed = (text) =>
  page.locator('[data-maka-contract="session-row"]').filter({ hasText: text }).first();

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
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[console.error] ${message.text()}`);
  });
  await page.locator('.appFrame').waitFor();
  await ensureSidebarExpanded();

  // Task A: a short reply, finished before anything else happens.
  await startTask('Session A anchor');
  await transcript().getByText('renderer loop are connected.', { exact: false }).waitFor();

  // Task B: a reply long enough to stream for ~25s.
  await page.getByRole('button', { name: 'New task', exact: true }).first().click();
  const filler = ' lorem ipsum dolor sit amet'.repeat(180);
  await startTask(`Session B streaming marker${filler}`);
  await transcript().getByText('Fake backend received: Session B', { exact: false }).waitFor();
  await sleep(1500);

  for (let round = 1; round <= 3; round += 1) {
    const before = await transcriptText();
    const streamedBefore = before.indexOf('Fake backend received: Session B');
    assert.ok(streamedBefore >= 0, `round ${round}: the stream is visible before leaving`);
    const lengthBefore = before.length - streamedBefore;

    await ensureSidebarExpanded();
    await rowNamed('Session A anchor').click();
    await transcript().getByText('renderer loop are connected.', { exact: false }).waitFor();
    await sleep(700);
    await rowNamed('Session B streaming marker').click();
    await transcript().getByText('Fake backend received: Session B', { exact: false }).waitFor();

    // What the reader sees right after the switch, sampled for two seconds.
    const samples = [];
    for (let i = 0; i < 8; i += 1) {
      await sleep(250);
      const text = await transcriptText();
      const at = text.indexOf('Fake backend received: Session B');
      samples.push(at >= 0 ? text.length - at : 0);
    }
    const gapRow = await transcript()
      .getByText('Newer messages below are not loaded.', { exact: false })
      .count();
    const jump = await page.getByRole('button', { name: 'Jump to latest', exact: true }).count();
    const skeleton = await transcript().locator('[data-maka-contract="chat-skeleton"]').count();
    await page.screenshot({ path: SHOT(`streaming-switch-round${round}.png`) });
    findings.push({
      round,
      streamedCharsBeforeLeaving: lengthBefore,
      streamedCharsAfterReturn: samples,
      gapRowShown: gapRow,
      jumpToLatestShown: jump,
      skeletonShown: skeleton,
    });
    await sleep(1500);
  }

  await transcript()
    .getByText('renderer loop are connected.', { exact: false })
    .waitFor({ timeout: 60000 });
  const final = await transcriptText();
  findings.push({ final: final.includes('Fake backend received: Session B') });

  // Task C: a live turn whose first step is a finished tool call waiting on
  // the user. Nothing here is an incomplete text accumulator, so what the
  // returning reader sees comes from the transcript overlay, not the seed.
  await page.getByRole('button', { name: 'New task', exact: true }).first().click();
  await startTask('__e2e_ask_user_question__');
  const promptPanel = page.locator('[data-maka-contract="interaction-prompt"]');
  await promptPanel.waitFor();
  await sleep(800);
  const beforeC = await transcriptText();
  await ensureSidebarExpanded();
  await rowNamed('Session A anchor').click();
  await transcript().getByText('renderer loop are connected.', { exact: false }).waitFor();
  await sleep(700);
  await rowNamed('__e2e_ask_user_question__').click();
  await transcript().waitFor();
  await sleep(2000);
  const afterC = await transcriptText();
  const panelAfter = await promptPanel.count();
  await page.screenshot({ path: SHOT('streaming-switch-question.png') });
  findings.push({
    question: true,
    transcriptBefore: beforeC.slice(0, 300),
    transcriptAfter: afterC.slice(0, 300),
    panelAfter,
  });
  // Task D: what a real model leaves behind mid-Turn — a settled text step and
  // a finished tool call — while the Turn itself stays open.
  await page.getByRole('button', { name: 'New task', exact: true }).first().click();
  await startTask('__e2e_hold_open_after_steps__');
  await transcript().getByText('Step one settled before the wait.', { exact: false }).waitFor();
  await transcript().getByText('Fake backend waiting', { exact: false }).waitFor();
  await sleep(1500);
  const textBeforeD = await transcriptText();
  await ensureSidebarExpanded();
  await rowNamed('Session A anchor').click();
  await transcript().getByText('renderer loop are connected.', { exact: false }).waitFor();
  await sleep(700);
  await rowNamed('__e2e_hold_open_after_steps__').click();
  await transcript().waitFor();
  await sleep(2500);
  const textAfterD = await transcriptText();
  await page.screenshot({ path: SHOT('streaming-switch-steps.png') });
  findings.push({
    steps: true,
    settledVisibleBefore: textBeforeD.includes('Step one settled before the wait.'),
    toolVisibleBefore: textBeforeD.includes('README.md'),
    settledVisibleAfter: textAfterD.includes('Step one settled before the wait.'),
    toolVisibleAfter: textAfterD.includes('README.md'),
    waitingVisibleAfter: textAfterD.includes('Fake backend waiting'),
  });
  await page
    .getByRole('button', { name: 'Stop', exact: true })
    .first()
    .click()
    .catch(() => undefined);
  await sleep(1000);

  for (const finding of findings) {
    if ('round' in finding) {
      assert.ok(
        finding.streamedCharsAfterReturn.every(
          (chars) => chars >= finding.streamedCharsBeforeLeaving,
        ),
        `round ${finding.round}: the streamed text must survive the switch`,
      );
    }
    if ('question' in finding)
      assert.equal(finding.panelAfter, 1, 'the pending question survives the switch');
    if ('steps' in finding) {
      assert.ok(finding.settledVisibleBefore && finding.waitingVisibleAfter);
      assert.ok(
        finding.settledVisibleAfter,
        'a step that finished before the switch is still shown after it',
      );
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    'Streaming switch smoke passed: text keeps streaming, a pending question and finished steps survive leaving and returning mid-Turn.',
  );
} finally {
  console.log(JSON.stringify({ findings, errors }, null, 2));
  if (app) await closeElectronApplication(app);
  await rm(userDataDir, { recursive: true, force: true });
}
