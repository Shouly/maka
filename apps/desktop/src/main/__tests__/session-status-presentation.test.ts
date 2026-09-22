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
import { describe, it } from 'node:test';
import type { TurnViewModel } from '@maka/ui';
import { deriveTurnPresentation as deriveAppShellTurnPresentation } from '../../renderer/hooks/use-turn-presentation.js';
import {
  describeFailedTurnExecutionState,
  describeTurnErrorClass,
  deriveFailedTurnSeverity,
} from '../../renderer/lib/ported/session-status-presentation.js';

const NOTHING_RAN = {
  ranCount: 0,
  failureKinds: [],
};

describe('failed turn presentation', () => {
  it('presents persisted provider server errors as provider failures', () => {
    assert.match(describeTurnErrorClass('server_error', 'zh-CN'), /模型服务返回错误/);
    assert.match(describeTurnErrorClass('server_error', 'zh-TW'), /模型服務回傳錯誤/);
    assert.match(describeTurnErrorClass('server_error', 'en'), /model service returned an error/i);
    // Before #3758 the adapter persisted these codes with an unknown kind.
    assert.equal(describeTurnErrorClass('ECONNRESET', 'en'), describeTurnErrorClass('network', 'en'));
  });

  it('says what to do next beside the cause, not why the runtime declined to retry', () => {
    // `side_effects` has no line of its own: the tools that caused it are the
    // ones the reader has to look at, and they are right there on the rows.
    const turn: TurnViewModel = {
      turnId: 't1', status: 'failed', errorClass: 'network',
      retry: { decision: 'declined', because: 'side_effects' },
      tools: [{ toolUseId: 'tool-1', toolName: 'Bash', status: 'completed', args: {} }],
      timeline: [], notes: [], startedAt: 1,
    };
    const presentation = deriveAppShellTurnPresentation([turn], {
      activeId: 'session-1', pendingTurnActions: new Set<string>(), uiLocale: 'zh-CN',
    });
    assert.equal(presentation.failedReasonLabels.t1, '网络连接失败，请检查网络。');
    assert.equal(presentation.failedExecutionStateLabels.t1,
      '它可能已经改过东西了。再发之前，先看一眼上面做了什么。');
    assert.equal(describeTurnErrorClass('rate_limit', 'zh-CN'), '模型请求太频繁被限流了。');
    assert.equal(describeTurnErrorClass('timeout', 'zh-CN'), '模型请求超时。');
  });

  it('grades continuable outcomes below outcomes the user must act on', () => {
    assert.equal(deriveFailedTurnSeverity('app_restarted'), 'warning');
    assert.equal(deriveFailedTurnSeverity('tool_step_cap_reached'), 'warning');
    assert.equal(deriveFailedTurnSeverity('permission_required'), 'warning');
    assert.equal(deriveFailedTurnSeverity('auth'), 'error');
    assert.equal(deriveFailedTurnSeverity('context_overflow'), 'error');
    assert.equal(deriveFailedTurnSeverity(undefined), 'error');
  });
});

describe('failed turn execution state', () => {
  it('tells the reader what to do rather than what the runtime recorded', () => {
    // A blind resend after a side-effecting tool can repeat that effect, so
    // this has to survive alongside a transport failure like `timeout`.
    const ran = { ...NOTHING_RAN, ranCount: 1 };
    assert.equal(
      describeFailedTurnExecutionState(ran, 'zh-CN'),
      '它可能已经改过东西了。再发之前，先看一眼上面做了什么。',
    );
    // "may": a Read runs and changes nothing, so this line may never assert
    // that something was changed.
    assert.match(describeFailedTurnExecutionState(ran, 'en') ?? '', /may already have changed/i);
  });

  it('never promises that a refused call left nothing behind', () => {
    // A Bash command graded `denied` got that grade from its terminal result,
    // so it RAN — it can have written inside the workspace before the sandbox
    // stopped it. "nothing changed" would be a guarantee this slot cannot make.
    const unchanged = /什么都没改|什麼都沒改|nothing (was )?changed/i;
    for (const kind of ['refused', 'denied'] as const) {
      for (const locale of ['zh-CN', 'zh-TW', 'en'] as const) {
        const line = describeFailedTurnExecutionState(
          { ...NOTHING_RAN, failureKinds: [kind] },
          locale,
        );
        assert.ok(line);
        assert.doesNotMatch(line, unchanged);
      }
    }
  });

  it('separates a refusal from a failure', () => {
    const refused = { ...NOTHING_RAN, failureKinds: ['refused' as const] };
    assert.equal(
      describeFailedTurnExecutionState(refused, 'zh-CN'),
      '有一步没被允许执行，这件事没做完。先看一眼上面做到哪了，再决定怎么说。',
    );
    assert.equal(
      describeFailedTurnExecutionState({ ...refused, failureKinds: ['denied' as const] }, 'en'),
      describeFailedTurnExecutionState(refused, 'en'),
    );
    assert.match(
      describeFailedTurnExecutionState({ ...NOTHING_RAN, failureKinds: ['failed' as const] }, 'zh-CN') ?? '',
      /改到一半/,
    );
  });

  it('does not let execution state displace the error class', () => {
    // The retired recovery derivation ranked these against each other and let
    // the tool branch win, so `auth` plus an errored tool advised "inspect the
    // tool result" and dropped the sign-in step. They are separate slots now.
    const state = { ...NOTHING_RAN, ranCount: 1, failureKinds: ['failed' as const] };
    assert.match(describeTurnErrorClass('auth', 'zh-CN'), /重新连接或登录/);
    assert.match(describeFailedTurnExecutionState(state, 'zh-CN') ?? '', /改到一半/);
    assert.match(describeTurnErrorClass('context_overflow', 'zh-CN'), /减少附件|开启新任务/);
    assert.match(describeFailedTurnExecutionState(state, 'zh-TW') ?? '', /改到一半/);
  });

  it('offers no execution guidance for a Turn that ran nothing', () => {
    assert.equal(describeFailedTurnExecutionState(NOTHING_RAN, 'zh-CN'), undefined);
    // `policy` and `budget` answer a question the reader never asked.
    assert.equal(
      describeFailedTurnExecutionState(
        { ...NOTHING_RAN, retry: { decision: 'declined', because: 'policy' } },
        'zh-CN',
      ),
      undefined,
    );
  });

  it('keeps the two facts the tool rows cannot show', () => {
    assert.match(
      describeFailedTurnExecutionState(
        { ...NOTHING_RAN, retry: { decision: 'declined', because: 'observable_output' } },
        'zh-CN',
      ) ?? '',
      /内容还在/,
    );
    assert.match(
      describeFailedTurnExecutionState({ ...NOTHING_RAN, retry: { decision: 'exhausted', attempts: 3 } }, 'zh-CN') ?? '',
      /自己试过几次/,
    );
  });

  it('never tells the reader to do what the line above says not to', () => {
    // `context_overflow` says start a new task; `auth` says sign in again.
    // Advice in this slot that said "send another message" would contradict
    // both, so no branch here prescribes sending.
    const send = /再发一次|重发一次|send it again|send another/i;
    for (const state of [
      { ...NOTHING_RAN, failureKinds: ['failed' as const] },
      { ...NOTHING_RAN, failureKinds: ['refused' as const] },
      { ...NOTHING_RAN, ranCount: 1 },
      { ...NOTHING_RAN, retry: { decision: 'exhausted' as const, attempts: 3 } },
    ]) {
      for (const locale of ['zh-CN', 'zh-TW', 'en'] as const) {
        assert.doesNotMatch(describeFailedTurnExecutionState(state, locale) ?? '', send);
      }
    }
  });

  it('prefers the most specific state the turn reached', () => {
    const all = { ranCount: 1, failureKinds: ['failed' as const] };
    assert.match(describeFailedTurnExecutionState(all, 'zh-CN') ?? '', /改到一半/);
    assert.match(
      describeFailedTurnExecutionState({ ...all, failureKinds: [] }, 'zh-CN') ?? '',
      /先看一眼上面/,
    );
  });
});


it('does not hide a terminal diagnostic behind a sandbox tool failure or promote a tool failure to a failed turn', () => {
  const turn: TurnViewModel = { turnId: 't1', status: 'failed', errorClass: 'unknown', failureMessage: 'Provider request failed after the tool result', tools: [{ toolUseId: 'tool-1', toolName: 'Bash', status: 'errored', args: {}, failure: { kind: 'denied', class: 'sandbox_denial', message: 'Operation not permitted' }, result: { kind: 'text', text: 'Operation not permitted' } }], timeline: [], notes: [], startedAt: 1 };
  const context = { activeId: 'session-1', pendingTurnActions: new Set<string>(), uiLocale: 'en' as const };
  assert.ok(deriveAppShellTurnPresentation([turn], context).failedReasonLabels.t1);
  assert.equal(deriveAppShellTurnPresentation([{ ...turn, status: 'completed' }], context).failedReasonLabels.t1, undefined);
});
