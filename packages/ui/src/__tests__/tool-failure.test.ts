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
import { buildToolFailure, isToolFailure, TOOL_FAILURE_MESSAGE_MAX_CHARS } from '@maka/core/events';
import type { ToolActivityItem } from '../materialize.js';
import { toolFailureOf } from '../tool-failure.js';

function tool(overrides: Partial<ToolActivityItem> = {}): ToolActivityItem {
  return {
    toolUseId: 'tool-1',
    toolName: 'Bash',
    activityKind: 'command',
    status: 'completed',
    args: { command: 'ls' },
    ...overrides,
  };
}

test('only a failed call has a failure, and an unannotated one reads as broken', () => {
  assert.equal(toolFailureOf(tool()), undefined);
  // A call the user stopped did not go wrong.
  assert.equal(toolFailureOf(tool({ status: 'interrupted' })), undefined);
  assert.equal(toolFailureOf(tool({ status: 'running' })), undefined);
  // The default an unannotated throw means, and what every row meant before
  // the envelope existed — an imported session, or an older Host.
  assert.deepEqual(toolFailureOf(tool({ status: 'errored' })), { kind: 'failed', tone: 'danger' });
});

test('the grade decides the volume, and only a boundary offers a way out', () => {
  const graded = (failure: Parameters<typeof buildToolFailure>) =>
    toolFailureOf(tool({ status: 'errored', failure: buildToolFailure(...failure) }));

  // A rule that said no: nothing is broken and nothing is the reader's to fix.
  assert.equal(graded(['refused', 'cannot block itself', 'SessionTaskRule'])?.tone, 'warning');
  assert.equal(graded(['refused', 'cannot block itself', 'SessionTaskRule'])?.remedy, undefined);
  // A boundary: still a warning, but this one the reader can move.
  assert.equal(graded(['denied', 'needs bypass', 'requires_bypass'])?.remedy, 'bypass');
  assert.equal(graded(['denied', 'blocked', 'sandbox_denial'])?.remedy, 'raise_permission');
  assert.equal(graded(['denied', 'blocked', 'sandbox_boundary_required'])?.remedy, 'raise_permission');
  // Broken.
  assert.equal(graded(['failed', 'ENOSPC'])?.tone, 'danger');
  // A class nothing has a control for is still a grade, just without an offer.
  assert.equal(graded(['denied', 'blocked', 'SomeFutureBoundary'])?.remedy, undefined);
});

test('a failure with no sentence keeps its grade', () => {
  // Several runtime branches have a shape rather than a message — a child
  // agent that did not finish. The result body explains those, and inventing
  // a sentence in the runtime would be writing UI copy in the wrong layer.
  const failure = buildToolFailure('failed', undefined, 'subagent_failed');
  assert.equal(failure.message, undefined);
  assert.ok(isToolFailure(failure));
  assert.deepEqual(toolFailureOf(tool({ status: 'errored', failure })), {
    kind: 'failed',
    tone: 'danger',
    class: 'subagent_failed',
  });
});

test('the reason is bounded at the source, because the wire rejects it otherwise', () => {
  const long = buildToolFailure('failed', 'x'.repeat(TOOL_FAILURE_MESSAGE_MAX_CHARS + 200));
  assert.equal(long.message?.length, TOOL_FAILURE_MESSAGE_MAX_CHARS);
  assert.ok(isToolFailure(long));
  // Built one byte over by hand, the protocol decoder must refuse it rather
  // than let a frame through that the far side would drop the connection over.
  assert.equal(
    isToolFailure({ kind: 'failed', message: 'x'.repeat(TOOL_FAILURE_MESSAGE_MAX_CHARS + 1) }),
    false,
  );
  assert.equal(isToolFailure({ kind: 'exploded', message: 'x' }), false);
  assert.equal(isToolFailure({ kind: 'failed', reason: 'x' }), false);
  assert.equal(isToolFailure({ kind: 'failed', message: '' }), false);
});

// A background command: the call that launched it succeeded and stays
// `completed`, the process it started goes on to fail. Read from `item.status`
// this returned nothing — and since the failure now carries the mark that
// replaced the word "Error", the row lost every sign it had failed.
test('a background command that died is a failure, though its call succeeded', () => {
  const backgrounded = tool({
    toolName: 'Bash',
    status: 'completed',
    result: {
      kind: 'shell_run',
      ref: 'run-1',
      status: 'failed',
      cwd: '/w',
      cmd: 'build',
      startedAt: 0,
      updatedAt: 1,
      completedAt: 1,
      exitCode: 1,
      failureMessage: 'Command failed',
      revision: 2,
      mode: 'pipes',
      output: {
        mode: 'pipes',
        stdout: '',
        stderr: 'boom\n',
        stdoutTruncated: false,
        stderrTruncated: false,
        redacted: false,
      },
    },
  });
  assert.deepEqual(toolFailureOf(backgrounded), { kind: 'failed', tone: 'danger' });
  // A run still going is not one that failed.
  assert.equal(
    toolFailureOf({
      ...backgrounded,
      result: { ...(backgrounded.result as Record<string, unknown>), status: 'running' } as never,
    }),
    undefined,
  );
});

// The envelope ships live and is persisted, so it is redacted where it is
// built. `formatSyntheticToolErrorText` redacted and the `ToolRefusal` branch
// beside it did not, so one call's body read `[redacted]` while its summary
// carried the token.
test('a reason is redacted by the builder, not by whoever remembers', () => {
  const failure = buildToolFailure('refused', 'connect failed: API_TOKEN=sk-live-abcdefghij');
  assert.doesNotMatch(failure.message ?? '', /sk-live/);
  assert.match(failure.message ?? '', /\[redacted\]/);
});

// Everything the decoder can reject is bounded where the envelope is built,
// because a frame it rejects is a dropped connection rather than a long word.
test('the builder bounds every field the decoder checks', () => {
  // A class is not always runtime-owned in practice: a workflow result's
  // `error.reason` is whatever the workflow wrote.
  const wild = buildToolFailure('failed', 'x', 'r'.repeat(400));
  assert.equal(wild.class?.length, 128);
  assert.ok(isToolFailure(wild));

  // Neither cut may end on half a surrogate pair — this string is JSON-encoded
  // onto the wire and persisted, and a lone high half decodes as U+FFFD.
  const withPair = `${'a'.repeat(TOOL_FAILURE_MESSAGE_MAX_CHARS - 2)}\u{1F642}tail`;
  const cut = buildToolFailure('failed', withPair);
  assert.doesNotMatch(cut.message ?? '', /[\uD800-\uDBFF]$/);
  assert.equal(cut.message, JSON.parse(JSON.stringify(cut.message)));
  assert.ok(isToolFailure(cut));

  // A class made entirely of whitespace-free padding still round-trips.
  assert.ok(isToolFailure(buildToolFailure('denied', undefined, 'c'.repeat(128))));
});
