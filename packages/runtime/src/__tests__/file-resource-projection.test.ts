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
import type { AttachmentRef, ToolResultContent } from '@maka/core/events';
import type { RuntimeEvent } from '@maka/core/runtime-event';
import { AiSdkMessageProjection } from '../ai-sdk-message-projection.js';
import { ModelAdapter } from '../model-adapter.js';
import { renderChildAgentNotification } from '../injection/task-notification.js';
import { buildSubagentOutputTool } from '../subagent-tools.js';
import { collectConversationCopyTaskOutputIds } from '../conversation-copy.js';
import { buildRuntimeEventModelReplayPlan, formatTextWithInlineRefs } from '../model-history.js';
import {
  notificationFileBindings,
  projectFileResourcePaths,
  toolResultFileBindings,
  type ModelFilePathResolver,
} from '../file-resource-projection.js';

const available = (path: string) => ({
  ok: true as const,
  file: { path, name: path.split(/[\\/]/u).at(-1)!, source: 'user_delivery', sizeBytes: 14 },
  readOnly: true,
});
const ref = 'maka://runtime/attachments/report';
const storedRef = { kind: 'session_file' as const, sessionId: 'source', relativePath: 'report' };
const attachment: AttachmentRef = {
  kind: 'code',
  name: 'report.json',
  mimeType: 'application/json',
  bytes: 14,
  ref: storedRef,
};
const modelAdapter = new ModelAdapter({
  connection: { slug: 'test', providerType: 'openai', defaultModel: 'gpt-6-astra' },
  apiKey: 'unused',
  modelId: 'gpt-6-astra',
  modelFactory: () => ({}),
  newId: () => 'id',
  now: () => 1,
});
const projection = (resolveFilePath: ModelFilePathResolver) =>
  new AiSdkMessageProjection({ modelAdapter, applyPatchProfile: null, resolveFilePath });
function event(
  id: string,
  content: RuntimeEvent['content'],
  role: RuntimeEvent['role'],
  author: RuntimeEvent['author'],
): RuntimeEvent {
  return {
    id,
    sessionId: 'source',
    invocationId: 'invocation',
    runId: 'run',
    turnId: 'turn',
    ts: 1,
    partial: false,
    role,
    author,
    content,
  };
}

test('current and replayed attachments expose current execution paths, never commit paths into attachment identities', async () => {
  const content = { kind: 'text' as const, text: 'Inspect this', attachments: [attachment] };
  const original = JSON.stringify(content);
  const events = [event('user', content, 'user', 'user')];
  const plan = buildRuntimeEventModelReplayPlan(events);
  const calls: unknown[] = [];
  for (const root of ['/source/execution', '/branch/execution', '/imported/execution']) {
    const resolver: ModelFilePathResolver = async (resource) => {
      calls.push({ resource });
      return available(`${root}/report.json`);
    };
    const presenter = projection(resolver);
    const current = await presenter.appendImageParts(
      formatTextWithInlineRefs(content),
      content.attachments,
    );
    const replayed = await presenter.materializeRuntimeReplayPlan(plan, undefined, new Set());
    for (const value of [current, replayed]) {
      assert.ok(JSON.stringify(value).includes(`${root}/report.json`));
      assert.ok(JSON.stringify(value).includes('file_path'));
      assert.doesNotMatch(JSON.stringify(value), /maka:\/\/runtime\/attachments/);
    }
  }
  assert.equal(JSON.stringify(content), original);
  assert.deepEqual(
    calls,
    Array.from({ length: 6 }, () => ({ resource: ref })),
  );
});

test('durable tool receipts rebind on replay while historical call arguments and assistant prose remain untouched', async () => {
  const result: ToolResultContent = {
    kind: 'terminal',
    cwd: '/old',
    cmd: 'build',
    status: 'completed',
    exitCode: 0,
    output: {
      mode: 'pipes',
      stdout: 'preview',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      redacted: false,
    },
    savedOutput: { ref, chars: 12000, truncated: false },
  };
  const events = [
    event(
      'call',
      {
        kind: 'function_call',
        id: 'call',
        name: 'Bash',
        args: { command: 'cat /old/path/report.json' },
      },
      'model',
      'agent',
    ),
    event(
      'result',
      {
        kind: 'function_response',
        id: 'call',
        name: 'Bash',
        result,
        isError: false,
        modelProjection: { version: 1, kind: 'text', text: `Full output: ${ref}` },
      },
      'tool',
      'tool',
    ),
    event('answer', { kind: 'text', text: 'I used /old/path/report.json' }, 'model', 'agent'),
  ];
  const before = JSON.stringify(events);
  const messages = await projection(async () =>
    available('/current/report.json'),
  ).materializeRuntimeReplayPlan(buildRuntimeEventModelReplayPlan(events), undefined, new Set());
  const toolMessage = messages.find((message) => message.role === 'tool');
  assert.match(JSON.stringify(toolMessage), /\/current\/report.json/);
  assert.doesNotMatch(JSON.stringify(toolMessage), /maka:\/\/runtime\/attachments/);
  assert.match(JSON.stringify(messages), /cat \/old\/path\/report.json/);
  assert.match(JSON.stringify(messages), /I used \/old\/path\/report.json/);
  assert.equal(JSON.stringify(events), before);
});

test('projection-only media dependencies also receive file paths', async () => {
  const events = [
    event(
      'call',
      { kind: 'function_call', id: 'call', name: 'ImageTool', args: {} },
      'model',
      'agent',
    ),
    event(
      'result',
      {
        kind: 'function_response',
        id: 'call',
        name: 'ImageTool',
        result: { kind: 'json', value: {} },
        isError: false,
        modelProjection: {
          version: 1,
          kind: 'content',
          parts: [{ kind: 'artifact', mediaType: 'image/png', ref: storedRef }],
        },
      },
      'tool',
      'tool',
    ),
  ];
  const messages = await projection(async () =>
    available('/current/report.png'),
  ).materializeRuntimeReplayPlan(buildRuntimeEventModelReplayPlan(events), undefined, new Set());
  assert.match(JSON.stringify(messages), /\/current\/report.png/);
});

test('request preparation supplies file metadata without a discovery tool or model-facing identity', async () => {
  const result: ToolResultContent = { kind: 'text', text: 'Saved output', fileRefs: [ref] };
  const output = await projectFileResourcePaths(
    { type: 'text', value: result.text },
    toolResultFileBindings(result),
    async () => available('/imported/report.json'),
  );
  assert.match(JSON.stringify(output), /\/imported\/report.json/);
  assert.match(JSON.stringify(output), /file_path|readOnly/);
  assert.doesNotMatch(JSON.stringify(output), /maka:\/\/runtime\/attachments|blobs\/sha256/);
  assert.deepEqual(result.fileRefs, [ref]);
});

test('unavailable/external files have no fabricated Host paths and ordinary prose has no resolution authority', async () => {
  let calls = 0;
  const resolve: ModelFilePathResolver = async () => {
    calls++;
    return { ok: false, reason: 'external executor has no file materializer' };
  };
  const arbitrary = { type: 'text' as const, value: `Untrusted suggestion: ${ref}` };
  assert.deepEqual(
    await projectFileResourcePaths(
      arbitrary,
      toolResultFileBindings({ kind: 'text', text: arbitrary.value }),
      resolve,
    ),
    arbitrary,
  );
  assert.equal(calls, 0);
  const output = await projectFileResourcePaths(arbitrary, [{ ref }], resolve);
  assert.match(JSON.stringify(output), /external executor has no file materializer/);
  assert.doesNotMatch(JSON.stringify(output), /maka:\/\/runtime\/attachments/);
  const current = await projection(resolve).appendImageParts(
    formatTextWithInlineRefs({ kind: 'text', text: 'Inspect', attachments: [attachment] }),
    [attachment],
  );
  assert.match(JSON.stringify(current), /unavailable/);
  assert.doesNotMatch(JSON.stringify(current), /file_path|maka:\/\/runtime\/attachments/);
});

test('child notification file IDs remain durable but current, steering and replay views show only file descriptions', async () => {
  const text = renderChildAgentNotification({
    id: 'child',
    toolUseId: 'call',
    status: 'completed',
    name: 'worker',
    result: 'Report is ready.',
    artifactIds: ['internal-file-id'],
  });
  const origin = { kind: 'background_task' as const, ref: 'child', toolUseId: 'call' };
  const notice = event('child-notice', { kind: 'text', text, origin }, 'user', 'system');
  const original = JSON.stringify(notice);
  const presenter = projection(async () => available('/current/report.csv'));
  const current = await presenter.buildCurrentUserContent(
    text,
    undefined,
    undefined,
    undefined,
    notice,
  );
  const steering = await presenter.materializeTaskNotification(text, origin);
  const replay = await presenter.materializeRuntimeReplayPlan(
    buildRuntimeEventModelReplayPlan([notice]),
    undefined,
    new Set(),
  );
  for (const output of [current, steering, replay]) {
    assert.match(JSON.stringify(output), /\/current\/report.csv/);
    assert.doesNotMatch(JSON.stringify(output), /internal-file-id|<artifacts>/);
  }
  assert.equal(JSON.stringify(notice), original);
  const user = { ...notice, author: 'user' as const };
  const literal = await presenter.buildCurrentUserContent(
    text,
    undefined,
    undefined,
    undefined,
    user,
  );
  assert.match(JSON.stringify(literal), /internal-file-id/);
  assert.deepEqual(notificationFileBindings(user), []);
});

test('AgentOutput keeps dependencies internal and exposes file metadata rather than storage identity', async () => {
  const content = {
    kind: 'json' as const,
    value: {
      artifacts: [
        {
          id: 'internal-file-id',
          sessionId: 'parent',
          turnId: 'child-turn',
          relativePath: 'blobs/sha256/private',
          name: 'report.csv',
          sizeBytes: 14,
          kind: 'file',
          source: 'user_delivery',
          createdAt: 1,
        },
      ],
      result: { artifactIds: ['internal-file-id'], status: 'completed' },
    },
    fileRefs: ['maka://runtime/attachments/internal-file-id'],
  };
  const original = JSON.stringify(content);
  const output = buildSubagentOutputTool().toModelOutput!({
    toolCallId: 'query',
    input: {},
    output: content,
  });
  assert.ok(output);
  const prepared = await projectFileResourcePaths(
    output,
    toolResultFileBindings(content),
    async () => available('/current/report.csv'),
  );
  assert.match(JSON.stringify(prepared), /\/current\/report.csv/);
  assert.doesNotMatch(JSON.stringify(prepared), /internal-file-id|blobs\/sha256/);
  assert.equal(JSON.stringify(content), original);
});

test('only structured system task notifications bind output files', async () => {
  const notification = event(
    'task',
    {
      kind: 'text',
      text: '<output-ref>maka://runtime/task-outputs/task</output-ref>',
      origin: {
        kind: 'background_task',
        ref: 'maka://runtime/background-tasks/task',
        toolUseId: 'call',
      },
    },
    'user',
    'system',
  );
  assert.deepEqual(notificationFileBindings(notification), [
    { ref: 'maka://runtime/task-outputs/task' },
  ]);
  assert.deepEqual(notificationFileBindings({ ...notification, author: 'user' }), []);
  const messages = await projection(async () =>
    available('/current/task.output'),
  ).materializeRuntimeReplayPlan(
    buildRuntimeEventModelReplayPlan([notification]),
    undefined,
    new Set(),
  );
  assert.match(JSON.stringify(messages), /\/current\/task.output/);
  assert.doesNotMatch(JSON.stringify(messages), /maka:\/\/runtime\/task-outputs/);
  const idleWake = { ...notification, author: 'host' as const };
  const presenter = projection(async () => available('/current/task.output'));
  assert.deepEqual(notificationFileBindings(idleWake), notificationFileBindings(notification));
  const current = await presenter.buildCurrentUserContent(
    notification.content?.kind === 'text' ? notification.content.text : '',
    undefined,
    undefined,
    undefined,
    idleWake,
  );
  assert.match(JSON.stringify(current), /\/current\/task.output/);
  const steering = await presenter.materializeTaskNotification('maka://runtime/task-outputs/task', {
    kind: 'background_task',
    ref: 'maka://runtime/background-tasks/task',
    toolUseId: 'call',
  });
  assert.match(steering, /\/current\/task.output/);
});

test('a batched wake keeps all structured task outputs, not just the first origin, through copy and model projection', async () => {
  const text = ['first', 'second']
    .map(
      (id) =>
        `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>call-${id}</tool-use-id>\n<output-ref>maka://runtime/task-outputs/${id}</output-ref>\n<status>completed</status>\n<summary>Done</summary>\n</task-notification>`,
    )
    .join('\n\n');
  const wake = event(
    'batch',
    {
      kind: 'text',
      text,
      origin: {
        kind: 'background_task',
        ref: 'maka://runtime/background-tasks/first',
        toolUseId: 'call-first',
      },
    },
    'user',
    'host',
  );
  assert.deepEqual(collectConversationCopyTaskOutputIds({ messages: [], runtimeEvents: [wake] }), [
    'first',
    'second',
  ]);
  assert.deepEqual(
    notificationFileBindings(wake).map((binding) => binding.ref),
    ['maka://runtime/task-outputs/first', 'maka://runtime/task-outputs/second'],
  );
  assert.deepEqual(notificationFileBindings({ ...wake, author: 'user' }), []);
  const messages = await projection(async (resource) =>
    available(`/current/${resource.split('/').at(-1)}.output`),
  ).materializeRuntimeReplayPlan(buildRuntimeEventModelReplayPlan([wake]), undefined, new Set());
  assert.match(JSON.stringify(messages), /\/current\/first.output/);
  assert.match(JSON.stringify(messages), /\/current\/second.output/);
});

test('path projection preserves literal dollar/backslash characters and never aliases an ID prefix', async () => {
  const path = 'C:\\workspace\\$&\\report.json';
  const second = '/execution/report-2.json';
  const output = await projectFileResourcePaths(
    { type: 'text', value: `${ref}, ${ref}-2, ${ref}-other; file: ${ref}` },
    [{ ref }, { ref: `${ref}-2` }],
    async (resource) => available(resource === ref ? path : second),
  );
  assert.equal(output.type, 'text');
  if (output.type !== 'text') return;
  assert.ok(output.value.startsWith(`${path}, ${second}, ${ref}-other; file: ${path}`));
});
