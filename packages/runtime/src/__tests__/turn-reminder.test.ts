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
import test from 'node:test';
import { renderTurnReminder } from '../system-prompt/turn-reminder.js';

const now = new Date('2026-09-13T14:05:00Z');

test('reminder carries the date, model, permission mode and boundary', () => {
  const text = renderTurnReminder({
    now,
    timeZone: 'Asia/Shanghai',
    modelId: 'claude-opus-5',
    permissionMode: 'ask',
    collaborationMode: 'plan',
    executionBoundary: { kind: 'managed', revision: 3, profile: 'workspace-write' } as never,
  });
  assert.match(text, /^<system-reminder>\n/u);
  assert.match(text, /Today is Sunday, September 13, 2026 at 10:05 PM GMT\+8\./u);
  assert.match(text, /serving this turn is claude-opus-5/u);
  assert.match(text, /Permission mode: ask, workspace-write/u);
  assert.match(text, /Plan mode is active/u);
  assert.match(text, /managed, revision 3/u);
  assert.match(text, /<\/system-reminder>$/u);
});

test('reminder omits what the host does not know and never invents a mode', () => {
  const text = renderTurnReminder({ now });
  assert.equal(text.split('\n').length, 4);
  assert.doesNotMatch(text, /Permission mode|serving this turn|Sandbox boundary/u);
});

test('bypass names the absence of a sandbox', () => {
  const text = renderTurnReminder({
    now,
    permissionMode: 'bypass',
    executionBoundary: { kind: 'bypass', revision: 1 } as never,
  });
  assert.match(text, /Permission mode: bypass, full access/u);
  assert.match(text, /Sandbox boundary: bypass/u);
});
