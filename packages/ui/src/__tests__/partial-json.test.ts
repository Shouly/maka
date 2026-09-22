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
import { readPartialJson } from '../partial-json.js';

describe('readPartialJson', () => {
  it('says nothing about an empty fragment', () => {
    for (const fragment of ['', '  ']) {
      assert.deepEqual(readPartialJson(fragment), { value: undefined, complete: false });
    }
  });

  it('reads a fragment with no closed key as the empty object it already is', () => {
    for (const fragment of ['{', '{"fil', '{"file_path"', '{"file_path":']) {
      assert.deepEqual(readPartialJson(fragment), { value: {}, complete: false });
    }
  });

  it('reports a whole document as complete', () => {
    assert.deepEqual(readPartialJson('{"command":"ls -la"}'), {
      value: { command: 'ls -la' },
      complete: true,
    });
  });

  it('hands over the string value while it is still being typed', () => {
    assert.deepEqual(readPartialJson('{"command":"npm run bui'), {
      value: { command: 'npm run bui' },
      complete: false,
    });
  });

  it('grows a Write call one key at a time', () => {
    const steps = [
      '{"file_path":"/tmp/a.ts"',
      '{"file_path":"/tmp/a.ts",',
      '{"file_path":"/tmp/a.ts","content":"',
      '{"file_path":"/tmp/a.ts","content":"line one\\nline',
    ];
    assert.deepEqual(
      steps.map((step) => readPartialJson(step).value),
      [
        { file_path: '/tmp/a.ts' },
        { file_path: '/tmp/a.ts' },
        { file_path: '/tmp/a.ts', content: '' },
        { file_path: '/tmp/a.ts', content: 'line one\nline' },
      ],
    );
  });

  it('drops a key whose value has not started', () => {
    assert.deepEqual(readPartialJson('{"file_path":"/tmp/a.ts","content":').value, {
      file_path: '/tmp/a.ts',
    });
  });

  it('keeps the text that precedes an unrepairable tail', () => {
    assert.deepEqual(readPartialJson('{"limit":10,"offset":1e').value, { limit: 10 });
    assert.deepEqual(readPartialJson('{"path":"/tmp","deep":nul').value, { path: '/tmp' });
  });

  // `{"line":12` parses cleanly while the model is still typing `123`, and
  // nothing in the text says which it is. A key whose value may be half a number
  // is dropped rather than reported wrong.
  it('drops a number that may still be being written', () => {
    assert.deepEqual(readPartialJson('{"file_path":"/a.ts","offset":12').value, {
      file_path: '/a.ts',
    });
    assert.deepEqual(readPartialJson('{"limit":10,"offset":5').value, { limit: 10 });
    assert.deepEqual(readPartialJson('{"limit":10,"pattern":"x"').value, {
      limit: 10,
      pattern: 'x',
    }, 'a number a later key terminated is complete');
  });

  it('closes nested structures from the inside out', () => {
    assert.deepEqual(
      readPartialJson('{"edits":[{"old_string":"a","new_string":"b"},{"old_string":"c').value,
      { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c' }] },
    );
  });

  it('does not let a trailing escape swallow the quote that closes the string', () => {
    assert.deepEqual(readPartialJson('{"pattern":"a\\').value, { pattern: 'a' });
    assert.deepEqual(readPartialJson('{"pattern":"a\\\\').value, { pattern: 'a\\' });
  });

  it('reads a quote and a brace inside a string as text, not as structure', () => {
    assert.deepEqual(readPartialJson('{"command":"echo \\"{\\" # ').value, {
      command: 'echo "{" # ',
    });
  });

  it('refuses a fragment whose brackets do not match', () => {
    assert.deepEqual(readPartialJson('{"a":[1,2}').value, undefined);
  });

  it('reads a fragment that is a bare array', () => {
    assert.deepEqual(readPartialJson('[{"id":"a"},{"id":"b').value, [{ id: 'a' }, { id: 'b' }]);
  });

// Every prefix is now reachable: a fragment is forwarded as the provider writes
// it, so the reading runs at each of these boundaries rather than at a handful
// of buffer-sized ones. Nothing here may throw, and whatever a prefix reads as
// must be a value the row could have been given whole.
it('reads every prefix of a real call as something a row could show', () => {
  const documents = [
    JSON.stringify({ file_path: '/tmp/a.ts', content: 'let 🙂 = "q \\" }";\nline 2\n', line: 128 }),
    JSON.stringify({ command: 'rg -n "a|b" .', description: 'Search', timeout: 60_000 }),
    JSON.stringify({ message: 'A note.\n\n- one\n- two\n', tone: null, ok: true }),
    JSON.stringify({ edits: [{ old: 'a', new: 'b' }, { old: 'c', new: 'd' }], nested: { a: [1, 2] } }),
  ];

  for (const document of documents) {
    for (let end = 0; end <= document.length; end += 1) {
      const reading = readPartialJson(document.slice(0, end));
      assert.equal(reading.complete, end === document.length);
      if (reading.value === undefined) continue;
      assert.equal(typeof reading.value, 'object');
      assert.ok(reading.value !== null);
      // A reading is handed to `projectToolArgsPreview`, which walks it: it has
      // to be a plain value, not something a repair invented.
      assert.doesNotThrow(() => JSON.stringify(reading.value));
    }
  }
});
});
