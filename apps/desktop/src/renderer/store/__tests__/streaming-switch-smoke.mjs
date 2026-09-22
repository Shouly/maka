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
  // The question's distance from the top, sampled through the pin: it must
  // settle near 24px and never leave again (a swap-induced second jump would
  // show as a sample far from the top after one that had arrived).
  const arrival = [];
  for (let i = 0; i < 20; i += 1) {
    await sleep(100);
    arrival.push(
      await page.evaluate(() => {
        const root = document.querySelector('[data-maka-transcript-boundary]');
        const rows = root.querySelectorAll('[data-role="user"]');
        const question = rows[rows.length - 1];
        return question
          ? Math.round(question.getBoundingClientRect().top - root.getBoundingClientRect().top)
          : null;
      }),
    );
  }
  findings.push({ arrival });
  const arrived = arrival.findIndex((top) => top !== null && top <= 40);
  assert.ok(arrived >= 0, `the question reaches the top: ${arrival.join(',')}`);
  assert.ok(
    arrival.slice(arrived).every((top) => top !== null && top <= 60),
    `the question stays at the top once there: ${arrival.join(',')}`,
  );
  await transcript().getByText('Fake backend received: Session B', { exact: false }).waitFor();

  // relx's reading model: the question sits at the top of the viewport, the
  // viewport does not follow the stream, and the disc appears once the answer
  // has grown past the bottom.
  const measure = () =>
    page.evaluate(() => {
      const root = document.querySelector('[data-maka-transcript-boundary]');
      const rows = root.querySelectorAll('[data-role="user"]');
      const question = rows[rows.length - 1];
      return {
        questionTop: question.getBoundingClientRect().top - root.getBoundingClientRect().top,
        scrollTop: root.scrollTop,
        floor: root.querySelector('.chat-feed').style.minHeight,
      };
    });
  const pinned = await measure();
  await page.screenshot({ path: SHOT('streaming-switch-pinned-light.png') });
  await page
    .getByRole('button', { name: 'Jump to latest', exact: true })
    .waitFor({ timeout: 30000 });
  const grown = await measure();
  findings.push({
    pin: true,
    questionTop: pinned.questionTop,
    floor: pinned.floor,
    scrollTopHeld: grown.scrollTop === pinned.scrollTop,
    questionTopAfterGrowth: grown.questionTop,
  });
  assert.ok(
    pinned.questionTop >= 16 && pinned.questionTop <= 40,
    `question pinned near the top: ${pinned.questionTop}`,
  );
  assert.equal(
    pinned.floor,
    '',
    'the first question is already at the top and needs no artificial floor',
  );
  assert.ok(grown.scrollTop === pinned.scrollTop, 'the viewport does not follow the stream');

  // The jump-to-latest disc, while the answer is still generating: scroll the
  // reader to the top so it shows, keep the shot for the style comparison.
  await transcript()
    .locator('[data-maka-transcript-boundary]')
    .evaluate((node) => {
      node.scrollTop = 0;
    });
  await page.getByRole('button', { name: 'Jump to latest', exact: true }).waitFor();
  await sleep(400);
  await page.screenshot({ path: SHOT('streaming-switch-jump-light.png') });
  await page.getByRole('button', { name: 'Jump to latest', exact: true }).click();
  await sleep(400);

  for (let round = 1; round <= 3; round += 1) {
    const before = await transcriptText();
    const streamedBefore = before.indexOf('Fake backend received: Session B');
    assert.ok(streamedBefore >= 0, `round ${round}: the stream is visible before leaving`);
    const lengthBefore = before.length - streamedBefore;

    if (round === 1) {
      // A reader who nudged the wheel while parked on the question: still the
      // latest Turn, so no bookmark — returning must land on the latest reply.
      await transcript().hover();
      await page.mouse.wheel(0, 40);
      await sleep(300);
    }
    await ensureSidebarExpanded();
    await rowNamed('Session A anchor').click();
    await transcript().getByText('renderer loop are connected.', { exact: false }).waitFor();
    await sleep(700);
    await rowNamed('Session B streaming marker').click();
    await transcript().getByText('Fake backend received: Session B', { exact: false }).waitFor();

    if (round === 1) {
      await sleep(1200);
      const layout = await page.evaluate(() => {
        const root = document.querySelector('[data-maka-transcript-boundary]');
        const rootRect = root.getBoundingClientRect();
        const rows = root.querySelectorAll('[data-role="user"]');
        const question = rows[rows.length - 1];
        const end = root.querySelector('[data-maka-transcript-end]');
        return {
          viewport: rootRect.height,
          scrollTop: root.scrollTop,
          scrollHeight: root.scrollHeight,
          questionTop: question ? question.getBoundingClientRect().top - rootRect.top : null,
          contentEndFromViewportTop: end.getBoundingClientRect().top - rootRect.top,
          floor: root.querySelector('.chat-feed').style.minHeight,
          disc: !!document.querySelector('button[aria-label="Jump to latest"]'),
        };
      });
      findings.push({ returned: true, ...layout });
      await page.screenshot({ path: SHOT('streaming-switch-returned-light.png') });
      assert.ok(
        layout.contentEndFromViewportTop <= layout.viewport + 1,
        `returning lands on the latest reply: content end ${layout.contentEndFromViewportTop} vs viewport ${layout.viewport}`,
      );
      assert.equal(layout.floor, '', 'no floor survives a switch');
    }

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

  // Leaving from history while a second Turn streams: the bookmark on the
  // earlier Turn is kept, so returning lands there with no following, and the
  // disc offers the tail. Taking the disc lands at the tail, which follows.
  const geometry = () =>
    page.evaluate(() => {
      const root = document.querySelector('[data-maka-transcript-boundary]');
      const rootRect = root.getBoundingClientRect();
      const turns = [...root.querySelectorAll('[data-turn-id]')];
      const end = root.querySelector('[data-maka-transcript-end]');
      return {
        scrollTop: root.scrollTop,
        firstTurnTop: turns[0] ? turns[0].getBoundingClientRect().top - rootRect.top : null,
        contentEndFromViewportTop: end.getBoundingClientRect().top - rootRect.top,
        viewport: rootRect.height,
        disc: !!document.querySelector('button[aria-label="Jump to latest"]'),
      };
    });
  await ensureSidebarExpanded();
  await rowNamed('Session A anchor').click();
  await transcript().getByText('renderer loop are connected.', { exact: false }).waitFor();
  await page.getByLabel('Message input', { exact: true }).fill(`Session A second turn${filler}`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await transcript()
    .getByText('Fake backend received: Session A second turn', { exact: false })
    .waitFor();
  const secondTurnFloor = await transcript()
    .locator('.chat-feed')
    .evaluate((feed) => Number.parseFloat(feed.style.minHeight || '0'));
  assert.ok(secondTurnFloor > 0, 'a later question gets room to move past existing history');
  // Past the question hold (450ms ease plus a 1200ms hold): reading history
  // is a decision the reader makes once the send has landed.
  await sleep(2500);
  // Read history by wheel, as a reader would: only reader-driven scrolling
  // records a reading position (a programmatic scrollTop does not). The wheel
  // lands on the answer, not on the collapsed question bubble, which is a
  // nested scroller the browser would feed first.
  // Read history from the keyboard: a synthetic wheel in this Electron is
  // applied before its event reaches the scroller, so the authority sees no
  // movement in it; a key scrolls after its keydown, as it does for a reader.
  await transcript()
    .locator('[data-maka-transcript-boundary]')
    .evaluate((node) => {
      node.tabIndex = -1;
      node.focus();
    });
  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('ArrowUp');
    await sleep(70);
  }
  await sleep(600);
  const inHistory = await geometry();
  assert.equal(inHistory.scrollTop, 0, 'the wheel reached the top of history');
  await rowNamed('Session B streaming marker').click();
  await transcript().getByText('Fake backend received: Session B', { exact: false }).waitFor();
  await sleep(600);
  await rowNamed('Session A anchor').click();
  await transcript()
    .getByText('Fake backend received: Session A second turn', { exact: false })
    .waitFor();
  await sleep(1200);
  const restored = await geometry();
  await sleep(2000);
  const restoredLater = await geometry();
  findings.push({ history: true, inHistory, restored, restoredLater });
  await page.screenshot({ path: SHOT('streaming-switch-history-light.png') });
  await page
    .getByRole('button', { name: 'Jump to latest', exact: true })
    .waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Jump to latest', exact: true }).click();
  await sleep(600);
  const atTail = await geometry();
  await sleep(2000);
  const atTailLater = await geometry();
  findings.push({ tail: true, atTail, atTailLater });
  assert.ok(
    restored.firstTurnTop !== null && restored.firstTurnTop >= -8 && restored.firstTurnTop <= 40,
    `returns to the bookmarked Turn: ${restored.firstTurnTop}`,
  );
  assert.ok(restoredLater.disc, 'the disc offers the tail from history once the answer has grown');
  assert.equal(restoredLater.scrollTop, restored.scrollTop, 'history does not follow the stream');
  assert.ok(atTail.contentEndFromViewportTop <= atTail.viewport + 1, 'the disc lands at the tail');
  assert.ok(atTailLater.scrollTop > atTail.scrollTop, 'the tail follows the stream');
  assert.ok(!atTailLater.disc, 'no disc while following');

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
  // Task E: a call is named, and then names what it does, while the model is
  // still writing it. The fixture streams the arguments as a provider does —
  // `file_path` closes in the first few fragments, the body takes a second and
  // a half more — so the distance between the row appearing and the row saying
  // what it writes is the whole question. Held back to the dispatch, that
  // distance is the length of the argument stream and the row spends it showing
  // the bare tool name.
  await page.getByRole('button', { name: 'New task', exact: true }).first().click();
  await startTask('__e2e_stream_tool_input__');
  const toolRow = transcript().locator('[data-maka-tool-row]').first();
  await toolRow.waitFor();
  const appearedAt = Date.now();
  await toolRow.getByText('fake-backend-demo.ts', { exact: false }).waitFor();
  const namedAt = Date.now();
  // And it still says it once the arguments land whole, from `args` rather than
  // from the partial reading. A finished group collapses to its summary line, so
  // the row has to be opened to be asked — reading it before the collapse is
  // racing the thing under test.
  await page
    .getByRole('button', { name: 'Stop', exact: true })
    .first()
    .waitFor({ state: 'detached', timeout: 15000 });
  await transcript().locator('[data-maka-tool-group] button[aria-expanded]').first().click();
  await toolRow.waitFor();
  findings.push({
    inputStream: true,
    namedAfterMs: namedAt - appearedAt,
    namedWhenSettled: await toolRow.getByText('fake-backend-demo.ts', { exact: false }).count(),
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
    if ('inputStream' in finding) {
      // The fixture spends about 1.9s writing the arguments; the naming key
      // closes in the first tenth of that.
      assert.ok(
        finding.namedAfterMs < 1000,
        `the row named the call after ${finding.namedAfterMs}ms, which is the whole argument stream: it was not following it`,
      );
      assert.equal(finding.namedWhenSettled, 1, 'and it still says so once the call settles');
    }
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
    'Streaming switch smoke passed: text keeps streaming, a pending question and finished steps survive leaving and returning mid-Turn, and a call names what it does while it is still being written.',
  );
} finally {
  console.log(JSON.stringify({ findings, errors }, null, 2));
  if (app) await closeElectronApplication(app);
  await rm(userDataDir, { recursive: true, force: true });
}
