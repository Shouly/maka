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
import { redactSecrets } from '@maka/core/redaction';
import {
  HELD_BACK_MAX_CHARS,
  heldBackStart,
  MAX_DEPTH,
  OutputRedactor,
  redactOutput,
} from '../output-redaction.js';

describe('redacting output a block of lines at a time, keeping its lines', () => {
  test('text that is not JSON is redacted as text', () => {
    for (const text of [
      'plain line\nkey: sk-ant-abcdefghijkl0123\n',
      'export TOKEN=hunter2\n{ token: 1234 }\n',
      'Authorization: Bearer abc.def\n',
    ]) {
      assert.equal(redactOutput(text), redactSecrets(text), text);
    }
  });

  test('the value of a sensitive key goes, whatever its type, and its lines stay', () => {
    const text = [
      '{',
      '  "token": 1234,',
      '  "secret": true,',
      '  "password": null,',
      '  "api_key": [',
      '    "first",',
      '    { "nested": 7 }',
      '  ],',
      '  "credentials": {',
      '    "client_value": "S3CR3T"',
      '  },',
      '  "name": "kept"',
      '}',
    ].join('\n');
    assert.equal(
      redactOutput(text),
      [
        '{',
        '  "token": "[redacted]",',
        '  "secret": "[redacted]",',
        '  "password": "[redacted]",',
        '  "api_key": [',
        '    "[redacted]",',
        '    { "[redacted]": "[redacted]" }',
        '  ],',
        '  "credentials": {',
        '    "[redacted]": "[redacted]"',
        '  },',
        '  "name": "kept"',
        '}',
      ].join('\n'),
    );
    // The JSON reading loses the same values, on one line.
    assert.doesNotMatch(redactSecrets(text), /1234|S3CR3T|first|nested/u);
  });

  test('a document followed across parts is redacted as it is whole', () => {
    const text = '[\n  {\n    "credentials": {\n      "client_value": "S3CR3T"\n    }\n  }\n]\n';
    const redactor = new OutputRedactor();
    const lines = text.split(/(?<=\n)/u);
    const parts = lines.map((line) => redactor.redact(line)).join('');
    assert.equal(parts, redactOutput(text));
    assert.doesNotMatch(parts, /S3CR3T/u);
  });

  test('a string is redacted as the JSON reading redacts it, escaped JSON in it included', () => {
    const text = '{"body": "{\\"password\\": \\"hunter2\\"}", "note": "ok"}\n';
    const redacted = redactOutput(text);
    assert.doesNotMatch(redacted, /hunter2/u);
    assert.equal(JSON.parse(redacted).body, '{"password": "[redacted]"}');
    assert.equal(JSON.parse(redacted).note, 'ok');
  });

  test('a top-level string on its own line is redacted as the JSON reading redacts it', () => {
    const text = '"aws configure set aws_secret_access_key S3CR3T"\n';
    assert.doesNotMatch(redactOutput(text), /S3CR3T/u);
  });

  test('where a line stops being JSON it is text, and the next line may start JSON again', () => {
    const text = [
      '{',
      '  "token": 1234,',
      '  this is not JSON "token": 5678',
      '  "password": 9999',
      '{"secret": 4321}',
    ].join('\n');
    assert.equal(
      redactOutput(text),
      [
        '{',
        '  "token": "[redacted]",',
        '  this is not JSON "token": 5678',
        '  "password": 9999',
        '{"secret": "[redacted]"}',
      ].join('\n'),
    );
  });

  test('a line left out stops the document; what follows is text', () => {
    const redactor = new OutputRedactor();
    assert.equal(redactor.redact('{\n  "credentials": {\n'), '{\n  "credentials": {\n');
    redactor.interrupt();
    assert.equal(redactor.redact('\n    "token": 5\n'), '\n    "token": 5\n');
    assert.equal(redactor.redact('{"token": 5}\n'), '{"token": "[redacted]"}\n');
  });

  test('a value left unfinished does not hide a document that starts on the next line', () => {
    const text = '{"progress": "half way"\n{\n  "token": 5,\n  "secret": [1, 2]\n}\n';
    assert.equal(
      redactOutput(text),
      '{"progress": "half way"\n{\n  "token": "[redacted]",\n  "secret": ["[redacted]", "[redacted]"]\n}\n',
    );
    // A token that fails further along its line leaves the rest of the line text.
    assert.equal(redactOutput('{"a": 1,\n"token" 5\n'), '{"a": 1,\n"token" 5\n');
    // So does a failure at the first token of a value begun on the same line.
    assert.equal(
      redactOutput('{"a": 1,\n"open\n{"token": 5}\n'),
      '{"a": 1,\n"open\n{"token": "[redacted]"}\n',
    );
  });
});

describe('a value nested too deep to follow', () => {
  test('is followed up to the depth limit', () => {
    const open = '['.repeat(MAX_DEPTH - 1);
    const close = ']'.repeat(MAX_DEPTH - 1);
    assert.equal(
      redactOutput(`${open}{"password": 12345}${close}\n`),
      `${open}{"password": "[redacted]"}${close}\n`,
    );
  });

  test('past it, the rest of its line is text, as the JSON reading reads it', () => {
    const text = `${'['.repeat(MAX_DEPTH)}{"password": 12345}${']'.repeat(MAX_DEPTH)}`;
    assert.equal(redactOutput(text), redactSecrets(text));
    // The next line starts a value again.
    assert.equal(
      redactOutput(`${text}\n{"token": 5}\n`),
      `${redactSecrets(text)}\n{"token": "[redacted]"}\n`,
    );
  });

  test('brackets never closed are not held past the limit, however many lines they run on', () => {
    const redactor = new OutputRedactor();
    const line = `${'['.repeat(1024 * 1024 - 1)}\n`;
    const before = process.memoryUsage().heapUsed;
    let peak = before;
    for (let index = 0; index < 16; index++) {
      assert.equal(redactor.redact(line), line);
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }
    // Followed without the limit, 16 Mi brackets held open take gigabytes.
    assert.ok(peak - before < 256 * 1024 * 1024, `${peak - before} bytes`);
  });
});

describe('the tail a block holds back for the next', () => {
  const tail = (text: string) => text.slice(heldBackStart(text));

  test('is its last two lines when nothing in them reads on', () => {
    assert.equal(tail('one\ntwo\nthree\n'), 'two\nthree\n');
    assert.equal(tail('only\n'), 'only\n');
  });

  test('takes in every line before them that a text rule may still be reading', () => {
    for (const lead of [
      'export API_TOKEN=\\\n',
      'Authorization:\n',
      'Proxy-Authorization: Basic\n',
      '"apiKey"\n',
      '"apiKey":\n   \n',
      '"password": "first\nsecond\n',
      "aws configure set aws_secret_access_key 'first\nsecond\n",
    ]) {
      const text = `plain\n${lead}one\ntwo\n`;
      assert.equal(tail(text), `${lead}one\ntwo\n`, lead);
    }
  });

  test('reaches no further back than its limit', () => {
    const text = `plain\n${'key:\n'.repeat(HELD_BACK_MAX_CHARS)}one\ntwo\n`;
    assert.ok(tail(text).length <= HELD_BACK_MAX_CHARS + 'two\n'.length);
    assert.ok(tail(text).length > HELD_BACK_MAX_CHARS - 'key:\n'.length);
    assert.ok(tail(text).startsWith('key:\n'));
  });
});
