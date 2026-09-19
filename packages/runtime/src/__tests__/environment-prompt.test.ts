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
import { renderEnvironmentPromptFragment } from '../system-prompt/environment-prompt.js';

test('environment block names the workspace facts and omits what the host does not know', () => {
  const text = renderEnvironmentPromptFragment({
    cwd: '/work/app',
    platform: 'darwin',
    gitRepository: true,
    branch: 'main',
    shell: 'zsh',
    timeZone: 'Asia/Shanghai',
    now: new Date('2026-09-18T12:00:00Z'),
  });
  assert.equal(
    text,
    [
      'The assistant is Copilot.',
      '',
      'The current date is (provided in the conversation below).',
      '',
      "Copilot is currently operating in the Copilot desktop app, on the person's own computer.",
      '',
      "The user's timezone is Asia/Shanghai (UTC+08:00).",
      '',
      '<env>',
      'Primary working directory: /work/app',
      'Is a git repository: yes (branch main)',
      'Platform: macOS',
      'Shell: zsh',
      '</env>',
    ].join('\n'),
  );
  assert.doesNotMatch(text, /language/u);
  // No zone, no zone line — and an unknown zone name falls to UTC.
  assert.doesNotMatch(
    renderEnvironmentPromptFragment({ cwd: '/w', platform: 'darwin', gitRepository: false }),
    /timezone/u,
  );
  assert.match(
    renderEnvironmentPromptFragment({
      cwd: '/w',
      platform: 'darwin',
      gitRepository: false,
      timeZone: 'Mars/Olympus',
    }),
    /The user's timezone is UTC \(UTC\+00:00\)\./u,
  );
});

test('unknown platforms pass through and Windows gets its label', () => {
  assert.match(
    renderEnvironmentPromptFragment({ cwd: 'C:\\\\work', platform: 'win32', gitRepository: false }),
    /Platform: Windows/u,
  );
  assert.match(
    renderEnvironmentPromptFragment({ cwd: '/w', platform: 'freebsd', gitRepository: false }),
    /Platform: freebsd/u,
  );
});
