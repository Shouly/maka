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

// The handoff wiring the main window depends on: who may answer, which
// revision an answer may name, what a view that cannot be shown becomes, and
// when the window is brought forward. startup-presentation imports Electron,
// so it is bundled and run against a stub, as workhub-presentation's test is.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { build } from 'esbuild';
import type { HostHandoffAction, HostHandoffView } from '@maka/runtime-host/client';
import type { DesktopStartupState } from '../../shared/desktop-startup.js';

type Presentation = typeof import('../startup-presentation.js');
type Handler = (event: { sender: unknown }, ...args: unknown[]) => unknown;

const source = fileURLToPath(new URL('../../../src/main/startup-presentation.ts', import.meta.url));
const bundled = build({
  entryPoints: [source],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  // Only the desktop's own files: packages load as themselves.
  packages: 'external',
});

/** A fresh module (its state is per process) wired to a fake main window. */
async function harness() {
  const output = await bundled;
  const module = { exports: {} as Presentation };
  const nodeRequire = createRequire(import.meta.url);
  runInNewContext(output.outputFiles[0]!.text, {
    module,
    exports: module.exports,
    console,
    // An automated run: no Dock branding, no startup menu.
    process: { ...process, env: { ...process.env, MAKA_E2E_FIXTURE: '1' } },
    URL,
    Error,
    TextEncoder,
    TextDecoder,
    Buffer,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    setImmediate,
    queueMicrotask,
    require: (name: string) =>
      name === 'electron' ? { app: { isPackaged: false } } : nodeRequire(name),
  });
  const presentation = module.exports;
  const handlers = new Map<string, Handler>();
  const main = { id: 'main' };
  const other = { id: 'workhub' };
  const pushes: DesktopStartupState[] = [];
  let focused = 0;
  presentation.connectDesktopStartup({
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
    send: (state: DesktopStartupState) => pushes.push(JSON.parse(JSON.stringify(state))),
    isMainWindow: (sender: unknown) => sender === main,
    focusMainWindow: () => {
      focused += 1;
    },
    visibleMainWindow: () => undefined,
  } as unknown as Parameters<Presentation['connectDesktopStartup']>[0]);
  const invoke = (channel: string, sender: unknown, ...args: unknown[]) =>
    handlers.get(channel)!({ sender }, ...args);
  return {
    presentation,
    main,
    other,
    pushes,
    focused: () => focused,
    answer: (revision: string, action: string, sender: unknown = main) =>
      invoke('startup:handoff', sender, revision, action) as boolean,
    read: (sender: unknown) => invoke('startup:state', sender) as DesktopStartupState,
    copy: (sender: unknown = main) => invoke('startup:copyDiagnostics', sender) as Promise<void>,
  };
}

const view = (revision: string, overrides: Partial<HostHandoffView> = {}): HostHandoffView => ({
  revision,
  target: { name: 'Local', location: 'local' },
  state: 'attention',
  reason: 'retry_required',
  mayExitNaturally: false,
  actions: ['cancel', 'retry'],
  defaultAction: 'cancel',
  ...overrides,
});

function surface(
  presentation: Presentation,
  resolveLocale: () => Promise<'en' | 'zh-CN'> = async () => 'en',
) {
  const answers: [string, HostHandoffAction][] = [];
  const open = presentation.createDesktopHostHandoffSurface(resolveLocale as never);
  const handle = open((revision, action) => answers.push([revision, action]));
  return { handle, answers };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('only the main window answers, only at the revision on screen, only with an offered action', async () => {
  const h = await harness();
  const { handle, answers } = surface(h.presentation);
  handle.update(view('r1'));
  await settle();
  assert.equal(h.pushes.at(-1)?.handoff?.revision, 'r1');
  assert.equal(h.focused(), 1, 'a decision brings the window forward');

  assert.equal(h.answer('r1', 'retry', h.other), false, 'another renderer view');
  assert.equal(h.answer('r0', 'retry'), false, 'a revision no longer on screen');
  assert.equal(h.answer('r1', 'interrupt'), false, 'an action it does not offer');
  assert.equal(h.answer('r1', 7 as never), false, 'not an action at all');
  assert.deepEqual(answers, []);
  assert.equal(h.answer('r1', 'retry'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(answers)), [['r1', 'retry']]);
});

test('an answer to a view the Host has already replaced is refused', async () => {
  const h = await harness();
  let wordNext: (locale: 'en') => void = () => {};
  let calls = 0;
  const { handle, answers } = surface(h.presentation, () => {
    calls += 1;
    return calls === 1 ? Promise.resolve('en') : new Promise((resolve) => (wordNext = resolve));
  });
  handle.update(view('r1'));
  await settle();
  handle.update(view('r2'));
  await settle();
  assert.equal(h.pushes.at(-1)?.handoff?.revision, 'r1', 'r2 is still being worded');
  assert.equal(h.answer('r1', 'retry'), false, 'the Host would drop it');
  wordNext('en');
  await settle();
  assert.equal(h.pushes.at(-1)?.handoff?.revision, 'r2');
  assert.equal(h.answer('r2', 'retry'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(answers)), [['r2', 'retry']]);
});

test('a view that cannot be worded is cancelled; one closed before it is worded never shows', async () => {
  const h = await harness();
  const broken = surface(h.presentation, async () => 'xx' as never);
  broken.handle.update(view('r1'));
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(broken.answers)), [['r1', 'cancel']]);

  const closed = surface(h.presentation);
  closed.handle.update(view('r2'));
  closed.handle.close();
  await settle();
  assert.equal(h.pushes.some((state) => state.handoff?.revision === 'r2'), false);
  assert.deepEqual(closed.answers, []);
});

test('when a decision closes, the next one waiting brings the window forward again', async () => {
  const h = await harness();
  const first = surface(h.presentation);
  const second = surface(h.presentation);
  first.handle.update(view('a1'));
  await settle();
  second.handle.update(view('b1'));
  await settle();
  assert.equal(h.pushes.at(-1)?.handoff?.revision, 'b1');
  const before = h.focused();
  second.handle.close();
  assert.equal(h.pushes.at(-1)?.handoff?.revision, 'a1', 'the first is still waiting');
  assert.equal(h.focused(), before + 1);
});

test('another renderer view reads the launch but never its handoff', async () => {
  const h = await harness();
  surface(h.presentation).handle.update(view('r1'));
  await settle();
  assert.equal(h.read(h.main).handoff?.revision, 'r1');
  assert.equal(h.read(h.other).handoff, undefined);
  assert.equal(h.read(h.other).ready, false);
});

test('copy diagnostics copies the handoff on screen, and the launch without one', async () => {
  const h = await harness();
  const copied: [string, string][] = [];
  h.presentation.beginDesktopStartup((phase, handoff) => {
    copied.push([phase, handoff?.revision ?? 'launch report']);
  });
  await h.copy();
  surface(h.presentation).handle.update(view('r1'));
  await settle();
  await h.copy();
  await h.copy(h.other);
  assert.deepEqual(JSON.parse(JSON.stringify(copied)), [
    ['prepare', 'launch report'],
    ['prepare', 'r1'],
  ]);
});

test('with no window to show them, the handoffs waiting at startup are cancelled', async () => {
  const h = await harness();
  const waiting = surface(h.presentation);
  waiting.handle.update(view('r1'));
  await settle();
  h.presentation.cancelDesktopStartupHandoffs();
  assert.deepEqual(JSON.parse(JSON.stringify(waiting.answers)), [['r1', 'cancel']]);

  h.presentation.markDesktopStartupReady();
  const later = surface(h.presentation);
  later.handle.update(view('r2'));
  await settle();
  h.presentation.cancelDesktopStartupHandoffs();
  assert.deepEqual(later.answers, [], 'after startup a closed window is not a dead end');
});
