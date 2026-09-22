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

/**
 * Read a tool call's arguments while the model is still writing them.
 *
 * A provider streams a tool call's input as raw JSON text, one fragment at a
 * time. Nothing downstream can use a fragment: every formatter in the transcript
 * reads an OBJECT (`args ?? argsPreview`). So the fragment is repaired into the
 * most complete value it can already stand for — the keys that have closed, plus
 * the string value currently being typed — and that value is what the row shows
 * until the real arguments arrive.
 *
 * Repair, not parse-what-you-can: the scanner records the open structures and
 * the string state, then writes the closers the text is missing. A key whose
 * value has not started yet is dropped rather than invented, and a value the
 * repair cannot make sense of (a half-written number, `nul`) costs only that
 * one key — the next fragment brings it back.
 *
 * The result is deliberately lossy and never persisted. `tool_start` carries
 * the authoritative arguments, and the projection replaces this with them.
 */

export interface PartialJsonReading {
  /**
   * The value the text can already stand for, or undefined when nothing can be:
   * an empty fragment, or one that has not yet closed its first key.
   */
  value: unknown;
  /** True when the text parsed as it stands — a complete JSON document. */
  complete: boolean;
}

const NOTHING: PartialJsonReading = { value: undefined, complete: false };

export function readPartialJson(text: string): PartialJsonReading {
  // Never trim the source: a fragment can end inside a string literal, where
  // trailing whitespace is the last thing the model wrote, not padding.
  if (text.trim().length === 0) return NOTHING;
  const whole = tryParse(text);
  if (whole.parsed) return { value: whole.value, complete: true };
  const repaired = repair(text);
  if (repaired === undefined) return NOTHING;
  const first = tryParse(repaired.text);
  if (first.parsed) return { value: first.value, complete: false };
  // The tail is a value mid-composition that no closer can finish — a partial
  // number, a partial literal. Drop that one entry and keep everything before it.
  if (repaired.lastEntryStart === undefined) return NOTHING;
  const withoutTail = repair(text.slice(0, repaired.lastEntryStart));
  if (withoutTail === undefined) return NOTHING;
  const second = tryParse(withoutTail.text);
  return second.parsed ? { value: second.value, complete: false } : NOTHING;
}

function tryParse(text: string): { parsed: true; value: unknown } | { parsed: false } {
  try {
    return { parsed: true, value: JSON.parse(text) as unknown };
  } catch {
    return { parsed: false };
  }
}

interface Repair {
  text: string;
  /**
   * Offset in the source of the separator that opens the final entry (`,` or the
   * opening bracket), so a tail that cannot be repaired can be cut off whole.
   */
  lastEntryStart?: number;
}

function repair(source: string): Repair | undefined {
  const stack: ('{' | '[')[] = [];
  let inString = false;
  let escaped = false;
  // Where the innermost structure's current entry began, so an unrepairable tail
  // can be cut back to it. Recorded per depth: closing a structure restores the
  // enclosing one's mark.
  const entryStarts: (number | undefined)[] = [];
  let entryStart: number | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '{' || character === '[') {
      entryStarts.push(entryStart);
      stack.push(character);
      entryStart = index + 1;
    } else if (character === '}' || character === ']') {
      const open = stack.pop();
      if (open === undefined) return undefined;
      if ((open === '{') !== (character === '}')) return undefined;
      entryStart = entryStarts.pop();
    } else if (character === ',' && stack.length > 0) {
      entryStart = index + 1;
    }
  }
  if (stack.length === 0) return undefined;
  let text = source;
  if (inString) {
    // A fragment may end mid-escape (`"a\`), where the backslash would escape
    // the quote that closes it.
    if (escaped) text = text.slice(0, -1);
    text += '"';
  }
  text = trimEntrySeparators(text);
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    text += stack[index] === '{' ? '}' : ']';
  }
  return { text, ...(entryStart !== undefined ? { lastEntryStart: entryStart } : {}) };
}

/**
 * Cut back the dangling tail a closer cannot stand next to: a trailing comma,
 * and a key whose value has not been written yet (`{"a":1,"b":` -> `{"a":1`).
 */
function trimEntrySeparators(text: string): string {
  let end = text.length;
  while (end > 0 && isWhitespace(text[end - 1]!)) end -= 1;
  // A number the model is part way through writing parses as a smaller, complete
  // one: `{"line":12` while it types `123`, and nothing distinguishes the two.
  // Only the ORIGINAL tail can be mid-write — a number exposed by dropping a
  // later entry was already terminated by the comma that followed it — so this
  // is decided once, before anything is trimmed.
  if (end > 0 && isNumberChar(text[end - 1]!)) end = skipNumberBack(text, end);
  for (;;) {
    while (end > 0 && isWhitespace(text[end - 1]!)) end -= 1;
    if (end === 0) return '';
    const last = text[end - 1]!;
    if (last === ',') {
      end -= 1;
      continue;
    }
    if (last === ':') {
      const keyEnd = skipWhitespaceBack(text, end - 1);
      if (keyEnd === 0 || text[keyEnd - 1] !== '"') return text.slice(0, end);
      const keyStart = stringStart(text, keyEnd - 1);
      if (keyStart === undefined) return text.slice(0, end);
      end = keyStart;
      continue;
    }
    return text.slice(0, end);
  }
}

function skipWhitespaceBack(text: string, from: number): number {
  let index = from;
  while (index > 0 && isWhitespace(text[index - 1]!)) index -= 1;
  return index;
}

/** Offset of the opening quote of the string literal ending at `closingQuote`. */
function stringStart(text: string, closingQuote: number): number | undefined {
  for (let index = closingQuote - 1; index >= 0; index -= 1) {
    if (text[index] !== '"') continue;
    let backslashes = 0;
    while (index - 1 - backslashes >= 0 && text[index - 1 - backslashes] === '\\') backslashes += 1;
    if (backslashes % 2 === 0) return index;
  }
  return undefined;
}

function isNumberChar(character: string): boolean {
  return (character >= '0' && character <= '9') || character === '-' || character === '+';
}

/** Back over a numeric literal and the `:` or `,` that introduced it. */
function skipNumberBack(text: string, from: number): number {
  let index = from;
  while (index > 0 && /[-+0-9.eE]/.test(text[index - 1]!)) index -= 1;
  return index;
}

function isWhitespace(character: string): boolean {
  return character === ' ' || character === '\n' || character === '\r' || character === '\t';
}
