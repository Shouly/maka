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

// The launch inside the main window: how much it says as the wait grows, the
// handoff over everything, and the store's read-versus-push order.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { LocaleProvider } from '@maka/ui';
import { UI_LOCALES } from '@maka/core/ui-locale';
import type {
  DesktopStartupHandoff,
  DesktopStartupState,
} from '../../../shared/desktop-startup.js';
import {
  handoffDialogGuards,
  StartupHandoffCard,
  type StartupHandoffProps,
  StartupLoading,
} from '../../components/startup/StartupScreens.js';
import {
  formatStartupElapsed,
  STARTUP_QUIET_MS,
  STARTUP_SLOW_MS,
  createHandoffAnswerGuard,
  HANDOFF_ANSWER_GRACE_MS,
  startupHoldsApp,
  startupStage,
  startupWaitSince,
} from '../../lib/startup-view.js';
import { getStartupCopy } from '../../locales/startup-copy.js';
import { createStartupStore } from '../startup-store.js';

function render(node: ReactElement) {
  return parseHTML(
    renderToStaticMarkup(createElement(LocaleProvider, { locale: 'en', children: node })),
  ).document;
}

const text = (document: Document) => document.documentElement?.textContent ?? '';
const en = getStartupCopy('en');
const noCopy = async () => {};

test('the wait says nothing at first, the step once noticeable, and why once long', () => {
  assert.equal(startupStage(0), 'quiet');
  assert.equal(startupStage(STARTUP_QUIET_MS - 1), 'quiet');
  assert.equal(startupStage(STARTUP_QUIET_MS), 'working');
  assert.equal(startupStage(STARTUP_SLOW_MS), 'slow');
  assert.equal(formatStartupElapsed(75_400), '1:15');

  const quiet = render(
    createElement(StartupLoading, { phase: 'connect', elapsedMs: 500, onCopyDiagnostics: noCopy }),
  );
  assert.equal(text(quiet), '', 'a short wait only shows the window');
  // The live region is there from the first paint, so the step is read out
  // when it arrives; nothing marks the surface busy, which would mute it.
  assert.equal(
    quiet.querySelector('[data-maka-contract="startup-loading"] [role="status"]')?.textContent,
    '',
  );
  assert.equal(quiet.querySelector('[aria-busy]'), null);

  const working = render(
    createElement(StartupLoading, {
      phase: 'connect',
      elapsedMs: 3_000,
      onCopyDiagnostics: noCopy,
    }),
  );
  // (The status also holds the spinner, an icon-font glyph.)
  assert.ok(working.querySelector('[role="status"]')?.textContent?.includes(en.phases.connect));
  assert.equal(working.querySelectorAll('button').length, 0);
  assert.ok(!text(working).includes(en.slow));

  const slow = render(
    createElement(StartupLoading, {
      phase: 'staging',
      elapsedMs: 12_000,
      onCopyDiagnostics: noCopy,
    }),
  );
  assert.ok(text(slow).includes(en.phases.staging));
  assert.ok(text(slow).includes(en.slow));
  assert.ok(text(slow).includes(en.elapsed('0:12')));
  assert.equal(slow.querySelector('button')?.textContent, en.copyDiagnostics);
});

test('the app is held until the launch is ready, and while it is unknown', () => {
  assert.equal(startupHoldsApp(undefined), true);
  assert.equal(startupHoldsApp({ ready: false, phase: 'connect', startedAt: 0 }), true);
  assert.equal(startupHoldsApp({ ready: true, phase: 'renderer', startedAt: 0 }), false);
});

test('a wait counts from the launch, or from a gate that mounted after a sign-in', () => {
  const launch = 1_000;
  const page = 9_000; // main took 8 s before the window existed: part of the wait
  assert.equal(startupWaitSince(undefined, page, page), undefined, 'no launch read yet');
  assert.equal(startupWaitSince(launch, page + 300, page), launch, 'mounted with its page');
  assert.equal(
    startupWaitSince(launch, page + 60_000, page),
    page + 60_000,
    'mounted a minute into its page: after a sign-in',
  );
});

test('a handoff takes one answer per view, and none in the moment a view appears', () => {
  let now = 0;
  const guard = createHandoffAnswerGuard(() => now);
  guard.show('r1');
  assert.equal(guard.take(), false, 'the press that opened it is not an answer');
  now += HANDOFF_ANSWER_GRACE_MS;
  assert.equal(guard.take(), true);
  assert.equal(guard.take(), false, "a double click's second half");
  guard.show('r1');
  assert.equal(guard.take(), false, 'the same view again is still answered');
  guard.show('r2');
  now += 100;
  assert.equal(guard.take(), false, 'Cancel landing under the pointer as progress appears');
  now += HANDOFF_ANSWER_GRACE_MS;
  assert.equal(guard.take(), true);
  guard.release();
  assert.equal(guard.take(), true, 'an answer that did not land can be given again');
});

test('the dialog is closed only by its actions, and keys pressed in it stay in it', () => {
  let prevented = 0;
  let stopped = 0;
  let focused = 0;
  const event = { preventDefault: () => (prevented += 1) } as unknown as Event;
  handoffDialogGuards.onOpenAutoFocus(event, {
    focus: () => (focused += 1),
  } as unknown as HTMLElement);
  assert.deepEqual([prevented, focused], [1, 1], 'focus goes to the dialog, not to a button');
  handoffDialogGuards.onEscapeKeyDown(event as KeyboardEvent);
  handoffDialogGuards.onInteractOutside(event);
  assert.equal(prevented, 3, 'neither Escape nor a click outside closes it');
  handoffDialogGuards.onKeyDown({ stopPropagation: () => (stopped += 1) });
  assert.equal(stopped, 1, "the shell's shortcuts do not act beneath it");
});

// One root element: the card is a fragment, and the parsed document is its first node.
const renderCard = (props: StartupHandoffProps) =>
  render(
    createElement(
      'div',
      null,
      createElement(DialogPrimitive.Root, { open: true }, createElement(StartupHandoffCard, props)),
    ),
  );

test('a handoff waiting on a decision offers its actions, with Stop marked destructive', () => {
  const handoff: DesktopStartupHandoff = {
    owner: '1',
    revision: 'r1',
    state: 'attention',
    title: 'Replace the running Runtime Host?',
    description: 'A task is still running.',
    detail: 'Local: 1.2.0 → 1.3.0',
    diagnostic: 'pid 4242 busy',
    actions: [
      { action: 'cancel', label: 'Not now' },
      { action: 'interrupt', label: 'Stop and replace' },
    ],
  };
  const document = renderCard({
    handoff,
    elapsedMs: 0,
    onAction: () => {},
    onCopyDiagnostics: noCopy,
  });
  assert.equal(document.querySelector('h2')?.textContent, handoff.title);
  for (const expected of [handoff.description, handoff.detail, handoff.diagnostic!]) {
    assert.ok(text(document).includes(expected), expected);
  }
  const buttons = Array.from(document.querySelectorAll('button'));
  assert.deepEqual(
    buttons.map((button) => button.textContent),
    [en.copyDiagnostics, 'Not now', 'Stop and replace'],
  );
  assert.ok(buttons[2]?.className.includes('ui-control-squish-danger'));
  // No button takes focus on its own (the dialog's own focus is handoffDialogGuards').
  assert.equal(document.querySelector('[autofocus]'), null);
  // The detail is part of the description a screen reader reads with the title.
  assert.ok(document.querySelector('h2 + div')?.textContent?.includes(handoff.detail));
  assert.equal(
    document.querySelector('[role="timer"], [role="status"]'),
    null,
    'a decision has no clock',
  );

  const progress = renderCard({
    handoff: { ...handoff, state: 'progress', since: 0, actions: [] },
    elapsedMs: 5_000,
    onAction: () => {},
    onCopyDiagnostics: noCopy,
  });
  // A timer, not a live region: it would be read out every second.
  assert.equal(progress.querySelector('[role="timer"]')?.textContent, en.elapsed('0:05'));
  assert.equal(progress.querySelector('[role="status"]'), null);
  // Each step of the work is announced as its words change.
  assert.equal(
    progress.querySelector('[aria-live="polite"]')?.textContent?.includes(handoff.description),
    true,
  );
});

test('every step and line of the launch has words in every locale', () => {
  for (const locale of UI_LOCALES) {
    const copy = getStartupCopy(locale);
    for (const [phase, words] of Object.entries(copy.phases))
      assert.ok(words.trim(), `${locale} ${phase}`);
    assert.ok(copy.slow && copy.copyDiagnostics && copy.copied && copy.copyFailed, locale);
    assert.ok(copy.elapsed('0:03').includes('0:03'), locale);
  }
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A bridge whose reads are answered by hand, in whatever order a test likes. */
function manualBridge() {
  const answers: ((state: DesktopStartupState) => void)[] = [];
  let push: (state: DesktopStartupState) => void = () => {};
  return {
    answers,
    push: (state: DesktopStartupState) => push(state),
    bridge: {
      getStartupState: () => new Promise<DesktopStartupState>((resolve) => answers.push(resolve)),
      subscribeStartup: (handler: (state: DesktopStartupState) => void) => {
        push = handler;
        return () => {
          push = () => {};
        };
      },
    },
  };
}

const connecting: DesktopStartupState = { ready: false, phase: 'connect', startedAt: 1 };
const ready: DesktopStartupState = { ready: true, phase: 'renderer', startedAt: 1 };

test('the store reads once, and a push newer than its read wins', async () => {
  const manual = manualBridge();
  const store = createStartupStore(manual.bridge);
  const stop = store.start();
  assert.equal(store.getState().startup, undefined, 'unknown until something lands');
  await tick();
  assert.equal(manual.answers.length, 1, 'one read');
  manual.push(ready);
  manual.answers[0]!(connecting);
  await tick();
  assert.equal(store.getState().startup?.ready, true, 'the older read does not undo the push');
  stop();

  // With no push before it, the read is the launch.
  const quiet = manualBridge();
  const read = createStartupStore(quiet.bridge);
  read.start();
  await tick();
  quiet.answers[0]!(connecting);
  await tick();
  assert.equal(read.getState().startup?.phase, 'connect');
});

test("a restarted store (StrictMode) ignores the first start's late read", async () => {
  const manual = manualBridge();
  const store = createStartupStore(manual.bridge);
  store.start()();
  store.start();
  await tick();
  assert.equal(manual.answers.length, 2);
  manual.answers[1]!(connecting);
  manual.answers[0]!(ready);
  await tick();
  assert.equal(store.getState().startup?.ready, false, 'the stopped start said nothing');
});

test('an unreadable launch does not hold the app forever', async () => {
  const broken = createStartupStore({
    getStartupState: () => Promise.reject(new Error('no bridge')),
    subscribeStartup: () => () => {},
  });
  broken.start();
  await tick();
  assert.equal(broken.getState().startup?.ready, true);
});
