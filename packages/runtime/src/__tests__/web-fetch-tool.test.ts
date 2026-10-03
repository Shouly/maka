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
import type { ZodType } from 'zod';
import type { MakaToolContext } from '../tool-runtime.js';
import { buildWebFetchTool, WEB_FETCH_MODEL_OUTPUT_MAX_BYTES } from '../web-fetch-tool.js';

test('WebFetch returns the page the service read, under the address it read it at', async () => {
  let received: { url: string; sessionId: string; abortSignal?: AbortSignal } | undefined;
  const tool = buildWebFetchTool({
    fetch: async (input) => {
      received = input;
      return { url: 'https://example.com/moved', content: '# Page\n\nBody.' };
    },
  });
  const abort = new AbortController();

  const result = await tool.impl({ url: 'https://example.com/a/../page' }, context(abort.signal));

  assert.equal(result, 'URL: https://example.com/moved\n\n# Page\n\nBody.');
  assert.deepEqual(received, {
    url: 'https://example.com/page',
    sessionId: 'session-1',
    abortSignal: abort.signal,
  });
});

test('WebFetch takes one HTTP or HTTPS url and nothing else', () => {
  const tool = buildWebFetchTool({ fetch: async ({ url }) => ({ url, content: 'unused' }) });
  const parameters = tool.parameters as ZodType;

  assert.deepEqual(parameters.parse({ url: 'https://example.com/page' }), {
    url: 'https://example.com/page',
  });
  assert.throws(() => parameters.parse({}));
  assert.throws(() => parameters.parse({ url: 'file:///tmp/secret' }));
  assert.throws(() => parameters.parse({ url: 'https://example.com', prompt: 'summarise' }));
});

test('WebFetch bounds a long page with a truncation marker', async () => {
  const tool = buildWebFetchTool({
    fetch: async ({ url }) => ({ url, content: `begin:${'x'.repeat(60 * 1024)}:end` }),
  });

  const result = await tool.impl(
    { url: 'https://example.com/large' },
    context(new AbortController().signal),
  );

  assert.ok(typeof result === 'string');
  assert.match(result, /^URL: https:\/\/example\.com\/large\n\nbegin:/);
  assert.doesNotMatch(result, /:end$/);
  assert.match(result, /WebFetch content truncated/);
  const content = result.slice(result.indexOf('\n\n') + 2);
  assert.ok(Buffer.byteLength(content, 'utf8') <= WEB_FETCH_MODEL_OUTPUT_MAX_BYTES);
});

function context(abortSignal: AbortSignal): MakaToolContext {
  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    cwd: '/tmp',
    toolCallId: 'tool-1',
    abortSignal,
    emitOutput: () => {},
  };
}
