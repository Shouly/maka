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
import { organizationQuotaFailureMessage } from '@maka/core/model-failure';

import { describeSessionErrorReason } from '../../renderer/lib/ported/session-error-presentation.js';
import { sessionEventErrorMessage } from '../../renderer/lib/ported/model-connection-errors.js';
import { describeTurnErrorClass } from '../../renderer/lib/ported/session-status-presentation.js';

describe('provider capacity presentation', () => {
  it('uses capacity-specific copy instead of the unknown error fallback', () => {
    assert.match(describeSessionErrorReason('provider_capacity', 'zh-CN') ?? '', /满载/);
    assert.match(describeSessionErrorReason('provider_capacity', 'en') ?? '', /at capacity/);
    assert.equal(describeTurnErrorClass('provider_capacity', 'zh-CN'), '模型服务暂时满载。');
    assert.equal(describeTurnErrorClass('provider_capacity', 'en'), 'The model service is temporarily at capacity.');
  });
});

describe('organisation gateway presentation', () => {
  it('tells when a used-up allowance resets, in the reader’s own clock and language', () => {
    const resetsAt = Date.parse('2026-10-05T00:00:00.000Z');
    const message = organizationQuotaFailureMessage(resetsAt);
    const when = new Intl.DateTimeFormat('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(resetsAt);
    const label = describeTurnErrorClass('organization_quota', 'zh-CN', message);
    assert.ok(label.includes(when), label);
    assert.match(label, /额度本期已用完/);
    // The live toast says the same, from the event's message.
    assert.equal(
      sessionEventErrorMessage(
        { type: 'error', reason: 'organization_quota', message } as never,
        'zh-CN',
      ),
      label,
    );
    // Without a reset in the message there is still something to say.
    assert.match(describeTurnErrorClass('organization_quota', 'en', 'Organization model allowance used up'), /used up/);
  });

  it('names the other organisation refusals', () => {
    assert.match(describeTurnErrorClass('organization_model_denied', 'zh-CN'), /没有为你开放/);
    assert.match(describeTurnErrorClass('organization_sign_in', 'zh-CN'), /重新登录/);
    assert.match(describeTurnErrorClass('organization_upgrade', 'zh-CN'), /请更新/);
  });
});
