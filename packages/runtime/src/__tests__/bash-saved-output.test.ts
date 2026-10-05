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
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import type { ShellRunStore } from '@maka/core/shell-run';
import { createSqliteShellRunStore } from '@maka/storage/shell-run-store';

import { projectBashToolResultForModel } from '../bash-model-output.js';
import { ShellRunProcessManager } from '../shell-run-manager.js';
import { defaultShellPlan } from '../shell-detect.js';

const roots: string[] = [];
const stores: Array<ReturnType<typeof createSqliteShellRunStore>> = [];
after(async () => {
  for (const store of stores) store.close();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function directory(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function manager(
  options: {
    toolResultRoot?: string;
    maxForegroundOutputBytes?: number;
    maxRetainedChars?: number;
  } = {},
): Promise<{ manager: ShellRunProcessManager; cwd: string }> {
  const cwd = await directory('maka-bash-saved-');
  const store: ShellRunStore = createSqliteShellRunStore(cwd);
  stores.push(store as ReturnType<typeof createSqliteShellRunStore>);
  let id = 0;
  let now = 1_000;
  return {
    cwd,
    manager: new ShellRunProcessManager({
      store,
      newId: () => `run-${++id}`,
      now: () => ++now,
      flushIntervalMs: 10,
      killGraceMs: 100,
      exitAcknowledgementMs: 500,
      ...options,
    }),
  };
}

/** A shell command that runs `script` with this Node, with no quoting to get wrong. */
function nodeCommand(script: string): string {
  const payload = Buffer.from(script, 'utf8').toString('base64');
  const bootstrap = `eval(Buffer.from('${payload}','base64').toString('utf8'))`;
  return `'${process.execPath.replaceAll("'", "'\\''")}' -e "${bootstrap}"`;
}

function run(
  target: ShellRunProcessManager,
  cwd: string,
  command: string,
  options: { timeoutMs?: number; abortSignal?: AbortSignal } = {},
) {
  return target.runForegroundBash({
    sessionId: 'session-1',
    sourceTurnId: 'turn-1',
    sourceToolCallId: 'tool-1',
    cwd,
    command,
    shell: defaultShellPlan(),
    emitOutput: () => undefined,
    ...options,
  });
}

/** What a run left in the root: only saved results, never a working file. */
async function rootEntries(root: string): Promise<string[]> {
  return (await readdir(root)).sort();
}

const posixOnly = { skip: process.platform === 'win32' ? 'POSIX shell quoting' : false };

describe('a foreground command too long to show is saved to a file', () => {
  test(
    'a valid output over 30,000 characters is saved whole and named by its path',
    posixOnly,
    async () => {
      const results = await directory('maka-tool-results-');
      const { manager: target, cwd } = await manager({ toolResultRoot: results });
      // 1.5 MB of stdout, past the 1 MB tail kept in memory: only the working
      // file has its start.
      const lines = Array.from({ length: 150_000 }, (_, index) => `line ${index + 1}`);
      const result = await run(
        target,
        cwd,
        nodeCommand(
          `const out = []; for (let i = 1; i <= 150000; i++) out.push('line ' + i); process.stdout.write(out.join('\\n') + '\\n'); process.stderr.write('token: sk-ant-abcdefghijkl0123\\n');`,
        ),
      );

      const path = join(results, 'session-1', 'run-1.txt');
      assert.equal(result.status, 'completed');
      assert.equal(result.savedOutput?.path, path);
      assert.equal(result.savedOutput?.truncated, false);
      const saved = await readFile(path, 'utf8');
      assert.equal(saved, `${lines.join('\n')}\ntoken: [redacted]`);
      assert.equal(result.savedOutput?.chars, saved.length);
      // The working files are gone; only the saved result stays.
      assert.deepEqual(await rootEntries(results), ['session-1']);
      assert.deepEqual(await readdir(join(results, 'session-1')), ['run-1.txt']);

      if (result.output.mode !== 'pipes') throw new Error('expected pipes');
      assert.equal(result.output.stdout, saved.slice(0, 2_000));
      assert.equal(result.output.stderr, '');
      assert.equal(
        projectBashToolResultForModel(result),
        `Output too long to show (${saved.length.toLocaleString('en-US')} characters). The full output is saved to ${path}; read it with Read or search it with Grep.\n\nPreview (first 2,000 characters):\n${saved.slice(0, 2_000)}`,
      );
    },
  );

  test('30,000 characters are shown whole and nothing is saved', posixOnly, async () => {
    const results = await directory('maka-tool-results-');
    const { manager: target, cwd } = await manager({ toolResultRoot: results });
    const result = await run(target, cwd, nodeCommand(`process.stdout.write('x'.repeat(30000));`));
    assert.equal(result.savedOutput, undefined);
    assert.equal(result.output.mode === 'pipes' && result.output.stdout, 'x'.repeat(30_000));
    // No Session folder: nothing was saved.
    assert.deepEqual(await rootEntries(results), []);
  });

  test('a grep that exits 1 is valid, so its long output is saved too', posixOnly, async () => {
    const results = await directory('maka-tool-results-');
    const { manager: target, cwd } = await manager({ toolResultRoot: results });
    const result = await run(
      target,
      cwd,
      `${nodeCommand(`process.stdout.write('g'.repeat(30001));`)}; grep -q needle /dev/null`,
    );
    assert.equal(result.exitCode, 1);
    assert.equal(result.savedOutput?.chars, 30_001);
    assert.match(String(projectBashToolResultForModel(result)), /^Exit code 1\nOutput too long/u);
  });

  test(
    'a failure over 10,000 characters is a head and a tail, with no file',
    posixOnly,
    async () => {
      const results = await directory('maka-tool-results-');
      const { manager: target, cwd } = await manager({ toolResultRoot: results });
      const result = await run(
        target,
        cwd,
        nodeCommand(
          `process.stdout.write('H'.repeat(5000) + 'm'.repeat(20000) + 'T'.repeat(5000)); process.exit(3);`,
        ),
      );
      assert.equal(result.status, 'failed');
      assert.equal(result.savedOutput, undefined);
      assert.equal(
        projectBashToolResultForModel(result),
        `Exit code 3\n${'H'.repeat(5_000)}\n[... 20,000 characters omitted ...]\n${'T'.repeat(5_000)}`,
      );
      assert.deepEqual(await rootEntries(results), []);
    },
  );

  test(
    'a failure longer than the retained tail shows the real start of its output',
    posixOnly,
    async () => {
      const results = await directory('maka-tool-results-');
      const { manager: target, cwd } = await manager({
        toolResultRoot: results,
        maxRetainedChars: 20_000,
      });
      const lines = Array.from({ length: 10_000 }, (_, index) => `line ${index + 1}`);
      const full = lines.join('\n');
      const result = await run(
        target,
        cwd,
        nodeCommand(
          `const out = []; for (let i = 1; i <= 10000; i++) out.push('line ' + i); process.stdout.write(out.join('\\n') + '\\n'); process.exitCode = 3;`,
        ),
      );
      assert.equal(result.savedOutput, undefined);
      assert.equal(
        projectBashToolResultForModel(result),
        `Exit code 3\n${full.slice(0, 5_000)}\n[... ${(full.length - 10_000).toLocaleString('en-US')} characters omitted ...]\n${full.slice(-5_000)}`,
      );
      assert.deepEqual(await rootEntries(results), []);
    },
  );

  test(
    'with nothing kept on disk, a failure longer than the retained tail says its start is not shown',
    posixOnly,
    async () => {
      const { manager: target, cwd } = await manager({ maxRetainedChars: 20_000 });
      const result = await run(
        target,
        cwd,
        nodeCommand(
          `const out = []; for (let i = 1; i <= 10000; i++) out.push('line ' + i); process.stdout.write(out.join('\\n')); process.exitCode = 3;`,
        ),
      );
      const text = String(projectBashToolResultForModel(result));
      assert.match(text, /^Exit code 3\n\[\.\.\. earlier output omitted \.\.\.\]\nline /u);
      assert.ok(text.endsWith('line 10000'));
      assert.doesNotMatch(text, /\nline 1\n/u);
    },
  );

  test('a timed-out or cancelled run leaves no working file behind', posixOnly, async () => {
    const results = await directory('maka-tool-results-');
    const { manager: target, cwd } = await manager({ toolResultRoot: results });
    const printThenWait = nodeCommand(
      `process.stdout.write('x'.repeat(50000) + '\\n'); setInterval(() => {}, 1000);`,
    );
    const timedOut = await run(target, cwd, printThenWait, { timeoutMs: 500 });
    assert.equal(timedOut.status, 'timed_out');
    assert.equal(timedOut.savedOutput, undefined);
    assert.deepEqual(await rootEntries(results), []);

    const controller = new AbortController();
    const cancelled = run(target, cwd, printThenWait, { abortSignal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    assert.equal((await cancelled).status, 'cancelled');
    assert.deepEqual(await rootEntries(results), []);
  });

  test(
    'a working file that cannot be written leaves a long valid output as a head and a tail',
    posixOnly,
    async () => {
      const results = await directory('maka-tool-results-');
      // Something already stands where the run's working file would go.
      await mkdir(join(results, 'run-1.stdout.partial'));
      const { manager: target, cwd } = await manager({ toolResultRoot: results });
      const result = await run(
        target,
        cwd,
        nodeCommand(`process.stdout.write('v'.repeat(40000));`),
      );
      assert.equal(result.savedOutput, undefined);
      assert.equal(
        result.output.mode === 'pipes' && result.output.stdout,
        `${'v'.repeat(15_000)}\n[... 10,000 characters omitted ...]\n${'v'.repeat(15_000)}`,
      );
      assert.deepEqual(await rootEntries(results), ['run-1.stdout.partial']);
    },
  );

  test(
    'a saved file that cannot be written leaves a long valid output as a head and a tail',
    posixOnly,
    async () => {
      const results = await directory('maka-tool-results-');
      // Something already stands where the saved file would go.
      await mkdir(join(results, 'session-1', 'run-1.txt'), { recursive: true });
      const { manager: target, cwd } = await manager({ toolResultRoot: results });
      const result = await run(
        target,
        cwd,
        nodeCommand(`process.stdout.write('v'.repeat(40000));`),
      );
      assert.equal(result.savedOutput, undefined);
      assert.match(
        String(result.output.mode === 'pipes' && result.output.stdout),
        /\n\[\.\.\. 10,000 characters omitted \.\.\.\]\n/u,
      );
      assert.deepEqual(await rootEntries(results), ['session-1']);
      assert.deepEqual(await readdir(join(results, 'session-1')), ['run-1.txt']);
    },
  );

  test('the output limit counts the bytes printed, not their decoded text', posixOnly, async () => {
    const { manager: target, cwd } = await manager({ maxForegroundOutputBytes: 64 * 1024 });
    // 40,000 bytes that are not UTF-8: each decodes to a three-byte U+FFFD,
    // 120,000 bytes of text, but only 40,000 were printed.
    const result = await run(
      target,
      cwd,
      nodeCommand(`process.stdout.write(Buffer.alloc(40000, 0xff));`),
    );
    assert.equal(result.status, 'completed');
    assert.equal(result.exitCode, 0);
  });

  test(
    'a composition that saves nothing shows a long valid output as a head and a tail',
    posixOnly,
    async () => {
      const { manager: target, cwd } = await manager();
      const result = await run(
        target,
        cwd,
        nodeCommand(`process.stdout.write('v'.repeat(40000));`),
      );
      assert.equal(result.savedOutput, undefined);
      assert.equal(
        result.output.mode === 'pipes' && result.output.stdout,
        `${'v'.repeat(15_000)}\n[... 10,000 characters omitted ...]\n${'v'.repeat(15_000)}`,
      );
    },
  );

  test('a command whose output passes the limit is killed', posixOnly, async () => {
    const results = await directory('maka-tool-results-');
    const { manager: target, cwd } = await manager({
      toolResultRoot: results,
      maxForegroundOutputBytes: 64 * 1024,
    });
    const result = await run(
      target,
      cwd,
      nodeCommand(
        `const line = 'y'.repeat(1023) + '\\n'; setInterval(() => process.stdout.write(line.repeat(16)), 1);`,
      ),
    );
    assert.equal(result.status, 'failed');
    assert.equal(result.exitCode, undefined);
    assert.equal(result.failureMessage, 'Output passed 64 KB, so the command was killed');
    assert.match(
      String(projectBashToolResultForModel(result)),
      /^Output passed 64 KB, so the command was killed\n/u,
    );
    assert.deepEqual(await rootEntries(results), []);
  });
});
