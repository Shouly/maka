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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { ToolResultContent } from '@maka/core/events';
import {
  BASH_FAILURE_INLINE_MAX_CHARS,
  BASH_INLINE_MAX_CHARS,
  boundTerminalResult,
  boundTerminalResultInline,
  exitOneIsBenign,
  isValidBashOutcome,
  type WholeShellOutput,
} from '../bash-output-limits.js';
import { capturedOutput, projectBashToolResultForModel } from '../bash-model-output.js';
import { PipeTailCollector } from '../pipe-tail-collector.js';
import { ShellOutputSpool, type ShellOutputHead } from '../shell-output-spool.js';
import { shapeTerminalResult } from '../shell-tools.js';

type TerminalToolResult = Extract<ToolResultContent, { kind: 'terminal' }>;

function terminal(input: {
  stdout?: string;
  stderr?: string;
  cmd?: string;
  status?: TerminalToolResult['status'];
  exitCode?: number;
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
}): TerminalToolResult {
  const status = input.status ?? 'completed';
  return {
    kind: 'terminal',
    cwd: '/workspace',
    cmd: input.cmd ?? 'make',
    status,
    exitCode: input.exitCode ?? (status === 'completed' ? 0 : 2),
    output: {
      mode: 'pipes',
      stdout: input.stdout ?? '',
      stderr: input.stderr ?? '',
      stdoutTruncated: input.stdoutTruncated ?? false,
      stderrTruncated: input.stderrTruncated ?? false,
      redacted: false,
    },
  };
}

/** A head from disk whose streams are held whole at the given lengths. */
function diskHead(
  stdout: string,
  stderr: string,
  chars: { stdout: number; stderr: number },
  overrides: Partial<ShellOutputHead['streams']> = {},
): ShellOutputHead {
  return {
    stdout,
    stderr,
    streams: {
      stdout: { chars: chars.stdout, ends: true, complete: true },
      stderr: { chars: chars.stderr, ends: true, complete: true },
      ...overrides,
    },
  };
}

function pipes(result: TerminalToolResult): { stdout: string; stderr: string } {
  if (result.output.mode !== 'pipes') throw new Error('expected pipes');
  return { stdout: result.output.stdout, stderr: result.output.stderr };
}

/** Output kept on disk that records what it was asked and answers like a spool would. */
function fakeWhole(
  chars: number,
  preview: string,
  head?: ShellOutputHead,
): {
  calls: number;
  heads: number;
  whole: WholeShellOutput;
} {
  const state = {
    calls: 0,
    heads: 0,
    whole: {
      save: async () => {
        state.calls += 1;
        return {
          path: '/tmp/maka/tool-results/session-1/run-1.txt',
          chars,
          truncated: false,
          preview: { stdout: preview, stderr: '' },
        };
      },
      head: async () => {
        state.heads += 1;
        return head;
      },
    },
  };
  return state;
}

describe('which command endings count as a valid result', () => {
  test('exit 1 is an answer from grep, rg, egrep, fgrep, find, diff, test, [ and git diff/grep', () => {
    for (const command of [
      'grep -n foo src/a.ts',
      'rg foo',
      'egrep "a|b" file',
      'fgrep x y',
      'find . -name "*.tmp"',
      'diff a.txt b.txt',
      'test -f missing',
      '[ -d /nope ]',
      'git diff --exit-code',
      'git grep needle',
      'git -C /repo --no-pager diff HEAD',
      '/usr/bin/grep foo bar',
      'LC_ALL=C grep foo bar',
      'cd src && grep -r foo .',
      'cat log | grep error',
      'grep foo bar 2>/dev/null',
      'grep foo bar 2>&1',
      'grep "a; b" file',
    ]) {
      assert.equal(exitOneIsBenign(command), true, command);
    }
  });

  test('exit 1 is a failure from every other command', () => {
    for (const command of [
      'ls missing',
      'npm test',
      'git status',
      'git commit -m "grep"',
      'grep foo bar | wc -l',
      'grep foo bar; false',
      'echo "grep foo"',
      'sh -c "grep foo"',
      '',
    ]) {
      assert.equal(exitOneIsBenign(command), false, command);
    }
  });

  test('a run is valid when it exits 0, or exits 1 where that is an answer', () => {
    assert.equal(isValidBashOutcome(terminal({})), true);
    assert.equal(
      isValidBashOutcome(terminal({ status: 'failed', exitCode: 1, cmd: 'grep x y' })),
      true,
    );
    assert.equal(
      isValidBashOutcome(terminal({ status: 'failed', exitCode: 1, cmd: 'ls x' })),
      false,
    );
    assert.equal(
      isValidBashOutcome(terminal({ status: 'failed', exitCode: 2, cmd: 'grep x y' })),
      false,
    );
    assert.equal(
      isValidBashOutcome(terminal({ status: 'timed_out', exitCode: 124, cmd: 'grep x y' })),
      false,
    );
    assert.equal(
      isValidBashOutcome(terminal({ status: 'cancelled', exitCode: 130, cmd: 'grep x y' })),
      false,
    );
  });
});

describe('a valid result past 30,000 characters is saved to a file', () => {
  test('30,000 characters are shown whole and nothing is saved', async () => {
    const result = terminal({ stdout: 'a'.repeat(BASH_INLINE_MAX_CHARS) });
    const save = fakeWhole(0, '');
    assert.equal(await boundTerminalResult(result, save.whole), result);
    assert.equal(save.calls, 0);
  });

  test('30,001 characters are saved, and the model gets the path and a 2,000-character preview', async () => {
    const stdout = `${'b'.repeat(2_000)}${'c'.repeat(BASH_INLINE_MAX_CHARS - 1_999)}`;
    const save = fakeWhole(stdout.length, stdout.slice(0, 2_000));
    const bounded = await boundTerminalResult(terminal({ stdout }), save.whole);

    assert.equal(save.calls, 1);
    assert.deepEqual(bounded.savedOutput, {
      path: '/tmp/maka/tool-results/session-1/run-1.txt',
      chars: 30_001,
      truncated: false,
    });
    assert.deepEqual(pipes(bounded), { stdout: 'b'.repeat(2_000), stderr: '' });
    assert.equal(bounded.output.mode === 'pipes' && bounded.output.stdoutTruncated, true);
    assert.equal(
      projectBashToolResultForModel(bounded),
      `Output too long to show (30,001 characters). The full output is saved to /tmp/maka/tool-results/session-1/run-1.txt; read it with Read or search it with Grep.\n\nPreview (first 2,000 characters):\n${'b'.repeat(2_000)}`,
    );
  });

  test('a benign exit 1 is valid, so its long output is saved and still leads with the code', async () => {
    const stdout = 'm'.repeat(BASH_INLINE_MAX_CHARS + 1);
    const save = fakeWhole(stdout.length, stdout.slice(0, 2_000));
    const bounded = await boundTerminalResult(
      terminal({ stdout, status: 'failed', exitCode: 1, cmd: 'diff a b' }),
      save.whole,
    );
    assert.equal(save.calls, 1);
    assert.match(String(projectBashToolResultForModel(bounded)), /^Exit code 1\nOutput too long/u);
  });

  test('with nowhere to save, a long valid result is a head and a tail of 30,000 characters', async () => {
    const stdout = `${'h'.repeat(20_000)}${'t'.repeat(20_000)}`;
    const bounded = await boundTerminalResult(terminal({ stdout }));
    const shown = pipes(bounded).stdout;
    assert.equal(bounded.savedOutput, undefined);
    assert.equal(
      shown,
      `${'h'.repeat(15_000)}\n[... 10,000 characters omitted ...]\n${'t'.repeat(15_000)}`,
    );
  });
});

describe('a failure past 10,000 characters is a head and a tail, never a file', () => {
  test('10,000 characters are shown whole', async () => {
    const result = terminal({
      stderr: 'e'.repeat(BASH_FAILURE_INLINE_MAX_CHARS),
      status: 'failed',
    });
    const save = fakeWhole(0, '');
    assert.equal(await boundTerminalResult(result, save.whole), result);
    assert.equal(save.calls, 0);
  });

  test('10,001 characters keep the first and last 5,000 and say how much is left out', async () => {
    const stderr = `${'H'.repeat(5_000)}x${'T'.repeat(5_000)}`;
    const save = fakeWhole(0, '');
    const bounded = await boundTerminalResult(terminal({ stderr, status: 'failed' }), save.whole);
    assert.equal(save.calls, 0);
    assert.equal(bounded.savedOutput, undefined);
    assert.deepEqual(pipes(bounded), {
      stdout: '',
      stderr: `${'H'.repeat(5_000)}\n[... 1 character omitted ...]\n${'T'.repeat(5_000)}`,
    });
    assert.equal(
      projectBashToolResultForModel(bounded),
      `Exit code 2\n${'H'.repeat(5_000)}\n[... 1 character omitted ...]\n${'T'.repeat(5_000)}`,
    );
  });

  test('the cut can span stdout into stderr; each keeps its own part', () => {
    const bounded = boundTerminalResultInline(
      terminal({
        stdout: `${'o'.repeat(8_000)}\n`,
        stderr: 'r'.repeat(8_000),
        status: 'timed_out',
        exitCode: 124,
      }),
    );
    assert.deepEqual(pipes(bounded), {
      stdout: `${'o'.repeat(5_000)}\n[... 6,001 characters omitted ...]\n`,
      stderr: 'r'.repeat(5_000),
    });
    assert.equal(
      projectBashToolResultForModel(bounded),
      `Exit code 124 (timed out)\n${'o'.repeat(5_000)}\n[... 6,001 characters omitted ...]\n${'r'.repeat(5_000)}`,
    );
  });

  test('a retained window that lost the start of the output says so at its top', () => {
    const bounded = boundTerminalResultInline(
      terminal({ stdout: 'w'.repeat(12_000), status: 'failed', stdoutTruncated: true }),
    );
    assert.equal(
      pipes(bounded).stdout,
      `[... earlier output omitted ...]\n${'w'.repeat(5_000)}\n[... 2,000 characters omitted ...]\n${'w'.repeat(5_000)}`,
    );
  });

  test('a stderr window whose start falls in the cut makes the count a lower bound', () => {
    const bounded = boundTerminalResultInline(
      terminal({
        stdout: 'o'.repeat(6_000),
        stderr: 'e'.repeat(6_000),
        status: 'failed',
        stderrTruncated: true,
      }),
    );
    assert.deepEqual(pipes(bounded), {
      stdout: `${'o'.repeat(5_000)}\n[... more than 2,001 characters omitted ...]\n`,
      stderr: 'e'.repeat(5_000),
    });
  });

  test('a stderr window whose start is shown is marked there', () => {
    const bounded = boundTerminalResultInline(
      terminal({
        stdout: 'o'.repeat(100),
        stderr: 'e'.repeat(12_000),
        status: 'failed',
        stderrTruncated: true,
      }),
    );
    assert.deepEqual(pipes(bounded), {
      stdout: 'o'.repeat(100),
      stderr: `[... earlier output omitted ...]\n${'e'.repeat(4_899)}\n[... 2,101 characters omitted ...]\n${'e'.repeat(5_000)}`,
    });
  });

  test('a long valid result with nowhere to save, whose window was cut, says so too', async () => {
    const bounded = await boundTerminalResult(
      terminal({ stdout: 'v'.repeat(40_000), stdoutTruncated: true }),
    );
    assert.match(pipes(bounded).stdout, /^\[\.\.\. earlier output omitted \.\.\.\]\nv/u);
  });

  test('a failure whose window was cut takes its head from the output kept on disk', async () => {
    const head = diskHead('S'.repeat(5_000), '', { stdout: 2_000_000, stderr: 0 });
    const whole = fakeWhole(0, '', head);
    const bounded = await boundTerminalResult(
      terminal({
        stdout: 'w'.repeat(1_000_000),
        status: 'failed',
        stdoutTruncated: true,
      }),
      whole.whole,
    );
    assert.equal(whole.calls, 0);
    assert.equal(whole.heads, 1);
    assert.equal(
      pipes(bounded).stdout,
      `${'S'.repeat(5_000)}\n[... 1,990,000 characters omitted ...]\n${'w'.repeat(5_000)}`,
    );
  });

  test('a head from disk that missed part of the output makes the count a lower bound', async () => {
    // A line of stderr was left out of the file, so its length there is short.
    const head = diskHead(
      'S'.repeat(4_000),
      'E'.repeat(999),
      { stdout: 4_000, stderr: 65_999 },
      { stderr: { chars: 65_999, ends: true, complete: false } },
    );
    const bounded = await boundTerminalResult(
      terminal({
        stdout: 'S'.repeat(4_000),
        stderr: 'w'.repeat(50_000),
        status: 'failed',
        stderrTruncated: true,
      }),
      fakeWhole(0, '', head).whole,
    );
    assert.deepEqual(pipes(bounded), {
      stdout: 'S'.repeat(4_000),
      stderr: `${'E'.repeat(999)}\n[... more than 60,000 characters omitted ...]\n${'w'.repeat(5_000)}`,
    });
  });

  test('without a head from disk a cut failure falls back to its retained window', async () => {
    const bounded = await boundTerminalResult(
      terminal({ stdout: 'w'.repeat(12_000), status: 'failed', stdoutTruncated: true }),
      fakeWhole(0, '').whole,
    );
    assert.match(pipes(bounded).stdout, /^\[\.\.\. earlier output omitted \.\.\.\]\n/u);
  });

  test('the tail taken after a head from disk never starts with half a surrogate pair', async () => {
    const head = diskHead('S'.repeat(5_000), '', { stdout: 100_000, stderr: 0 });
    // The tail's first unit would be the second half of a fox.
    const bounded = await boundTerminalResult(
      terminal({ stdout: `a${'🦊'.repeat(3_000)}b`, status: 'failed', stdoutTruncated: true }),
      fakeWhole(0, '', head).whole,
    );
    const shown = pipes(bounded).stdout;
    assert.ok(shown.endsWith(`${'🦊'.repeat(2_499)}b`));
    assert.match(shown, /omitted \.\.\.\]\n🦊/u);
    assert.doesNotMatch(
      shown,
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
  });

  test('a short stdout the head already shows is not shown again, and stderr keeps its head', async () => {
    // stdout is one short line; stderr is one line too long to retain, then the error.
    const root = await mkdtemp(join(tmpdir(), 'maka-excerpt-overlap-'));
    try {
      const chunks: Array<['stdout' | 'stderr', string]> = [
        ['stdout', 'compiling\n'],
        ['stderr', `${'x'.repeat(1_200_000)}\nError: build failed\n`],
      ];
      const spool = await ShellOutputSpool.open(root, 'run-overlap');
      const tail = new PipeTailCollector();
      for (const [stream, chunk] of chunks) {
        spool.accept(stream, chunk);
        tail.accept(stream, chunk);
      }
      const output = tail.snapshot();
      assert.equal(output.stderrTruncated, true);
      const bounded = await boundTerminalResult(
        {
          kind: 'terminal',
          cwd: '/workspace',
          cmd: 'make',
          status: 'failed',
          exitCode: 1,
          output,
        },
        { save: async () => undefined, head: (maxChars) => spool.head(maxChars) },
      );
      await spool.discard();
      assert.deepEqual(pipes(bounded), {
        stdout: 'compiling',
        // The head is 5,000 characters: `compiling`, the newline, and 4,990 of the long line.
        stderr: `${'x'.repeat(4_990)}\n[... 1,195,011 characters omitted ...]\nError: build failed`,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('a stdout the head and the tail show between them is shown whole, with no line between', async () => {
    const stdout = `${'a'.repeat(5_000)}${'b'.repeat(2_000)}`;
    const head = diskHead('a'.repeat(5_000), '', { stdout: 7_000, stderr: 3_000_000 });
    const bounded = await boundTerminalResult(
      terminal({
        stdout,
        stderr: 'e'.repeat(100),
        status: 'failed',
        stderrTruncated: true,
      }),
      fakeWhole(0, '', head).whole,
    );
    assert.deepEqual(pipes(bounded), {
      stdout,
      stderr: `[... 2,999,900 characters omitted ...]\n${'e'.repeat(100)}`,
    });
  });

  test('one stretch left out from inside stdout into stderr is one line', async () => {
    const head = diskHead('S'.repeat(5_000), '', { stdout: 3_000_000, stderr: 2_000_000 });
    const bounded = await boundTerminalResult(
      terminal({
        stdout: 'w'.repeat(1_000_000),
        stderr: 'e'.repeat(1_000_000),
        status: 'failed',
        stdoutTruncated: true,
        stderrTruncated: true,
      }),
      fakeWhole(0, '', head).whole,
    );
    // stdout's 2,995,000 after the head, the newline, then stderr's first 1,995,000.
    assert.deepEqual(pipes(bounded), {
      stdout: `${'S'.repeat(5_000)}\n[... 4,990,001 characters omitted ...]`,
      stderr: 'e'.repeat(5_000),
    });
  });

  test('a stream the file stops short of is counted as a lower bound', async () => {
    // stdout reached the size limit, so nothing of stderr is in the file.
    const head = diskHead(
      'S'.repeat(5_000),
      '',
      { stdout: 60_000_000, stderr: 0 },
      {
        stdout: { chars: 60_000_000, ends: false, complete: false },
        stderr: { chars: 0, ends: false, complete: false },
      },
    );
    const bounded = await boundTerminalResult(
      terminal({
        stdout: 'w'.repeat(1_000_000),
        stderr: 'boom',
        status: 'failed',
        stdoutTruncated: true,
      }),
      fakeWhole(0, '', head).whole,
    );
    assert.deepEqual(pipes(bounded), {
      stdout: `${'S'.repeat(5_000)}\n[... more than 59,990,004 characters omitted ...]\n${'w'.repeat(4_996)}`,
      stderr: 'boom',
    });
  });

  test('the cut never splits a surrogate pair', () => {
    // Both edges of the cut land inside a pair: the head's last unit is a
    // high surrogate and the tail's first a low one.
    const bounded = boundTerminalResultInline(
      terminal({ stdout: `a${'🦊'.repeat(6_000)}b`, status: 'failed' }),
    );
    assert.match(pipes(bounded).stdout, /\n\[\.\.\. 2,004 characters omitted \.\.\.\]\n/u);
    assert.doesNotMatch(
      pipes(bounded).stdout,
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
    );
  });
});

describe('a long run of newlines before the end of the output', () => {
  test('is bounded in linear time, saved to a file or cut to a head and a tail', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'maka-bash-newlines-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const stdout = `${'\n'.repeat(4 * 1024 * 1024)}x\n`;
    const started = performance.now();
    const spool = await ShellOutputSpool.open(root, 'run-1');
    spool.accept('stdout', stdout);
    const saved = await boundTerminalResult(terminal({ stdout }), {
      save: () => spool.save(join(root, 'session-1', 'run-1.txt'), 2_000),
      head: (maxChars) => spool.head(maxChars),
    });
    assert.equal(saved.savedOutput?.chars, 4 * 1024 * 1024 + 1);
    const failure = boundTerminalResultInline(terminal({ stdout, status: 'failed' }));
    assert.ok(pipes(failure).stdout.endsWith('\nx'));
    assert.ok(capturedOutput({ mode: 'pipes', stdout, stderr: '' }).endsWith('\nx'));
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 2_000, `${elapsed} ms`);
  });
});

describe('the preview of a saved output', () => {
  test('is the start of the saved file as it is, newlines at its end included', async () => {
    const stdout = `${'x'.repeat(1_990)}\n\n\n${'y'.repeat(40_000)}`;
    const whole: WholeShellOutput = {
      save: async () => ({
        path: '/tmp/r/s/run.txt',
        chars: stdout.length,
        truncated: false,
        preview: { stdout: `${'x'.repeat(1_990)}\n\n\n${'y'.repeat(7)}`, stderr: '' },
      }),
      head: async () => undefined,
    };
    const bounded = await boundTerminalResult(terminal({ stdout, stderr: 'err' }), whole);
    const text = String(projectBashToolResultForModel(bounded));
    assert.ok(
      text.endsWith(
        `Preview (first 2,000 characters):\n${'x'.repeat(1_990)}\n\n\n${'y'.repeat(7)}`,
      ),
    );
  });

  test('joins a stdout part and a stderr part with the newline between them in the file', async () => {
    const whole: WholeShellOutput = {
      save: async () => ({
        path: '/tmp/r/s/run.txt',
        chars: 40_000,
        truncated: false,
        preview: { stdout: 'out', stderr: 'err\n\n' },
      }),
      head: async () => undefined,
    };
    const bounded = await boundTerminalResult(
      terminal({ stdout: 'out\n\n', stderr: `err\n\n${'e'.repeat(40_000)}` }),
      whole,
    );
    assert.ok(
      String(projectBashToolResultForModel(bounded)).endsWith(
        'Preview (first 9 characters):\nout\nerr\n\n',
      ),
    );
  });
});

describe('the notice for a saved output the file does not hold whole', () => {
  test('says only part of it is saved and that a line marks the gap, never that it is all there', async () => {
    const whole: WholeShellOutput = {
      save: async () => ({
        path: '/tmp/r/s/run.txt',
        chars: 1_234_567,
        truncated: true,
        preview: { stdout: 'start', stderr: '' },
      }),
      head: async () => undefined,
    };
    const bounded = await boundTerminalResult(terminal({ stdout: 's'.repeat(40_000) }), whole);
    assert.equal(bounded.savedOutput?.truncated, true);
    const text = String(projectBashToolResultForModel(bounded));
    assert.equal(
      text,
      'Output too long to show, and too long to save whole: /tmp/r/s/run.txt holds 1,234,567 characters of it, and a line in the file marks where output was left out. Read it with Read or search it with Grep.\n\nPreview (first 5 characters):\nstart',
    );
    assert.doesNotMatch(text, /full output/u);
  });
});

describe('reading the command whose exit status is reported', () => {
  const benign = (command: string) => assert.equal(exitOneIsBenign(command), true, command);
  const failure = (command: string) => assert.equal(exitOneIsBenign(command), false, command);

  test('parameter expansions are part of a word', () => {
    benign('grep "${PATTERN}" file');
    benign('grep ${PATTERN:-x} file');
    benign('test ${#files[@]} -eq 0');
    benign('test ${#files[@]} -eq 0 && grep x y');
    failure('${GREP:-grep} foo file');
  });

  test('command and process substitutions are part of a word', () => {
    benign('grep "$(cat pattern.txt)" file');
    benign('grep $(echo foo; echo bar) file');
    benign('grep "$(echo ")")" file');
    benign('diff <(sort a) <(sort b; echo) ');
    benign('grep -f <(echo x) file');
    benign('grep `echo x` file');
    failure('cat $(grep -l x .)');
  });

  test('brace expansion is part of a word, a group is not', () => {
    benign('grep foo file{1,2}.txt');
    benign('diff {a,b}.txt');
    benign('find . -name x -exec grep -l y {} \\;');
    benign('{ ls; grep x y; }');
    failure('{ grep x y; ls; }');
  });

  test('a # inside a word is not a comment', () => {
    benign('grep foo#bar file');
    benign('grep "#x" file');
    benign("grep 'a' file # a trailing comment; ls");
    failure('ls # ; grep x');
  });

  test('an escaped quote does not end a double-quoted string', () => {
    benign('grep "say \\"hi; there\\"" file');
    failure('grep "a\\"b" file | wc -l');
    benign("grep $'a\\'b' file");
  });

  test('[[ ]] is a test, its operators its own', () => {
    benign('[[ -f a && -f b ]]');
    benign('[[ $a < $b ]]');
    benign('[[ ( -f a ) || -d b ]]');
    failure('[[ -f x ]] && ls');
    failure('[[ -f x');
  });

  test('the command behind a wrapper is the one looked at', () => {
    benign('sudo grep x /etc/hosts');
    benign('sudo -u root grep x f');
    benign('sudo -E -u admin LC_ALL=C grep x f');
    benign('sudo --user=root -- grep x f');
    benign('time grep x f');
    benign('time -p diff a b');
    benign('env LC_ALL=C grep x f');
    benign('env -i PATH=/bin grep x f');
    benign('env -u HOME grep x f');
    benign('env - grep x f');
    benign('timeout 5 grep x f');
    benign('timeout -s KILL 10s diff a b');
    benign('timeout --kill-after=5 30 grep x f');
    benign("find . -name '*.ts' | xargs grep foo");
    benign('xargs -0 -n 1 grep foo');
    benign('xargs -I {} grep foo {}');
    benign('command grep x f');
    benign('nice -n 10 grep x f');
    benign('nice -5 grep x f');
    benign('nice grep x f');
    benign('nohup grep x f');
    benign('sudo timeout 5 nice -n 2 env A=b grep x f');
    benign('/usr/bin/timeout 5 /usr/bin/grep x f');
  });

  test('a wrapper it cannot read, or one that does not run the command, is a failure', () => {
    failure('command -v grep');
    failure('sudo -l grep');
    failure('sudo --frobnicate grep x');
    failure('timeout grep x f');
    failure('timeout 5');
    failure("env -S 'grep x' f");
    failure('xargs');
    failure('nice -n');
    failure('sudo ls');
    failure('nohup ls');
  });

  test('a command line it cannot read is a failure', () => {
    failure('grep "unterminated');
    failure("grep 'unterminated");
    failure('grep $(echo x file');
    failure('grep ${x file');
    failure('grep `x file');
  });

  test('a command line nested too deep is a failure, never a thrown error', () => {
    const quoted = `grep x "${'$("'.repeat(5_000)}${'")'.repeat(5_000)}"`;
    const substituted = `grep x ${'$('.repeat(20_000)}y${')'.repeat(20_000)}`;
    const expanded = `grep x ${'${'.repeat(20_000)}y${'}'.repeat(20_000)}`;
    for (const command of [quoted, substituted, expanded]) failure(command);
    // A nesting within the limit is still read.
    assert.equal(exitOneIsBenign(`grep x "${'$("'.repeat(50)}${'")'.repeat(50)}"`), true);
  });

  test('a finished command nested too deep still gets its result', async () => {
    const cmd = `grep x "${'$("'.repeat(5_000)}${'")'.repeat(5_000)}"`;
    const bounded = await boundTerminalResult(
      terminal({ cmd, stdout: 'o'.repeat(20_000), status: 'failed', exitCode: 1 }),
    );
    assert.equal(bounded.status, 'failed');
    assert.match(pipes(bounded).stdout, /omitted/u);
    const shaped = shapeTerminalResult({
      cwd: '/workspace',
      command: cmd,
      result: { stdout: 'o'.repeat(20_000), stderr: '', exitCode: 1 },
    });
    assert.equal(shaped.exitCode, 1);
    assert.match(pipes(shaped).stdout, /omitted/u);
  });
});
