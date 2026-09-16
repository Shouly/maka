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
import {
  buildWebFetchTool,
  routeWebFetchTools,
  WEB_FETCH_MODEL_OUTPUT_MAX_BYTES,
} from '../web-fetch-tool.js';
import type { MakaToolContext } from '../tool-runtime.js';

test('WebFetch forwards the canonical URL to its executor', async () => {
  let received: { url: string; sessionId: string; abortSignal?: AbortSignal } | undefined;
  const tool = buildWebFetchTool({
    fetch: async (input) => {
      received = input;
      return 'page body';
    },
  });
  const abort = new AbortController();

  const result = await tool.impl(
    { url: 'https://example.com/a/../page', prompt: 'What is on the page?' },
    context(abort.signal),
  );

  assert.match(String(result), /No summarising model is available/u);
  assert.match(String(result), /page body$/u);
  assert.deepEqual(received, {
    url: 'https://example.com/page',
    sessionId: 'session-1',
    abortSignal: abort.signal,
  });
});

test('WebFetch accepts only an HTTP or HTTPS url argument', () => {
  const tool = buildWebFetchTool({ fetch: async () => 'unused' });
  const parameters = tool.parameters as ZodType;

  assert.deepEqual(parameters.parse({ url: 'https://example.com/page', prompt: 'summarise' }), {
    url: 'https://example.com/page',
    prompt: 'summarise',
  });
  assert.throws(() => parameters.parse({ url: 'https://example.com/page' }));
  assert.throws(() => parameters.parse({ url: 'file:///tmp/secret', prompt: 'x' }));
  assert.throws(() => parameters.parse({ url: 'https://example.com', prompt: 'x', maxBytes: 1 }));
});

test('WebFetch bounds model output with a head-truncation marker', async () => {
  const tool = buildWebFetchTool({ fetch: async () => `begin:${'x'.repeat(60 * 1024)}:end` });

  const result = await tool.impl(
    { url: 'https://example.com/large', prompt: 'summarise' },
    context(new AbortController().signal),
  );

  assert.ok(typeof result === 'string');
  assert.match(result, /\n\nbegin:/);
  assert.doesNotMatch(result, /:end$/);
  assert.match(result, /WebFetch content truncated/);
  const content = result.slice(result.indexOf('\n\n') + 2);
  assert.ok(Buffer.byteLength(content, 'utf8') <= WEB_FETCH_MODEL_OUTPUT_MAX_BYTES);
});

test('WebFetch answers the prompt with the executor model when one is wired', async () => {
  let asked: { url: string; prompt: string; content: string } | undefined;
  const tool = buildWebFetchTool({
    fetch: async () => 'the page says hello',
    answer: async (input) => {
      asked = { url: input.url, prompt: input.prompt, content: input.content };
      return 'It says hello.';
    },
  });

  const result = await tool.impl(
    { url: 'https://example.com/page', prompt: 'What does it say?' },
    context(new AbortController().signal),
  );

  assert.equal(result, 'It says hello.');
  assert.deepEqual(asked, {
    url: 'https://example.com/page',
    prompt: 'What does it say?',
    content: 'the page says hello',
  });
});

test('privacy mode removes WebFetch from a turn', () => {
  const webFetch = buildWebFetchTool({ fetch: async () => 'unused' });
  const other = { ...webFetch, name: 'Read' };

  assert.deepEqual(
    routeWebFetchTools([other, webFetch], { incognitoActive: true }).map((tool) => tool.name),
    ['Read'],
  );
  assert.deepEqual(
    routeWebFetchTools([other, webFetch], { incognitoActive: false }).map((tool) => tool.name),
    ['Read', 'WebFetch'],
  );
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
