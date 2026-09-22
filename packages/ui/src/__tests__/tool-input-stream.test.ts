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
import { TOOL_INPUT_PREVIEW_MAX_CHARS } from '@maka/core/events';
import { applyToolInputFragment, openToolInput, type LiveToolInput } from '../tool-input-stream.js';

/** The fragments as the wire delivers them: each placed where it belongs. */
const stream = (...parts: readonly string[]): { offset: number; delta: string }[] => {
  let offset = 0;
  return parts.map((delta) => {
    const fragment = { offset, delta };
    offset += delta.length;
    return fragment;
  });
};

const fold = (
  fragments: readonly { offset: number; delta: string }[],
  toolName = 'Write',
): LiveToolInput =>
  fragments.reduce(
    (input, fragment) => applyToolInputFragment(input, fragment, toolName),
    openToolInput(),
  );

describe('applyToolInputFragment', () => {
  it('names the call as each key closes', () => {
    const [first, second] = stream('{"file_path":"/tmp/a.ts"', ',"content":"const a');
    const one = fold([first!]);
    const two = applyToolInputFragment(one, second!, 'Write');

    assert.deepEqual(one.preview, { file_path: '/tmp/a.ts' });
    assert.deepEqual(
      two.preview,
      { file_path: '/tmp/a.ts' },
      'the body is not one of the keys a row may show, streaming or settled',
    );
  });

  // The reading goes through `projectToolArgsPreview`, the one gate every other
  // path to the screen goes through. Reading it and showing it are not the same
  // step, and a stream that skipped the gate would put a file's contents — and
  // anything in them — on screen for the length of the write.
  it('shows only what a settled row would show', () => {
    const written = fold(
      stream('{"file_path":"/tmp/a.ts","content":"export const key = ', "'sk-ABCDEF1234567890';\""),
    );

    assert.deepEqual(written.preview, { file_path: '/tmp/a.ts' });
    assert.equal(JSON.stringify(written.preview).includes('sk-'), false);
    assert.ok(written.text.includes('sk-'), 'the text itself is untouched, and is never shown');
  });

  // A note's argument IS the thing the person is meant to read, so it is the one
  // tool whose body the gate lets through — and the one whose row says nothing
  // at all until some of it has arrived.
  it('follows a note as the model writes it', () => {
    const [opening, more] = stream('{"message":"Checking the', ' two suites now."}');

    const started = fold([opening!], 'SendUserMessage');
    assert.deepEqual(started.preview, { message: 'Checking the' });

    const finished = applyToolInputFragment(started, more!, 'SendUserMessage');
    assert.deepEqual(finished.preview, { message: 'Checking the two suites now.' });
  });

  // A task write's arguments are a proposal until the result commits them, so
  // `projectToolArgsPreview` withholds them from a live row entirely.
  it('shows nothing for a call whose arguments are only a proposal', () => {
    const proposed = fold(stream('{"description":"Review the diff"'), 'TaskCreate');

    assert.equal(proposed.preview, undefined);
  });

  // The fragments are one document rejoined by offset, so a hole in it does not
  // read as a hole — it reads as a different, well-formed call. A reseed drops
  // whatever was buffered for the frame and nothing replays it, which is how a
  // hole opens in practice.
  it('breaks on a lost fragment rather than reading past the hole', () => {
    const broken = fold([
      { offset: 0, delta: '{"command":"rm -rf ' },
      { offset: 40, delta: '/"}' },
    ]);

    assert.equal(broken.broken, true);
    assert.equal(broken.text, '{"command":"rm -rf ', 'nothing was folded in past the hole');
    // What the valid prefix said is still true, and it is what the row is named
    // by: taking it away would also take away whether the row can be opened,
    // which closes an open panel and restarts the sweep on a designed-for path.
    assert.deepEqual(broken.preview, { command: 'rm -rf ' });
  });

  it('stays broken for every fragment that follows', () => {
    const later = applyToolInputFragment(
      fold([{ offset: 0, delta: '{"command":"ls' }, { offset: 99, delta: '"}' }]),
      { offset: 101, delta: ' more' },
      'Bash',
    );

    assert.equal(later.text, '{"command":"ls');
    assert.deepEqual(later.preview, { command: 'ls' }, 'frozen, not withdrawn');
  });

  it('refuses a replay without disturbing what it has', () => {
    const first = fold(stream('{"command":"ls'));
    const replayed = applyToolInputFragment(first, { offset: 0, delta: '{"command":"ls' }, 'Bash');

    assert.equal(replayed, first, 'the same value, so nothing downstream re-renders');
  });

  // The Host folds contiguous fragments into one frame when a subscriber falls
  // behind, so a fragment can arrive overlapping what is already held — the fold
  // starts at the queued tail's offset, not at the reader's.
  it('takes only the new tail of an overlapping fragment', () => {
    const held = fold(stream('{"file_path":"/tm'));
    const overlapping = applyToolInputFragment(
      held,
      { offset: 0, delta: '{"file_path":"/tmp/a.ts"' },
      'Write',
    );

    assert.equal(overlapping.text, '{"file_path":"/tmp/a.ts"');
    assert.deepEqual(overlapping.preview, { file_path: '/tmp/a.ts' });
  });

  // Reading means re-reading everything received so far, each time a fragment
  // lands — the square of the length, on the thread drawing the transcript.
  it('stops reading at the bound while the fragments keep arriving', () => {
    const head = '{"file_path":"/tmp/a.ts","content":"';
    let input = fold(stream(head));
    let offset = head.length;
    for (let index = 0; index < 40; index += 1) {
      input = applyToolInputFragment(input, { offset, delta: 'x'.repeat(1024) }, 'Write');
      offset += 1024;
    }

    assert.ok(input.text.length >= TOOL_INPUT_PREVIEW_MAX_CHARS);
    assert.ok(
      input.text.length < TOOL_INPUT_PREVIEW_MAX_CHARS + 1024 * 2,
      'it overshoots by the one fragment that crossed the bound, and no further',
    );
    assert.equal(input.broken, undefined, 'the bound is not a hole; nothing past it is kept');
    assert.deepEqual(input.preview, { file_path: '/tmp/a.ts' }, 'the head still names the call');
  });

  it('has nothing to show before the first key closes', () => {
    assert.equal(fold(stream('{"fi')).preview, undefined);
  });
});
