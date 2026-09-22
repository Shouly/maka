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

// The memory store's refusals, graded where the truth is known.
//
// Every one of these is the store working correctly and saying no, with the
// reason and the way forward. Thrown as plain Errors they reached the
// transcript as `failed` — the grade for something broken — and the renderer
// had to recover which one it was with a regex over the message text. That
// regex could not run on a live row, because the text is the result body and
// the body is exactly what a live frame omits: the same write drew as a red
// failure while it ran and as "merging…" once the turn ended.
//
// Two of these classes are load-bearing for the renderer (`version_conflict`
// and `exists` are the merge-and-retry handshake it must not paint as a
// failure), so they are asserted by name.

import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolRefusal } from '@maka/core/events';
import {
  buildMemoryStrReplaceTool,
  buildMemoryWriteTool,
  type MemoryToolMutationResult,
  type MemoryToolStore,
} from '../memory-tools.js';

const CURRENT = {
  path: '/memories/topics/food.md',
  content: 'oolong every morning',
  version: 'v2',
  byteLength: 20,
  updatedAt: 1,
};

function storeReturning(result: MemoryToolMutationResult): MemoryToolStore {
  const refuse = async () => result;
  return {
    list: async () => ({ entries: [], nextCursor: null }),
    read: async () => CURRENT,
    write: refuse,
    strReplace: refuse,
    append: refuse,
    delete: refuse,
  } as unknown as MemoryToolStore;
}

async function refusalFrom(
  build: typeof buildMemoryWriteTool,
  result: MemoryToolMutationResult,
  args: Record<string, unknown>,
): Promise<ToolRefusal> {
  const tool = build({ store: storeReturning(result), gate: async () => ({ allowed: true }) });
  let error: unknown;
  try {
    await tool.impl(args, {
      toolCallId: 'call-1',
      abortSignal: new AbortController().signal,
    } as never);
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error instanceof ToolRefusal, `expected a refusal, got ${String(error)}`);
  return error;
}

test('a version conflict is a refusal the renderer can recognise before the body lands', async () => {
  const refusal = await refusalFrom(
    buildMemoryWriteTool,
    { kind: 'version_conflict', current: CURRENT },
    { path: '/memories/topics/food.md', content: 'pu-erh now', if_version: 'v1' },
  );
  // The class is what survives into the live frame; the renderer keys the
  // merge-and-retry handshake on this exact value.
  assert.equal(refusal.failureClass, 'version_conflict');
  // The model gets the current content so it can merge in the same turn …
  assert.match(refusal.message, /oolong every morning/);
  // … and the reader gets one line that is not a dump of their own memory.
  assert.ok(refusal.summary);
  assert.doesNotMatch(refusal.summary, /oolong every morning/);
});

test('writing `new` over a file that exists is the other merge-and-retry class', async () => {
  const refusal = await refusalFrom(
    buildMemoryWriteTool,
    { kind: 'exists', current: CURRENT },
    { path: '/memories/topics/food.md', content: 'pu-erh now', if_version: 'new' },
  );
  assert.equal(refusal.failureClass, 'exists');
  assert.doesNotMatch(refusal.summary ?? '', /oolong every morning/);
});

test('a failed match is a refusal too, and names itself', async () => {
  const notFound = await refusalFrom(
    buildMemoryStrReplaceTool,
    { kind: 'old_str_not_found', current: CURRENT },
    { path: '/memories/topics/food.md', old_str: 'absent', new_str: 'x', if_version: 'v2' },
  );
  assert.equal(notFound.failureClass, 'old_str_not_found');

  const ambiguous = await refusalFrom(
    buildMemoryStrReplaceTool,
    { kind: 'old_str_ambiguous', matches: 3, current: CURRENT },
    { path: '/memories/topics/food.md', old_str: 'e', new_str: 'x', if_version: 'v2' },
  );
  assert.equal(ambiguous.failureClass, 'old_str_ambiguous');
  assert.match(ambiguous.summary ?? '', /3 times/);
});

test('a refusal with nothing extra to say carries no summary at all', async () => {
  // `oversize` is one sentence already; a summary would be the same words
  // twice, and the envelope falls back to the message.
  const refusal = await refusalFrom(
    buildMemoryWriteTool,
    { kind: 'oversize', byteLength: 900_000, limit: 100_000 },
    { path: '/memories/topics/food.md', content: 'x', if_version: 'v2' },
  );
  assert.equal(refusal.failureClass, 'oversize');
  assert.equal(refusal.summary, undefined);
  assert.match(refusal.message, /the limit is 100000 bytes/);
});
