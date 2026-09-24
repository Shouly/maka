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

import { _electron as electron } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { closeElectronApplication } from '../../../../../../scripts/electron-lifecycle.mjs';
const root = await mkdtemp(join(tmpdir(), 'maka-prompt-ui-'));
let app;
try {
  await build({
    entryPoints: [
      fileURLToPath(
        new URL('../../bridge/__tests__/composer-prompts-fixture.tsx', import.meta.url),
      ),
    ],
    outfile: join(root, 'fixture.js'),
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    // Match Vite's browser externalization; fail if a Node-only hash reaches this UI test.
    plugins: [
      {
        name: 'browser-crypto-boundary',
        setup(build) {
          build.onResolve({ filter: /^node:crypto$/ }, () => ({
            path: 'crypto',
            namespace: 'browser-external',
          }));
          build.onLoad({ filter: /.*/, namespace: 'browser-external' }, () => ({
            contents:
              'export function createHash(){ throw new Error("Node hashing reached a renderer"); }',
            loader: 'js',
          }));
        },
      },
    ],
  });
  await writeFile(
    join(root, 'index.html'),
    '<html><body><div id="root"></div><script type="module" src="./fixture.js"></script></body></html>',
  );
  await writeFile(
    join(root, 'main.cjs'),
    `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(root, 'profile'))});app.whenReady().then(()=>{const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});window.loadFile(${JSON.stringify(join(root, 'index.html'))});});`,
  );
  app = await electron.launch({ args: [join(root, 'main.cjs')], timeout: 30000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  await page.waitForFunction(() => !!window.promptFixture);
  const show = async (request) => {
    await page.evaluate((request) => window.promptFixture.show(request), {
      id: 'event',
      turnId: 'turn',
      ts: 1,
      toolUseId: 'tool',
      ...request,
    });
  };
  const panel = page.locator('[data-maka-contract="interaction-prompt"]');
  await show({
    type: 'client_capability_request',
    requestId: 'cap',
    capability: 'browser',
    scope: { kind: 'browser_origin', origin: 'https://example.com' },
  });
  await panel.getByRole('button', { name: 'Allow for this task', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  await show({
    type: 'sandbox_boundary_request',
    requestId: 'sandbox',
    justification: 'Read the test folder',
    expansion: {
      filesystem: { entries: [{ path: '/tmp/read-only', access: 'read', scope: 'subtree' }] },
    },
  });
  await panel.getByRole('button', { name: 'Decline', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  // Only the Host's own home becomes `~`; another account's folder or
  // /Users/Shared is a different target and keeps its whole path. And Esc
  // declines even though the shell's hotkeys claim every Escape first.
  await show({
    type: 'sandbox_boundary_request',
    requestId: 'sandbox-esc',
    justification: 'Compare the folders',
    expansion: {
      filesystem: {
        entries: [
          { path: '/Users/tester/Desktop', access: 'read', scope: 'subtree' },
          { path: '/Users/Shared/project', access: 'write', scope: 'subtree' },
          { path: '/Users/another/project', access: 'read', scope: 'subtree' },
        ],
      },
    },
  });
  await panel.getByText('~/Desktop', { exact: false }).first().waitFor();
  const shownPaths = (await panel.textContent()) ?? '';
  assert.ok(shownPaths.includes('/Users/Shared/project'), shownPaths);
  assert.ok(shownPaths.includes('/Users/another/project'), shownPaths);
  assert.ok(!shownPaths.includes('~/project'), shownPaths);
  // Typed in a text field, neither key answers the card: ⌘↵ there belongs to
  // what is being written, and a grant must never be its side effect.
  await page.getByLabel('Fixture field').focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(await panel.count(), 1, 'the card is still waiting for an answer');
  await panel.getByRole('button', { name: 'Decline', exact: true }).focus();
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  await show({
    type: 'form_request',
    requestId: 'form',
    message: 'Configure this run',
    requester: { name: 'Test tool' },
    fields: [
      { name: 'count', label: 'Count', kind: 'integer', minimum: 1, maximum: 3, required: true },
      { name: 'enabled', label: 'Enabled', kind: 'boolean', required: true },
      { name: 'optional', label: 'Optional', kind: 'string', required: false },
    ],
  });
  assert.equal(await panel.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true);
  await panel.getByLabel('Count', { exact: false }).fill('2');
  await page.evaluate(() => window.promptFixture.failNext());
  await panel.getByRole('button', { name: 'Submit', exact: true }).click();
  await panel.getByRole('alert').waitFor();
  assert.equal(await panel.getByLabel('Count', { exact: false }).inputValue(), '2');
  await panel.getByRole('button', { name: 'Submit', exact: true }).click();
  await panel.waitFor({ state: 'detached' });
  const responses = await page.evaluate(() => window.promptFixture.submissions);
  assert.deepEqual(responses, [
    { kind: 'capability', response: { requestId: 'cap', decision: 'allow' } },
    { kind: 'sandbox', response: { requestId: 'sandbox', decision: 'deny' } },
    { kind: 'sandbox', response: { requestId: 'sandbox-esc', decision: 'deny' } },
    {
      kind: 'form',
      response: { requestId: 'form', action: 'accept', values: { count: 2, enabled: false } },
    },
  ]);
  console.log(
    'Prompt UI smoke passed: capability, sandbox, home-path display, Esc under shell hotkeys, typed form, absent optionals, failure and retry.',
  );
} finally {
  if (app) await closeElectronApplication(app, 3000);
  await rm(root, { recursive: true, force: true });
}
