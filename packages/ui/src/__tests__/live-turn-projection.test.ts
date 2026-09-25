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

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { encodeToolStepProgress } from '@maka/core/events';
import type { StoredMessage } from '@maka/core/session';
import { applyLiveTurnEvent } from './live-turn-zh.js';
import {
  armLiveTurn,
  confirmLiveTurn,
  reconcileTerminalLiveTurn,
  settleLiveTurnStep,
  type LiveTurnProjection,
} from '../live-turn-projection.js';
import { materializeTurns, overlayLiveTurn, type ToolActivityItem } from '../materialize.js';
import { redactSecrets } from '../redact.js';
import { getConversationCopy } from '../conversation-copy.js';

// A client that just sent cannot read "has my turn started" off session status:
// it is the same before the turn starts and after it ends. The arm carries
// `unconfirmed` until the authority says something about THAT turn, which is
// what stops a snapshot taken before the send landed from retiring it.
describe('the unconfirmed claim an arm carries', () => {
  it('is set at arm and dropped by an answer naming the same turn', () => {
    const armed = armLiveTurn('turn-1');
    assert.equal(armed.unconfirmed, true);

    const confirmed = confirmLiveTurn(armed, 'turn-1');
    assert.equal(confirmed?.unconfirmed, undefined);
    assert.equal(confirmed?.turnId, 'turn-1');
    assert.equal(confirmed?.phase, 'waiting', 'confirming is not the same as streaming');
  });

  // Another client's turn, or a scheduled task's, says nothing about this send.
  it('survives an answer that names a different turn', () => {
    const armed = armLiveTurn('turn-mine');

    assert.equal(confirmLiveTurn(armed, 'turn-theirs'), armed);
  });

  it('is dropped by the turn\'s own events, not just by an explicit answer', () => {
    const streamed = applyLiveTurnEvent(armLiveTurn('turn-1'), {
      type: 'text_delta',
      id: 'event-1',
      turnId: 'turn-1',
      messageId: 'step-1',
      ts: 100,
      text: '你',
    });

    assert.equal(streamed.unconfirmed, undefined);
  });
});

describe('provider retry copy', () => {
  it('describes capacity retries without collapsing them into generic unavailability', () => {
    assert.match(getConversationCopy('zh-CN').messages.providerRetryReason.provider_capacity, /满载/);
    assert.match(
      getConversationCopy('en').messages.providerRetryReason.provider_capacity,
      /capacity/,
    );
  });
});

describe('applyLiveTurnEvent', () => {
  it('keeps every streamed prefix oracle-equivalent and drops raw state on terminal events', () => {
    const input = 'api_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY tail';
    let projection: LiveTurnProjection | undefined;
    let source = '';
    for (const [index, text] of [...input].entries()) {
      source += text;
      projection = applyLiveTurnEvent(projection, {
        type: 'text_delta',
        id: `text-${index}`,
        turnId: 'turn-redaction',
        messageId: 'message-redaction',
        ts: index,
        text,
      });
      assert.ok(projection);
      assert.equal(projection.steps[0]?.text?.text, redactSecrets(source));
    }
    assert.ok(projection);
    assert.ok(projection.steps[0]?.text?.redactionState);

    const aborted = applyLiveTurnEvent(projection, {
      type: 'abort', id: 'abort-1', turnId: 'turn-redaction', ts: 100, reason: 'user_stop',
    });
    assert.equal(aborted?.steps[0]?.text?.text, redactSecrets(input));
    assert.equal(aborted?.steps[0]?.text?.redactionState, undefined);

    let thinking = applyLiveTurnEvent(undefined, {
      type: 'thinking_delta', id: 'thinking-1', turnId: 'turn-error',
      messageId: 'message-thinking', ts: 1, text: 'Authorization: Bearer secret-value',
    });
    assert.ok(thinking.steps[0]?.thinking?.redactionState);
    thinking = applyLiveTurnEvent(thinking, {
      type: 'error', id: 'error-1', turnId: 'turn-error', ts: 2,
      recoverable: false, message: 'provider failed',
    })!;
    assert.equal(thinking.steps[0]?.thinking?.redactionState, undefined);
    assert.equal(thinking.steps[0]?.thinking?.text.includes('secret-value'), false);
  });

  it('folds replayed absolute deltas instead of appending a resubscription seed', () => {
    const seed = {
      type: 'text_delta' as const,
      id: 'seed-1',
      turnId: 'turn-1',
      messageId: 'step-1',
      ts: 100,
      startOffset: 0,
      text: 'Hello',
    };
    const first = applyLiveTurnEvent(undefined, seed);
    const replayed = applyLiveTurnEvent(first, { ...seed, id: 'seed-2', ts: 200 });
    const extended = applyLiveTurnEvent(replayed, {
      ...seed,
      id: 'delta-3',
      ts: 300,
      startOffset: 5,
      text: ' world',
    });

    assert.equal(replayed.steps[0]?.text?.text, 'Hello');
    assert.equal(extended.steps[0]?.text?.text, 'Hello world');
    assert.equal(extended.steps[0]?.text?.sourceEndOffset, 11);
  });

  it('tracks absolute thinking offsets independently from redacted display text', () => {
    const first = applyLiveTurnEvent(undefined, {
      type: 'thinking_delta',
      id: 'thinking-1',
      turnId: 'turn-1',
      messageId: 'step-1',
      ts: 100,
      startOffset: 0,
      text: 'Authorization: Bearer secret-value',
    });
    const replayed = applyLiveTurnEvent(first, {
      type: 'thinking_delta',
      id: 'thinking-2',
      turnId: 'turn-1',
      messageId: 'step-1',
      ts: 200,
      startOffset: 0,
      text: 'Authorization: Bearer secret-value',
    });

    assert.equal(replayed.steps[0]?.thinking?.text, first.steps[0]?.thinking?.text);
    assert.equal(
      replayed.steps[0]?.thinking?.sourceEndOffset,
      'Authorization: Bearer secret-value'.length,
    );
  });

  // Switching back to a running task resubscribes, and the Host seeds all it
  // has so far as ONE delta from offset 0. A long reply is far past 4 KB there
  // with nothing wrong, so no part of it may be cut as an "oversize delta".
  it('shows a resubscription seed longer than 4 KB whole', () => {
    const answer = 'The answer goes on. '.repeat(600);
    const reasoning = 'Weighing the options. '.repeat(600);
    const seeded = [
      { type: 'thinking_delta' as const, text: reasoning },
      { type: 'text_delta' as const, text: answer },
    ].reduce<LiveTurnProjection | undefined>(
      (projection, delta, index) =>
        applyLiveTurnEvent(projection, {
          ...delta,
          id: `seed-${index}`,
          turnId: 'turn-1',
          messageId: 'step-1',
          ts: 100,
          startOffset: 0,
        }),
      undefined,
    );

    const step = seeded?.steps[0];
    assert.ok(answer.length > 4 * 1024 && reasoning.length > 4 * 1024);
    assert.equal(step?.text?.text, answer);
    assert.equal(step?.text?.truncated, false);
    assert.equal(step?.thinking?.text, reasoning);
    assert.equal(step?.thinking?.truncated, false);
  });


  it('projects transient provider retry progress until the next model output', () => {
    const scheduled = applyLiveTurnEvent(armLiveTurn('turn-1'), {
      type: 'provider_retry',
      id: 'retry-1',
      turnId: 'turn-1',
      ts: 100,
      phase: 'scheduled',
      attempt: 2,
      maxAttempts: 10,
      delayMs: 4_000,
      reason: 'rate_limit',
    });
    assert.deepEqual(scheduled?.providerRetry?.event, {
      type: 'provider_retry',
      id: 'retry-1',
      turnId: 'turn-1',
      ts: 100,
      phase: 'scheduled',
      attempt: 2,
      maxAttempts: 10,
      delayMs: 4_000,
      reason: 'rate_limit',
    });
    // Receipt is stamped on the client clock so the countdown ticks in one
    // clock domain, immune to skew against a remote Runtime Host.
    assert.equal(typeof scheduled?.providerRetry?.receivedAtMs, 'number');

    const started = applyLiveTurnEvent(scheduled, {
      type: 'provider_retry',
      id: 'retry-2',
      turnId: 'turn-1',
      ts: 101,
      phase: 'started',
      attempt: 2,
      maxAttempts: 10,
      reason: 'rate_limit',
    });
    assert.equal(started?.providerRetry?.event.phase, 'started');

    const streamed = applyLiveTurnEvent(started, {
      type: 'text_delta',
      id: 'event-1',
      turnId: 'turn-1',
      messageId: 'step-1',
      ts: 102,
      text: '恢复',
    });
    assert.equal(streamed?.providerRetry, undefined);
  });

  it('keeps provider capacity visible through retry projection', () => {
    const live = applyLiveTurnEvent(armLiveTurn('turn-1'), {
      type: 'provider_retry',
      id: 'retry-capacity',
      turnId: 'turn-1',
      ts: 100,
      phase: 'scheduled',
      attempt: 2,
      maxAttempts: 10,
      delayMs: 4_000,
      reason: 'provider_capacity',
    });

    const started = applyLiveTurnEvent(live, {
      type: 'provider_retry',
      id: 'retry-capacity-started',
      turnId: 'turn-1',
      ts: 101,
      phase: 'started',
      attempt: 2,
      maxAttempts: 10,
      reason: 'provider_capacity',
    });

    assert.equal(started?.providerRetry?.event.reason, 'provider_capacity');
  });



  it('replaces the live reasoning with thinking_complete on the same step', () => {
    const partial = applyLiveTurnEvent(undefined, {
      type: 'thinking_delta',
      id: 'event-1',
      turnId: 'turn-1',
      messageId: 'step-1',
      ts: 100,
      text: '部分',
    });
    const projection = applyLiveTurnEvent(partial, {
      type: 'thinking_complete',
      id: 'event-2',
      turnId: 'turn-1',
      messageId: 'step-1',
      ts: 101,
      text: '完整思考',
    });

    assert.deepEqual(projection.steps[0]?.thinking, {
      text: '完整思考',
      truncated: false,
      complete: true,
    });
  });




  it('retains live nested tool activity identity', () => {
    const projection = applyLiveTurnEvent(undefined, {
      type: 'tool_start',
      id: 'event-1',
      turnId: 'turn-1',
      stepId: 'step-1',
      toolUseId: 'nested-1',
      toolName: 'Read',
      args: { path: 'README.md' },
      origin: 'code_mode',
      modelVisibility: 'hidden',
      parentToolCallId: 'exec-1',
      parentOperationId: 'exec-operation-1',
      ts: 100,
    });

    assert.deepEqual(projection.steps[0]?.tools[0], {
      toolUseId: 'nested-1',
      toolName: 'Read',
      stepId: 'step-1',
      status: 'running',
      args: { path: 'README.md' },
      origin: 'code_mode',
      modelVisibility: 'hidden',
      parentToolCallId: 'exec-1',
      parentOperationId: 'exec-operation-1',
    });
  });

  it('retains nested identity when a tool result arrives before its start', () => {
    const projection = applyLiveTurnEvent(undefined, {
      type: 'tool_result',
      id: 'event-1',
      turnId: 'turn-1',
      toolUseId: 'nested-1',
      isError: false,
      content: { kind: 'text', text: 'ok' },
      origin: 'code_mode',
      modelVisibility: 'hidden',
      parentToolCallId: 'exec-1',
      parentOperationId: 'exec-operation-1',
      ts: 100,
    });

    assert.deepEqual(projection.steps[0]?.tools[0], {
      toolUseId: 'nested-1',
      toolName: 'Tool',
      status: 'completed',
      args: undefined,
      result: { kind: 'text', text: 'ok' },
      origin: 'code_mode',
      modelVisibility: 'hidden',
      parentToolCallId: 'exec-1',
      parentOperationId: 'exec-operation-1',
    });
  });

  it('maps cancelled terminal tool_result to interrupted, not errored', () => {
    const started = applyLiveTurnEvent(undefined, {
      type: 'tool_start',
      id: 'event-1',
      turnId: 'turn-1',
      stepId: 'step-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      args: { command: 'sleep 99' },
      ts: 100,
    });
    const projection = applyLiveTurnEvent(started, {
      type: 'tool_result',
      id: 'event-2',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      isError: true,
      content: {
        kind: 'terminal',
        cwd: '/repo',
        cmd: 'sleep 99',
        status: 'cancelled',
        exitCode: 130,
        output: {
          mode: 'pipes',
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          redacted: false,
        },
      },
      ts: 101,
    });

    assert.equal(projection.steps[0]?.tools[0]?.status, 'interrupted');
  });


  it('moves an output-first tool into its real step without duplicating or regressing it', () => {
    const output = applyLiveTurnEvent(undefined, {
      type: 'tool_output_delta',
      id: 'event-1',
      turnId: 'turn-1',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolUseId: 'tool-1',
      seq: 0,
      stream: 'stdout',
      chunk: 'hello\n',
      redacted: false,
      createdAt: 100,
      ts: 100,
    });
    const projection = applyLiveTurnEvent(output, {
      type: 'tool_start',
      id: 'event-2',
      turnId: 'turn-1',
      stepId: 'step-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      args: { command: 'printf hello' },
      ts: 101,
    });

    assert.equal(projection.steps.length, 1);
    assert.equal(projection.steps[0]?.stepId, 'step-1');
    assert.deepEqual(projection.steps[0]?.tools, [{
      toolUseId: 'tool-1',
      toolName: 'Bash',
      stepId: 'step-1',
      status: 'running',
      args: { command: 'printf hello' },
      outputChunks: [{
        seq: 0,
        stream: 'stdout',
        text: 'hello\n',
        redacted: false,
        createdAt: 100,
      }],
      outputTruncated: false,
    }]);
  });

  it('projects bounded multi-step tool progress onto the running row', () => {
    const started = applyLiveTurnEvent(undefined, {
      type: 'tool_start',
      id: 'event-1',
      turnId: 'turn-1',
      stepId: 'step-1',
      toolUseId: 'tool-1',
      toolName: 'mcp__desktop_computer_use__Computer',
      activityKind: 'computer',
      args: {
        action: 'element_sequence',
        steps: [{ label: '<text:1>' }, { label: '<text:1>' }],
      },
      ts: 100,
    });
    const projection = applyLiveTurnEvent(started, {
      type: 'tool_progress',
      id: 'event-2',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      chunk: encodeToolStepProgress({ current: 1, total: 2 })!,
      ts: 101,
    });

    assert.deepEqual(projection.steps[0]?.tools[0]?.progress, { current: 1, total: 2 });
    assert.equal(projection.steps[0]?.tools[0]?.status, 'running');
  });

  it('ignores invalid step progress without clearing the last valid value', () => {
    const valid = applyLiveTurnEvent(undefined, {
      type: 'tool_progress',
      id: 'event-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      chunk: encodeToolStepProgress({ current: 1, total: 2 })!,
      ts: 100,
    });
    const invalid = applyLiveTurnEvent(valid, {
      type: 'tool_progress',
      id: 'event-2',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      chunk: 'steps:3/2',
      ts: 101,
    });

    assert.deepEqual(invalid.steps[0]?.tools[0]?.progress, { current: 1, total: 2 });
  });

  it('preserves steering positions when an output-first tool receives its real step', () => {
    const firstSteer = applyLiveTurnEvent(undefined, {
      type: 'steering_message', id: 'steer-event-1', messageId: 'steer-1',
      turnId: 'turn-1', ts: 99, content: { text: 'before tool' },
    });
    const output = applyLiveTurnEvent(firstSteer, {
      type: 'tool_output_delta', id: 'output-1', turnId: 'turn-1',
      sessionId: 'session-1', toolCallId: 'tool-1', toolUseId: 'tool-1',
      seq: 0, stream: 'stdout', chunk: 'hello\n', redacted: false,
      createdAt: 100, ts: 100,
    });
    const answer = applyLiveTurnEvent(output, {
      type: 'text_delta', id: 'text-1', messageId: 'step-1',
      turnId: 'turn-1', ts: 101, text: 'answer',
    });
    const secondSteer = applyLiveTurnEvent(answer, {
      type: 'steering_message', id: 'steer-event-2', messageId: 'steer-2',
      turnId: 'turn-1', ts: 102, content: { text: 'after tool' },
    });
    const projection = applyLiveTurnEvent(secondSteer, {
      type: 'tool_start', id: 'start-1', turnId: 'turn-1', stepId: 'step-1',
      toolUseId: 'tool-1', toolName: 'Bash', args: {}, ts: 103,
    });

    assert.equal(projection.steps.flatMap((step) => step.tools).length, 1);
    assert.deepEqual(
      overlayLiveTurn([], projection, 'en')[0]?.timeline.map((item) =>
        item.kind === 'user' ? `user:${item.message.text}` : item.kind),
      ['user:before tool', 'text', 'tools', 'user:after tool'],
    );
  });


  it('appends late thinking without moving an already visible tool', () => {
    const tool = applyLiveTurnEvent(undefined, {
      type: 'tool_start',
      id: 'event-1',
      turnId: 'turn-1',
      stepId: 'step-1',
      toolUseId: 'tool-1',
      toolName: 'Read',
      args: {},
      ts: 100,
    });
    const withLateThinking = applyLiveTurnEvent(tool, {
      type: 'thinking_complete',
      id: 'event-2',
      turnId: 'turn-1',
      messageId: 'step-1',
      text: 'late reasoning',
      ts: 101,
    });

    const timeline = overlayLiveTurn([], withLateThinking, 'en')[0]?.timeline;
    assert.deepEqual(timeline?.map((item) => item.kind), ['tools', 'thinking']);
  });

  it('drops a terminal projection only after its last live step settles', () => {
    const streaming = applyLiveTurnEvent(armLiveTurn('turn-1'), {
      type: 'text_delta',
      id: 'event-1',
      turnId: 'turn-1',
      messageId: 'step-1',
      ts: 100,
      text: 'answer',
    });
    const running = applyLiveTurnEvent(streaming, {
      type: 'tool_start',
      id: 'event-2',
      turnId: 'turn-1',
      stepId: 'step-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      args: {},
      ts: 101,
    });
    const terminal = applyLiveTurnEvent(running, {
      type: 'complete',
      id: 'event-3',
      turnId: 'turn-1',
      ts: 102,
      stopReason: 'end_turn',
    });

    assert.equal(terminal?.terminal, true);
    assert.equal(terminal?.steps[0]?.text?.complete, true);
    assert.equal(terminal?.steps[0]?.tools[0]?.status, 'interrupted');
    assert.equal(settleLiveTurnStep(terminal!, 'step-1'), undefined);
  });

  it('marks an aborted projection terminal with in-flight tools interrupted', () => {
    const thinking = applyLiveTurnEvent(undefined, {
      type: 'thinking_delta',
      id: 'event-1',
      turnId: 'turn-1',
      messageId: 'step-1',
      text: 'partial reasoning',
      ts: 100,
    });
    const streaming = applyLiveTurnEvent(thinking, {
      type: 'text_delta',
      id: 'event-2',
      turnId: 'turn-1',
      messageId: 'step-1',
      text: 'partial answer',
      ts: 101,
    });
    const running = applyLiveTurnEvent(streaming, {
      type: 'tool_start',
      id: 'event-3',
      turnId: 'turn-1',
      stepId: 'step-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      args: {},
      ts: 102,
    });
    const aborted = applyLiveTurnEvent(running, {
      type: 'abort',
      id: 'event-4',
      turnId: 'turn-1',
      ts: 103,
      reason: 'user_stop',
    });

    assert.equal(aborted?.terminal, true);
    assert.equal(aborted?.steps[0]?.thinking?.complete, true);
    assert.equal(aborted?.steps[0]?.text?.complete, true);
    assert.equal(aborted?.steps[0]?.tools[0]?.status, 'interrupted');
  });
});

describe('settleLiveTurnStep', () => {
  it('removes only the committed step and drops an empty projection', () => {
    const projection = {
      turnId: 'turn-1',
      phase: 'streamed' as const,
      steps: [
        { stepId: 'step-1', tools: [] },
        { stepId: 'step-2', tools: [] },
      ],
    };

    assert.deepEqual(settleLiveTurnStep(projection, 'step-1'), {
      turnId: 'turn-1',
      phase: 'streamed',
      steps: [{ stepId: 'step-2', tools: [] }],
    });
    assert.deepEqual(
      settleLiveTurnStep({ turnId: 'turn-1', phase: 'streamed', steps: [{ stepId: 'step-1', tools: [] }] }, 'step-1'),
      { turnId: 'turn-1', phase: 'streamed', steps: [] },
    );
  });

  it('keeps co-located tool stream evidence when text handoff settles', () => {
    const projection: LiveTurnProjection = {
      turnId: 'turn-1',
      phase: 'streamed',
      terminal: true,
      steps: [{
        stepId: 'step-1',
        text: { text: 'done', truncated: false, complete: true },
        tools: [{
          toolUseId: 'tool-1',
          toolName: 'Bash',
          status: 'completed',
          args: { command: 'npm test' },
          outputChunks: [
            { seq: 0, stream: 'stdout', text: 'starting-live-output\n', redacted: true, createdAt: 1 },
          ],
          outputTruncated: true,
        }],
      }],
    };

    const settled = settleLiveTurnStep(projection, 'step-1');
    assert.ok(settled);
    assert.equal(settled!.steps.length, 1);
    assert.equal(settled!.steps[0]!.text, undefined);
    assert.equal(settled!.steps[0]!.tools[0]!.outputChunks?.[0]?.text, 'starting-live-output\n');
  });

  it('still drops tools without live stream evidence on text settle', () => {
    const projection: LiveTurnProjection = {
      turnId: 'turn-1',
      phase: 'streamed',
      terminal: true,
      steps: [{
        stepId: 'step-1',
        text: { text: 'done', truncated: false, complete: true },
        tools: [{
          toolUseId: 'tool-1',
          toolName: 'Bash',
          status: 'interrupted',
          args: {},
        }],
      }],
    };
    assert.equal(settleLiveTurnStep(projection, 'step-1'), undefined);
  });
});

describe('reconcileTerminalLiveTurn', () => {
  const toolOnly: LiveTurnProjection = {
    turnId: 'turn-1',
    phase: 'streamed' as const,
    terminal: true,
    steps: [{
      stepId: 'step-1',
      tools: [{ toolUseId: 'tool-1', toolName: 'Bash', status: 'completed' as const, args: {} }],
    }],
  };

  it('settles a tool-only terminal step once persisted history covers it', () => {
    assert.equal(reconcileTerminalLiveTurn(toolOnly, [
      { type: 'tool_call', id: 'tool-1', turnId: 'turn-1', stepId: 'step-1', ts: 1, toolName: 'Bash', args: {} },
      { type: 'tool_result', id: 'result-1', turnId: 'turn-1', ts: 2, toolUseId: 'tool-1', isError: false, content: { kind: 'text', text: 'ok' } },
    ]), undefined);
  });

  it('keeps a non-terminal projection armed once persisted history covers all steps', () => {
    const inFlight: LiveTurnProjection = {
      turnId: 'turn-1',
      phase: 'streamed',
      steps: toolOnly.steps,
    };
    assert.deepEqual(reconcileTerminalLiveTurn(inFlight, [
      { type: 'tool_call', id: 'tool-1', turnId: 'turn-1', stepId: 'step-1', ts: 1, toolName: 'Bash', args: {} },
      { type: 'tool_result', id: 'result-1', turnId: 'turn-1', ts: 2, toolUseId: 'tool-1', isError: false, content: { kind: 'text', text: 'ok' } },
    ]), { turnId: 'turn-1', phase: 'streamed', steps: [] });
  });

  it('retains terminal evidence while persisted history does not cover it', () => {
    assert.equal(reconcileTerminalLiveTurn(toolOnly, []), toolOnly);
  });

  it('keeps terminal live steering until the terminal transcript catches up', () => {
    const message = { id: 'steer-1', content: { text: 'change direction' }, ts: 2 };
    const withSteering: LiveTurnProjection = {
      ...toolOnly,
      steering: [message],
    };

    assert.equal(reconcileTerminalLiveTurn(withSteering, []), withSteering);
    const steeringOnly = { ...withSteering, steps: [] };
    assert.equal(reconcileTerminalLiveTurn(steeringOnly, []), steeringOnly);
    assert.deepEqual(reconcileTerminalLiveTurn(withSteering, [{
      type: 'turn_state', id: 'state-1', turnId: 'turn-1', ts: 3,
      status: 'completed',
    }]), toolOnly);
  });

  it('keeps steering-only aborts visible for transcript handoff', () => {
    const message = { id: 'steer-1', content: { text: 'change direction' }, ts: 2 };
    const withSteering = applyLiveTurnEvent(undefined, {
      type: 'steering_message', id: 'steer-event', messageId: message.id,
      turnId: 'turn-1', ts: message.ts, content: message.content,
    });
    const aborted = applyLiveTurnEvent(withSteering, {
      type: 'abort', id: 'abort-1', turnId: 'turn-1', ts: 3, reason: 'user_stop',
    });

    assert.equal(aborted?.terminal, true);
    assert.deepEqual(aborted?.steering, [{ ...message, seq: 0 }]);
  });

  it('retains interrupted live output until a persisted result covers it', () => {
    const withOutput: LiveTurnProjection = {
      ...toolOnly,
      steps: [{
        ...toolOnly.steps[0]!,
        tools: [{
          ...toolOnly.steps[0]!.tools[0]!,
          status: 'interrupted',
          outputChunks: [{ seq: 0, stream: 'stdout', text: 'partial evidence', redacted: false, createdAt: 1 }],
        }],
      }],
    };
    const toolCallOnly = [
      { type: 'tool_call' as const, id: 'tool-1', turnId: 'turn-1', stepId: 'step-1', ts: 1, toolName: 'Bash', args: {} },
    ];

    assert.equal(reconcileTerminalLiveTurn(withOutput, toolCallOnly), withOutput);
  });

  it('keeps live stream evidence when persisted shell_run streams are still empty', () => {
    const withOutput: LiveTurnProjection = {
      ...toolOnly,
      steps: [{
        ...toolOnly.steps[0]!,
        tools: [{
          ...toolOnly.steps[0]!.tools[0]!,
          status: 'completed',
          outputChunks: [
            { seq: 0, stream: 'stdout', text: 'starting-live-output\n', redacted: true, createdAt: 1 },
          ],
          outputTruncated: true,
        }],
      }],
    };
    const emptyContent = {
      kind: 'shell_run' as const,
      ref: 'maka://runtime/background-tasks/bg',
      mode: 'pipes' as const,
      status: 'running' as const,
      cwd: '/repo',
      cmd: 'npm test',
      startedAt: 1,
      updatedAt: 2,
      revision: 1,
    };
    const emptyShellRun = [
      { type: 'tool_call' as const, id: 'tool-1', turnId: 'turn-1', stepId: 'step-1', ts: 1, toolName: 'Bash', args: {} },
      {
        type: 'tool_result' as const,
        id: 'result-1',
        turnId: 'turn-1',
        ts: 2,
        toolUseId: 'tool-1',
        isError: false,
        content: emptyContent,
      },
    ];

    assert.equal(reconcileTerminalLiveTurn(withOutput, emptyShellRun), withOutput);

    const filled = [
      emptyShellRun[0]!,
      {
        type: 'tool_result' as const,
        id: 'result-1',
        turnId: 'turn-1',
        ts: 2,
        toolUseId: 'tool-1',
        isError: false,
        content: {
          ...emptyContent,
          output: {
            mode: 'pipes' as const,
            stdout: 'starting-live-output\n',
            stderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
            redacted: false,
          },
        },
      },
    ];
    assert.equal(reconcileTerminalLiveTurn(withOutput, filled), undefined);
  });

  it('leaves text steps to the streaming display handoff', () => {
    const textTurn: LiveTurnProjection = {
      ...toolOnly,
      steps: [{
        ...toolOnly.steps[0]!,
        text: { text: 'answer', truncated: false, complete: true },
      }],
    };
    assert.equal(reconcileTerminalLiveTurn(textTurn, [
      { type: 'assistant', id: 'step-1', turnId: 'turn-1', ts: 1, text: 'answer', modelId: 'm' },
      { type: 'tool_call', id: 'tool-1', turnId: 'turn-1', stepId: 'step-1', ts: 2, toolName: 'Bash', args: {} },
    ]), textTurn);
  });

  it('terminalizes live text when persisted history proves a missed terminal event', () => {
    const live: LiveTurnProjection = {
      turnId: 'turn-1',
      phase: 'streamed',
      providerRetry: {
        event: {
          type: 'provider_retry',
          id: 'retry-1',
          turnId: 'turn-1',
          ts: 2,
          phase: 'started',
          attempt: 2,
          maxAttempts: 3,
          reason: 'network',
        },
        receivedAtMs: 2,
      },
      steps: [{
        stepId: 'assistant-1',
        thinking: { text: 'reasoning', truncated: false, complete: false },
        text: { text: 'answer', truncated: false, complete: false },
        tools: [],
      }],
    };

    assert.deepEqual(reconcileTerminalLiveTurn(live, [
      {
        type: 'assistant',
        id: 'assistant-1',
        turnId: 'turn-1',
        ts: 3,
        text: 'answer',
        thinking: { text: 'reasoning' },
        modelId: 'm',
      },
      {
        type: 'turn_state',
        id: 'state-1',
        turnId: 'turn-1',
        ts: 4,
        status: 'completed',
      },
    ]), {
      turnId: 'turn-1',
      phase: 'streamed',
      terminal: true,
      steps: [{
        stepId: 'assistant-1',
        thinking: { text: 'reasoning', truncated: false, complete: true },
        text: { text: 'answer', truncated: false, complete: true },
        tools: [],
      }],
    });
  });

  it('settles a persisted thinking-only step whose text slot is empty', () => {
    const thinkingOnly: LiveTurnProjection = {
      turnId: 'turn-1',
      phase: 'streamed',
      terminal: true,
      steps: [{
        stepId: 'step-1',
        thinking: { text: 'reasoning', truncated: false, complete: true },
        text: { text: '', truncated: false, complete: true },
        tools: [],
      }],
    };

    assert.equal(reconcileTerminalLiveTurn(thinkingOnly, [
      { type: 'assistant', id: 'step-1', turnId: 'turn-1', ts: 1, text: '', thinking: { text: 'reasoning' }, modelId: 'm' },
    ]), undefined);
  });

  it('drops persisted stream evidence before the next tool batch settles', () => {
    const evidence = (toolUseId: string): ToolActivityItem => ({
      toolUseId,
      toolName: 'Bash',
      status: 'completed',
      args: {},
      outputChunks: [{ seq: 0, stream: 'stdout', text: 'ok\n', redacted: false, createdAt: 1 }],
    });
    const current = (toolUseId: string): ToolActivityItem => ({
      toolUseId,
      toolName: 'Bash',
      status: 'running',
      args: {},
    });
    const projection: LiveTurnProjection = {
      turnId: 'turn-1',
      phase: 'streamed',
      steps: [
        { stepId: 'step-1', tools: ['old-1', 'old-2', 'old-3'].map(evidence), contentOrder: ['tools'] },
        { stepId: 'step-2', tools: ['new-1', 'new-2', 'new-3', 'new-4'].map(current), contentOrder: ['tools'] },
      ],
    };
    const persisted = ['old-1', 'old-2', 'old-3'].flatMap((toolUseId, index) => ([
      { type: 'tool_call' as const, id: toolUseId, turnId: 'turn-1', stepId: 'step-1', ts: index * 2 + 1, toolName: 'Bash', args: {} },
      { type: 'tool_result' as const, id: `result-${toolUseId}`, turnId: 'turn-1', ts: index * 2 + 2, toolUseId, isError: false, content: { kind: 'text' as const, text: 'ok\n' } },
    ]));

    assert.deepEqual(reconcileTerminalLiveTurn(projection, persisted), {
      ...projection,
      steps: [projection.steps[1]!],
    });
  });
});

describe('tool_result_preview live projection', () => {
  it('attaches live open-facts and replaces them with the durable result', () => {
    const previewed = previewedSubagentTurn();
    const previewedTool = previewed.steps[0]?.tools[0];

    assert.equal(previewedTool?.status, 'running');
    assert.equal(
      previewedTool?.result?.kind === 'subagent'
        ? previewedTool.result.childSessionId
        : undefined,
      'child-session',
    );

    const settled = applyLiveTurnEvent(previewed, {
      type: 'tool_result',
      id: 'event-3',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      isError: false,
      content: {
        kind: 'subagent',
        childSessionId: 'child-session',
        agentId: 'local_read',
        agentName: 'Local Read',
        turnId: 'child-turn',
        runId: 'child-run',
        status: 'completed',
        permissionMode: 'explore',
        summary: 'done',
        artifactIds: [],
      },
      ts: 102,
    });
    assert.equal(settled.steps[0]?.tools[0]?.status, 'completed');
    assert.equal(
      settled.steps[0]?.tools[0]?.result &&
        settled.steps[0]?.tools[0]?.result.kind === 'subagent'
        ? settled.steps[0]?.tools[0]?.result.summary
        : undefined,
      'done',
    );
  });

  it('keeps hydrated result content when Runtime Host omits it from the live event', () => {
    const previewed = previewedSubagentTurn();
    const hydrated: LiveTurnProjection = {
      ...previewed,
      steps: [{
        ...previewed.steps[0]!,
        tools: [{
          ...previewed.steps[0]!.tools[0]!,
          result: { kind: 'text', text: 'full durable output' },
        }],
      }],
    };
    const settled = applyLiveTurnEvent(hydrated, {
      type: 'tool_result',
      id: 'event-3',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      contentOmitted: true,
      isError: false,
      content: { kind: 'text', text: '' },
      ts: 102,
    });

    assert.equal(settled.steps[0]?.tools[0]?.status, 'completed');
    assert.deepEqual(settled.steps[0]?.tools[0]?.result, { kind: 'text', text: 'full durable output' });
  });

  it('lets a meaningful live empty result replace older durable content', () => {
    const turns = materializeTurns([
      {
        type: 'tool_call', id: 'tool-1', turnId: 'turn-1', stepId: 'step-1', ts: 1,
        toolName: 'Read', args: { path: 'README.md' },
      },
      {
        type: 'tool_result', id: 'result-1', turnId: 'turn-1', ts: 2,
        toolUseId: 'tool-1', isError: false,
        content: { kind: 'text', text: 'older durable output' },
      },
      {
        type: 'turn_state', id: 'state-1', turnId: 'turn-1', ts: 3,
        status: 'running',
      },
    ], 'en');
    const started = applyLiveTurnEvent(undefined, {
      type: 'tool_start', id: 'start-1', turnId: 'turn-1', stepId: 'step-1',
      toolUseId: 'tool-1', toolName: 'Read', args: { path: 'README.md' }, ts: 4,
    });
    const settled = applyLiveTurnEvent(started, {
      type: 'tool_result', id: 'live-result-1', turnId: 'turn-1', toolUseId: 'tool-1',
      isError: false, content: { kind: 'text', text: '' }, ts: 5,
    });

    assert.deepEqual(overlayLiveTurn(turns, settled, 'en')[0]?.tools[0]?.result, {
      kind: 'text',
      text: '',
    });
  });
});

function previewedSubagentTurn(): LiveTurnProjection {
  const started = applyLiveTurnEvent(undefined, {
    type: 'tool_start',
    id: 'event-1',
    turnId: 'turn-1',
    stepId: 'step-1',
    toolUseId: 'tool-1',
    toolName: 'Agent',
    args: { profile: 'local_read', task: 'Inspect' },
    ts: 100,
  });
  return applyLiveTurnEvent(started, {
    type: 'tool_result_preview',
    id: 'event-2',
    turnId: 'turn-1',
    toolUseId: 'tool-1',
    isError: false,
    content: {
      kind: 'subagent',
      childSessionId: 'child-session',
      agentId: 'local_read',
      agentName: 'Local Read',
      turnId: 'child-turn',
      runId: 'child-run',
      status: 'running',
      permissionMode: 'explore',
    },
    ts: 101,
  });
}

describe('context-compaction live row', () => {
  it('arms a rootExecutionKind projection from a context_compaction_started event', () => {
    const projection = applyLiveTurnEvent(undefined, {
      type: 'context_compaction_started',
      id: 'compaction-started-1',
      turnId: 'turn-compact',
      ts: 1,
    });
    assert.ok(projection);
    assert.equal(projection.turnId, 'turn-compact');
    assert.equal(projection.rootExecutionKind, 'context_compact');
    assert.equal(projection.steps.length, 0);
  });

  it('overlays exactly one localized "compacting" system row while running', () => {
    const projection = applyLiveTurnEvent(undefined, {
      type: 'context_compaction_started',
      id: 'compaction-started-1',
      turnId: 'turn-compact',
      ts: 1,
    });
    const turns = overlayLiveTurn([], projection, 'en');
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.turnId, 'turn-compact');
    assert.equal(turns[0]?.status, 'running');
    assert.equal(turns[0]?.notes.length, 1);
    assert.equal(
      turns[0]?.notes[0]?.text,
      getConversationCopy('en').messages.systemNotes.contextCompacting,
    );
  });

  it('merges the compacting note into an already-persisted running turn', () => {
    // Production persists a `turn_state:running` row for the compaction turn, so
    // materializeTurns yields an empty running turn before the live row arrives.
    const settled = [
      {
        turnId: 'turn-compact',
        status: 'running' as const,
        statusSource: 'recorded' as const,
        tools: [],
        notes: [],
        timeline: [],
        startedAt: 5,
      },
    ];
    const projection = applyLiveTurnEvent(undefined, {
      type: 'context_compaction_started',
      id: 'compaction-started-1',
      turnId: 'turn-compact',
      ts: 7,
    });
    const turns = overlayLiveTurn(settled, projection, 'en');
    assert.equal(turns.length, 1);
    assert.equal(turns[0]?.turnId, 'turn-compact');
    assert.equal(turns[0]?.notes.length, 1);
    assert.equal(
      turns[0]?.notes[0]?.text,
      getConversationCopy('en').messages.systemNotes.contextCompacting,
    );
    assert.equal(turns[0]?.notes[0]?.id, 'context-compaction:turn-compact');
    // Deterministic ts (no Date.now()): the note borrows the settled turn's start.
    assert.equal(turns[0]?.notes[0]?.ts, 5);
    // Idempotent across reprojection — no duplicate note.
    const again = overlayLiveTurn(turns, projection, 'en');
    assert.equal(again[0]?.notes.length, 1);
  });

  it('localizes the compacting row per locale', () => {
    const projection = applyLiveTurnEvent(undefined, {
      type: 'context_compaction_started',
      id: 'compaction-started-1',
      turnId: 'turn-compact',
      ts: 1,
    });
    assert.equal(
      overlayLiveTurn([], projection, 'zh-CN')[0]?.notes[0]?.text,
      getConversationCopy('zh-CN').messages.systemNotes.contextCompacting,
    );
    assert.notEqual(
      getConversationCopy('zh-CN').messages.systemNotes.contextCompacting,
      getConversationCopy('en').messages.systemNotes.contextCompacting,
    );
  });

  it('drops the row when the compaction turn completes with no content', () => {
    let projection = applyLiveTurnEvent(undefined, {
      type: 'context_compaction_started',
      id: 'compaction-started-1',
      turnId: 'turn-compact',
      ts: 1,
    });
    projection = applyLiveTurnEvent(projection, {
      type: 'complete',
      id: 'complete-1',
      turnId: 'turn-compact',
      ts: 2,
      stopReason: 'end_turn',
    });
    assert.equal(projection, undefined);
    assert.deepEqual(overlayLiveTurn([], projection, 'en'), []);
  });

  it('drops the running row when transcript reconciliation finds the compaction terminal', () => {
    const projection = applyLiveTurnEvent(undefined, {
      type: 'context_compaction_started',
      id: 'compaction-started-1',
      turnId: 'turn-compact',
      ts: 1,
    });
    assert.ok(projection);
    assert.equal(overlayLiveTurn([], projection, 'en')[0]?.status, 'running');

    const messages: StoredMessage[] = [
      {
        type: 'system_note',
        id: 'compaction-settled-1',
        turnId: 'turn-compact',
        ts: 2,
        kind: 'context_compacted',
      },
      {
        type: 'turn_state',
        id: 'turn-terminal-1',
        turnId: 'turn-compact',
        ts: 3,
        status: 'completed',
      },
    ];
    const reconciled = reconcileTerminalLiveTurn(projection, messages);
    const turns = overlayLiveTurn(materializeTurns(messages, 'en'), reconciled, 'en');

    assert.equal(reconciled, undefined);
    assert.deepEqual(
      turns[0]?.notes.map((note) => note.text),
      [getConversationCopy('en').messages.systemNotes.contextCompacted],
    );
  });
});

// A tool call is written by the model before it is run by the Runtime, and the
// two are different moments. Until this landed the row appeared at the second
// one, so a long argument list — a Write body, a long command — was a stretch of
// turn that looked stalled.
describe('a tool call while the model is still writing it', () => {
  const inputStart = {
    type: 'tool_input_start' as const,
    id: 'input-start-1',
    turnId: 'turn-1',
    ts: 100,
    toolUseId: 'tool-1',
    toolName: 'Write',
    activityKind: 'edit' as const,
    displayName: 'Write file',
    stepId: 'step-1',
  };
  const fragment = (offset: number, delta: string, ts: number) => ({
    type: 'tool_input_delta' as const,
    id: `input-delta-${offset}`,
    turnId: 'turn-1',
    ts,
    toolUseId: 'tool-1',
    offset,
    delta,
  });

  it('shows the tool by name before a single argument has arrived', () => {
    const projection = applyLiveTurnEvent(undefined, inputStart);
    const tool = projection.steps[0]?.tools[0];

    assert.equal(projection.steps[0]?.stepId, 'step-1');
    assert.equal(tool?.toolName, 'Write');
    assert.equal(tool?.args, undefined);
    // Without these the row picks the generic icon and the generic title, then
    // swaps both when the call is dispatched — the row visibly changing its mind.
    assert.equal(tool?.activityKind, 'edit');
    assert.equal(tool?.displayName, 'Write file');
    assert.deepEqual(tool?.input, { text: '' });
    assert.deepEqual(
      overlayLiveTurn([], projection, 'en')[0]?.timeline.map((item) => item.kind),
      ['tools'],
    );
  });

  // Every formatter in the transcript reads `args ?? argsPreview`, so mirroring
  // the stream's reading there is what makes the row name itself as it fills in —
  // without a single formatter knowing that a partial reading exists. What may
  // be shown is the stream's business (`tool-input-stream.test.ts`); that the
  // row wears it is this one's.
  it('names what the call does as the arguments arrive', () => {
    const started = applyLiveTurnEvent(undefined, inputStart);
    const path = applyLiveTurnEvent(started, fragment(0, '{"file_path":"/tmp/a.ts"', 101))!;
    const tool = path.steps[0]?.tools[0];

    assert.deepEqual(tool?.argsPreview, { file_path: '/tmp/a.ts' });
    assert.equal(tool?.argsPreview, tool?.input?.preview, 'the row wears what the stream read');
  });

  it('refuses a fragment that would concatenate onto the wrong offset', () => {
    const started = applyLiveTurnEvent(undefined, inputStart);
    const first = applyLiveTurnEvent(started, fragment(0, '{"file_path":"/tmp/a.ts"', 101))!;
    const replayed = applyLiveTurnEvent(first, fragment(0, '{"file_path":"/tmp/a.ts"', 102))!;
    const late = applyLiveTurnEvent(replayed, fragment(0, ',"content":"x"', 103))!;

    assert.equal(late.steps[0]?.tools[0]?.input?.text, '{"file_path":"/tmp/a.ts"');
    assert.deepEqual(late.steps[0]?.tools[0]?.argsPreview, { file_path: '/tmp/a.ts' });
  });

  // A client that joined mid-argument has no head to concatenate onto, so the
  // fragment is dropped rather than used to build a document missing its start.
  it('ignores a fragment for a call it never saw open', () => {
    assert.equal(applyLiveTurnEvent(undefined, fragment(6, '_path":"/tmp/a.ts"', 101)), undefined);
  });

  it('hands the row over to the real call without moving or duplicating it', () => {
    const started = applyLiveTurnEvent(undefined, inputStart);
    const written = applyLiveTurnEvent(started, fragment(0, '{"file_path":"/tmp/a.ts"', 101))!;
    const dispatched = applyLiveTurnEvent(written, {
      type: 'tool_start', id: 'start-1', turnId: 'turn-1', ts: 103, stepId: 'step-1',
      toolUseId: 'tool-1', toolName: 'Write', args: { file_path: '/tmp/a.ts', content: 'const a = 1\n' },
    });

    assert.equal(dispatched.steps.length, 1);
    assert.equal(dispatched.steps[0]?.tools.length, 1);
    const tool = dispatched.steps[0]?.tools[0];
    assert.equal(tool?.input, undefined, 'the arguments are here in full');
    assert.equal(tool?.argsPreview, undefined, 'the partial reading goes with it');
    assert.deepEqual(tool?.args, { file_path: '/tmp/a.ts', content: 'const a = 1\n' });
    assert.equal(tool?.status, 'running');
  });

  // Nothing ran and the ledger holds no call, so interrupting the row would pin
  // a record of something that did not happen.
  it('takes back a call whose arguments never finished arriving', () => {
    const started = applyLiveTurnEvent(undefined, inputStart);
    const written = applyLiveTurnEvent(started, fragment(0, '{"file_pa', 101))!;
    const aborted = applyLiveTurnEvent(written, {
      type: 'abort', id: 'abort-1', turnId: 'turn-1', ts: 102, reason: 'user_stop',
    });

    assert.equal(aborted, undefined);
  });

  it('keeps the answer that preceded it when only the call is taken back', () => {
    const answer = applyLiveTurnEvent(undefined, {
      type: 'text_complete', id: 'text-1', turnId: 'turn-1', ts: 99,
      messageId: 'step-1', text: '我来写这个文件',
    });
    const started = applyLiveTurnEvent(answer, inputStart);
    const aborted = applyLiveTurnEvent(started, {
      type: 'abort', id: 'abort-1', turnId: 'turn-1', ts: 102, reason: 'user_stop',
    });

    assert.deepEqual(aborted?.steps[0]?.tools, []);
    assert.deepEqual(aborted?.steps[0]?.contentOrder, ['text']);
    assert.equal(aborted?.steps[0]?.text?.text, '我来写这个文件');
  });
});

// `tool_start` carries the stepId of the assistant step it belongs to, so
// "model speaks, then calls a tool" is ONE step. An interjection that lands
// between the two is not the start of anything, and used to be appended to the
// end of the live timeline — the reader's own words shown after the tool they
// were trying to get ahead of.
describe('an interjection that lands in the middle of a step', () => {
  const steer = (id: string, ts: number, text: string) => ({
    type: 'steering_message' as const,
    id: `${id}-event`,
    messageId: id,
    turnId: 'turn-1',
    ts,
    content: { text },
  });
  const kinds = (projection: LiveTurnProjection) =>
    overlayLiveTurn([], projection, 'en')[0]?.timeline.map((item) =>
      item.kind === 'user' ? `user:${item.message.text}` : item.kind);

  it('renders between the answer and the tool that answer goes on to call', () => {
    const answer = applyLiveTurnEvent(undefined, {
      type: 'text_delta', id: 'text-1', messageId: 'step-1', turnId: 'turn-1', ts: 100,
      text: '我去查一下',
    });
    const interjected = applyLiveTurnEvent(answer, steer('steer-1', 101, '别查了'));
    const projection = applyLiveTurnEvent(interjected, {
      type: 'tool_start', id: 'start-1', turnId: 'turn-1', ts: 102, stepId: 'step-1',
      toolUseId: 'tool-1', toolName: 'Grep', args: {},
    });

    assert.deepEqual(kinds(projection), ['text', 'user:别查了', 'tools']);
  });

  it('renders between two calls of the same step', () => {
    let projection = applyLiveTurnEvent(undefined, {
      type: 'tool_start', id: 'start-1', turnId: 'turn-1', ts: 100, stepId: 'step-1',
      toolUseId: 'tool-1', toolName: 'Read', args: {},
    });
    projection = applyLiveTurnEvent(projection, steer('steer-1', 101, '等一下'))!;
    projection = applyLiveTurnEvent(projection, {
      type: 'tool_start', id: 'start-2', turnId: 'turn-1', ts: 102, stepId: 'step-1',
      toolUseId: 'tool-2', toolName: 'Read', args: {},
    });

    assert.deepEqual(kinds(projection), ['tools', 'user:等一下', 'tools']);
  });

  it('keeps two interjections in the order they arrived', () => {
    let projection = applyLiveTurnEvent(undefined, {
      type: 'text_delta', id: 'text-1', messageId: 'step-1', turnId: 'turn-1', ts: 100, text: '好',
    });
    projection = applyLiveTurnEvent(projection, steer('steer-1', 101, '第一句'))!;
    projection = applyLiveTurnEvent(projection, steer('steer-2', 102, '第二句'))!;

    assert.deepEqual(kinds(projection), ['text', 'user:第一句', 'user:第二句']);
  });

  it('renders an interjection that beat every step to the front', () => {
    const interjected = applyLiveTurnEvent(undefined, steer('steer-1', 99, '先说一句'));
    const projection = applyLiveTurnEvent(interjected, {
      type: 'text_delta', id: 'text-1', messageId: 'step-1', turnId: 'turn-1', ts: 100, text: '好',
    });

    assert.deepEqual(kinds(projection), ['user:先说一句', 'text']);
  });
});

// A step issues several calls at once and the provider interleaves their
// fragments. Each call is its own document with its own offsets, so the only
// thing keeping them apart is the id on every frame.
describe('several calls written at once', () => {
  const open = (toolUseId: string, toolName: string, ts: number) => ({
    type: 'tool_input_start' as const,
    id: `open-${toolUseId}`,
    turnId: 'turn-1',
    ts,
    toolUseId,
    toolName,
    stepId: 'step-1',
  });
  const part = (toolUseId: string, offset: number, delta: string, ts: number) => ({
    type: 'tool_input_delta' as const,
    id: `part-${toolUseId}-${offset}`,
    turnId: 'turn-1',
    ts,
    toolUseId,
    offset,
    delta,
  });

  it('keeps each call\'s arguments to itself', () => {
    let projection = applyLiveTurnEvent(undefined, open('tool-1', 'Read', 100));
    projection = applyLiveTurnEvent(projection, open('tool-2', 'Bash', 101))!;
    for (const event of [
      part('tool-1', 0, '{"file_path":"/tmp', 102),
      part('tool-2', 0, '{"command":"ls', 103),
      part('tool-1', 18, '/a.ts"}', 104),
      part('tool-2', 14, ' -la"}', 105),
    ]) {
      projection = applyLiveTurnEvent(projection, event)!;
    }

    // One step, two rows, in the order they were named.
    assert.equal(projection.steps.length, 1);
    const [first, second] = projection.steps[0]!.tools;
    assert.equal(first?.toolUseId, 'tool-1');
    assert.equal(second?.toolUseId, 'tool-2');
    assert.equal(first?.input?.text, '{"file_path":"/tmp/a.ts"}');
    assert.equal(second?.input?.text, '{"command":"ls -la"}');
    assert.deepEqual(first?.argsPreview, { file_path: '/tmp/a.ts' });
    assert.deepEqual(second?.argsPreview, { command: 'ls -la' });
  });

  // A hole is per call. The one that lost a fragment stops; the other does not
  // even notice, which is the whole reason the id is on every frame.
  it('breaks only the call that lost a fragment', () => {
    let projection = applyLiveTurnEvent(undefined, open('tool-1', 'Read', 100));
    projection = applyLiveTurnEvent(projection, open('tool-2', 'Bash', 101))!;
    for (const event of [
      part('tool-1', 0, '{"file_path":"/tmp/a.ts"', 102),
      part('tool-2', 0, '{"command":"ls', 103),
      part('tool-1', 99, ',"offset":1}', 104),
      part('tool-2', 14, ' -la"}', 105),
    ]) {
      projection = applyLiveTurnEvent(projection, event)!;
    }

    const [first, second] = projection.steps[0]!.tools;
    assert.equal(first?.input?.broken, true);
    assert.deepEqual(first?.argsPreview, { file_path: '/tmp/a.ts' }, 'frozen at the valid prefix');
    assert.equal(second?.input?.broken, undefined);
    assert.deepEqual(second?.argsPreview, { command: 'ls -la' }, 'untouched by its neighbour');
  });

  // Each row is its own timeline entry, stamped when it appeared, so an
  // interjection can land between two calls of the same step.
  it('gives each call its own row in the timeline', () => {
    let projection = applyLiveTurnEvent(undefined, open('tool-1', 'Read', 100));
    projection = applyLiveTurnEvent(projection, part('tool-1', 0, '{"file_path":"/a"}', 101))!;
    projection = applyLiveTurnEvent(projection, open('tool-2', 'Bash', 102))!;
    projection = applyLiveTurnEvent(projection, part('tool-2', 0, '{"command":"ls"}', 103))!;

    const timeline = overlayLiveTurn([], projection, 'en')[0]?.timeline ?? [];
    assert.deepEqual(
      timeline.flatMap((item) => (item.kind === 'tools' ? item.items.map((t) => t.toolUseId) : [])),
      ['tool-1', 'tool-2'],
    );
  });
});

// A live `tool_result` carries a STATUS and no body: the Host omits the content
// and the client rebuilds it as `contentOmitted`. Asking for the body as proof
// that a call ran therefore threw away a call that had already returned — and
// with it the step, and with it the whole Turn.
describe('a completed call whose dispatch frame was lost', () => {
  it('survives the terminal on its status, with no result body to show', () => {
    // `tool_start` never arrives — shed behind a backlog, or missed across a
    // resubscribe — so the row still carries the arriving `input`.
    const opened = applyLiveTurnEvent(undefined, {
      type: 'tool_input_start', id: 'open', turnId: 'turn-1', ts: 100,
      toolUseId: 'tool-1', toolName: 'Read', stepId: 'step-1',
    });
    const returned = applyLiveTurnEvent(opened, {
      type: 'tool_result', id: 'r1', turnId: 'turn-1', ts: 200,
      toolUseId: 'tool-1', isError: false, contentOmitted: true,
      content: { kind: 'text', text: '' },
    })!;
    assert.equal(returned.steps[0]?.tools[0]?.status, 'completed');
    assert.equal(returned.steps[0]?.tools[0]?.result, undefined, 'status without a body');
    assert.notEqual(returned.steps[0]?.tools[0]?.input, undefined);

    const settled = applyLiveTurnEvent(returned, {
      type: 'complete', id: 'done', turnId: 'turn-1', ts: 300, stopReason: 'end_turn',
    });
    assert.notEqual(settled, undefined, 'the Turn does not vanish');
    assert.equal(settled?.steps[0]?.tools.length, 1, 'and neither does the call');
  });
});

// Whatever the stream did on the way — a bound reached, a fragment lost — the
// call still settles on the arguments that arrive whole.
describe('a call that settles after a troubled stream', () => {
  it('hands the row over to the arguments that arrive whole', () => {
    const opened = applyLiveTurnEvent(undefined, {
      type: 'tool_input_start', id: 'start', turnId: 'turn-1', ts: 100,
      toolUseId: 'tool-1', toolName: 'Bash', stepId: 'step-1',
    });
    const written = applyLiveTurnEvent(opened, {
      type: 'tool_input_delta', id: 'd0', turnId: 'turn-1', ts: 101,
      toolUseId: 'tool-1', offset: 0, delta: '{"command":"ls',
    })!;
    const gapped = applyLiveTurnEvent(written, {
      type: 'tool_input_delta', id: 'd2', turnId: 'turn-1', ts: 102,
      toolUseId: 'tool-1', offset: 20, delta: ' -la"}',
    })!;
    assert.equal(gapped.steps[0]?.tools[0]?.input?.broken, true);

    const dispatched = applyLiveTurnEvent(gapped, {
      type: 'tool_start', id: 'start-1', turnId: 'turn-1', ts: 200, stepId: 'step-1',
      toolUseId: 'tool-1', toolName: 'Bash', args: { command: 'ls -la' },
    });

    assert.equal(dispatched.steps[0]?.tools[0]?.input, undefined);
    assert.deepEqual(dispatched.steps[0]?.tools[0]?.args, { command: 'ls -la' });
  });

  // Only `tool_start` clears `input`, so a client that missed that one frame —
  // shed behind a backlog, or evicted and resubscribed across it — still carries
  // it on a call that ran and returned. Dropping on `input` alone deleted it.
  it('keeps a call that ran, even without the frame that dispatched it', () => {
    const opened = applyLiveTurnEvent(undefined, {
      type: 'tool_input_start', id: 'start', turnId: 'turn-1', ts: 100,
      toolUseId: 'tool-1', toolName: 'Write', stepId: 'step-1',
    });
    const returned = applyLiveTurnEvent(opened, {
      type: 'tool_result', id: 'result-1', turnId: 'turn-1', ts: 101,
      toolUseId: 'tool-1', isError: false, content: { kind: 'text', text: 'written' },
    });
    const completed = applyLiveTurnEvent(returned, {
      type: 'complete', id: 'complete-1', turnId: 'turn-1', ts: 102, stopReason: 'end_turn',
    });

    assert.equal(completed?.steps[0]?.tools.length, 1, 'the call that returned is still there');
    assert.equal(completed?.steps[0]?.tools[0]?.status, 'completed');
  });

  it('drops a Turn that completes with nothing but an abandoned call', () => {
    const opened = applyLiveTurnEvent(undefined, {
      type: 'tool_input_start', id: 'start', turnId: 'turn-1', ts: 100,
      toolUseId: 'tool-1', toolName: 'Write', stepId: 'step-1',
    });
    const completed = applyLiveTurnEvent(opened, {
      type: 'complete', id: 'complete-1', turnId: 'turn-1', ts: 101, stopReason: 'end_turn',
    });

    assert.equal(completed, undefined, 'not a terminal husk with no steps in it');
  });
});

// A retried attempt is the request taken from the top. A call it had half
// written will never be dispatched, so it has no counterpart in the ledger to
// settle against — left alone it shimmers as a running call for the whole Turn.
describe('an attempt that is retried', () => {
  it('takes back the calls it was part way through writing', () => {
    const answered = applyLiveTurnEvent(undefined, {
      type: 'text_complete', id: 'text-1', turnId: 'turn-1', ts: 99,
      messageId: 'step-1', text: 'Let me look.',
    });
    const writing = applyLiveTurnEvent(answered, {
      type: 'tool_input_start', id: 'start', turnId: 'turn-1', ts: 100,
      toolUseId: 'tool-1', toolName: 'Bash', stepId: 'step-1',
    });
    const retried = applyLiveTurnEvent(writing, {
      type: 'provider_retry', id: 'retry-1', turnId: 'turn-1', ts: 101,
      phase: 'scheduled', attempt: 2, maxAttempts: 10, delayMs: 1_000, reason: 'rate_limit',
    });

    assert.deepEqual(retried?.steps[0]?.tools, [], 'the half-written call is gone');
    assert.deepEqual(retried?.steps[0]?.contentOrder, ['text']);
    assert.equal(retried?.steps[0]?.text?.text, 'Let me look.', 'the answer before it stays');
    assert.ok(retried?.providerRetry, 'and the retry is still projected');
  });

  it('leaves a call that was already dispatched alone', () => {
    const dispatched = applyLiveTurnEvent(undefined, {
      type: 'tool_start', id: 'start-1', turnId: 'turn-1', ts: 100, stepId: 'step-1',
      toolUseId: 'tool-1', toolName: 'Bash', args: { command: 'ls' },
    });
    const retried = applyLiveTurnEvent(dispatched, {
      type: 'provider_retry', id: 'retry-1', turnId: 'turn-1', ts: 101,
      phase: 'scheduled', attempt: 2, maxAttempts: 10, delayMs: 1_000, reason: 'rate_limit',
    });

    assert.equal(retried?.steps[0]?.tools.length, 1);
  });
});
