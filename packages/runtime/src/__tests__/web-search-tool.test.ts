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
import test from 'node:test';
import type { ZodType } from 'zod';
import type { MakaToolContext } from '../tool-runtime.js';
import { buildWebSearchTool, webSearchToolResultToModelOutput } from '../web-search-tool.js';

function context(): MakaToolContext {
  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    cwd: '/tmp',
    toolCallId: 'tool-1',
    operationId: 'toolop-1',
    abortSignal: new AbortController().signal,
    emitOutput: () => {},
  };
}

test('WebSearch takes the reference parameters and forwards domain filters', async () => {
  let received: unknown;
  const tool = buildWebSearchTool({
    search: async (input) => {
      received = input;
      return {
        ok: true,
        results: [
          {
            provider: 'tavily',
            title: 'Maka',
            url: 'https://maka.example/current',
            snippet: 'Current information.',
            source: 'maka.example',
          },
        ],
      };
    },
  });
  const parameters = tool.parameters as ZodType;
  assert.throws(() => parameters.parse({ query: 'x' }), /2/u);
  assert.throws(() => parameters.parse({ query: 'maka', limit: 3 }));
  assert.deepEqual(parameters.parse({ query: 'maka', allowed_domains: ['a.example'] }), {
    query: 'maka',
    allowed_domains: ['a.example'],
  });

  const ctx = context();
  const result = await tool.impl(
    { query: 'latest maka', allowed_domains: ['a.example'], blocked_domains: ['b.example'] },
    ctx,
  );
  assert.deepEqual(received, {
    query: 'latest maka',
    limit: 5,
    allowedDomains: ['a.example'],
    blockedDomains: ['b.example'],
    sessionId: 'session-1',
    abortSignal: ctx.abortSignal,
  } as never);
  const output = webSearchToolResultToModelOutput(result);
  assert.equal(output.type, 'text');
  const text = output.type === 'text' ? output.value : '';
  assert.equal(
    text,
    [
      'Web search results for query: "latest maka"',
      '',
      'Links: [{"title":"Maka","url":"https://maka.example/current","snippet":"Current information."}]',
      '',
      '',
      'REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.',
    ].join('\n'),
  );
});

test('WebSearch failures reach the model as an error line', async () => {
  const tool = buildWebSearchTool({
    search: async () => ({ ok: false, reason: 'rate_limited', message: 'Slow down.' }),
  });
  const result = await tool.impl({ query: 'anything' }, context());
  const output = webSearchToolResultToModelOutput(result);
  assert.equal(output.type, 'error-text');
  assert.equal(
    output.type === 'error-text' ? output.value : '',
    'Web search failed (rate_limited): Slow down.',
  );
});
