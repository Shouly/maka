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

import { build } from 'esbuild';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { closeElectronApplication } from '../../../../../../scripts/electron-lifecycle.mjs';
const dir = await mkdtemp(join(tmpdir(), 'maka-core-regression-'));
let app;
try {
  await build({
    entryPoints: [
      new URL('../../bridge/__tests__/core-dialogue-fixture.tsx', import.meta.url).pathname,
    ],
    outfile: join(dir, 'fixture.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'dataurl' },
    plugins: [
      {
        name: 'crypto',
        setup(b) {
          b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: 'crypto', namespace: 'empty' }));
          b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({
            contents: 'export function createHash(){throw Error("unexpected hash")}',
            loader: 'js',
          }));
        },
      },
    ],
  });
  await writeFile(
    join(dir, 'index.html'),
    '<html><body><div id="root"></div><script type="module" src="./fixture.js"></script></body></html>',
  );
  await writeFile(
    join(dir, 'main.cjs'),
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(dir, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});w.loadFile(${JSON.stringify(join(dir, 'index.html'))});});`,
  );
  app = await electron.launch({ args: [join(dir, 'main.cjs')], timeout: 30000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const editor = page.getByLabel('Review editor', { exact: true });
  await editor.waitFor();
  await editor.press('End');
  await editor.press('Alt+Enter');
  assert.equal(
    await page.evaluate(
      () => window.reviewCore.calls.filter((x) => x[0] === 'editor-submit').length,
    ),
    0,
  );
  assert.ok((await editor.innerText()).includes('\n'));
  assert.equal(
    await page
      .locator('#markdown style')
      .evaluateAll((nodes) => nodes.some((node) => node.textContent.includes('.review-marker'))),
    false,
  );
  assert.notEqual(
    await page.locator('#outside-marker').evaluate((el) => getComputedStyle(el).color),
    'rgb(255, 0, 0)',
  );
  await page.locator('#markdown').getByRole('link', { name: 'email', exact: true }).click();
  await page.locator('#markdown').getByRole('link', { name: 'task', exact: true }).click();
  assert.deepEqual(
    await page.evaluate(() => window.reviewCore.calls.filter((x) => x[0] === 'internal')),
    [['internal', { kind: 'settings', section: 'models' }]],
  );
  assert.deepEqual(
    await page.evaluate(() => window.reviewCore.calls.filter((x) => x[0] === 'external')),
    [['external', 'mailto:test@example.com']],
  );
  await page.locator('[data-maka-contract=mermaid] svg').waitFor();
  await page.locator('#markdown img[alt=inline]').waitFor();
  assert.ok(
    (await page.locator('#markdown img[alt=inline]').getAttribute('src')).startsWith(
      'data:image/png;base64,',
    ),
  );
  const pending = page.locator('[data-transient-message-id=pending]');
  await pending.waitFor();
  assert.equal(await pending.getByRole('button', { name: 'Regenerate', exact: true }).count(), 0);
  assert.equal(await pending.getByRole('button', { name: 'Branch', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Copy', exact: true }).nth(1).click();
  assert.deepEqual(
    await page.evaluate(() => window.reviewCore.calls.filter((x) => x[0] === 'clipboard')),
    [['clipboard', 'Final answer.']],
  );
  const queue = page.locator('[data-maka-contract=message-queue]');
  await queue.getByRole('button', { name: 'Edit', exact: true }).click();
  await queue.locator('textarea').fill('my edit from revision one');
  await page.evaluate(() => window.reviewCore.bumpQueue());
  await queue.getByRole('button', { name: 'Save', exact: true }).click();
  await queue.locator('textarea').waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(() => window.reviewCore.calls.find((x) => x[0] === 'queue-edit')[3]),
    1,
  );
  await page.getByRole('button', { name: 'Edit and resend', exact: true }).first().click();
  await page.locator('textarea[aria-label="Edit and resend"]').fill('edited request');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => window.reviewCore.calls.some((x) => x[0] === 'revise'));
  await page.locator('textarea[aria-label="Edit and resend"]').press('Escape');
  await page.waitForFunction(() => window.reviewCore.draft() === undefined);
  await page.evaluate(() => window.reviewCore.releaseCopy());
  // Allow the released promise and store reactions to settle; no send may follow cancellation.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
  assert.equal(
    await page.evaluate(() => window.reviewCore.calls.filter((x) => x[0] === 'send').length),
    0,
  );
  await page.evaluate(() => window.reviewCore.earlyReply());
  await page.locator('#session').getByText('early assistant answer', { exact: true }).waitFor();
  const ordered = () =>
    page.locator('#session').evaluate((root) => {
      const user = [...root.querySelectorAll('[data-role="user"]')].find((node) =>
        node.textContent.includes('early user prompt'),
      );
      const assistant = root.querySelector('[data-maka-contract="markdown"]');
      return Boolean(
        user &&
          assistant &&
          user.compareDocumentPosition(assistant) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
  assert.equal(
    await ordered(),
    true,
    'the optimistic user prompt must precede the early assistant reply',
  );
  await page.evaluate(() => window.reviewCore.earlyReply(true));
  await page
    .locator('#session [data-transient-message-id="early-user"]')
    .waitFor({ state: 'detached' });
  assert.equal(await ordered(), true, 'the durable user prompt preserves the same order');
  assert.equal(await page.locator('#session [data-role="user"]').count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    'Core dialogue UI regression passed: Alt+Enter, HTML isolation, links, Mermaid, attachment image, transient actions, final-copy, queue revision, cancel-before-send, first-prompt/stream ordering.',
  );
} finally {
  if (app) await closeElectronApplication(app, 3000);
  await rm(dir, { recursive: true, force: true });
}
