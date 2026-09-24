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
import { computeEditedSource } from '../edit-replace.js';

describe('computeEditedSource — exact match', () => {
  test('replaces the single occurrence and reports an exact match + line range', () => {
    assert.deepEqual(computeEditedSource('hello world', 'world', 'Maka', 'a.txt'), {
      content: 'hello Maka',
      matchedVia: 'exact',
      startLine: 1,
      endLine: 1,
      replacements: 1,
    });
  });

  test('reports the matched multi-line range (1-based, inclusive)', () => {
    const content = 'a\nb\nTARGET1\nTARGET2\nc\n';
    const result = computeEditedSource(content, 'TARGET1\nTARGET2', 'X', 'a.txt');
    assert.equal(result.content, 'a\nb\nX\nc\n');
    assert.equal(result.startLine, 3);
    assert.equal(result.endLine, 4);
  });

  test('inserts new_string literally (no $-pattern interpretation)', () => {
    const result = computeEditedSource('const x = old;', 'old', '$&value', 'a.txt');
    assert.equal(result.content, 'const x = $&value;');
  });

  test('throws with the where label when old_string is absent', () => {
    assert.throws(
      () => computeEditedSource('hello', 'absent', 'x', 'src/a.txt'),
      /String to replace not found in file\.\nString: absent$/,
    );
  });

  test('a non-unique old_string names both exits and shows the string', () => {
    assert.throws(
      () => computeEditedSource('a a a', 'a', 'b', 'b.txt'),
      (error: unknown) => {
        const message = (error as Error).message;
        assert.match(
          message,
          /^Found 3 matches of the string to replace, but replace_all is false\./,
        );
        assert.match(message, /To replace all occurrences, set replace_all to true\./);
        assert.match(
          message,
          /To replace only one occurrence, please provide more context to uniquely identify the instance\./,
        );
        assert.equal(message.split('\n').at(-1), 'String: a');
        return true;
      },
    );
  });

  test('the reported old_string is truncated so a huge one cannot flood the turn', () => {
    const long = 'x'.repeat(500);
    assert.throws(
      () => computeEditedSource(`${long} ${long}`, long, 'y', 'b.txt'),
      (error: unknown) => {
        const last = (error as Error).message.split('\n').at(-1) ?? '';
        assert.equal(last, `String: ${'x'.repeat(200)}\u2026`);
        return true;
      },
    );
  });

  test('rejects identical old_string and new_string', () => {
    assert.throws(() => computeEditedSource('abc', 'abc', 'abc', 'b.txt'), /exactly the same/);
  });

  test('an empty old_string creates the file only when it is empty', () => {
    assert.throws(
      () => computeEditedSource('abc', '', 'x', 'b.txt'),
      /Cannot create new file - file already exists\.$/,
    );
    assert.deepEqual(computeEditedSource('', '', 'new\n', 'b.txt'), {
      content: 'new\n',
      matchedVia: 'exact',
      startLine: 1,
      endLine: 1,
      replacements: 1,
    });
    assert.equal(computeEditedSource('  \n', '', 'x', 'b.txt').content, 'x');
  });

  test("a span's trailing newline is a terminator, not an extra line, for endLine", () => {
    assert.deepEqual(computeEditedSource('abc\n', 'abc\n', 'def\n', 'r.ts'), {
      content: 'def\n',
      matchedVia: 'exact',
      startLine: 1,
      endLine: 1,
      replacements: 1,
    });
  });
});

describe('computeEditedSource — nothing but the text is matched', () => {
  test('indentation drift is not found', () => {
    const content = 'function f() {\n    return 1;\n}\n';
    assert.throws(
      () => computeEditedSource(content, 'function f() {\n  return 1;\n}', 'x', 'f.ts'),
      /String to replace not found in file\./,
    );
  });

  test('collapsed whitespace and literal escapes are not found', () => {
    assert.throws(
      () => computeEditedSource('const  x   =   1;', 'const x = 1;', 'y', 'w.ts'),
      /not found/,
    );
    assert.throws(
      () => computeEditedSource('line1\nline2', 'line1\\nline2', 'X', 'e.ts'),
      /not found/,
    );
    assert.throws(
      () => computeEditedSource('\tindented', '    indented', 'x', 't.txt'),
      /not found/,
    );
  });
});

describe('computeEditedSource — quotes', () => {
  test('straight quotes match curly ones, and the replacement keeps the curly style', () => {
    const content = 'It\u2019s a \u201csmart quote\u201d test.\n';
    const result = computeEditedSource(content, '"smart quote"', '"plain quote"', 'q.txt');
    assert.equal(result.matchedVia, 'quotes');
    assert.equal(result.content, 'It\u2019s a \u201cplain quote\u201d test.\n');
  });

  test('single quotes: apostrophes stay apostrophes, others open and close', () => {
    const content = '\u2018quoted\u2019 and it\u2019s\n';
    const result = computeEditedSource(content, "'quoted' and it's", "'cited' and that's", 'q.txt');
    assert.equal(result.content, '\u2018cited\u2019 and that\u2019s\n');
  });

  test('a file with straight quotes is left straight', () => {
    const result = computeEditedSource('say "hi"\n', '"hi"', '"bye"', 'q.txt');
    assert.equal(result.matchedVia, 'exact');
    assert.equal(result.content, 'say "bye"\n');
  });
});

describe('computeEditedSource — line endings', () => {
  test('a CRLF file is matched with LF and written back as CRLF', () => {
    const result = computeEditedSource('one\r\ntwo\r\nthree\r\n', 'one\ntwo', 'ONE\nTWO', 'c.txt');
    assert.equal(result.content, 'ONE\r\nTWO\r\nthree\r\n');
    assert.equal(result.startLine, 1);
    assert.equal(result.endLine, 2);
  });

  test('a CRLF old_string matches an LF file, and the file stays LF', () => {
    const result = computeEditedSource('one\ntwo\n', 'one\r\ntwo', 'X', 'c.txt');
    assert.equal(result.content, 'X\n');
  });
});

describe('computeEditedSource — replace_all', () => {
  test('replaces every exact occurrence and reports the count', () => {
    const result = computeEditedSource('a\nfoo\nb\nfoo\nc\n', 'foo', 'bar', 'r.ts', {
      replaceAll: true,
    });
    assert.equal(result.content, 'a\nbar\nb\nbar\nc\n');
    assert.equal(result.replacements, 2);
    assert.equal(result.matchedVia, 'exact');
    // The reported range spans the first match to the last, so the caller's
    // diff window covers every edit.
    assert.equal(result.startLine, 2);
    assert.equal(result.endLine, 4);
  });

  test('a single occurrence is still fine under replace_all', () => {
    const result = computeEditedSource('only one here', 'one', 'two', 'r.ts', {
      replaceAll: true,
    });
    assert.equal(result.content, 'only two here');
    assert.equal(result.replacements, 1);
  });

  test('new_string is inserted literally, without $-pattern interpretation', () => {
    const result = computeEditedSource('old old', 'old', '$&x', 'r.ts', { replaceAll: true });
    assert.equal(result.content, '$&x $&x');
  });

  test('a drifted old_string fails as not found', () => {
    assert.throws(
      () =>
        computeEditedSource('const  x   =   1;', 'const x = 1;', 'const x = 2;', 'w.ts', {
          replaceAll: true,
        }),
      /String to replace not found in file\./,
    );
  });

  test('identical old_string and new_string is still rejected', () => {
    assert.throws(
      () => computeEditedSource('abc abc', 'abc', 'abc', 'r.ts', { replaceAll: true }),
      /exactly the same/,
    );
  });
});
