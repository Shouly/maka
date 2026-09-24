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

// Glob against a measured reference capture (2026-09-22, cases T01–T43).
// The lab below is the capture's `glob-lab`, the cases keep its numbers, and
// every expected answer is the capture's own. Files get distinct times in
// creation order so the capture's time-ordered answers are deterministic.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildBuiltinTools } from '../builtin-tools.js';
import { resolveRipgrepPath } from '../ripgrep-locator.js';
import { nodeGlob } from '../search-plan.js';

const LAB_FILES = [
  '中文目录/笔记.md',
  '.hidden_dir/secret.md',
  '.dotfile.md',
  'README.md',
  'ignored/x.md',
  'deep/a/b/c/d/deep.md',
  'docs/guide.md',
  'docs/API.MD',
  '.env',
  '.gitignore',
  'case/Upper.TXT',
  'case/lower.txt',
  'file1.txt',
  'file2.txt',
  'file10.txt',
  'fileA.txt',
  'node_modules/pkg/index.js',
  'src/index.js',
  'src/app.ts',
  'src/components/Button.tsx',
  'src/utils/helper.js',
  'with space/a b.txt',
  ...Array.from({ length: 150 }, (_, index) => `many/f${String(index + 1).padStart(3, '0')}.dat`),
  'many/keep.log',
];
const MTIME_FILES: ReadonlyArray<readonly [string, number]> = [
  ['mtime/a_2020.txt', Date.UTC(2020, 0, 1)],
  ['mtime/b_2024.txt', Date.UTC(2024, 0, 1)],
  ['mtime/c_2022.txt', Date.UTC(2022, 0, 1)],
];
const TRUNCATION = (shown: number, total: number) =>
  `(Showing ${shown} of ${total} matching files; ${total - shown} more are not listed. Narrow the pattern or path to see the rest.)`;

describe('Glob matches the reference capture', { skip: !(await resolveRipgrepPath()) }, () => {
  let parent: string;
  let lab: string;
  const glob = buildBuiltinTools().find((tool) => tool.name === 'Glob');
  assert.ok(glob);

  /** The model's text for one call, run from the lab as the session cwd. */
  async function run(args: { pattern: string; path?: string }): Promise<string> {
    const output = await glob!.impl(args as never, {
      sessionId: 'session-1',
      turnId: 'turn-1',
      cwd: lab,
      toolCallId: 'tool-1',
      abortSignal: new AbortController().signal,
      emitOutput: () => {},
      // Host scope, as in the capture: T14 and T16 search above the cwd.
      executionBoundary: { kind: 'bypass', revision: 1 },
    });
    const text = glob!.toModelOutput?.({ toolCallId: 'tool-1', input: args, output });
    assert.ok(text?.type === 'text');
    return text.value;
  }
  const lines = async (args: { pattern: string; path?: string }) => (await run(args)).split('\n');
  const set = async (args: { pattern: string; path?: string }) => (await lines(args)).sort();

  before(async () => {
    // Not realpath'd: macOS answers /var/... here and /private/var/... from
    // the filesystem, and the answers must keep the spelling they were given.
    parent = await mkdtemp(join(tmpdir(), 'maka-glob-reference-'));
    lab = join(parent, 'glob-lab');
    const base = Date.UTC(2025, 0, 1);
    for (const [index, file] of LAB_FILES.entries()) {
      await mkdir(dirname(join(lab, file)), { recursive: true });
      await writeFile(join(lab, file), `${file}\n`, 'utf8');
      const time = new Date(base + index * 1_000);
      await utimes(join(lab, file), time, time);
    }
    for (const [file, time] of MTIME_FILES) {
      await mkdir(dirname(join(lab, file)), { recursive: true });
      await writeFile(join(lab, file), `${file}\n`, 'utf8');
      await utimes(join(lab, file), new Date(time), new Date(time));
    }
    await mkdir(join(lab, 'empty_dir'));
    await symlink('nonexistent.md', join(lab, 'broken_link.md'));
    await symlink('README.md', join(lab, 'readme_link.md'));
    await symlink('docs', join(lab, 'docs_link'));
    await writeFile(join(parent, 'outside.md'), 'outside\n', 'utf8');
  });

  after(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  test('T01 T02 T03: recursion, dotfiles in, case and symlinks out', async () => {
    const expected = [
      '.dotfile.md',
      '.hidden_dir/secret.md',
      'README.md',
      'deep/a/b/c/d/deep.md',
      'docs/guide.md',
      'ignored/x.md',
      '中文目录/笔记.md',
    ].sort();
    assert.deepEqual(await set({ pattern: '**/*.md', path: lab }), expected);
    assert.deepEqual(await set({ pattern: '*.md', path: lab }), expected);
    assert.deepEqual(await set({ pattern: '**/*.md' }), expected);
  });

  test('T04–T07 T24 T23 T33: the pattern syntax', async () => {
    const src = ['src/app.ts', 'src/components/Button.tsx', 'src/index.js', 'src/utils/helper.js'];
    assert.deepEqual(await set({ pattern: 'src/**/*.{js,ts,tsx}', path: lab }), src);
    assert.deepEqual(await set({ pattern: 'file?.txt', path: lab }), [
      'file1.txt',
      'file2.txt',
      'fileA.txt',
    ]);
    assert.deepEqual(await set({ pattern: 'file[0-9]*.txt', path: lab }), [
      'file1.txt',
      'file10.txt',
      'file2.txt',
    ]);
    assert.deepEqual(await lines({ pattern: 'file[!0-9].txt', path: lab }), ['fileA.txt']);
    assert.deepEqual(await set({ pattern: '*', path: join(lab, 'src') }), src);
    assert.deepEqual(await lines({ pattern: 'deep/**', path: lab }), ['deep/a/b/c/d/deep.md']);
    assert.deepEqual(await set({ pattern: '{README,docs/guide}.md', path: lab }), [
      'README.md',
      'docs/guide.md',
    ]);
  });

  test('T08 T14 T20 T35 T09 T37: paths answer relative to the cwd, not to `path`', async () => {
    assert.deepEqual(await lines({ pattern: '*.md', path: join(lab, 'docs') }), ['docs/guide.md']);
    assert.deepEqual(await lines({ pattern: 'glob-lab/docs/*.md', path: parent }), [
      'docs/guide.md',
    ]);
    assert.deepEqual(await lines({ pattern: '*.md', path: 'docs' }), ['docs/guide.md']);
    assert.deepEqual(await lines({ pattern: 'docs/*.md', path: '.' }), ['docs/guide.md']);
    assert.deepEqual(await set({ pattern: join(lab, 'src/**/*.js') }), [
      'src/index.js',
      'src/utils/helper.js',
    ]);
    assert.deepEqual(await lines({ pattern: join(lab, 'docs/*.md'), path: join(lab, 'src') }), [
      'docs/guide.md',
    ]);
  });

  test('T16: a file outside the cwd answers with its absolute path, as written', async () => {
    const answer = await lines({ pattern: '*.md', path: parent });
    assert.ok(answer.includes(join(parent, 'outside.md')), answer.join('\n'));
    assert.ok(answer.includes('docs/guide.md'));
  });

  test('T34 T36 T29: `./` patterns and `..` match nothing', async () => {
    assert.equal(await run({ pattern: './docs/*.md', path: '.' }), 'No files found');
    assert.equal(await run({ pattern: './docs/*.md', path: lab }), 'No files found');
    assert.equal(await run({ pattern: '../docs/*.md', path: join(lab, 'src') }), 'No files found');
  });

  test('T18 T19: a missing root and a file root are errors', async () => {
    await assert.rejects(run({ pattern: '*.md', path: join(lab, 'does-not-exist') }), {
      message: `Directory does not exist: ${join(lab, 'does-not-exist')}. Note: your current working directory is ${lab}.`,
    });
    await assert.rejects(run({ pattern: '*', path: join(lab, 'README.md') }), {
      message: `Path is not a directory: ${join(lab, 'README.md')}`,
    });
  });

  test('T11 T12 T21 T22 T27 T25 T26 T15 T10: case, files only, names', async () => {
    assert.deepEqual(await lines({ pattern: '**/*.MD', path: lab }), ['docs/API.MD']);
    assert.deepEqual(await lines({ pattern: '*.txt', path: join(lab, 'case') }), [
      'case/lower.txt',
    ]);
    assert.equal(await run({ pattern: '**/src', path: lab }), 'No files found');
    assert.equal(await run({ pattern: '**/empty_dir', path: lab }), 'No files found');
    assert.deepEqual(await set({ pattern: '.*', path: lab }), [
      '.dotfile.md',
      '.env',
      '.gitignore',
    ]);
    assert.deepEqual(await lines({ pattern: 'with space/*.txt', path: lab }), [
      'with space/a b.txt',
    ]);
    assert.deepEqual(await lines({ pattern: '中文目录/*', path: lab }), ['中文目录/笔记.md']);
    assert.equal(await run({ pattern: '**/*.xyz', path: lab }), 'No files found');
    assert.deepEqual(await set({ pattern: '**/*.js', path: lab }), [
      'node_modules/pkg/index.js',
      'src/index.js',
      'src/utils/helper.js',
    ]);
  });

  test('T30 T31: symlinks are neither followed nor listed', async () => {
    assert.equal(await run({ pattern: 'docs_link/*.md', path: lab }), 'No files found');
    assert.equal(await run({ pattern: '*_link*', path: lab }), 'No files found');
  });

  test('T32: an empty pattern lists every file, oldest first, capped at 100', async () => {
    const answer = await lines({ pattern: '', path: lab });
    assert.equal(answer.length, 101);
    assert.deepEqual(answer.slice(0, 3), [
      'mtime/a_2020.txt',
      'mtime/c_2022.txt',
      'mtime/b_2024.txt',
    ]);
    assert.equal(answer.at(-1), TRUNCATION(100, 176));
  });

  test('T13 T17: ascending by time, and the cap drops the newest', async () => {
    assert.deepEqual(await lines({ pattern: '*.txt', path: join(lab, 'mtime') }), [
      'mtime/a_2020.txt',
      'mtime/c_2022.txt',
      'mtime/b_2024.txt',
    ]);
    const answer = await lines({ pattern: '*.dat', path: join(lab, 'many') });
    assert.equal(answer.length, 101);
    assert.equal(answer[0], 'many/f001.dat');
    assert.equal(answer[99], 'many/f100.dat');
    assert.equal(answer[100], TRUNCATION(100, 150));
  });

  test('T28 T40: .gitignore is not respected', async () => {
    await writeFile(join(lab, '.gitignore'), 'ignored/\n*.log\n', 'utf8');
    assert.deepEqual(await lines({ pattern: '**/*.log', path: lab }), ['many/keep.log']);
    assert.deepEqual(await lines({ pattern: 'ignored/x.md', path: lab }), ['ignored/x.md']);
  });

  test('a pattern that repeats the end of its path means the path itself', async () => {
    assert.deepEqual(await lines({ pattern: 'docs/*.md', path: join(lab, 'docs') }), [
      'docs/guide.md',
    ]);
  });

  test('T43: touching a file moves it to the end', async () => {
    const now = new Date();
    await utimes(join(lab, 'README.md'), now, now);
    const answer = await lines({ pattern: '**/*.md', path: lab });
    assert.equal(answer.at(-1), 'README.md');
    assert.equal(answer.length, 7);
  });

  test('T41 T42: .git is searched like any directory', async () => {
    for (const file of ['.git/HEAD', '.git/config', '.git/description', '.git/hooks/a.sample']) {
      await mkdir(dirname(join(lab, file)), { recursive: true });
      await writeFile(join(lab, file), `${file}\n`, 'utf8');
    }
    assert.deepEqual(await set({ pattern: '.git/*', path: lab }), [
      '.git/HEAD',
      '.git/config',
      '.git/description',
    ]);
    assert.deepEqual(await lines({ pattern: '**/*.sample', path: lab }), ['.git/hooks/a.sample']);
  });
});

describe('the Node fallback Glob stays inside its root', () => {
  test('`..` matches nothing, as with ripgrep', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'maka-node-glob-'));
    try {
      await mkdir(join(parent, 'root', 'sub'), { recursive: true });
      await writeFile(join(parent, 'outside.md'), 'x\n', 'utf8');
      await writeFile(join(parent, 'root', 'sub', 'inside.md'), 'x\n', 'utf8');
      const root = join(parent, 'root');
      for (const pattern of ['../*', '../*.md', 'sub/../../*.md'])
        assert.deepEqual(
          await nodeGlob({ root, pattern, limit: 100 }),
          { files: [], total: 0 },
          pattern,
        );
      assert.deepEqual(await nodeGlob({ root, pattern: '*.md', limit: 100 }), {
        files: [join('sub', 'inside.md')],
        total: 1,
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
