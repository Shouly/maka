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
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { ShellRunRecord } from '@maka/core/shell-run';
import {
  purgeSessionShellRunOutputFiles,
  shellRunOutputFileContent,
  shellRunOutputFilePath,
  writeShellRunOutputFile,
} from '../shell-run-output-file.js';

const ROOTS: string[] = [];
after(async () => {
  await Promise.all(ROOTS.map((path) => rm(path, { recursive: true, force: true })));
});

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'maka-task-output-'));
  ROOTS.push(path);
  return path;
}

function record(overrides: Partial<ShellRunRecord> = {}): ShellRunRecord {
  return {
    shellRunId: 'sr_1',
    sessionId: 'session-1',
    sourceTurnId: 'turn-1',
    sourceToolCallId: 'call-1',
    cwd: '/workspace',
    command: 'npm test',
    background: true,
    status: 'running',
    startedAt: 1,
    updatedAt: 1,
    revision: 1,
    output: {
      mode: 'pipes',
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      redacted: false,
    },
    ...overrides,
  } as ShellRunRecord;
}

describe('the file a background command writes for the model to read', () => {
  test('reads as the output, then how the run stands', () => {
    assert.equal(
      shellRunOutputFileContent(
        record({ output: { ...record().output, stdout: 'hello\nbye\n' } as never }),
      ),
      'hello\nbye\n\n[running]\n',
    );
    assert.equal(
      shellRunOutputFileContent(record({ status: 'completed', exitCode: 0 })),
      '\n[exited with code 0]\n',
    );
    assert.equal(
      shellRunOutputFileContent(record({ status: 'cancelled', exitCode: 130 })),
      '\n[killed]\n',
    );
    assert.equal(
      shellRunOutputFileContent(record({ status: 'timed_out', exitCode: 124, timeoutMs: 5_000 })),
      '\n[timed out after 5000ms]\n',
    );
  });

  test('a shortened tail says so, or a model believes it saw everything', () => {
    const text = shellRunOutputFileContent(
      record({
        output: { ...record().output, stdout: 'tail', stdoutTruncated: true } as never,
      }),
    );
    assert.match(text, /\[Output was truncated; only the tail is shown\./u);
  });

  test('stdout and stderr stay on separate lines', () => {
    assert.equal(
      shellRunOutputFileContent(
        record({ output: { ...record().output, stdout: 'out', stderr: 'err' } as never }),
      ),
      'out\nerr\n\n[running]\n',
    );
  });

  test('a late write carrying an older revision never overwrites a newer one', async () => {
    const base = await root();
    const outputFile = shellRunOutputFilePath(base, 'session-1', 'sr_1');
    const finished = record({ revision: 9, status: 'completed', exitCode: 0, outputFile });
    const stale = record({ revision: 2, outputFile });
    await writeShellRunOutputFile(finished);
    // A real gap, not two awaits back to back: the queue for this file is
    // emptied as soon as it drains, and a guard that lives only in the queue
    // would have nothing left to compare the late write against.
    await new Promise((resolve) => setImmediate(resolve));
    await writeShellRunOutputFile(stale);
    assert.equal(await readFile(outputFile, 'utf8'), '\n[exited with code 0]\n');
  });

  test('overlapping writes leave the newest on disk', async () => {
    const base = await root();
    const outputFile = shellRunOutputFilePath(base, 'session-1', 'sr_1');
    await Promise.all([
      writeShellRunOutputFile(record({ revision: 1, outputFile })),
      writeShellRunOutputFile(
        record({ revision: 2, outputFile, status: 'completed', exitCode: 0 }),
      ),
    ]);
    assert.equal(await readFile(outputFile, 'utf8'), '\n[exited with code 0]\n');
  });

  test("retiring a Session takes its tasks' files with it", async () => {
    const base = await root();
    const outputFile = shellRunOutputFilePath(base, 'session-1', 'sr_1');
    await writeShellRunOutputFile(record({ outputFile }));
    await purgeSessionShellRunOutputFiles(base, 'session-1');
    await assert.rejects(() => readFile(outputFile, 'utf8'), /ENOENT/u);
  });
});
