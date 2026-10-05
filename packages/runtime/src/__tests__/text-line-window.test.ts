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
import { execFileSync } from 'node:child_process';
import { mkdtemp, open, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
  LINE_COUNT_MAX_BYTES,
  NOTEBOOK_READ_MAX_BYTES,
  partialViewNotice,
  readFileLineWindow,
  ReadLimitError,
  ReadRefusedError,
  readTextLineWindowFacts,
} from '../text-line-window.js';

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** What the model is shown for a window: each line with its number and a tab. */
function numbered(content: string, startLine: number): string {
  return content
    .split('\n')
    .map((line, index) => `${startLine + index}\t${line}`)
    .join('\n');
}

/** The UTF-8 bytes the model is shown for a first page: its lines, then its notice. */
function firstPageBytes(window: { content: string; totalLines: number }): number {
  const lines = window.content.split('\n').length;
  return Buffer.byteLength(
    `${numbered(window.content, 1)}\n\n${partialViewNotice(1, lines, window.totalLines)}`,
    'utf8',
  );
}

async function file(name: string, content: string | Buffer): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'maka-line-window-'));
  roots.push(root);
  const path = join(root, name);
  await writeFile(path, content);
  return path;
}

/**
 * `content`, then zeros up to `size` bytes, with a newline at each of
 * `newlinesAt`. The zeros are a hole in the file: nothing is written there.
 */
async function sparseFile(
  content: string,
  size: number,
  newlinesAt: readonly number[] = [],
): Promise<string> {
  const path = await file('sparse.log', content);
  await truncate(path, size);
  const handle = await open(path, 'r+');
  try {
    for (const at of newlinesAt) await handle.write('\n', at);
  } finally {
    await handle.close();
  }
  return path;
}

/** How `read` settles, and the bytes every file handle read meanwhile. */
async function bytesReadBy(
  read: () => Promise<unknown>,
): Promise<{ bytes: number; outcome: PromiseSettledResult<unknown> }> {
  const probe = await open(await file('probe.txt', ''), 'r');
  const prototype = Object.getPrototypeOf(probe) as {
    read: (...args: unknown[]) => Promise<{ bytesRead: number }>;
  };
  await probe.close();
  const original = prototype.read;
  let bytes = 0;
  prototype.read = async function (this: unknown, ...args: unknown[]) {
    const result = await original.apply(this, args);
    bytes += result.bytesRead;
    return result;
  };
  try {
    const [outcome] = await Promise.allSettled([read()]);
    return { bytes, outcome: outcome! };
  } finally {
    prototype.read = original;
  }
}

describe('reading a file one window at a time', () => {
  test('counts and slices lines exactly as the whole-text window does', async () => {
    for (const content of ['', 'a', 'a\n', 'a\nb', 'a\nb\n', '\n\n', 'x\r\ny\r\n', 'é\n漢\n🦊']) {
      const path = await file('lines.txt', content);
      for (const [offset, limit] of [
        [undefined, undefined],
        [0, undefined],
        [1, 1],
        [2, undefined],
        [2, 1],
        [3, 5],
        [9, undefined],
      ] as Array<[number | undefined, number | undefined]>) {
        const { partial, ...window } = await readFileLineWindow(path, offset, limit);
        assert.deepEqual(
          window,
          readTextLineWindowFacts(content, offset, limit),
          `${JSON.stringify(content)} ${offset}:${limit}`,
        );
        assert.equal(partial, false);
      }
    }
  });

  test('a whole-file read past 25,000 tokens answers with the lines that fit, and counts the rest', async () => {
    const path = await file('long.txt', `${'q'.repeat(49_800)}\n`.repeat(4));
    const window = await readFileLineWindow(path);
    // Two numbered lines are 99,605 bytes with the newline between them, the
    // notice after them included; a third would pass 100,000.
    assert.equal(window.content, `${'q'.repeat(49_800)}\n${'q'.repeat(49_800)}`);
    assert.equal(window.totalLines, 5);
    assert.equal(window.partial, true);
    assert.ok(firstPageBytes(window) <= 100_000);
  });

  test('a first page leaves room for its notice', async () => {
    // Two numbered lines are 99,985 bytes: within the limit, but not with the notice.
    const path = await file('long.txt', `${'q'.repeat(49_990)}\n`.repeat(4));
    const window = await readFileLineWindow(path);
    assert.equal(window.content, 'q'.repeat(49_990));
    assert.equal(window.partial, true);
    // A range has no notice: the same two lines are read whole.
    const ranged = await readFileLineWindow(path, 1, 2);
    assert.equal(ranged.content, `${'q'.repeat(49_990)}\n${'q'.repeat(49_990)}`);
  });

  test('every line counts toward the limit, an empty one too, with its number', async () => {
    // Five million newlines: each line is only its number and a tab.
    const path = await file('newlines.txt', '\n'.repeat(5_000_000));
    const page = await readFileLineWindow(path);
    assert.equal(page.partial, true);
    assert.equal(page.totalLines, 5_000_001);
    assert.equal(page.content, '\n'.repeat(15_839));
    assert.ok(firstPageBytes(page) <= 100_000);
    // A named range stops where the limit does, without the notice.
    await assert.rejects(
      readFileLineWindow(path, 1, 5_000_000),
      (error: unknown) =>
        error instanceof ReadLimitError &&
        error.message.includes('only 15872 lines from line 1 fit'),
    );
    await assert.rejects(readFileLineWindow(path, 1_000_000), ReadLimitError);
    const ranged = await readFileLineWindow(path, 15_873, 3);
    assert.equal(ranged.content, '\n\n');
    assert.equal(ranged.startLine, 15_873);
  });

  test('a file of one-character lines is held to the limit as it is shown', async () => {
    const path = await file('tiny.txt', 'x\n'.repeat(200_000));
    const page = await readFileLineWindow(path);
    assert.equal(page.partial, true);
    assert.equal(page.content.split('\n').length, 13_860);
    assert.ok(firstPageBytes(page) <= 100_000);
    await assert.rejects(
      readFileLineWindow(path, 1, 200_000),
      (error: unknown) =>
        error instanceof ReadLimitError &&
        error.message.includes('only 13888 lines from line 1 fit'),
    );
    const ranged = await readFileLineWindow(path, 1, 13_888);
    assert.ok(Buffer.byteLength(numbered(ranged.content, 1), 'utf8') <= 100_000);
  });

  test('a read with an explicit limit stops at the line that passes the limit, without reading on', async () => {
    // Three long lines, then a gigabyte the read would have to go through.
    const path = await sparseFile(`${'w'.repeat(60_000)}\n`.repeat(3), 1024 * 1024 * 1024);
    const { bytes, outcome } = await bytesReadBy(() => readFileLineWindow(path, 1, 1_000_000));
    assert.equal(outcome.status, 'rejected');
    const error = (outcome as PromiseRejectedResult).reason;
    assert.ok(error instanceof ReadLimitError);
    assert.equal(
      error.message,
      'The requested lines exceed the maximum of 25000 tokens one Read can return; only 1 line from line 1 fit. Read them with a limit of 1. If line 2 alone exceeds the maximum, search for specific content with Grep instead.',
    );
    // Line 2 passes the limit in the second 64 KiB read.
    assert.ok(bytes <= 128 * 1024, `${bytes} bytes read`);
  });

  test('past the lines it shows, a read counts no further than its limit, and says the file has more', async () => {
    // A first page of two lines, two more lines, then zeros with a newline
    // here and there: the count stops 64 MiB past the page.
    const page = `${'q'.repeat(49_800)}\n`.repeat(4);
    const path = await sparseFile(page, LINE_COUNT_MAX_BYTES + 16 * 1024 * 1024, [
      1024 * 1024,
      2 * 1024 * 1024,
      LINE_COUNT_MAX_BYTES + 8 * 1024 * 1024,
    ]);
    const { bytes, outcome } = await bytesReadBy(() => readFileLineWindow(path));
    assert.equal(outcome.status, 'fulfilled');
    const window = (
      outcome as PromiseFulfilledResult<Awaited<ReturnType<typeof readFileLineWindow>>>
    ).value;
    assert.equal(window.content, `${'q'.repeat(49_800)}\n${'q'.repeat(49_800)}`);
    assert.equal(window.partial, true);
    // Lines 1-4, then the two that end at the first newlines in the zeros; the
    // one after the third newline is never reached.
    assert.equal(window.totalLines, 6);
    assert.equal(window.moreLines, true);
    assert.ok(bytes < LINE_COUNT_MAX_BYTES + 1024 * 1024, `${bytes} bytes read`);
    assert.equal(
      partialViewNotice(1, 2, window.totalLines, window.moreLines),
      'PARTIAL view: lines 1-2 of more than 6 are shown, because the whole file exceeds the maximum of 25000 tokens one Read can return. Read the rest with offset and limit, starting at offset 3.',
    );
    // A range is counted past its last line no further either.
    const ranged = await readFileLineWindow(path, 2, 1);
    assert.equal(ranged.content, 'q'.repeat(49_800));
    assert.equal(ranged.totalLines, 6);
    assert.equal(ranged.moreLines, true);
    // A file that ends within the limit is counted to its end.
    const short = await sparseFile(page, 16 * 1024 * 1024, [1024 * 1024]);
    const counted = await readFileLineWindow(short);
    assert.equal(counted.totalLines, 6);
    assert.equal(counted.moreLines, undefined);
  });

  test('a read stops when its call is aborted', async () => {
    const path = await file('lines.txt', 'a\nb\n');
    await assert.rejects(
      readFileLineWindow(path, undefined, undefined, AbortSignal.abort()),
      (error: unknown) => error instanceof Error && error.name === 'AbortError',
    );
  });

  test('a device, a named pipe or a socket is refused without being read', {
    skip: process.platform === 'win32' ? 'no such files' : false,
    // A read that waited on the pipe, or read the device, would never end.
    timeout: 10_000,
  }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'maka-line-window-special-'));
    roots.push(root);
    const pipe = join(root, 'pipe');
    execFileSync('mkfifo', [pipe]);
    const notebookPipe = join(root, 'pipe.ipynb');
    execFileSync('mkfifo', [notebookPipe]);
    for (const [path, kind] of [
      ['/dev/urandom', 'a character device'],
      ['/dev/zero', 'a character device'],
      [pipe, 'a named pipe'],
      [notebookPipe, 'a named pipe'],
    ] as const) {
      for (const [offset, limit] of [
        [undefined, undefined],
        [1, 10],
      ] as const) {
        await assert.rejects(
          readFileLineWindow(path, offset, limit),
          (error: unknown) =>
            error instanceof ReadRefusedError &&
            error.message ===
              `Read cannot read '${path}': it is ${kind}, not a regular file. Read reads only regular files; to read from it, use Bash with a command that stops on its own (for example head -c).`,
          path,
        );
      }
    }
  });

  test('measures the text it returns, not the bytes it read', async () => {
    // GBK text read as UTF-8: every byte is invalid and comes back as U+FFFD,
    // three bytes of text for each byte of the file.
    const gbk = Buffer.alloc(40_000, 0xb0);
    const lines = Buffer.concat([gbk, Buffer.from('\n'), gbk, Buffer.from('\n'), gbk]);
    const path = await file('table.csv', lines);
    // 40,000 bytes on disk are 120,000 bytes of text: not even one line fits.
    await assert.rejects(
      readFileLineWindow(path),
      (error: unknown) =>
        error instanceof ReadLimitError && /^Line 1 alone exceeds the maximum/u.test(error.message),
    );
    await assert.rejects(
      readFileLineWindow(path, 2, 1),
      (error: unknown) =>
        error instanceof ReadLimitError && /^Line 2 alone exceeds the maximum/u.test(error.message),
    );
  });

  test('a page of text that is not UTF-8 stays within the limit', async () => {
    const line = Buffer.alloc(10_000, 0xb0);
    const parts: Buffer[] = [];
    for (let index = 0; index < 10; index++) parts.push(line, Buffer.from('\n'));
    const path = await file('table.csv', Buffer.concat(parts));
    const page = await readFileLineWindow(path);
    assert.equal(page.partial, true);
    // Three numbered lines are 90,008 bytes of text; a fourth would pass 100,000.
    assert.equal(page.content.split('\n').length, 3);
    assert.ok(Buffer.byteLength(page.content, 'utf8') <= 100_000);
    // The same lines through the ranged path, and the same refusal past them.
    const ranged = await readFileLineWindow(path, 1, 3);
    assert.equal(ranged.content, page.content);
    await assert.rejects(readFileLineWindow(path, 1, 4), ReadLimitError);
  });

  test('a character cut off at the end of a line is counted as the U+FFFD it becomes', async () => {
    const path = await file('cut.txt', Buffer.from([0x61, 0xe6, 0xbc, 0x0a, 0x62]));
    const window = await readFileLineWindow(path);
    assert.equal(window.content, 'a\uFFFD\nb');
  });

  test('only offset names a range: the refusal says which limit to pass', async () => {
    // Lines 2 and 3, numbered, are 99,985 bytes; line 4 would pass 100,000.
    const path = await file('long.txt', `${'q'.repeat(49_990)}\n`.repeat(4));
    await assert.rejects(
      readFileLineWindow(path, 2),
      (error: unknown) =>
        error instanceof ReadLimitError &&
        error.message ===
          'The lines from line 2 to the end of the file exceed the maximum of 25000 tokens one Read can return; only 2 lines from line 2 fit. Read them with a limit of 2. If line 4 alone exceeds the maximum, search for specific content with Grep instead.',
    );
  });

  test('a notebook is read whole up to 256 KB and refused past it, pointing away from offset and limit', async () => {
    const cell = (index: number) =>
      `{"cell_type":"code","source":["print(${index})"],"metadata":{},"outputs":[],"execution_count":null}`;
    const notebook = (cells: number) =>
      `{"cells":[${Array.from({ length: cells }, (_, index) => cell(index)).join(',')}],"metadata":{},"nbformat":4,"nbformat_minor":5}`;
    // The most cells that fit in 256 KB.
    let count = 1;
    let bytes = Buffer.byteLength(notebook(1));
    while (bytes + 1 + Buffer.byteLength(cell(count)) <= NOTEBOOK_READ_MAX_BYTES) {
      bytes += 1 + Buffer.byteLength(cell(count));
      count++;
    }
    assert.equal(Buffer.byteLength(notebook(count)), bytes);
    const fits = await file('fits.ipynb', notebook(count));
    assert.equal((await readFileLineWindow(fits)).content, notebook(count));
    const tooLarge = await file('large.ipynb', notebook(count + 1));
    await assert.rejects(readFileLineWindow(tooLarge), (error: unknown) => {
      if (!(error instanceof ReadLimitError)) return false;
      assert.match(
        error.message,
        /^Notebook content \(256(\.\d)?KB\) exceeds the maximum size Read can show \(256KB\), and a notebook is only read whole\. Search its cells with Grep, or read part of it with Bash/u,
      );
      assert.doesNotMatch(error.message, /offset|limit/u);
      return true;
    });
  });
});
