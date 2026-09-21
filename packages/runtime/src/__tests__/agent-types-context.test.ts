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
import { describe, test } from 'node:test';
import { renderAgentTypesPromptFragment } from '../agent-types-context.js';
import { listBuiltinAgentDefinitions } from '../agent-catalog.js';
import { buildBuiltinTools } from '../builtin-tools.js';
import {
  purgeSessionShellRunOutputFiles,
  shellRunOutputFilePath,
} from '../shell-run-output-file.js';

describe('the agent types a Session is told it can launch', () => {
  test('names each runnable type, what it is for, and what it can use', () => {
    const definitions = listBuiltinAgentDefinitions({
      tools: buildBuiltinTools({}),
      worktreeChildExecutorAvailable: false,
    });
    const text = renderAgentTypesPromptFragment({ definitions, presets: [] });
    assert.ok(text);
    assert.match(text, /^Available agent types for the Agent tool:\n/u);
    assert.match(text, /\n- local_read: [^\n]*\(Tools: Glob, Grep, Read\)/u);
    assert.match(text, /run at the same time\.$/u);
    // A profile this composition cannot run is not offered.
    assert.doesNotMatch(text, /\n- implementation:/u);
  });

  test('a user preset is offered by the id Agent takes', () => {
    const text = renderAgentTypesPromptFragment({
      definitions: [],
      presets: [
        {
          id: 'preset-1',
          name: 'Docs reader',
          description: 'Reads   the   docs',
          profile: 'local_read',
          model: 'some-model',
          availability: { status: 'available' },
        } as never,
        {
          id: 'preset-2',
          name: 'Disabled',
          description: 'Not runnable',
          profile: 'local_read',
          model: 'some-model',
          availability: { status: 'unavailable', reason: 'disabled' },
        } as never,
      ],
    });
    assert.ok(text);
    assert.match(text, /\n- preset-1: Reads the docs \(Docs reader\)/u);
    assert.doesNotMatch(text, /preset-2/u);
  });

  test('a Session that can launch nothing is told nothing', () => {
    assert.equal(renderAgentTypesPromptFragment({ definitions: [], presets: [] }), undefined);
  });
});

describe('where a task output file is allowed to live', () => {
  test('a Session id or task id that could leave the root is refused', async () => {
    for (const bad of ['../escape', 'a/b', '', '.', 'x'.repeat(129)]) {
      assert.throws(() => shellRunOutputFilePath('/root', bad, 'sr_1'), /Unsafe Session id/u);
      assert.throws(() => shellRunOutputFilePath('/root', 'session-1', bad), /Unsafe task id/u);
      // Awaited: the purge refuses before it deletes anything, and an
      // un-awaited assertion would let a regression through as nothing more
      // than a stray rejection.
      await assert.rejects(
        () => purgeSessionShellRunOutputFiles('/root', bad),
        /Unsafe Session id/u,
      );
    }
    assert.equal(
      shellRunOutputFilePath('/root', 'session-1', 'sr_1'),
      '/root/session-1/sr_1.output',
    );
  });
});
