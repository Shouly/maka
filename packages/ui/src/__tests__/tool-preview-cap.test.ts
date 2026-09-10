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
import { capLines, TOOL_LINE_CAP } from '../tool-activity/preview-utils.js';

const long = Array.from({ length: TOOL_LINE_CAP + 20 }, (_, index) => `line ${index}`).join('\n');

test('a capped block keeps the end the reader is actually watching', () => {
  const head = capLines(long, 'head');
  assert.equal(head.capped, 20);
  assert.equal(head.body.split('\n').length, TOOL_LINE_CAP);
  assert.equal(head.body.startsWith('line 0\n'), true);
  // A command's output is read at the bottom: the line that just arrived, and
  // the error it ended on. Keeping the head is what left a long run's panel
  // frozen on its opening banner.
  const tail = capLines(long, 'tail');
  assert.equal(tail.capped, 20);
  assert.equal(tail.body.split('\n').length, TOOL_LINE_CAP);
  assert.equal(tail.body.endsWith(`line ${TOOL_LINE_CAP + 19}`), true);
  assert.equal(tail.body.startsWith('line 20\n'), true);
});

test('a block under the cap is returned whole, either way', () => {
  const short = 'one\ntwo\nthree';
  for (const keep of ['head', 'tail'] as const) {
    assert.deepEqual(capLines(short, keep), { body: short, capped: 0 });
  }
});
