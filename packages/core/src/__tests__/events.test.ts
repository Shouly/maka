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
import {
  aggregateMessageContents,
  decodeToolStepProgress,
  encodeToolStepProgress,
  TOOL_INPUT_DELTA_MAX_CHARS,
  TOOL_INPUT_PREVIEW_MAX_CHARS,
} from '../events.js';

test('aggregates inline references against the combined display text', () => {
  assert.deepStrictEqual(
    aggregateMessageContents([
      {
        text: 'Alpha, expanded for the model\n\nFirst',
        displayText: '/alpha First',
        inlineReferences: [{ kind: 'skill', value: '/alpha', label: 'Alpha', start: 0 }],
      },
      {
        text: 'Beta, expanded for the model\n\nSecond',
        displayText: '/beta Second',
        inlineReferences: [{ kind: 'skill', value: '/beta', label: 'Beta', start: 0 }],
      },
    ]),
    {
      text: 'Alpha, expanded for the model\n\nFirst\n\nBeta, expanded for the model\n\nSecond',
      displayText: '/alpha First\n\n/beta Second',
      inlineReferences: [
        { kind: 'skill', value: '/alpha', label: 'Alpha', start: 0 },
        { kind: 'skill', value: '/beta', label: 'Beta', start: 14 },
      ],
    },
  );
});

test('preserves an explicit empty inline-reference marker while aggregating', () => {
  assert.deepStrictEqual(aggregateMessageContents([{ text: 'plain', inlineReferences: [] }]), {
    text: 'plain',
    inlineReferences: [],
  });
});

test('round-trips bounded tool step progress through the shared wire codec', () => {
  const encoded = encodeToolStepProgress({ current: 1, total: 2 });

  assert.strictEqual(encoded, 'steps:1/2');
  assert.deepStrictEqual(decodeToolStepProgress(encoded!), { current: 1, total: 2 });
  assert.deepStrictEqual(
    decodeToolStepProgress(
      encodeToolStepProgress({
        current: Number.MAX_SAFE_INTEGER,
        total: Number.MAX_SAFE_INTEGER,
      })!,
    ),
    {
      current: Number.MAX_SAFE_INTEGER,
      total: Number.MAX_SAFE_INTEGER,
    },
  );
});

test('rejects invalid tool step progress at both codec boundaries', () => {
  for (const progress of [
    { current: -1, total: 2 },
    { current: 1, total: 0 },
    { current: 3, total: 2 },
    { current: 0.5, total: 2 },
    { current: Number.MAX_SAFE_INTEGER + 1, total: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.strictEqual(encodeToolStepProgress(progress), undefined);
  }

  for (const chunk of [
    'working',
    'steps:-1/2',
    'steps:1/0',
    'steps:3/2',
    'steps:0.5/2',
    'steps:9007199254740992/9007199254740992',
  ]) {
    assert.strictEqual(decodeToolStepProgress(chunk), undefined);
  }
  assert.strictEqual(decodeToolStepProgress({ kind: 'stdout', text: 'steps:1/2' }), undefined);
});

// The wire bound on an argument fragment is derived from the reading bound
// (`SESSION_TOOL_INPUT_DELTA_MAX_BYTES`), on the grounds that nothing past what
// a reader keeps is ever sent. That holds only while the Runtime's split size
// stays under it — raise it above and the decoder starts rejecting fragments,
// which kills the subscription rather than degrading it.
test('a split argument fragment can never exceed what a reader keeps', () => {
  assert.ok(TOOL_INPUT_DELTA_MAX_CHARS <= TOOL_INPUT_PREVIEW_MAX_CHARS);
});
