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
import type { ModelMessage } from '../model-protocol.js';
import { composeRequestProjection, type RequestProjectionContext } from '../request-projection.js';

function context(messages: ModelMessage[]): RequestProjectionContext {
  return {
    completedSteps: [],
    stepNumber: 1,
    model: {},
    messages,
    resolveDispatch: (active) => ({ systemPromptChars: 0, activeTools: [...(active ?? [])] }),
  };
}

describe('request projection', () => {
  test('composes the active tool set with rewritten messages', async () => {
    const original: ModelMessage[] = [{ role: 'user', content: 'original' }];
    const rewritten: ModelMessage[] = [{ role: 'user', content: 'rewritten' }];
    let seenActiveTools: readonly string[] | undefined;
    const composed = composeRequestProjection(
      () => ({ activeTools: ['Read', 'ToolSearch'] }),
      (options) => {
        seenActiveTools = options.activeTools;
        return { messages: rewritten };
      },
    );

    assert.ok(composed);
    const result = await composed(context(original));

    // The message stage shapes the request the tool stage already narrowed.
    assert.deepEqual(seenActiveTools, ['Read', 'ToolSearch']);
    assert.deepEqual(result?.activeTools, ['Read', 'ToolSearch']);
    assert.deepEqual(result?.messages, rewritten);
  });

  test('is absent when no stage is bound', () => {
    assert.equal(composeRequestProjection(undefined, undefined), undefined);
  });
});
