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
import { renderEnvironmentContext } from '../system-prompt/environment-prompt.js';

test("the environment block is the design's # Environment, with the model line under it", () => {
  const text = renderEnvironmentContext({
    cwd: '/work/app',
    gitRepository: true,
    platform: 'darwin',
    shell: '/bin/sh',
    osVersion: 'Darwin 25.0.0',
    tmpDir: '/tmp',
    timeZone: 'Asia/Shanghai',
    now: new Date('2026-09-18T12:00:00Z'),
    model: { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5' },
    knowledgeCutoff: '2026-06',
  });
  assert.equal(
    text,
    [
      '# Environment',
      'You have been invoked in the following environment:',
      ' - Primary working directory: /work/app',
      ' - Is a git repository: true',
      ' - Platform: darwin',
      ' - Shell: /bin/sh',
      ' - OS Version: Darwin 25.0.0',
      ' - Temporary directory for scratch files: /tmp',
      ' - Time zone: Asia/Shanghai (UTC+08:00)',
      '',
      'You are powered by the model named Claude Opus 5.5. The exact model ID is claude-opus-5-5. Assistant knowledge cutoff is June 2026.',
    ].join('\n'),
  );
});

test('what the host does not know is said as unknown or left out, never invented', () => {
  const bare = renderEnvironmentContext({ cwd: '/w', gitRepository: false, platform: 'linux' });
  assert.equal(
    bare,
    [
      '# Environment',
      'You have been invoked in the following environment:',
      ' - Primary working directory: /w',
      ' - Is a git repository: false',
      ' - Platform: linux',
      ' - Shell: unknown',
    ].join('\n'),
  );
  // A model without a name of its own is named by its id; an unknown zone reads as UTC.
  const unnamed = renderEnvironmentContext({
    cwd: '/w',
    gitRepository: false,
    platform: 'win32',
    timeZone: 'Mars/Olympus',
    model: { id: 'gpt-6' },
  });
  assert.match(unnamed, / - Time zone: UTC \(UTC\+00:00\)/u);
  assert.match(unnamed, /\n\nYou are powered by the model gpt-6\.$/u);
});
