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
import { shellRunResultText } from '../shell-run-model-output.js';

const ref = 'maka://runtime/background-tasks/sr_1';
const base = { kind: 'shell_run' as const, ref, cmd: 'npm run dev', mode: 'pipes' as const };
const pipes = (stdout: string, stderr = '') => ({
  mode: 'pipes' as const,
  stdout,
  stderr,
  stdoutTruncated: false,
  stderrTruncated: false,
  redacted: false,
});

describe('a background task, as the model reads it', () => {
  test('starting answers with the ref and what to do with it', () => {
    assert.equal(
      shellRunResultText({ ...base, status: 'running' }),
      `Command running in background with ref: ${ref}. To check its output, use Read on that ref; to end it, use TaskStop.`,
    );
    assert.match(
      shellRunResultText({ ...base, mode: 'pty', status: 'running' }),
      /It has a terminal: send keystrokes with TaskInput\.$/u,
    );
  });

  test('reading numbers the output like a file and ends in the status line', () => {
    assert.equal(
      shellRunResultText({
        ...base,
        status: 'completed',
        exitCode: 0,
        output: pipes('start\nfinished\n'),
      }),
      '1\tstart\n2\tfinished\n3\t\n4\t[exited with code 0]',
    );
    assert.equal(
      shellRunResultText({ ...base, status: 'running', output: pipes('long-start\n') }),
      '1\tlong-start\n2\t\n3\t[running]',
    );
    assert.equal(
      shellRunResultText({
        ...base,
        status: 'cancelled',
        exitCode: 130,
        output: pipes('long-start\n'),
      }),
      '1\tlong-start\n2\t\n3\t[killed]',
    );
    assert.equal(
      shellRunResultText({ ...base, status: 'timed_out', timeoutMs: 2000, output: pipes('') }),
      '1\t[timed out after 2000ms]',
    );
    assert.equal(
      shellRunResultText({ ...base, status: 'failed', exitCode: 3, output: pipes('', 'boom\n') }),
      '1\tboom\n2\t\n3\t[exited with code 3]',
    );
    assert.equal(
      shellRunResultText({
        ...base,
        status: 'orphaned',
        failureMessage: 'Runtime restarted without a live shell process handle',
        output: pipes(''),
      }),
      '1\t[orphaned: Runtime restarted without a live shell process handle]',
    );
  });

  test('a PTY read shows the screen', () => {
    const text = shellRunResultText({
      ...base,
      mode: 'pty',
      status: 'running',
      output: {
        mode: 'pty',
        screen: '$ vim\n~\n',
        scrollback: '',
        cols: 80,
        rows: 24,
        cursor: { x: 0, y: 0, visible: true },
        alternateScreen: false,
        truncated: false,
        redacted: false,
      },
    });
    assert.equal(text, '1\t$ vim\n2\t~\n3\t\n4\t[running]');
  });

  test('stopping answers with one JSON line', () => {
    const stopped = JSON.parse(
      shellRunResultText({
        ...base,
        status: 'cancelled',
        exitCode: 130,
        output: pipes(''),
        operation: { kind: 'stop', applied: true },
      }),
    );
    assert.deepEqual(stopped, {
      message: `Successfully stopped task: ${ref} (npm run dev)`,
      ref,
      task_type: 'local_bash',
      command: 'npm run dev',
      status: 'cancelled',
    });
    const already = JSON.parse(
      shellRunResultText({
        ...base,
        status: 'completed',
        exitCode: 0,
        output: pipes(''),
        operation: { kind: 'stop', applied: false },
      }),
    );
    assert.equal(already.message, `Task ${ref} had already exited (code 0) (npm run dev)`);
  });

  test('a TaskInput result leads with what the terminal took', () => {
    const text = shellRunResultText({
      ...base,
      mode: 'pty',
      status: 'running',
      output: {
        mode: 'pty',
        screen: 'ok',
        scrollback: '',
        cols: 80,
        rows: 24,
        cursor: { x: 0, y: 0, visible: true },
        alternateScreen: false,
        truncated: false,
        redacted: false,
      },
      operation: { kind: 'pty_control', failed: false, input: { bytes: 6, queued: true } },
    });
    assert.equal(text, '[6 bytes of input queued]\n1\tok\n2\t\n3\t[running]');
  });
});
