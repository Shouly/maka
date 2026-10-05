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

// Redaction of a command's output that is read a block of lines at a time and
// keeps its lines where they were.
//
// `redactSecrets` reads a text that is valid JSON as JSON: the value of every
// sensitive key goes, whatever its type, and every string is redacted as text.
// It then lays the document out again on one line. Output saved to a file is
// read in blocks, and is paged by line, so neither half of that fits it: a
// block is rarely the whole document, and one line in place of 1,500 cannot be
// paged. Here the same reading is done as the text streams past, in place:
//
// - A JSON value that starts a line (`{`, `[` or `"` first on it) is followed
//   token by token for as long as it stays valid JSON, across lines and
//   blocks. The value of a sensitive key becomes "[redacted]"; when that value
//   is an object or an array, its keys and values each become "[redacted]"
//   and its brackets, commas and whitespace stay, so its lines stay too. A
//   string anywhere else is redacted as text, as the JSON reading does.
// - At the first token that is not valid JSON, the rest of the line is plain
//   text, and the next line may start a value again. When that token is the
//   first on its line, of a value begun on an earlier one, the line itself
//   may start a value: an unfinished value does not hide a document that
//   starts on the next line. What was redacted before stays redacted.
// - A value nested deeper than MAX_DEPTH is not followed: the rest of its line
//   is plain text, as at a token that is not valid JSON. `redactSecrets` does
//   not read so deep a document as JSON either: its walk of the parsed value
//   runs out of stack thousands of levels sooner, and it reads the text as
//   text. Nor is the stack of open brackets then held for the rest of the
//   output.
// - Every block is then redacted as text as well, as text that is not JSON is.
//   A text rule can read across a line break, so a block holds back the lines
//   it may still be reading and redacts them with the next
//   (`heldBackStart`).
//
// So output that `redactSecrets` would read as JSON loses at least what it
// would lose there, and output it would read as text at least that too.

import { isSensitiveKey, redactTextSecrets } from '@maka/core/redaction';

const REDACTED = '"[redacted]"';

/** Objects and arrays open at once past which a value is not followed. */
export const MAX_DEPTH = 100_000;

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEX_DIGIT = /^[0-9A-Fa-f]{4}$/u;

type Mode = 'line_start' | 'text' | 'value' | 'after_value';

interface Frame {
  readonly kind: 'object' | 'array';
  /** Everything inside is redacted: the value of a sensitive key, or inside one. */
  readonly secret: boolean;
  expect: 'key_or_close' | 'key' | 'colon' | 'value_or_close' | 'value' | 'comma_or_close';
}

export class OutputRedactor {
  private mode: Mode = 'line_start';
  private stack: Frame[] = [];
  /** The value about to start belongs to a sensitive key. */
  private secretValue = false;
  /** The value followed began on an earlier line, and no token of this line is taken yet. */
  private freshLine = false;

  /**
   * Redact the next part of the output. Parts are fed in order; each ends at
   * the end of a line, except the output's last.
   */
  redact(text: string): string {
    return redactTextSecrets(this.redactJson(text));
  }

  /** A line of the output was left out: whatever JSON it was in cannot be followed. */
  interrupt(): void {
    this.abandon();
  }

  private redactJson(text: string): string {
    const parts: string[] = [];
    let copied = 0;
    const replace = (start: number, end: number, replacement: string): void => {
      parts.push(text.slice(copied, start), replacement);
      copied = end;
    };
    let at = 0;
    while (at < text.length) {
      const code = text.charCodeAt(at);
      switch (this.mode) {
        case 'line_start':
          if (code === 0x7b || code === 0x5b || code === 0x22) {
            this.mode = 'value';
            this.stack = [];
            this.secretValue = false;
            this.freshLine = false;
          } else if (isWhitespace(code)) at++;
          else this.mode = 'text';
          break;
        case 'text': {
          const newline = text.indexOf('\n', at);
          if (newline === -1) at = text.length;
          else {
            at = newline + 1;
            this.mode = 'line_start';
          }
          break;
        }
        case 'after_value':
          // Only whitespace may follow a value on its line.
          if (code === 0x0a) this.mode = 'line_start';
          else if (!isWhitespace(code)) {
            this.mode = 'text';
            break;
          }
          at++;
          break;
        case 'value': {
          if (isJsonWhitespace(code)) {
            // Indentation runs long in a laid-out document.
            do {
              if (text.charCodeAt(at) === 0x0a) this.freshLine = true;
              at++;
            } while (at < text.length && isJsonWhitespace(text.charCodeAt(at)));
            break;
          }
          const next = this.token(text, at, replace);
          if (next === undefined) {
            const restart = this.freshLine;
            this.abandon();
            // Only whitespace precedes the token on its line: the line may
            // start a value itself.
            if (restart) this.mode = 'line_start';
            break;
          }
          this.freshLine = false;
          at = next;
          break;
        }
      }
    }
    if (parts.length === 0) return text;
    parts.push(text.slice(copied));
    return parts.join('');
  }

  /** Take the token at `at`; the index after it, or undefined when it is not valid JSON here. */
  private token(
    text: string,
    at: number,
    replace: (start: number, end: number, replacement: string) => void,
  ): number | undefined {
    const frame = this.stack.at(-1);
    const expect = frame?.expect ?? 'value';
    const char = text[at]!;
    if (expect === 'colon') {
      if (char !== ':') return undefined;
      frame!.expect = 'value';
      return at + 1;
    }
    if (expect === 'comma_or_close') {
      if (char === ',') {
        frame!.expect = frame!.kind === 'object' ? 'key' : 'value';
        return at + 1;
      }
      if (char !== (frame!.kind === 'object' ? '}' : ']')) return undefined;
      return this.close(at);
    }
    if (expect === 'key_or_close' || expect === 'key') {
      if (char === '}' && expect === 'key_or_close') return this.close(at);
      if (char !== '"') return undefined;
      const end = stringEnd(text, at);
      if (end === -1) return undefined;
      const key = decodeString(text.slice(at, end));
      if (key === undefined) return undefined;
      if (frame!.secret) replace(at, end, REDACTED);
      else this.secretValue = isSensitiveKey(key);
      frame!.expect = 'colon';
      return end;
    }
    // A value, or the end of an empty array.
    if (char === ']' && expect === 'value_or_close') return this.close(at);
    const secret = (frame?.secret ?? false) || this.secretValue;
    this.secretValue = false;
    if (char === '{' || char === '[') {
      if (this.stack.length >= MAX_DEPTH) return undefined;
      this.stack.push({
        kind: char === '{' ? 'object' : 'array',
        secret,
        expect: char === '{' ? 'key_or_close' : 'value_or_close',
      });
      return at + 1;
    }
    let end: number;
    if (char === '"') {
      end = stringEnd(text, at);
      if (end === -1) return undefined;
      const literal = text.slice(at, end);
      if (secret) replace(at, end, REDACTED);
      else {
        const redacted = redactStringLiteral(literal);
        if (redacted === undefined) return undefined;
        if (redacted !== literal) replace(at, end, redacted);
      }
    } else {
      end = scalarEnd(text, at);
      if (end === -1) return undefined;
      if (secret) replace(at, end, REDACTED);
    }
    this.valueDone();
    return end;
  }

  private close(at: number): number {
    this.stack.pop();
    this.valueDone();
    return at + 1;
  }

  private valueDone(): void {
    const frame = this.stack.at(-1);
    if (frame) frame.expect = 'comma_or_close';
    else this.mode = 'after_value';
  }

  private abandon(): void {
    this.mode = 'text';
    this.stack = [];
    this.secretValue = false;
    this.freshLine = false;
  }
}

/** {@link OutputRedactor} over one whole text. */
export function redactOutput(text: string): string {
  return new OutputRedactor().redact(text);
}

/** How far before a text's last line the tail it holds back may reach. */
export const HELD_BACK_MAX_CHARS = 64 * 1024;
const AWAITING_HEADER_VALUE = /(?:^|[^A-Za-z0-9_])(?:authorization['"]?|bearer|basic|token)$/iu;
const SECRET_KEY_FLAGS = ['--secret-access-key', 'aws_secret_access_key'];

/**
 * Where the tail of `text` starts that is to be redacted with what comes
 * after it. `text` is whole lines; the rest of the output is not read yet.
 *
 * A text rule reads across a line break in these places: a value continued
 * with a backslash; the whitespace after a quoted key, a `:`, or an
 * Authorization header's name or scheme; a quoted value, or a quoted AWS
 * secret key, over several lines. So the tail is the last line and the one
 * before it, and before them every line that ends in a backslash; in `:`,
 * `"`, `authorization`, `bearer`, `basic` or `token`; in nothing but
 * whitespace; or inside a quoted value, from the line its key is on. It
 * reaches at most {@link HELD_BACK_MAX_CHARS} before the last line, and a
 * quoted key spread over lines is not looked for.
 */
export function heldBackStart(text: string): number {
  if (text === '') return 0;
  const last = lineStartBefore(text, text.length);
  const floor = Math.max(0, last - HELD_BACK_MAX_CHARS);
  let start = last;
  if (start > floor && lineStartBefore(text, start) >= floor) start = lineStartBefore(text, start);
  while (start > floor) {
    const from = runsOnFrom(text, start, floor);
    if (from === undefined || from < floor) break;
    start = from;
  }
  return start;
}

/**
 * When the line ending at `start` may run on into the line after it, where
 * that run starts: the line itself, or the line a quoted value it ends inside
 * starts on. Undefined when it does not run on.
 */
function runsOnFrom(text: string, start: number, floor: number): number | undefined {
  const lineStart = lineStartBefore(text, start);
  let end = start - 1;
  if (end > lineStart && text.charCodeAt(end - 1) === 0x0d) end--;
  if (end > lineStart && text.charCodeAt(end - 1) === 0x5c) return lineStart;
  let last = end - 1;
  while (last >= lineStart && isSpace(text.charCodeAt(last))) last--;
  if (last < lineStart) return lineStart;
  const code = text.charCodeAt(last);
  if (code === 0x3a || code === 0x22) return lineStart;
  if (AWAITING_HEADER_VALUE.test(text.slice(Math.max(lineStart, last - 31), last + 1))) {
    return lineStart;
  }
  const opener = openQuoteStart(text, start, floor);
  return opener === undefined ? undefined : lineStartBefore(text, opener + 1);
}

/**
 * Where the match starts whose quoted value or token `text` ends inside, up
 * to `end`: a value after `"key":`, or a token after an AWS secret key flag.
 */
function openQuoteStart(text: string, end: number, floor: number): number | undefined {
  const double = lastUnescaped(text, 0x22, end, floor);
  if (double !== -1) {
    const opener = quotedKeyBefore(text, double, floor) ?? secretKeyFlagBefore(text, double, floor);
    if (opener !== undefined) return opener;
  }
  const single = lastUnescaped(text, 0x27, end, floor);
  return single === -1 ? undefined : secretKeyFlagBefore(text, single, floor);
}

/** The last `quote` before `end` that no backslash escapes; -1 when there is none from `floor`. */
function lastUnescaped(text: string, quote: number, end: number, floor: number): number {
  for (let at = end - 1; at >= floor; at--) {
    if (text.charCodeAt(at) !== quote) continue;
    let slashes = 0;
    while (at - slashes > floor && text.charCodeAt(at - slashes - 1) === 0x5c) slashes++;
    if (slashes % 2 === 0) return at;
  }
  return -1;
}

/** The opening quote of the `"key"` that `"key"\s*:\s*` before `at` names. */
function quotedKeyBefore(text: string, at: number, floor: number): number | undefined {
  let index = at - 1;
  while (index >= floor && isSpace(text.charCodeAt(index))) index--;
  if (index < floor || text.charCodeAt(index) !== 0x3a) return undefined;
  index--;
  while (index >= floor && isSpace(text.charCodeAt(index))) index--;
  if (index < floor || text.charCodeAt(index) !== 0x22) return undefined;
  let key = index - 1;
  while (key >= floor && text.charCodeAt(key) !== 0x22 && text.charCodeAt(key) !== 0x5c) key--;
  if (key < floor || key === index - 1 || text.charCodeAt(key) !== 0x22) return undefined;
  return key;
}

/** The start of the AWS secret key flag that blanks or continued lines separate from `at`. */
function secretKeyFlagBefore(text: string, at: number, floor: number): number | undefined {
  let index = at;
  while (index > floor) {
    const code = text.charCodeAt(index - 1);
    if (code === 0x20 || code === 0x09) index--;
    else if (code === 0x0a && text.charCodeAt(index - 2) === 0x5c) index -= 2;
    else if (code === 0x0a && text.startsWith('\\\r', index - 3)) index -= 3;
    else break;
  }
  if (index === at) return undefined;
  for (const flag of SECRET_KEY_FLAGS) {
    const from = index - flag.length;
    if (from >= floor && text.startsWith(flag, from)) return from;
  }
  return undefined;
}

/** The start of the line that ends at `end`, its newline included. */
function lineStartBefore(text: string, end: number): number {
  return end < 2 ? 0 : text.lastIndexOf('\n', end - 2) + 1;
}

/** What `\s` matches. */
function isSpace(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** Space, tab or carriage return: whitespace that does not end a line. */
function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0d;
}

function isJsonWhitespace(code: number): boolean {
  return isWhitespace(code) || code === 0x0a;
}

/** The index after the `"` closing the string that starts at `start`; -1 when it is not a valid one. */
function stringEnd(text: string, start: number): number {
  for (let at = start + 1; at < text.length; at++) {
    const code = text.charCodeAt(at);
    if (code === 0x22) return at + 1;
    if (code < 0x20) return -1;
    if (code === 0x5c) {
      const escaped = text[at + 1];
      if (escaped === 'u') {
        if (!HEX_DIGIT.test(text.slice(at + 2, at + 6))) return -1;
        at += 5;
      } else if (escaped !== undefined && '"\\/bfnrt'.includes(escaped)) at++;
      else return -1;
    }
  }
  return -1;
}

/** The index after the number, `true`, `false` or `null` at `start`; -1 when there is none. */
function scalarEnd(text: string, start: number): number {
  for (const word of ['true', 'false', 'null']) {
    if (text.startsWith(word, start)) return start + word.length;
  }
  NUMBER.lastIndex = start;
  return NUMBER.test(text) ? NUMBER.lastIndex : -1;
}

function decodeString(literal: string): string | undefined {
  if (!literal.includes('\\')) return literal.slice(1, -1);
  try {
    return JSON.parse(literal) as string;
  } catch {
    return undefined;
  }
}

/**
 * A string's text redacted as the JSON reading redacts it, written back as a
 * string; the literal itself when nothing in it changes.
 */
function redactStringLiteral(literal: string): string | undefined {
  const value = decodeString(literal);
  if (value === undefined) return undefined;
  const redacted = redactTextSecrets(value);
  return redacted === value ? literal : JSON.stringify(redacted);
}
