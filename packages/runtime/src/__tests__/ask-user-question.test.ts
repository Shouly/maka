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

import { createTestToolRuntime } from './execution-boundary-test-helpers.js';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SessionEvent } from '@maka/core/events';
import type { SessionHeader, StoredMessage } from '@maka/core/session';

import { buildAskUserQuestionTool } from '../ask-user-question-tool.js';
import { ToolRuntime } from '../tool-runtime.js';

function header(): SessionHeader {
  return {
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
    model: 'm',
    permissionMode: 'ask',
    schemaVersion: 1,
  };
}

describe('AskUserQuestion runtime round trip', () => {
  test('parks the tool, emits one request, and persists one nullable JSON result', async () => {
    const appended: StoredMessage[] = [];
    const events: SessionEvent[] = [];
    let id = 0;
    const runtime = createTestToolRuntime({
      sessionId: 'session-1',
      header: header(),
      connection: { providerType: 'openai', slug: 'c' } as never,
      modelId: 'm',
      appendMessage: async (message) => {
        appended.push(message);
      },
      newId: () => `id-${++id}`,
      now: () => 1,
      getPermissionPauseTarget: () => null,
    });
    const resultPromise = runtime
      .settleToolCall({
        tool: buildAskUserQuestionTool(),
        turnId: 'turn-1',
        toolCallId: 'tool-1',
        input: {
          questions: [
            {
              question: 'Choose an approach',
              header: 'Approach',
              multiSelect: false,
              options: [
                { label: 'Extend', description: 'Reuse the runtime seam' },
                { label: 'Separate', description: 'Start a new module' },
              ],
            },
            {
              question: 'Keep the default?',
              header: 'Default',
              multiSelect: false,
              options: [
                { label: 'Yes', description: 'Leave it alone' },
                { label: 'No', description: 'Change it' },
              ],
            },
          ],
        },
        abortSignal: new AbortController().signal,
        eventSink: {
          push: (event) => events.push(event),
          pushAndWaitUntilConsumed: async (event) => {
            events.push(event);
          },
        },
      })
      .then((settlement) => settlement.result);

    await new Promise<void>((resolve) => setImmediate(resolve));
    const request = events.find((event) => event.type === 'user_question_request');
    assert.ok(request);
    assert.equal(request.toolUseId, 'tool-1');
    assert.equal(runtime.pendingUserQuestionCount(), 1);

    assert.equal(
      runtime.respondToUserQuestion({
        requestId: request.requestId,
        answers: ['Extend', null],
      }),
      true,
    );

    assert.deepEqual(await resultPromise, {
      answers: [
        { question: 'Choose an approach', answer: 'Extend', selected: ['Extend'] },
        { question: 'Keep the default?', answer: null, selected: [] },
      ],
    });
    const results = appended.filter((message) => message.type === 'tool_result');
    assert.equal(results.length, 1);
    assert.deepEqual(results[0]?.content, {
      kind: 'json',
      value: {
        answers: [
          { question: 'Choose an approach', answer: 'Extend', selected: ['Extend'] },
          { question: 'Keep the default?', answer: null, selected: [] },
        ],
      },
    });
  });

  test('turn abort rejects the parked tool and ignores a late response', async () => {
    const events: SessionEvent[] = [];
    let id = 0;
    const runtime = createTestToolRuntime({
      sessionId: 'session-1',
      header: header(),
      connection: { providerType: 'openai', slug: 'c' } as never,
      modelId: 'm',
      newId: () => `id-${++id}`,
      now: () => 1,
      getPermissionPauseTarget: () => null,
    });
    const resultPromise = runtime
      .settleToolCall({
        tool: buildAskUserQuestionTool(),
        turnId: 'turn-1',
        toolCallId: 'tool-1',
        input: {
          questions: [
            {
              question: 'Continue?',
              header: 'Continue',
              multiSelect: false,
              options: [
                { label: 'Yes', description: 'Keep going' },
                { label: 'No', description: 'Stop here' },
              ],
            },
          ],
        },
        abortSignal: new AbortController().signal,
        eventSink: {
          push: (event) => events.push(event),
          pushAndWaitUntilConsumed: async (event) => {
            events.push(event);
          },
        },
      })
      .then((settlement) => settlement.result);

    await new Promise<void>((resolve) => setImmediate(resolve));
    const request = events.find((event) => event.type === 'user_question_request');
    assert.ok(request);

    runtime.endTurn('aborted');

    assert.deepEqual(await resultPromise, {
      error: `Turn turn-1 aborted before user question ${request.requestId} was answered`,
    });
    assert.equal(
      runtime.respondToUserQuestion({
        requestId: request.requestId,
        answers: ['Yes'],
      }),
      false,
    );
  });

  test('cell abort releases a parked question without waiting for turn teardown', async () => {
    const events: SessionEvent[] = [];
    let id = 0;
    const runtime = createTestToolRuntime({
      sessionId: 'session-1',
      header: header(),
      connection: { providerType: 'openai', slug: 'c' } as never,
      modelId: 'm',
      newId: () => `id-${++id}`,
      now: () => 1,
      getPermissionPauseTarget: () => null,
    });
    const controller = new AbortController();
    const pending = runtime.settleToolCall({
      tool: buildAskUserQuestionTool(),
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      input: {
        questions: [
          {
            question: 'Continue?',
            header: 'Continue',
            multiSelect: false,
            options: [
              { label: 'Yes', description: 'Keep going' },
              { label: 'No', description: 'Stop here' },
            ],
          },
        ],
      },
      abortSignal: controller.signal,
      eventSink: {
        push: (event) => events.push(event),
        pushAndWaitUntilConsumed: async (event) => {
          events.push(event);
        },
      },
    });

    while (!events.some((event) => event.type === 'user_question_request')) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    const request = events.find((event) => event.type === 'user_question_request');
    assert.ok(request);
    controller.abort(new Error('cell aborted'));

    const settlement = await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('question did not release after cell abort')), 50),
      ),
    ]);
    assert.match(String((settlement.result as { error: string }).error), /cell aborted/i);
    assert.equal(runtime.pendingUserQuestionCount(), 0);
    assert.equal(
      runtime.respondToUserQuestion({
        requestId: request.requestId,
        answers: ['Yes'],
      }),
      false,
    );
  });
});

describe('AskUserQuestion schema', () => {
  const parameters = () =>
    buildAskUserQuestionTool().parameters as unknown as {
      safeParse(value: unknown): { success: boolean; error?: { message: string } };
    };
  const question = (overrides: Record<string, unknown> = {}) => ({
    question: 'Which auth method?',
    header: 'Auth method',
    multiSelect: false,
    options: [
      { label: 'OAuth', description: 'Delegate to the provider.' },
      { label: 'API key', description: 'Keep a long-lived secret.' },
    ],
    ...overrides,
  });

  test('accepts one to four questions with two to four options each', () => {
    assert.equal(parameters().safeParse({ questions: [question()] }).success, true);
    assert.equal(
      parameters().safeParse({
        questions: Array.from({ length: 4 }, () => question()),
      }).success,
      true,
    );
    assert.equal(
      parameters().safeParse({
        questions: Array.from({ length: 5 }, () => question()),
      }).success,
      false,
    );
    assert.equal(parameters().safeParse({ questions: [] }).success, false);
    assert.equal(
      parameters().safeParse({
        questions: [question({ options: [{ label: 'Only', description: 'one' }] })],
      }).success,
      false,
    );
    assert.equal(
      parameters().safeParse({
        questions: [
          question({
            options: Array.from({ length: 5 }, (_unused, index) => ({
              label: `Option ${index}`,
              description: 'x',
            })),
          }),
        ],
      }).success,
      false,
    );
  });

  test('trims the header and holds it to twelve characters', () => {
    const parsed = (
      buildAskUserQuestionTool().parameters as unknown as {
        parse(value: unknown): { questions: Array<{ header: string }> };
      }
    ).parse({ questions: [question({ header: '  Auth method  ' })] });
    assert.equal(parsed.questions[0]?.header, 'Auth method');
    assert.equal(
      parameters().safeParse({ questions: [question({ header: 'Authentication method' })] })
        .success,
      false,
    );
    assert.equal(parameters().safeParse({ questions: [question({ header: '' })] }).success, false);
  });

  test('requires a header and multiSelect on every question', () => {
    const { header: _header, ...withoutHeader } = question();
    assert.equal(parameters().safeParse({ questions: [withoutHeader] }).success, false);
    const { multiSelect: _multiSelect, ...withoutMultiSelect } = question();
    assert.equal(parameters().safeParse({ questions: [withoutMultiSelect] }).success, false);
  });
});

describe('AskUserQuestion result projection', () => {
  test('multiSelect answers join for the model and keep their labels', async () => {
    const appended: StoredMessage[] = [];
    const events: SessionEvent[] = [];
    let id = 0;
    const runtime = createTestToolRuntime({
      sessionId: 'session-1',
      header: header(),
      connection: { providerType: 'openai', slug: 'c' } as never,
      modelId: 'm',
      appendMessage: async (message) => {
        appended.push(message);
      },
      newId: () => `id-${++id}`,
      now: () => 1,
      getPermissionPauseTarget: () => null,
    });
    const tool = buildAskUserQuestionTool();
    const resultPromise = runtime
      .settleToolCall({
        tool,
        turnId: 'turn-1',
        toolCallId: 'tool-1',
        input: {
          questions: [
            {
              question: 'Which surfaces?',
              header: 'Surfaces',
              multiSelect: true,
              options: [
                { label: 'Desktop', description: 'The Electron app' },
                { label: 'CLI', description: 'The terminal UI' },
                { label: 'Web', description: 'The browser client' },
              ],
            },
            {
              question: 'Anything else?',
              header: 'Else',
              multiSelect: false,
              options: [
                { label: 'Yes', description: 'Tell me more' },
                { label: 'No', description: 'That is all' },
              ],
            },
          ],
        },
        abortSignal: new AbortController().signal,
        eventSink: {
          push: (event) => events.push(event),
          pushAndWaitUntilConsumed: async (event) => {
            events.push(event);
          },
        },
      })
      .then((settlement) => settlement.result);

    await new Promise<void>((resolve) => setImmediate(resolve));
    const request = events.find((event) => event.type === 'user_question_request');
    assert.ok(request);
    assert.equal(
      runtime.respondToUserQuestion({
        requestId: request.requestId,
        answers: [['Desktop', 'CLI'], 'ship it next week'],
      }),
      true,
    );

    const result = await resultPromise;
    assert.deepEqual(result, {
      answers: [
        { question: 'Which surfaces?', answer: 'Desktop, CLI', selected: ['Desktop', 'CLI'] },
        { question: 'Anything else?', answer: 'ship it next week', selected: [] },
      ],
    });
    assert.deepEqual(tool.toModelOutput?.({ toolCallId: 'tool-1', input: {}, output: result }), {
      type: 'text',
      value:
        'Your questions have been answered: "Which surfaces?"="Desktop, CLI", "Anything else?"="ship it next week"',
    });
  });

  test('rejects an array answer for a single-select question', async () => {
    const events: SessionEvent[] = [];
    let id = 0;
    const runtime = createTestToolRuntime({
      sessionId: 'session-1',
      header: header(),
      connection: { providerType: 'openai', slug: 'c' } as never,
      modelId: 'm',
      newId: () => `id-${++id}`,
      now: () => 1,
      getPermissionPauseTarget: () => null,
    });
    void runtime.settleToolCall({
      tool: buildAskUserQuestionTool(),
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      input: {
        questions: [
          {
            question: 'Continue?',
            header: 'Continue',
            multiSelect: false,
            options: [
              { label: 'Yes', description: 'Keep going' },
              { label: 'No', description: 'Stop here' },
            ],
          },
        ],
      },
      abortSignal: new AbortController().signal,
      eventSink: {
        push: (event) => events.push(event),
        pushAndWaitUntilConsumed: async (event) => {
          events.push(event);
        },
      },
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const request = events.find((event) => event.type === 'user_question_request');
    assert.ok(request);
    assert.throws(
      () => runtime.respondToUserQuestion({ requestId: request.requestId, answers: [['Yes']] }),
      /Invalid user question response/,
    );
    runtime.endTurn('aborted');
  });
});
