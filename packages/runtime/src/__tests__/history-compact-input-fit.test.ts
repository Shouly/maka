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
import { stableJsonLength } from '../context-budget-helpers.js';
import { HistoryCompactSummarizerError } from '../history-compact-error.js';
import {
  fitHistoryCompactMessages,
  refitRejectedHistoryCompactMessages,
} from '../history-compact-input-fit.js';
import type { ModelMessage } from '../model-protocol.js';

describe('history compaction input fitting', () => {
  test('bounds oversized tool evidence without breaking the call/result pair', () => {
    const oversizedOutput = 'raw-tool-output-'.repeat(1_024);
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'shell',
            input: { command: 'inspect' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'shell',
            output: { type: 'text', value: oversizedOutput },
          },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'The inspection completed.' }] },
    ];

    const bounded = fitHistoryCompactMessages(messages, {
      maxInputEstimatedTokens: 600,
      charsPerToken: 1,
    });

    assert.ok(stableJsonLength(bounded) <= 600);
    assert.equal(JSON.stringify(bounded).includes(oversizedOutput), false);
    assert.deepEqual(
      bounded.flatMap((message) =>
        typeof message.content === 'string'
          ? []
          : message.content
              .filter((part) => part.type === 'tool-call' || part.type === 'tool-result')
              .map((part) => ({ type: part.type, toolCallId: part.toolCallId })),
      ),
      [
        { type: 'tool-call', toolCallId: 'call-1' },
        { type: 'tool-result', toolCallId: 'call-1' },
      ],
    );
  });

  test('bounds every oversized result in a multi-result tool message', () => {
    const oversizedOutput = 'raw-tool-output-'.repeat(1_024);
    const messages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'call-1', toolName: 'shell', input: { command: 'a' } },
          { type: 'tool-call', toolCallId: 'call-2', toolName: 'shell', input: { command: 'b' } },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'shell',
            output: { type: 'text', value: oversizedOutput },
          },
          {
            type: 'tool-result',
            toolCallId: 'call-2',
            toolName: 'shell',
            output: { type: 'text', value: oversizedOutput },
          },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Both inspections completed.' }] },
    ];

    const bounded = fitHistoryCompactMessages(messages, {
      maxInputEstimatedTokens: 1_000,
      charsPerToken: 1,
    });

    assert.ok(stableJsonLength(bounded) <= 1_000);
    assert.equal(JSON.stringify(bounded).includes(oversizedOutput), false);
    assert.deepEqual(
      bounded.flatMap((message) =>
        typeof message.content === 'string'
          ? []
          : message.content
              .filter((part) => part.type === 'tool-call' || part.type === 'tool-result')
              .map((part) => ({ type: part.type, toolCallId: part.toolCallId })),
      ),
      [
        { type: 'tool-call', toolCallId: 'call-1' },
        { type: 'tool-call', toolCallId: 'call-2' },
        { type: 'tool-result', toolCallId: 'call-1' },
        { type: 'tool-result', toolCallId: 'call-2' },
      ],
    );
  });

  test('fails before dispatch when non-tool history cannot fit', () => {
    assert.throws(
      () =>
        fitHistoryCompactMessages(
          [{ role: 'user', content: [{ type: 'text', text: 'x'.repeat(1_000) }] }],
          { maxInputEstimatedTokens: 10, charsPerToken: 1 },
        ),
      (error) =>
        error instanceof HistoryCompactSummarizerError && error.reason === 'input_too_large',
    );
  });

  test('keeps the projection unchanged without a budget or when it already fits', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'bounded history' }] },
    ];

    assert.deepEqual(fitHistoryCompactMessages(messages, {}), messages);
    assert.deepEqual(
      fitHistoryCompactMessages(messages, {
        maxInputEstimatedTokens: 1_000,
        charsPerToken: 1,
      }),
      messages,
    );
  });

  const toolResult = (toolCallId: string, value: string): ModelMessage => ({
    role: 'tool',
    content: [
      { type: 'tool-result', toolCallId, toolName: 'Read', output: { type: 'text', value } },
    ],
  });
  const outputs = (messages: readonly ModelMessage[]) =>
    messages.flatMap((message) =>
      message.role === 'tool'
        ? message.content.map((part) =>
            part.type === 'tool-result' && part.output.type === 'text' ? part.output.value : '',
          )
        : [],
    );

  test('a rejected request without a known size loses only its largest tool output', () => {
    const messages = [
      toolResult('call-1', 'a'.repeat(3_000)),
      toolResult('call-2', 'b'.repeat(9_000)),
      toolResult('call-3', 'c'.repeat(6_000)),
    ];
    const refit = refitRejectedHistoryCompactMessages(messages, {});

    assert.equal(refit.omittedToolOutputs, 1);
    assert.deepEqual(
      outputs(refit.messages).map((value) => value.slice(0, 1)),
      ['a', '[', 'c'],
    );
    // Messages it did not touch are the same objects.
    assert.equal(refit.messages[0], messages[0]);
    assert.equal(refit.messages[2], messages[2]);
  });

  test('a rejected request with a known size loses its largest outputs until it fits', () => {
    const messages = [
      toolResult('call-1', 'a'.repeat(3_000)),
      toolResult('call-2', 'b'.repeat(9_000)),
      toolResult('call-3', 'c'.repeat(6_000)),
    ];
    // A thousand tokens is four thousand bytes: the two largest must go.
    const refit = refitRejectedHistoryCompactMessages(messages, { maxInputEstimatedTokens: 1_000 });

    assert.equal(refit.omittedToolOutputs, 2);
    assert.deepEqual(
      outputs(refit.messages).map((value) => value.slice(0, 1)),
      ['a', '[', '['],
    );
  });

  test('a rejected request with no tool output has nothing to leave out', () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'x'.repeat(10_000) }] },
    ];
    const refit = refitRejectedHistoryCompactMessages(messages, { maxInputEstimatedTokens: 10 });

    assert.equal(refit.omittedToolOutputs, 0);
    assert.deepEqual(refit.messages, messages);
  });
});
