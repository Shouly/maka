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
import type { RuntimeEvent } from '../runtime-event.js';
import {
  rewriteRuntimeEventSavedOutputPaths,
  savedOutputPathMapRewrite,
  savedOutputPathRewrite,
} from '../saved-output-paths.js';

const FOLDER = '/state/tool-results/session-a';

test('a saved-output path is matched whole, and only in the folders given', () => {
  const rewrite = savedOutputPathRewrite([FOLDER], (path) => path.replace('session-a', 'b'));
  assert.equal(
    rewrite(`saved to ${FOLDER}/r-1.txt; read it.`),
    'saved to /state/tool-results/b/r-1.txt; read it.',
  );
  assert.equal(
    rewrite(`written to: ${FOLDER}/task_1.output. To check`),
    'written to: /state/tool-results/b/task_1.output. To check',
  );
  for (const untouched of [
    // Another Session's folder that starts with the same characters.
    '/state/tool-results/session-ab/r-1.txt',
    // A path that only ends in the folder.
    `/copy${FOLDER}/r-1.txt`,
    // A file deeper than the folder, or of another kind.
    `${FOLDER}/nested/r-1.txt`,
    `${FOLDER}/r-1.json`,
    `${FOLDER}/r-1.txtx`,
  ]) {
    assert.equal(rewrite(untouched), untouched, untouched);
  }
  const windows = savedOutputPathRewrite(['C:\\state\\tool-results\\s'], () => 'moved');
  assert.equal(windows('at C:\\state\\tool-results\\s\\r.txt.'), 'at moved.');

  const mapped = savedOutputPathMapRewrite(
    new Map([[`${FOLDER}/r-1.txt`, '/state/tool-results/b/r-1.txt']]),
  );
  assert.equal(
    mapped(`${FOLDER}/r-1.txt and ${FOLDER}/r-2.txt`),
    `/state/tool-results/b/r-1.txt and ${FOLDER}/r-2.txt`,
    'a path the map does not name stays',
  );
});

test("a RuntimeEvent's tool result, model view and text move; a tool call does not", () => {
  const path = `${FOLDER}/r-1.txt`;
  const rewrite = savedOutputPathRewrite([FOLDER], () => '/moved/r-1.txt');
  const base = {
    id: 'event',
    invocationId: 'invocation',
    runId: 'run',
    sessionId: 'session-a',
    turnId: 'turn',
    ts: 1,
    partial: false,
  } as const;
  const call: RuntimeEvent = {
    ...base,
    role: 'model',
    author: 'agent',
    content: { kind: 'function_call', id: 'call', name: 'Read', args: { file_path: path } },
  };
  assert.equal(rewriteRuntimeEventSavedOutputPaths(call, rewrite), call);

  const response: RuntimeEvent = {
    ...base,
    role: 'tool',
    author: 'tool',
    content: {
      kind: 'function_response',
      id: 'call',
      name: 'mcp__srv__fetch',
      result: { kind: 'json', value: { content: [{ type: 'text', text: `saved to ${path};` }] } },
      modelProjection: { version: 1, kind: 'content', parts: [{ kind: 'text', text: path }] },
    },
  };
  assert.deepEqual(rewriteRuntimeEventSavedOutputPaths(response, rewrite).content, {
    ...response.content,
    result: {
      kind: 'json',
      value: { content: [{ type: 'text', text: 'saved to /moved/r-1.txt;' }] },
    },
    modelProjection: {
      version: 1,
      kind: 'content',
      parts: [{ kind: 'text', text: '/moved/r-1.txt' }],
    },
  });

  const text: RuntimeEvent = {
    ...base,
    role: 'user',
    author: 'system',
    content: { kind: 'text', text: `<output-file>${path}</output-file>` },
  };
  assert.deepEqual(rewriteRuntimeEventSavedOutputPaths(text, rewrite).content, {
    kind: 'text',
    text: '<output-file>/moved/r-1.txt</output-file>',
  });
  const unrelated: RuntimeEvent = { ...text, content: { kind: 'text', text: 'nothing here' } };
  assert.equal(rewriteRuntimeEventSavedOutputPaths(unrelated, rewrite), unrelated);
});
