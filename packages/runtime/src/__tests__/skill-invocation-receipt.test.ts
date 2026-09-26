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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  failedSkillInvocationReceipt,
  skillInvocationReceiptTraceData,
} from '../skill-invocation-receipt.js';

describe('skill invocation receipt', () => {
  it('strips control characters and bounds the request', () => {
    const receipt = failedSkillInvocationReceipt('deck\u0000\u001b[31m\nhelper', 'not_found');
    assert.equal(receipt.request, 'deck[31mhelper');
    assert.equal(failedSkillInvocationReceipt('\u0000\u0007', 'invalid_name').request, '[invalid]');

    // 512 bytes, cut on a character boundary: a three-byte character that
    // would straddle the limit is dropped whole.
    const bounded = failedSkillInvocationReceipt(`${'a'.repeat(510)}中文`, 'not_found');
    assert.equal(bounded.request, 'a'.repeat(510));
  });

  it('traces the request length, never its text', () => {
    const data = skillInvocationReceiptTraceData(
      failedSkillInvocationReceipt('secret-name', 'disabled'),
    );
    assert.deepEqual(data, {
      invocation: 'model_tool',
      success: false,
      reason: 'disabled',
      requestChars: 'secret-name'.length,
    });
  });
});
