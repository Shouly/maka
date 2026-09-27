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
import { test } from 'node:test';
import type { DesktopStartupState } from '../../shared/desktop-startup.js';
import {
  createDesktopStartupState,
  type DesktopStartupHandoffView,
} from '../desktop-startup-state.js';

const handoff = (overrides: Partial<DesktopStartupHandoffView> = {}): DesktopStartupHandoffView => ({
  revision: 'r1',
  state: 'attention',
  title: 'Update Runtime Host',
  description: 'Maka needs to replace the running service.',
  detail: '',
  actions: [
    { action: 'cancel', label: 'Cancel' },
    { action: 'replace', label: 'Replace' },
  ],
  ...overrides,
});

test('the launch moves through its phases until ready, and stays ready', () => {
  const startup = createDesktopStartupState(1_000);
  const seen: DesktopStartupState[] = [];
  startup.subscribe((state) => seen.push(state));
  assert.deepEqual(startup.state(), { ready: false, phase: 'prepare', startedAt: 1_000 });
  startup.update('storage');
  startup.update('storage');
  startup.update('connect');
  assert.deepEqual(
    seen.map((state) => state.phase),
    ['storage', 'connect'],
    'a repeated phase is not news',
  );
  startup.markReady();
  assert.deepEqual(startup.state(), { ready: true, phase: 'renderer', startedAt: 1_000 });
  // A later Host restart reports through its handoff, not by un-readying the app.
  startup.update('restart');
  assert.equal(startup.state().phase, 'renderer');
  assert.equal(startup.state().ready, true);
});

test('a handoff shows over the launch and answers only its own actions', () => {
  const startup = createDesktopStartupState(0);
  assert.deepEqual(startup.showHandoff('a', handoff({ state: 'progress', actions: [] })), {
    becameAttention: false,
  });
  assert.deepEqual(startup.showHandoff('a', handoff()), { becameAttention: true }, 'now it needs a decision');
  assert.deepEqual(startup.showHandoff('a', handoff({ revision: 'r2' })), { becameAttention: false });
  assert.equal(startup.answerable('r2', 'replace'), 'a');
  assert.equal(startup.answerable('r1', 'replace'), undefined, 'an answer to a revision no longer on screen');
  assert.equal(startup.answerable('r2', 'interrupt'), undefined, 'an action it does not offer');
  startup.clearHandoff('b');
  assert.equal(startup.state().handoff?.revision, 'r2', 'another owner closing leaves this one');
  startup.clearHandoff('a');
  assert.equal(startup.state().handoff, undefined);
  assert.equal(startup.answerable('r2', 'cancel'), undefined);
});

test('open handoffs wait their turn: a decision before progress, the next once one closes', () => {
  const startup = createDesktopStartupState(0);
  startup.showHandoff('a', handoff({ revision: 'a1' }));
  assert.deepEqual(
    startup.showHandoff('b', handoff({ revision: 'b1', state: 'progress', actions: [] })),
    { becameAttention: false },
  );
  assert.equal(startup.state().handoff?.revision, 'a1', 'progress does not cover a decision');
  assert.deepEqual(startup.showHandoff('b', handoff({ revision: 'b2' })), { becameAttention: true });
  assert.equal(startup.state().handoff?.revision, 'b2', 'the newest decision shows');
  assert.equal(startup.answerable('b2', 'replace'), 'b');
  assert.equal(startup.answerable('a1', 'replace'), undefined, 'a handoff not on screen');
  startup.clearHandoff('b');
  assert.equal(startup.state().handoff?.revision, 'a1', 'the one still waiting comes back');
  assert.equal(startup.answerable('a1', 'cancel'), 'a');
});

test('a handoff at work keeps one clock, stamped when its work began', () => {
  let clock = 1_000;
  const startup = createDesktopStartupState(0, () => clock);
  startup.showHandoff('a', handoff({ state: 'progress', actions: [] }));
  assert.equal(startup.state().handoff?.since, 1_000);
  clock = 5_000;
  startup.showHandoff('a', handoff({ revision: 'r2', state: 'progress', actions: [] }));
  assert.equal(startup.state().handoff?.since, 1_000, 'a later step of the same work');
  startup.showHandoff('a', handoff({ revision: 'r3' }));
  assert.equal(startup.state().handoff?.since, undefined, 'a decision has no clock');
  clock = 9_000;
  startup.showHandoff('a', handoff({ revision: 'r4', state: 'progress', actions: [] }));
  assert.equal(startup.state().handoff?.since, 9_000, 'work after the decision starts its own');
  startup.showHandoff('b', handoff({ revision: 'b1', state: 'progress', actions: [] }));
  assert.equal(startup.state().handoff?.owner, 'b');
  assert.equal(startup.state().handoff?.since, 9_000, 'each owner has its own clock');
});

test('an unchanged republish and a hidden handoff send nothing', () => {
  const startup = createDesktopStartupState(0);
  const seen: DesktopStartupState[] = [];
  startup.subscribe((state) => seen.push(state));
  startup.showHandoff('a', handoff());
  startup.showHandoff('a', handoff());
  assert.equal(seen.length, 1, 'the surface republishes while it waits');
  startup.showHandoff('b', handoff({ revision: 'b1', state: 'progress', actions: [] }));
  startup.showHandoff('b', handoff({ revision: 'b2', state: 'progress', actions: [] }));
  assert.equal(seen.length, 1, 'progress behind a decision is not on screen');
});

test('when a handoff closes, the next one waiting on a decision brings the window forward', () => {
  const startup = createDesktopStartupState(0);
  startup.showHandoff('a', handoff({ revision: 'a1' }));
  startup.showHandoff('b', handoff({ revision: 'b1' }));
  assert.deepEqual(startup.clearHandoff('b'), { becameAttention: true });
  assert.equal(startup.state().handoff?.owner, 'a');
  assert.deepEqual(startup.clearHandoff('a'), { becameAttention: false });
  assert.deepEqual(startup.clearHandoff('a'), { becameAttention: false }, 'already gone');
});
