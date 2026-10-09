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
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import { z } from 'zod';
import { createTestAiSdkBackend } from './execution-boundary-test-helpers.js';
import { createDurableTurnHarness, drainWithDurableTurn } from './durable-turn-harness.js';

type Dialect = 'anthropic' | 'openai-native' | 'openai-alias' | 'withholding';
type Harness = ReturnType<typeof createDurableTurnHarness>;
const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function backend(input: {
  dialect: Dialect;
  source: boolean;
  durable: Harness;
  calls: string[];
  prompts: unknown[];
  removed?: boolean;
  query?: string;
}) {
  const modelId =
    input.dialect === 'anthropic'
      ? 'claude-sonnet-4-5'
      : input.dialect === 'openai-native'
        ? 'gpt-5.4'
        : input.dialect === 'openai-alias'
          ? 'gpt-5.3'
          : 'mock-model-id';
  const providerType = input.dialect === 'anthropic' ? 'anthropic' : 'openai';
  let id = 0;
  const model = new MockLanguageModelV4({
    doStream: async (request) => {
      input.prompts.push(request.prompt);
      const query = { query: input.query ?? 'select:BrowserClick' };
      return {
        stream: convertArrayToReadableStream([
          { type: 'stream-start', warnings: [] },
          {
            type: 'tool-call',
            toolCallId: input.source ? 'search-1' : 'click-1',
            toolName: input.source
              ? input.dialect === 'openai-alias'
                ? 'CopilotToolSearch'
                : 'ToolSearch'
              : 'BrowserClick',
            input: JSON.stringify(
              input.source
                ? input.dialect === 'openai-native'
                  ? { arguments: query, call_id: 'search-1' }
                  : query
                : {},
            ),
          },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_calls' }, usage },
        ]),
      };
    },
  });
  return createTestAiSdkBackend({
    sessionId: 'session-1',
    header: {
      id: 'session-1',
      workspaceRoot: '/tmp/maka',
      cwd: '/tmp/maka',
      createdAt: 1,
      name: 'Test',
      titleIsManual: true,
      isFlagged: false,
      labels: [],
      isArchived: false,
      status: 'active',
      statusUpdatedAt: 1,
      hasUnread: false,
      backend: 'ai-sdk',
      llmConnectionSlug: 'c',
      connectionLocked: true,
      model: modelId,
      permissionMode: 'ask',
      schemaVersion: 1,
    },
    connection: { slug: 'c', providerType, defaultModel: modelId },
    apiKey: 'sk-test',
    modelId,
    modelFactory: () => model,
    tools: [
      {
        name: input.removed ? 'OtherTool' : 'BrowserClick',
        description: 'Click a browser element',
        parameters: z.object({}),
        impl: () => {
          input.calls.push('BrowserClick');
          return { ok: true };
        },
      },
    ],
    toolAvailability: {},
    loadTurnRuntimeEvents: input.durable.loadTurnRuntimeEvents,
    newId: () => `${input.source ? 'source' : 'successor'}-${++id}`,
    now: () => 1,
  });
}

for (const dialect of ['anthropic', 'openai-native', 'openai-alias', 'withholding'] as const) {
  test(`${dialect} ToolSearch survives a cold same-Turn handoff through the durable codec`, async () => {
    const source = createDurableTurnHarness({
      turnId: 'turn-1',
      runId: 'source-run',
      invocationId: 'source-run',
      text: 'search then click',
    });
    let paused = false;
    await drainWithDurableTurn(
      backend({ dialect, source: true, durable: source, calls: [], prompts: [] }).send(
        source.sendInput({
          maxSteps: 3,
          handoffBoundary: async () => {
            paused = true;
            return 'pause';
          },
        }),
      ),
      source,
    );
    assert.equal(paused, true);
    const response = source.ledger.find((event) => event.content?.kind === 'function_response');
    assert.ok(response?.content?.kind === 'function_response');
    assert.equal(response.content.modelProjection?.kind, 'json');
    for (const mode of [
      'same-turn',
      'fresh-turn',
      'removed-tool',
      ...(dialect === 'anthropic' ? ['legacy-projection'] : []),
    ]) {
      const currentTurn = mode === 'fresh-turn' ? 'turn-2' : 'turn-1';
      const next = createDurableTurnHarness({
        turnId: currentTurn,
        runId: 'successor-run',
        invocationId: 'successor-run',
        text: 'continue',
      });
      const events = structuredClone(source.ledger);
      if (mode === 'legacy-projection') {
        const old = events.find((event) => event.content?.kind === 'function_response')!;
        if (old.content?.kind === 'function_response')
          old.content.modelProjection = {
            version: 1,
            kind: 'content',
            parts: [{ kind: 'text', text: 'Tool completed with no content.' }],
          };
      }
      const calls: string[] = [];
      const prompts: unknown[] = [];
      await drainWithDurableTurn(
        backend({
          dialect,
          source: false,
          durable: next,
          calls,
          prompts,
          removed: mode === 'removed-tool',
        }).send(
          next.sendInput({
            maxSteps: 1,
            text: mode === 'fresh-turn' ? 'continue' : '',
            runtimeContext: events,
            ...(mode === 'fresh-turn'
              ? {}
              : {
                  continuation: {
                    sourceInvocationId: 'source-run',
                    sourceRunId: 'source-run',
                    sourceTurnId: 'turn-1',
                    sourceRuntimeEventHighWater: events.length,
                  },
                }),
          }),
        ),
        next,
      );
      const native = dialect === 'anthropic' || dialect === 'openai-native';
      const expected =
        mode === 'removed-tool' || (mode === 'fresh-turn' && !native) ? [] : ['BrowserClick'];
      assert.deepEqual(calls, expected, mode);
      if (dialect === 'anthropic' && mode !== 'removed-tool')
        assert.match(JSON.stringify(prompts[0]), /tool-reference/u, mode);
    }
  });
}

test('an empty ToolSearch does not activate an unrequested tool after handoff', async () => {
  const source = createDurableTurnHarness({
    turnId: 'turn-1',
    runId: 'source-run',
    invocationId: 'source-run',
    text: 'search',
  });
  await drainWithDurableTurn(
    backend({
      dialect: 'withholding',
      source: true,
      durable: source,
      calls: [],
      prompts: [],
      query: 'select:Missing',
    }).send(
      source.sendInput({
        maxSteps: 2,
        handoffBoundary: async () => 'pause',
      }),
    ),
    source,
  );
  const next = createDurableTurnHarness({
    turnId: 'turn-1',
    runId: 'successor-run',
    invocationId: 'successor-run',
    text: 'search',
  });
  const calls: string[] = [];
  await drainWithDurableTurn(
    backend({ dialect: 'withholding', source: false, durable: next, calls, prompts: [] }).send(
      next.sendInput({
        maxSteps: 1,
        text: '',
        runtimeContext: source.ledger,
        continuation: {
          sourceInvocationId: 'source-run',
          sourceRunId: 'source-run',
          sourceTurnId: 'turn-1',
          sourceRuntimeEventHighWater: source.ledger.length,
        },
      }),
    ),
    next,
  );
  assert.deepEqual(calls, []);
});
