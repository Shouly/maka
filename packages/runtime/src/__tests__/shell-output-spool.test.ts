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
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { redactSecrets } from '@maka/core/redaction';
import {
  LONG_LINE_MARKER,
  READ_BLOCK_BYTES,
  SAVED_LINE_MAX_BYTES,
  savedOutputCutMarker,
  ShellOutputSpool,
} from '../shell-output-spool.js';

const roots: string[] = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'maka-spool-'));
  roots.push(root);
  return root;
}

/** The text a preview stands for: its parts joined as the file joins them. */
function previewText(preview: { stdout: string; stderr: string } | undefined): string {
  return [preview?.stdout ?? '', preview?.stderr ?? ''].filter((part) => part !== '').join('\n');
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

describe("a foreground command's output kept on disk while it runs", () => {
  test('saves stdout then stderr as the inline result reads them, and removes its working files', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-1');
    spool.accept('stdout', '\nfirst\n');
    spool.accept('stderr', 'warn\n\n');
    spool.accept('stdout', 'second\n\n\n');

    const path = join(root, 'session-1', 'run-1.txt');
    const saved = await spool.save(path, 4);
    const text = '\nfirst\nsecond\nwarn';
    assert.deepEqual(saved, {
      path,
      chars: text.length,
      truncated: false,
      preview: { stdout: '\nfir', stderr: '' },
    });
    assert.equal(await readFile(path, 'utf8'), text);
    assert.deepEqual(await readdir(root), ['session-1']);
    assert.deepEqual(await readdir(join(root, 'session-1')), ['run-1.txt']);
  });

  test('keeps its working files outside the Session folder, which only a save makes', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-1');
    spool.accept('stdout', 'out\n');
    spool.accept('stderr', 'err\n');
    await spool.written();
    assert.deepEqual((await readdir(root)).sort(), [
      'run-1.stderr.partial',
      'run-1.stdout.partial',
    ]);
    await spool.discard();
    assert.deepEqual(await readdir(root), []);
  });

  test('is private to the user: folders 0700, files 0600', {
    skip: process.platform === 'win32' ? 'POSIX modes' : false,
  }, async () => {
    const root = join(await directory(), 'tool-results');
    const spool = await ShellOutputSpool.open(root, 'run-1');
    spool.accept('stdout', 'x\n');
    await spool.written();
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, 'run-1.stdout.partial'))).mode & 0o777, 0o600);
    const saved = await spool.save(join(root, 'session-1', 'run-1.txt'), 10);
    assert.equal((await stat(join(root, 'session-1'))).mode & 0o777, 0o700);
    assert.equal((await stat(saved!.path)).mode & 0o777, 0o600);
  });

  test('redacts what it saves, a secret split across two chunks included', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-2');
    spool.accept('stdout', 'key: sk-ant-abc');
    spool.accept('stdout', 'defghijkl0123\nnext line\n');
    await spool.save(join(root, 's', 'run-2.txt'), 100);
    const saved = await readFile(join(root, 's', 'run-2.txt'), 'utf8');
    assert.equal(saved, 'key: [redacted]\nnext line');
  });

  test('a stream that reaches the size limit ends at its last whole line, and says so', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-3', 100);
    // The line in progress at the limit holds a secret whose start alone
    // would not be recognised; it is left out, not cut.
    spool.accept('stdout', `${'x'.repeat(60)}\n`);
    spool.accept('stdout', `token sk-ant-abcdefghijkl0123 ${'y'.repeat(60)}\n`);
    spool.accept('stderr', 'never shown');
    const saved = await spool.save(join(root, 's', 'run-3.txt'), 1_000);
    const text = await readFile(join(root, 's', 'run-3.txt'), 'utf8');
    assert.equal(text, `${'x'.repeat(60)}\n${savedOutputCutMarker(100)}`);
    assert.equal(saved?.truncated, true);
    assert.equal(saved?.chars, text.length);
    assert.doesNotMatch(text, /sk-ant/u);
  });

  test('a stream with no whole line before the limit keeps nothing but the marker', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-3b', 100);
    spool.accept('stdout', 'x'.repeat(60));
    spool.accept('stdout', 'y'.repeat(60));
    const saved = await spool.save(join(root, 's', 'run-3b.txt'), 1_000);
    assert.equal(await readFile(saved!.path, 'utf8'), savedOutputCutMarker(100));
    assert.equal(saved?.truncated, true);
  });

  test('the joined streams are cut at the size limit on a whole character, after redaction', async () => {
    const root = await directory();
    // Each stream fits on its own; the two together do not.
    const spool = await ShellOutputSpool.open(root, 'run-4', 200);
    spool.accept('stdout', `${'x'.repeat(30)}\n`);
    spool.accept('stderr', `${'🦊'.repeat(45)}\n`);
    const saved = await spool.save(join(root, 's', 'run-4.txt'), 1_000);
    const text = await readFile(saved!.path, 'utf8');
    const marker = savedOutputCutMarker(200);
    assert.ok(text.startsWith(`${'x'.repeat(30)}\n🦊`));
    assert.ok(text.endsWith(`🦊\n${marker}`));
    assert.ok(Buffer.byteLength(text, 'utf8') <= 200);
    assert.doesNotMatch(text, /\uFFFD/u);
    assert.doesNotMatch(text, LONE_SURROGATE);
    assert.equal(saved?.truncated, true);
  });

  test('a line that runs on from one read into the next is redacted whole', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-5');
    // The secret straddles the end of the first read.
    const lines = `${'x'.repeat(1_023)}\n`.repeat(READ_BLOCK_BYTES / 1_024 - 1);
    const before = `${lines}${'a '.repeat((1_024 - 10) / 2)}`;
    assert.equal(before.length, READ_BLOCK_BYTES - 10);
    spool.accept('stdout', `${before}sk-ant-abcdefghijkl0123 tail\nnext\n`);
    const saved = await spool.save(join(root, 's', 'run-5.txt'), 10);
    const text = await readFile(saved!.path, 'utf8');
    assert.ok(text.endsWith('[redacted] tail\nnext'));
    assert.doesNotMatch(text, /sk-ant|abcdefghijkl/u);
  });

  test('a line over the line limit is left out whole, a marker in its place', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-6');
    spool.accept('stdout', 'first\n');
    const chunk = 'z'.repeat(1024 * 1024);
    for (let index = 0; index < SAVED_LINE_MAX_BYTES / chunk.length; index++) {
      spool.accept('stdout', chunk);
    }
    spool.accept('stdout', 'sk-ant-abcdefghijkl0123 still the long line\nlast\n');
    const head = await spool.head(100);
    assert.deepEqual(head?.streams.stdout, {
      chars: `first\n${LONG_LINE_MARKER}\nlast`.length,
      ends: true,
      complete: false,
    });
    const saved = await spool.save(join(root, 's', 'run-6.txt'), 100);
    assert.equal(await readFile(saved!.path, 'utf8'), `first\n${LONG_LINE_MARKER}\nlast`);
    assert.equal(head?.streams.stdout.chars, saved?.chars);
    // The file does not hold the whole output, though nothing was cut at the size limit.
    assert.equal(saved?.truncated, true);
  });

  test('a line over the line limit at the very end is left out too', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-6b');
    spool.accept('stdout', 'first\n');
    spool.accept('stdout', 'z'.repeat(SAVED_LINE_MAX_BYTES + 1));
    const saved = await spool.save(join(root, 's', 'run-6b.txt'), 100);
    assert.equal(await readFile(saved!.path, 'utf8'), `first\n${LONG_LINE_MARKER}`);
    assert.equal(saved?.truncated, true);
  });

  test('discarding removes the working files without saving anything', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-7');
    spool.accept('stdout', 'kept for nobody');
    await spool.discard();
    assert.deepEqual(await readdir(root), []);
  });

  test('a save that fails part way removes what it wrote, and the folder it made', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-8');
    spool.accept('stdout', 'one\n');
    spool.accept('stderr', 'two\n');
    await spool.written();
    // stdout is written, then reading stderr's working file fails.
    await rm(join(root, 'run-8.stderr.partial'));
    assert.equal(await spool.save(join(root, 'session-1', 'run-8.txt'), 10), undefined);
    assert.deepEqual(await readdir(root), []);
  });

  test('a working file that cannot be written gives no saved file', async () => {
    const root = await directory();
    // Something already stands where the working file would go.
    await mkdir(join(root, 'run-9.stdout.partial'));
    const spool = await ShellOutputSpool.open(root, 'run-9');
    spool.accept('stdout', 'lost\n');
    assert.equal(await spool.save(join(root, 'session-1', 'run-9.txt'), 10), undefined);
    assert.equal(await spool.head(10), undefined);
    // What was there before is not the spool's to remove.
    assert.deepEqual(await readdir(root), ['run-9.stdout.partial']);
  });
});

describe('output that is slow to read for its shape', () => {
  test('a long run of newlines with lines after it is saved in linear time', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-1');
    // Read in one block, the run and the lines after it.
    const newlines = 4 * 1024 * 1024 - 1024;
    spool.accept('stdout', `${'\n'.repeat(newlines)}x\nz\nz\n`);
    const started = performance.now();
    const saved = await spool.save(join(root, 'session-1', 'run-1.txt'), 2_000);
    const elapsed = performance.now() - started;
    assert.equal(saved?.chars, newlines + 'x\nz\nz'.length);
    assert.ok(elapsed < 2_000, `${elapsed} ms`);
  });

  test('16 MiB of brackets never closed are saved without holding them open', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run-1');
    const line = `${'['.repeat(1024 * 1024 - 1)}\n`;
    for (let index = 0; index < 16; index++) spool.accept('stdout', line);
    await spool.written();
    const before = process.memoryUsage().heapUsed;
    let peak = before;
    const sample = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }, 5);
    const started = performance.now();
    try {
      const saved = await spool.save(join(root, 'session-1', 'run-1.txt'), 2_000);
      assert.equal(saved?.chars, 16 * 1024 * 1024 - 1);
    } finally {
      clearInterval(sample);
    }
    peak = Math.max(peak, process.memoryUsage().heapUsed);
    const elapsed = performance.now() - started;
    assert.ok(peak - before < 512 * 1024 * 1024, `${peak - before} bytes`);
    assert.ok(elapsed < 10_000, `${elapsed} ms`);
  });
});

describe('the preview of a saved output is exactly the start of the file', () => {
  async function savedPreview(stdout: string, stderr: string, chars: number) {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run');
    if (stdout) spool.accept('stdout', stdout);
    if (stderr) spool.accept('stderr', stderr);
    const saved = await spool.save(join(root, 's', 'run.txt'), chars);
    return { saved, file: await readFile(join(root, 's', 'run.txt'), 'utf8') };
  }

  test('an emoji at the end of the preview is left whole or left out', async () => {
    // Not hex digits: a long run of those is redacted as a likely secret.
    const { saved, file } = await savedPreview(
      `${'x'.repeat(1_999)}🦊${'y'.repeat(40_000)}`,
      '',
      2_000,
    );
    assert.deepEqual(saved?.preview, { stdout: 'x'.repeat(1_999), stderr: '' });
    assert.ok(file.startsWith(previewText(saved?.preview)));
  });

  test('an emoji at the end of the stderr part is left whole or left out', async () => {
    const { saved, file } = await savedPreview('out\n', `${'q'.repeat(1_995)}🦊q`, 2_000);
    assert.deepEqual(saved?.preview, { stdout: 'out', stderr: 'q'.repeat(1_995) });
    assert.ok(file.startsWith(previewText(saved?.preview)));
  });

  test('emoji at every boundary never leave half a pair', async () => {
    // stdout's part of the file is 3,000 units, the newline after it the 3,001st.
    for (const cut of [1, 2, 3, 1_999, 2_000, 2_001, 3_000, 3_001, 3_002, 3_003, 3_004]) {
      const { saved, file } = await savedPreview(
        `${'🦊'.repeat(1_500)}\n`,
        `${'🦊'.repeat(1_500)}`,
        cut,
      );
      const text = previewText(saved?.preview);
      assert.doesNotMatch(text, LONE_SURROGATE, String(cut));
      assert.ok(text.length >= cut - 2 && text.length <= cut, String(cut));
      assert.ok(file.startsWith(text), String(cut));
    }
  });

  test('newlines at the end of the preview are kept: they are the file, not the end of a stream', async () => {
    const stdout = `${'x'.repeat(1_990)}${'\n'.repeat(10)}${'y'.repeat(40_000)}`;
    const { saved, file } = await savedPreview(stdout, 'err', 2_000);
    assert.deepEqual(saved?.preview, {
      stdout: `${'x'.repeat(1_990)}${'\n'.repeat(10)}`,
      stderr: '',
    });
    assert.equal(previewText(saved?.preview), file.slice(0, 2_000));
  });

  test('a preview that ends on the newline between the streams leaves it out', async () => {
    const { saved, file } = await savedPreview('abc\n\n', 'defgh', 4);
    assert.deepEqual(saved?.preview, { stdout: 'abc', stderr: '' });
    assert.equal(file, 'abc\ndefgh');
  });

  test('a preview reaching into stderr joins the two as the file does', async () => {
    const { saved, file } = await savedPreview('abc\n\n', 'defgh', 6);
    assert.deepEqual(saved?.preview, { stdout: 'abc', stderr: 'de' });
    assert.equal(previewText(saved?.preview), file.slice(0, 6));
  });

  test('stderr alone starts the file', async () => {
    const { saved } = await savedPreview('\n\n', 'defgh', 3);
    assert.deepEqual(saved?.preview, { stdout: '', stderr: 'def' });
  });
});

describe('the start of the output for a failure', () => {
  test('is the start of what a save would write, with its length', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run');
    spool.accept('stdout', 'first line\nsecond\n');
    spool.accept('stderr', 'error: sk-ant-abcdefghijkl0123\n');
    const head = await spool.head(14);
    assert.deepEqual(head, {
      stdout: 'first line\nsec',
      stderr: '',
      streams: {
        stdout: { chars: 'first line\nsecond'.length, ends: true, complete: true },
        stderr: { chars: 'error: [redacted]'.length, ends: true, complete: true },
      },
    });
    await spool.discard();
  });

  test('a stream that reached the size limit does not end in the file, nor does any after it', async () => {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run', 20);
    spool.accept('stdout', `${'a'.repeat(10)}\n${'b'.repeat(30)}\n`);
    spool.accept('stderr', 'error\n');
    const head = await spool.head(5);
    assert.equal(head?.stdout, 'aaaaa');
    // Its characters are the whole line kept, its newline included, not the marker after it.
    assert.deepEqual(head?.streams, {
      stdout: { chars: 11, ends: false, complete: false },
      stderr: { chars: 0, ends: false, complete: false },
    });
    await spool.discard();
  });
});

describe('saved output is redacted at least as the inline result is, line for line', () => {
  /** A config as a tool prints it: two spaces to a level, its secrets in nested objects and numbers. */
  function config(entries: number, secrets: { first: string; last: string }): string {
    return JSON.stringify(
      {
        first: { credentials: { client_value: secrets.first }, token: 987654321 },
        entries: Array.from({ length: entries }, (_, index) => ({
          id: index,
          label: `entry ${index}`,
        })),
        last: {
          credentials: { client_value: secrets.last, scopes: ['read', 'write'] },
          token: 987654321,
          password: `hunter2-${secrets.last}`,
        },
      },
      null,
      2,
    );
  }

  const lines = (text: string) => text.replace(/\n+$/u, '').split('\n').length;

  async function saveOutput(text: string) {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run');
    // Chunks the size a pipe hands over, so lines and blocks break anywhere.
    for (let at = 0; at < text.length; at += 65_536) {
      spool.accept('stdout', text.slice(at, at + 65_536));
    }
    const head = await spool.head(text.length);
    const saved = await spool.save(join(root, 's', 'run.txt'), text.length);
    return { saved, head, file: await readFile(join(root, 's', 'run.txt'), 'utf8') };
  }

  for (const ending of ['', '\n']) {
    const ends = ending === '' ? 'without' : 'with';

    test(`a pretty-printed JSON config under 4 MiB, ${ends} a final newline`, async () => {
      const text = `${config(800, { first: 'S3CR3T-FIRST', last: 'S3CR3T-LAST' })}${ending}`;
      assert.ok(text.length > 40_000 && text.length < 4 * 1024 * 1024);
      // Read inline, the whole output is JSON and loses these values.
      assert.doesNotMatch(redactSecrets(text), /S3CR3T|987654321/u);
      const { saved, head, file } = await saveOutput(text);
      for (const shown of [file, previewText(saved?.preview), previewText(head)]) {
        assert.doesNotMatch(shown, /S3CR3T|987654321/u);
      }
      assert.equal(lines(file), lines(text));
      assert.match(file, /\n {4}"credentials": \{\n {6}"\[redacted\]": "\[redacted\]"\n {4}\},\n/u);
      assert.match(file, /\n {4}"token": "\[redacted\]",?\n/u);
      // Nothing else moves.
      assert.match(file, /\n {6}"label": "entry 799"\n/u);
    });

    test(`a pretty-printed JSON config over 4 MiB, ${ends} a final newline`, async () => {
      const text = `${config(100_000, { first: 'S3CR3T-FIRST', last: 'S3CR3T-LAST' })}${ending}`;
      assert.ok(text.length > 4 * 1024 * 1024 + 1_000_000);
      const { saved, head, file } = await saveOutput(text);
      for (const shown of [file, previewText(saved?.preview), previewText(head)]) {
        assert.doesNotMatch(shown, /S3CR3T|987654321/u);
      }
      assert.equal(lines(file), lines(text));
      assert.equal(saved?.truncated, false);
    });
  }

  test('JSON Lines lose the same values on every line, and keep their lines', async () => {
    const record = (index: number) =>
      JSON.stringify({
        id: index,
        token: 987654321,
        credentials: { client_value: `S3CR3T-${index}` },
      });
    const rows = Array.from({ length: 3_000 }, (_, index) => record(index));
    rows.splice(1_500, 0, 'plain text between the records');
    const text = `${rows.join('\n')}\n`;
    const { file } = await saveOutput(text);
    assert.doesNotMatch(file, /S3CR3T|987654321/u);
    assert.equal(lines(file), lines(text));
    assert.equal(
      file.split('\n')[0],
      '{"id":0,"token":"[redacted]","credentials":{"[redacted]":"[redacted]"}}',
    );
    assert.equal(file.split('\n')[1_500], 'plain text between the records');
  });

  test('a JSON document read in one block is redacted where it stands, not laid out again', async () => {
    const document = JSON.stringify(
      { items: Array.from({ length: 500 }, (_, index) => ({ index })), password: 'x' },
      null,
      2,
    );
    const { file } = await saveOutput(document);
    assert.ok(lines(document) > 1_500);
    assert.equal(file, document.replace('"password": "x"', '"password": "[redacted]"'));
  });

  test('a secret in JSON held inside a JSON string is found, though the output is not all JSON', async () => {
    const text = `${JSON.stringify({ body: JSON.stringify({ api_key: 'S3CR3T' }) }, null, 2)}\n${'.'.repeat(40_000)}\n`;
    const { file } = await saveOutput(text);
    assert.doesNotMatch(file, /S3CR3T/u);
    assert.equal(lines(file), lines(text));
  });

  test('a document after a line that left a value unfinished is still read as JSON', async () => {
    const document = JSON.stringify(
      { config: { name: 'svc', token: 424242, password: 'pw-S3CR3T' } },
      null,
      2,
    );
    // Held whole, the inline result reads the document alone as JSON.
    assert.doesNotMatch(redactSecrets(document), /424242|S3CR3T/u);
    const text = `{"progress": "${'x'.repeat(100_000)}"\n${document}\n`;
    const { file } = await saveOutput(text);
    assert.doesNotMatch(file, /424242|S3CR3T/u);
    assert.equal(lines(file), lines(text));
    assert.ok(file.endsWith('\n    "token": "[redacted]",\n    "password": "[redacted]"\n  }\n}'));
  });
});

describe('a text rule that reads across lines is not cut where a read or the output ends', () => {
  /** Secrets whose rule reads on past a line break. */
  const SHAPES = [
    '"apiKey":\n  "s3cr3t-value-123"',
    '"password": "first-half\nsecond-half-SECRET"',
    'Authorization: Bearer\n  tok_SECRET_456',
    'export API_TOKEN=\\\nSECRET_continued_789',
  ];
  /** Longer runs of the same rules. */
  const LONG_SHAPES = [
    '"apiKey":\n\n\n  "s3cr3t-value-123"',
    '"private_key": "-----BEGIN KEY-----\nMIIEvAIBADANBg\nkqhkiG9w0BAQEF\nAASCBKYwggSiAg\n-----END KEY-----"',
    'Authorization:\n  Bearer\n  tok_SECRET_456',
    'export API_TOKEN=\\\nfirst\\\nsecond\\\nthird_SECRET',
    'aws configure set aws_secret_access_key "first\nsecond_SECRET"',
  ];

  /** The inline result of `text`: read whole and redacted at once, trailing newlines dropped. */
  const inline = (text: string) => redactSecrets(text).replace(/\n+$/u, '');
  const lines = (text: string) => text.split('\n').length;

  async function save(stdout: string, stderr = '') {
    const root = await directory();
    const spool = await ShellOutputSpool.open(root, 'run');
    for (let at = 0; at < stdout.length; at += 65_536) {
      spool.accept('stdout', stdout.slice(at, at + 65_536));
    }
    if (stderr) spool.accept('stderr', stderr);
    const saved = await spool.save(join(root, 's', 'run.txt'), 2_000);
    return { saved, file: await readFile(join(root, 's', 'run.txt'), 'utf8') };
  }

  /** Lines of `x`, `bytes` long in all, the last one shorter. */
  function filler(bytes: number): string {
    const line = `${'x'.repeat(99)}\n`;
    const rest = bytes % line.length;
    return `${line.repeat(Math.floor(bytes / line.length))}${rest > 0 ? `${'y'.repeat(rest - 1)}\n` : ''}`;
  }

  test('the last line, with no newline after it, is redacted with the lines before it', async () => {
    for (const shape of SHAPES) {
      const text = `${'filler line\n'.repeat(3_000)}${shape}`;
      assert.notEqual(inline(text), text, shape);
      const { file } = await save(text);
      assert.equal(file, inline(text), shape);
      assert.equal(lines(file), lines(inline(text)), shape);
    }
  });

  test('the preview of such a last line is redacted as the inline result is', async () => {
    for (const shape of SHAPES) {
      const { saved, file } = await save(shape, 'warning: something\n'.repeat(2_000));
      assert.equal(saved?.preview.stdout, inline(shape), shape);
      assert.ok(file.startsWith(`${inline(shape)}\nwarning: something\n`), shape);
    }
  });

  test('a read that ends inside one is redacted with the next read', async () => {
    for (const shape of [...SHAPES, ...LONG_SHAPES]) {
      // The read ends right after each line break in it, or a few characters on.
      const breaks = [...shape.matchAll(/\n/gu)].map((match) => match.index + 1);
      for (const at of breaks) {
        for (const into of [0, 3]) {
          const text = `${filler(READ_BLOCK_BYTES - at - into)}${shape}\n${'tail line\n'.repeat(200)}`;
          assert.equal(
            Buffer.byteLength(text.slice(0, text.indexOf(shape) + at + into)),
            READ_BLOCK_BYTES,
          );
          const { file } = await save(text);
          const name = `${JSON.stringify(shape)} at ${at}+${into}`;
          assert.notEqual(inline(text), text.replace(/\n+$/u, ''), name);
          assert.equal(file, inline(text), name);
          assert.equal(lines(file), lines(inline(text)), name);
        }
      }
    }
  });
});
