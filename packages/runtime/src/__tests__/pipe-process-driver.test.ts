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

import { PipeProcessDriver, type PipeProcessExit } from '../pipe-process-driver.js';

test('reports a partial stdin delivery failure before the child exit', async () => {
  const failures: Error[] = [];
  const events: string[] = [];
  let resolveExit!: (exit: PipeProcessExit) => void;
  const exited = new Promise<PipeProcessExit>((resolve) => {
    resolveExit = resolve;
  });
  const driver = new PipeProcessDriver({
    plan: {
      file: process.execPath,
      args: [
        '-e',
        [
          "const fs = require('node:fs');",
          'fs.closeSync(0);',
          'setTimeout(() => process.exit(0), 50);',
        ].join(' '),
      ],
      useShellOption: false,
      stdin: 'x'.repeat(8 * 1024 * 1024),
    },
    cwd: process.cwd(),
    outputDrainMs: 1_000,
    onData() {},
    onRootExit() {},
    onFailure(error) {
      events.push('failure');
      failures.push(error);
    },
    onExit(exit) {
      events.push('exit');
      resolveExit(exit);
    },
  });

  try {
    driver.writeInputs();
    await driver.ready;
    const exit = await exited;
    assert.equal(exit.exitCode, 0);
    assert.equal(failures.length, 1);
    assert.match(String((failures[0] as NodeJS.ErrnoException).code), /EPIPE|ERR_STREAM_DESTROYED/);
    assert.deepEqual(events, ['failure', 'exit']);
  } finally {
    driver.dispose();
  }
});

test('hands over decoded text with the bytes the process wrote for it', async () => {
  const received: Array<{ stream: string; data: string; bytes: number }> = [];
  let resolveExit!: (exit: PipeProcessExit) => void;
  const exited = new Promise<PipeProcessExit>((resolve) => {
    resolveExit = resolve;
  });
  // A fox split across two writes, a byte that is not UTF-8, and a
  // character the output never finishes.
  const script = [
    'process.stdout.write(Buffer.from([0xf0, 0x9f]));',
    'setTimeout(() => {',
    '  process.stdout.write(Buffer.from([0xa6, 0x8a, 0xff]));',
    '  setTimeout(() => process.stdout.write(Buffer.from([0x61, 0xe6])), 20);',
    '}, 20);',
  ].join(' ');
  const driver = new PipeProcessDriver({
    plan: { file: process.execPath, args: ['-e', script], useShellOption: false },
    cwd: process.cwd(),
    outputDrainMs: 1_000,
    onData(stream, data, bytes) {
      received.push({ stream, data, bytes });
    },
    onRootExit() {},
    onFailure() {},
    onExit(exit) {
      resolveExit(exit);
    },
  });
  try {
    driver.writeInputs();
    await driver.ready;
    await exited;
    assert.equal(received.map((chunk) => chunk.data).join(''), '🦊\uFFFDa\uFFFD');
    assert.equal(
      received.reduce((total, chunk) => total + chunk.bytes, 0),
      7,
    );
    assert.ok(received.every((chunk) => chunk.stream === 'stdout'));
  } finally {
    driver.dispose();
  }
});
