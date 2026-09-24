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

// Edit's string replacement. `old_string` must be in the file exactly —
// indentation and every other character — with two allowances:
//
// - Quotes. Straight quotes in `old_string` match the file's curly ones, and
//   `new_string` is then written with curly quotes too, so the file keeps its
//   style.
// - Line endings. A CRLF file is matched and edited as LF, and written back
//   as CRLF.
//
// Nothing else is normalised; a near miss is reported as not found.

export type EditMatchStrategy = 'exact' | 'quotes';

export interface EditMatch {
  /** The full new file content after the replacement. */
  content: string;
  /** Whether `old_string` was found as written or only once quotes were matched. */
  matchedVia: EditMatchStrategy;
  /** 1-based first line of the matched span in the original source. */
  startLine: number;
  /** 1-based last line (inclusive) of the matched span in the original source. */
  endLine: number;
  /** How many occurrences were replaced. Always 1 unless `replaceAll` was asked for. */
  replacements: number;
}

export interface EditReplaceOptions {
  /** Replace every occurrence instead of requiring a unique one. */
  replaceAll?: boolean;
}

/** The model pays for this text, so a long old_string is shown as a head. */
function truncateForMessage(value: string, max = 200): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/**
 * Replace `oldString` with `newString` in `source`: once, where it occurs
 * exactly once, or everywhere with `options.replaceAll`.
 *
 * @throws when old_string is empty, absent, ambiguous, or identical to new_string.
 */
export function computeEditedSource(
  source: string,
  oldString: string,
  newString: string,
  _where: string,
  options: EditReplaceOptions = {},
): EditMatch {
  if (oldString === newString) {
    throw new Error('No changes to make: old_string and new_string are exactly the same.');
  }
  if (oldString === '') {
    // An empty old_string creates a file; one that exists may only be empty.
    if (source.trim() !== '') throw new Error('Cannot create new file - file already exists.');
    return {
      content: newString,
      matchedVia: 'exact',
      startLine: 1,
      endLine: Math.max(1, newString.split('\n').length - (newString.endsWith('\n') ? 1 : 0)),
      replacements: 1,
    };
  }

  const crlf = usesCrlf(source);
  const text = crlf ? toLf(source) : source;
  const find = toLf(oldString);
  const actual = findActualString(text, find);
  if (actual === undefined) {
    throw new Error(
      `String to replace not found in file.\nString: ${truncateForMessage(oldString)}`,
    );
  }
  const replacement = preserveQuoteStyle(find, actual, toLf(newString));
  const matchedVia: EditMatchStrategy = actual === find ? 'exact' : 'quotes';
  const count = countOccurrences(text, actual);
  if (count > 1 && !options.replaceAll) {
    throw new Error(
      `Found ${count} matches of the string to replace, but replace_all is false. ` +
        'To replace all occurrences, set replace_all to true. To replace only one occurrence, ' +
        'please provide more context to uniquely identify the instance.\n' +
        `String: ${truncateForMessage(oldString)}`,
    );
  }

  const first = text.indexOf(actual);
  const last = options.replaceAll ? text.lastIndexOf(actual) : first;
  const startLine = countOccurrences(text.slice(0, first), '\n') + 1;
  // A trailing newline in the span is its last line's terminator, not a line.
  const spanLines = countOccurrences(actual, '\n') + 1 - (actual.endsWith('\n') ? 1 : 0);
  const endLine = countOccurrences(text.slice(0, last), '\n') + 1 + Math.max(spanLines, 1) - 1;
  // split-join (not String.replace) so `$&`/`$1` in new_string stay literal.
  const edited = options.replaceAll
    ? text.split(actual).join(replacement)
    : text.slice(0, first) + replacement + text.slice(first + actual.length);
  return {
    content: crlf ? edited.replaceAll('\n', '\r\n') : edited,
    matchedVia,
    startLine,
    endLine,
    replacements: options.replaceAll ? count : 1,
  };
}

/** More CRLF line breaks than bare LF ones. */
function usesCrlf(source: string): boolean {
  const crlf = countOccurrences(source, '\r\n');
  return crlf > 0 && crlf >= countOccurrences(source, '\n') - crlf;
}

function toLf(text: string): string {
  return text.replaceAll('\r\n', '\n');
}

const CURLY_QUOTES: Readonly<Record<string, string>> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
};

function normalizeQuotes(text: string): string {
  return text.replace(/[‘’“”]/g, (quote) => CURLY_QUOTES[quote]!);
}

/**
 * `find` as the file spells it: itself when it is there, or the span that
 * matches it once curly quotes are read as straight ones. Each quote is one
 * UTF-16 unit either way, so the offsets line up.
 */
function findActualString(text: string, find: string): string | undefined {
  if (text.includes(find)) return find;
  const index = normalizeQuotes(text).indexOf(normalizeQuotes(find));
  return index === -1 ? undefined : text.slice(index, index + find.length);
}

/** When the match needed curly quotes, `replacement` gets them too. */
function preserveQuoteStyle(find: string, actual: string, replacement: string): string {
  if (find === actual) return replacement;
  let result = replacement;
  if (/[“”]/.test(actual)) result = curlyDoubleQuotes(result);
  if (/[‘’]/.test(actual)) result = curlySingleQuotes(result);
  return result;
}

/** A quote that opens: at the start, or after space or an opening bracket or dash. */
function opensAt(chars: readonly string[], index: number): boolean {
  if (index === 0) return true;
  return /[\s([{—–]/.test(chars[index - 1]!);
}

function curlyDoubleQuotes(text: string): string {
  const chars = [...text];
  return chars
    .map((char, index) => (char === '"' ? (opensAt(chars, index) ? '“' : '”') : char))
    .join('');
}

function curlySingleQuotes(text: string): string {
  const chars = [...text];
  return chars
    .map((char, index) => {
      if (char !== "'") return char;
      const letterBefore = index > 0 && /\p{L}/u.test(chars[index - 1]!);
      const letterAfter = index < chars.length - 1 && /\p{L}/u.test(chars[index + 1]!);
      // Between two letters it is an apostrophe: it's, don't.
      if (letterBefore && letterAfter) return '’';
      return opensAt(chars, index) ? '‘' : '’';
    })
    .join('');
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  for (
    let index = haystack.indexOf(needle);
    index !== -1;
    index = haystack.indexOf(needle, index + needle.length)
  ) {
    count += 1;
  }
  return count;
}
