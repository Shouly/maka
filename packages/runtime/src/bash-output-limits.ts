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

// How much of a finished foreground command the model is shown.
//
// The decision is made once, when the result is made, and never revisited:
// a result's text stays in the model's context as it was produced.
//
// - A valid result is shown whole up to BASH_INLINE_MAX_CHARS. Past that the
//   whole output is saved to a file and the model gets the path and a preview
//   of its start.
// - A failure is shown whole up to BASH_FAILURE_INLINE_MAX_CHARS. Past that it
//   gets a head and a tail, with no file.
//
// The result itself holds only the last ~1 MiB of each stream. When a stream
// was longer, the start of the output comes from the working files the run
// kept (`shell-output-spool.ts`); where there are none, the excerpt says that
// earlier output is not shown.
//
// A command is valid when it exits 0, or exits 1 where exit 1 is an ordinary
// answer rather than an error (grep finding nothing, diff finding a
// difference); every other end is a failure. Reading the command line is
// best effort, and a command line it cannot read counts as a failure: one
// nested too deep, or one the reading fails on.

import type { TerminalSavedOutput, ToolResultContent } from '@maka/core/events';
import type { PipeShellOutput } from '@maka/core/shell-run';
import type { SavedShellOutput, SavedStreamExtent, ShellOutputHead } from './shell-output-spool.js';
import {
  formatCount,
  isHighSurrogate,
  isLowSurrogate,
  savedToolResultNotice,
  sliceEndAtCharacter,
} from './tool-result-file.js';

type TerminalToolResult = Extract<ToolResultContent, { kind: 'terminal' }>;

/** A valid result is shown whole up to this many characters, and saved to a file past it. */
export const BASH_INLINE_MAX_CHARS = 30_000;
/** A failure is shown whole up to this many characters, and as a head and a tail past it. */
export const BASH_FAILURE_INLINE_MAX_CHARS = 10_000;
/** How much of a saved output the model is shown. */
export const BASH_SAVED_PREVIEW_CHARS = 2_000;
/** A foreground command that prints more than this is killed. */
export const BASH_MAX_OUTPUT_BYTES = 5 * 1024 * 1024 * 1024;

/** Stands at the start of a stream whose retained tail lost the output's start. */
export const EARLIER_OUTPUT_MARKER = '[... earlier output omitted ...]';

// ---------------------------------------------------------------------------
// Which endings are valid
// ---------------------------------------------------------------------------

/** Programs whose exit 1 is an answer: no match, a difference, a false test. */
const EXIT_ONE_PROGRAMS = new Set([
  'grep',
  'rg',
  'egrep',
  'fgrep',
  'find',
  'diff',
  'test',
  '[',
  '[[',
]);
const EXIT_ONE_GIT_COMMANDS = new Set(['diff', 'grep']);
/** git options that take the next word as their value. */
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
/** Quotes and substitutions nested deeper than this are not read: the line is unreadable. */
const MAX_NESTING = 256;

/** How a program that runs another one takes its own options. */
interface Wrapper {
  /** Short options that take a value: the rest of the word, or the next word. */
  readonly shortWithValue?: string;
  /** Short options that take a value only when it is attached (`-i{}`). */
  readonly shortWithAttachedValue?: string;
  readonly shortFlags?: string;
  /** Short options after which the command is not run, or its status is not passed on. */
  readonly refusing?: string;
  /** Long options that take a value, as `--name=value` or `--name value`. */
  readonly longWithValue?: readonly string[];
  readonly longFlags?: readonly string[];
  /** `-<number>` is an option (nice's old form). */
  readonly numericOption?: boolean;
  /** `-` alone is an option (env's old form of `-i`). */
  readonly loneDash?: boolean;
  /** A word taken after the options, before the command (timeout's duration). */
  readonly operand?: RegExp;
}

/** Programs that run the command after them, which is the one whose exit status is reported. */
const WRAPPERS = new Map<string, Wrapper>([
  [
    'sudo',
    {
      shortWithValue: 'CDghprRtTuU',
      shortFlags: 'AbBEHiknNPsS',
      refusing: 'eKlvV',
      longWithValue: [
        'chdir',
        'chroot',
        'close-from',
        'command-timeout',
        'group',
        'host',
        'other-user',
        'prompt',
        'role',
        'type',
        'user',
      ],
      longFlags: [
        'askpass',
        'background',
        'bell',
        'login',
        'non-interactive',
        'preserve-env',
        'preserve-groups',
        'reset-timestamp',
        'set-home',
        'shell',
        'stdin',
      ],
    },
  ],
  ['time', { shortWithValue: 'fo', shortFlags: 'ahlpqv' }],
  [
    'env',
    {
      shortWithValue: 'CPu',
      shortFlags: '0iv',
      refusing: 'S',
      longWithValue: ['chdir', 'unset'],
      longFlags: ['debug', 'ignore-environment', 'null'],
      loneDash: true,
    },
  ],
  [
    'timeout',
    {
      shortWithValue: 'ks',
      shortFlags: 'fpv',
      longWithValue: ['kill-after', 'signal'],
      longFlags: ['foreground', 'preserve-status', 'verbose'],
      operand: /^\d+(?:\.\d+)?[smhd]?$/u,
    },
  ],
  [
    'xargs',
    {
      shortWithValue: 'adEIJLnPRsS',
      shortWithAttachedValue: 'eil',
      shortFlags: '0oprtx',
      longWithValue: [
        'arg-file',
        'delimiter',
        'eof',
        'max-args',
        'max-chars',
        'max-lines',
        'max-procs',
        'process-slot-var',
        'replace',
      ],
      longFlags: ['exit', 'interactive', 'no-run-if-empty', 'null', 'open-tty', 'verbose'],
    },
  ],
  ['command', { shortFlags: 'p', refusing: 'vV' }],
  ['nice', { shortWithValue: 'n', longWithValue: ['adjustment'], numericOption: true }],
  ['nohup', {}],
]);

export function isValidBashOutcome(
  result: Pick<TerminalToolResult, 'status' | 'exitCode' | 'cmd'>,
): boolean {
  if (result.status === 'completed') return result.exitCode === 0;
  return result.status === 'failed' && result.exitCode === 1 && exitOneIsBenign(result.cmd);
}

/**
 * Whether exit 1 from `command` is an answer rather than an error. The exit
 * status is the last command's, so that is the one looked at, past any
 * wrapper that runs it (`sudo`, `timeout 5`, `xargs`, …).
 */
export function exitOneIsBenign(command: string): boolean {
  try {
    return lastCommandAnswersWithExitOne(command);
  } catch {
    // Whatever the reading trips on, the result is still made: as a failure.
    return false;
  }
}

function lastCommandAnswersWithExitOne(command: string): boolean {
  const words = lastSimpleCommand(command);
  const run = words && commandBehindWrappers(words);
  if (!run) return false;
  const program = run[0]!.split('/').at(-1)!;
  if (EXIT_ONE_PROGRAMS.has(program)) return true;
  if (program !== 'git') return false;
  for (let index = 1; index < run.length; index++) {
    const word = run[index]!;
    if (GIT_OPTIONS_WITH_VALUE.has(word)) index++;
    else if (!word.startsWith('-')) return EXIT_ONE_GIT_COMMANDS.has(word);
  }
  return false;
}

/** The command a run of wrappers ends in, from its program on; undefined when unclear. */
function commandBehindWrappers(words: readonly string[]): readonly string[] | undefined {
  let index = 0;
  for (;;) {
    while (index < words.length && ASSIGNMENT.test(words[index]!)) index++;
    const word = words[index];
    if (word === undefined) return undefined;
    const wrapper = WRAPPERS.get(word.split('/').at(-1)!);
    if (!wrapper) return words.slice(index);
    const next = skipWrapperOptions(words, index + 1, wrapper);
    if (next === undefined) return undefined;
    index = next;
  }
}

/** The index of the first word after a wrapper's options; undefined for one it does not know. */
function skipWrapperOptions(
  words: readonly string[],
  start: number,
  wrapper: Wrapper,
): number | undefined {
  let index = start;
  while (index < words.length) {
    const word = words[index]!;
    if (word === '--') {
      index++;
      break;
    }
    if (word === '-' && wrapper.loneDash) {
      index++;
      continue;
    }
    if (!word.startsWith('-') || word === '-') break;
    if (word.startsWith('--')) {
      const equals = word.indexOf('=');
      const name = word.slice(2, equals === -1 ? undefined : equals);
      if (wrapper.longFlags?.includes(name)) index++;
      else if (wrapper.longWithValue?.includes(name)) index += equals === -1 ? 2 : 1;
      else return undefined;
      continue;
    }
    if (wrapper.numericOption && /^-\d+$/u.test(word)) {
      index++;
      continue;
    }
    let next = index + 1;
    for (let at = 1; at < word.length; at++) {
      const option = word[at]!;
      if (wrapper.refusing?.includes(option)) return undefined;
      if (wrapper.shortWithValue?.includes(option)) {
        if (at === word.length - 1) next++;
        break;
      }
      if (wrapper.shortWithAttachedValue?.includes(option)) break;
      if (!wrapper.shortFlags?.includes(option)) return undefined;
    }
    index = next;
  }
  if (wrapper.operand) {
    if (!wrapper.operand.test(words[index] ?? '')) return undefined;
    index++;
  }
  return index < words.length ? index : undefined;
}

/**
 * The words of the last simple command in a shell command line: split on
 * `;`, `&&`, `||`, `|`, `&`, newlines and grouping, with quotes, escapes,
 * expansions (`${…}`, `$(…)`, backticks, `<(…)`), comments, redirections and
 * `[[ … ]]` taken into account. Undefined for a line it cannot read: an
 * unclosed quote, substitution or test.
 */
function lastSimpleCommand(command: string): string[] | undefined {
  let current: string[] = [];
  let last: string[] = [];
  let word = '';
  let inWord = false;
  let dropNextWord = false;
  // Between `[[` and `]]`, where `<`, `&&` and parentheses are the test's own.
  let inTest = false;
  const endWord = () => {
    if (inWord) {
      if (dropNextWord) dropNextWord = false;
      else {
        if (word === '[[' && current.length === 0) inTest = true;
        current.push(word);
      }
    }
    word = '';
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (current.length > 0) last = current;
    current = [];
  };
  const take = (end: number, text: string): number => {
    word += text;
    inWord = true;
    return end;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    const next = command[i + 1];
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      if (close === -1) return undefined;
      i = take(close, command.slice(i + 1, close));
      continue;
    }
    if (c === '"') {
      const close = endOfDoubleQuotes(command, i + 1);
      if (close === -1) return undefined;
      i = take(close, command.slice(i + 1, close).replace(/\\(["\\$`])/gu, '$1'));
      continue;
    }
    if (c === '\\') {
      if (next === '\n') i++;
      else if (next !== undefined) i = take(i + 1, next);
      continue;
    }
    if (c === '$' && next === "'") {
      const close = endOfAnsiQuotes(command, i + 2);
      if (close === -1) return undefined;
      i = take(close, command.slice(i + 2, close));
      continue;
    }
    if (
      (c === '$' && (next === '(' || next === '{')) ||
      ((c === '<' || c === '>') && next === '(')
    ) {
      // An expansion, or a process substitution, is one piece of a word.
      const close = endOfGroup(command, i + 1);
      if (close === -1) return undefined;
      i = take(close, command.slice(i, close + 1));
      continue;
    }
    if (c === '`') {
      const close = endOfBackticks(command, i + 1);
      if (close === -1) return undefined;
      i = take(close, command.slice(i, close + 1));
      continue;
    }
    if (c === '#' && !inWord) {
      const newline = command.indexOf('\n', i);
      i = (newline === -1 ? command.length : newline) - 1;
      continue;
    }
    if (c === ' ' || c === '\t') {
      endWord();
      continue;
    }
    if (inTest) {
      if (!inWord && command.startsWith(']]', i) && /^[\s;&|)]?$/u.test(command[i + 2] ?? '')) {
        current.push(']]');
        inTest = false;
        i++;
      } else if (c === '\n') endWord();
      else take(i, c);
      continue;
    }
    if (c === '>' || c === '<' || (c === '&' && next === '>')) {
      // A redirection and its target are not words of the command; a bare
      // fd number in front of it (`2>`) is part of it.
      if (inWord && /^\d+$/u.test(word)) {
        word = '';
        inWord = false;
      } else endWord();
      while (i + 1 < command.length && /[<>&|]/u.test(command[i + 1]!)) i++;
      dropNextWord = true;
      continue;
    }
    if (c === '{' || c === '}') {
      // A group only as a word of its own where a command starts; anywhere
      // else it is part of a word, as in `file{1,2}.txt` or `-exec … {} \;`.
      if (!inWord && current.length === 0 && /^[\s;&|()]?$/u.test(next ?? '')) endCommand();
      else take(i, c);
      continue;
    }
    if (';&|\n()'.includes(c)) {
      endCommand();
      continue;
    }
    take(i, c);
  }
  if (inTest) return undefined;
  endCommand();
  return last;
}

/**
 * The index of the `"` closing a double-quoted string that starts at `start`,
 * or -1. `depth` counts the quotes and groups it is inside of.
 */
function endOfDoubleQuotes(command: string, start: number, depth = 0): number {
  if (depth > MAX_NESTING) return -1;
  for (let i = start; i < command.length; i++) {
    const c = command[i]!;
    if (c === '\\') i++;
    else if (c === '"') return i;
    else if (c === '$' && (command[i + 1] === '(' || command[i + 1] === '{')) {
      i = endOfGroup(command, i + 1, depth + 1);
      if (i === -1) return -1;
    } else if (c === '`') {
      i = endOfBackticks(command, i + 1);
      if (i === -1) return -1;
    }
  }
  return -1;
}

/** The index of the `'` closing a `$'…'` string whose text starts at `start`, or -1. */
function endOfAnsiQuotes(command: string, start: number): number {
  for (let i = start; i < command.length; i++) {
    if (command[i] === '\\') i++;
    else if (command[i] === "'") return i;
  }
  return -1;
}

/** The index of the backtick closing a substitution whose text starts at `start`, or -1. */
function endOfBackticks(command: string, start: number): number {
  for (let i = start; i < command.length; i++) {
    if (command[i] === '\\') i++;
    else if (command[i] === '`') return i;
  }
  return -1;
}

/** The index of the bracket closing the `(` or `{` at `open`, or -1; `depth` as for quotes. */
function endOfGroup(command: string, open: number, depth = 0): number {
  if (depth > MAX_NESTING) return -1;
  const opener = command[open]!;
  const closer = opener === '(' ? ')' : '}';
  // Brackets of this group's own kind opened and not yet closed.
  let unclosed = 0;
  for (let i = open; i < command.length; i++) {
    const c = command[i]!;
    if (c === '\\') i++;
    else if (c === "'") {
      i = command.indexOf("'", i + 1);
      if (i === -1) return -1;
    } else if (c === '"') {
      i = endOfDoubleQuotes(command, i + 1, depth + 1);
      if (i === -1) return -1;
    } else if (c === '`') {
      i = endOfBackticks(command, i + 1);
      if (i === -1) return -1;
    } else if (c === '$' && (command[i + 1] === '(' || command[i + 1] === '{')) {
      i = endOfGroup(command, i + 1, depth + 1);
      if (i === -1) return -1;
    } else if (c === opener) unclosed++;
    else if (c === closer && --unclosed === 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Bounding a result
// ---------------------------------------------------------------------------

/** What the model reads of a piped run: stdout then stderr, one newline between. */
export function joinedStreams(stdout: string, stderr: string): string {
  return [trimTrailingNewlines(stdout), trimTrailingNewlines(stderr)]
    .filter((part) => part !== '')
    .join('\n');
}

/**
 * The preview of a saved output as the model reads it. Its streams are the
 * start of the saved file, not whole streams, so nothing is trimmed.
 */
export function savedPreviewText(stdout: string, stderr: string): string {
  return [stdout, stderr].filter((part) => part !== '').join('\n');
}

/** The whole output of a run, kept on disk while it ran. */
export interface WholeShellOutput {
  /** Save it to a file; undefined when it cannot be saved. */
  save(): Promise<SavedShellOutput | undefined>;
  /** Its first `maxChars` characters and its length; undefined when they cannot be read. */
  head(maxChars: number): Promise<ShellOutputHead | undefined>;
}

/**
 * Bound a finished command's result for the model. `whole` is the output
 * kept on disk: a long valid result is saved from it, and a failure whose
 * retained tail lost the output's start takes the start from it. Without it,
 * or when it fails, a long result is a head and a tail of what was retained.
 */
export async function boundTerminalResult(
  result: TerminalToolResult,
  whole?: WholeShellOutput,
): Promise<TerminalToolResult> {
  const output = result.output;
  if (output.mode !== 'pipes') return result;
  const valid = isValidBashOutcome(result);
  const maxChars = valid ? BASH_INLINE_MAX_CHARS : BASH_FAILURE_INLINE_MAX_CHARS;
  const windowCut = output.stdoutTruncated || output.stderrTruncated;
  if (!windowCut && joinedStreams(output.stdout, output.stderr).length <= maxChars) return result;
  if (valid) {
    const saved = await whole?.save().catch(() => undefined);
    if (saved) return savedResult(result, output, saved);
  } else if (windowCut) {
    const head = await whole?.head(Math.floor(maxChars / 2)).catch(() => undefined);
    if (head) return withOutput(result, excerptWithHead(output, head, maxChars));
  }
  return boundTerminalResultInline(result);
}

/** {@link boundTerminalResult} where nothing was kept on disk: long output becomes a head and a tail. */
export function boundTerminalResultInline(result: TerminalToolResult): TerminalToolResult {
  const output = result.output;
  if (output.mode !== 'pipes') return result;
  const max = isValidBashOutcome(result) ? BASH_INLINE_MAX_CHARS : BASH_FAILURE_INLINE_MAX_CHARS;
  return withOutput(result, excerptStreams(output, max));
}

function withOutput(result: TerminalToolResult, output: PipeShellOutput): TerminalToolResult {
  return output === result.output ? result : { ...result, output };
}

/**
 * At most `maxChars` of the joined streams: the first half and the last half,
 * with a line saying how much was left out between them. A stream whose
 * retained tail lost its start begins with {@link EARLIER_OUTPUT_MARKER}, or,
 * when that start falls in the cut, the line says more than that was left out.
 */
export function excerptStreams(output: PipeShellOutput, maxChars: number): PipeShellOutput {
  const stdout = trimTrailingNewlines(output.stdout);
  const stderr = trimTrailingNewlines(output.stderr);
  const joined = joinedStreams(stdout, stderr);
  if (joined.length <= maxChars) return output;
  let start = Math.floor(maxChars / 2);
  let end = joined.length - (maxChars - start);
  // Never split a surrogate pair at either edge of the cut.
  if (isHighSurrogate(joined.charCodeAt(start - 1))) start--;
  if (isLowSurrogate(joined.charCodeAt(end))) end++;
  const offset = stdout === '' ? 0 : stdout.length + 1;
  const stdoutLost = output.stdoutTruncated && stdout !== '';
  const stderrLost = output.stderrTruncated && stderr !== '';
  // Where stderr's retained text starts is either shown, and marked there,
  // or inside the cut, which then left out more than it can count.
  const stderrLostInCut = stderrLost && offset >= start && offset < end;
  const kept = cutStreams(stdout, stderr, start, end, omittedMarker(end - start, stderrLostInCut));
  return {
    ...output,
    stdout: stdoutLost ? `${EARLIER_OUTPUT_MARKER}\n${kept.stdout}` : kept.stdout,
    stderr:
      stderrLost && !stderrLostInCut ? `${EARLIER_OUTPUT_MARKER}\n${kept.stderr}` : kept.stderr,
    stdoutTruncated: output.stdoutTruncated || kept.stdout !== stdout,
    stderrTruncated: output.stderrTruncated || kept.stderr !== stderr,
  };
}

/**
 * About `maxChars` of the output: `head`, the real start of it read from
 * disk, then the end of the retained streams, never again what the head
 * shows. Each stream keeps its own parts in order, and a line says how much
 * was left out between them: a lower bound where the file on disk did not
 * hold the whole stream. One stretch left out from inside stdout into stderr
 * gets one line.
 */
export function excerptWithHead(
  output: PipeShellOutput,
  head: ShellOutputHead,
  maxChars: number,
): PipeShellOutput {
  const stdout = trimTrailingNewlines(output.stdout);
  const stderr = trimTrailingNewlines(output.stderr);
  let budget = Math.max(0, maxChars - savedPreviewText(head.stdout, head.stderr).length);
  // The head reaches into stderr only past the whole of stdout.
  const stdoutRest =
    head.stderr === ''
      ? afterHead(stdout, output.stdoutTruncated, head.stdout.length, head.streams.stdout)
      : NOTHING_AFTER_HEAD;
  const stderrRest = afterHead(
    stderr,
    output.stderrTruncated,
    head.stderr.length,
    head.streams.stderr,
  );
  // The end of the output is the end of stderr, then of stdout before it.
  const stderrTail = sliceEndAtCharacter(stderrRest.text, budget);
  budget -= stderrTail.length;
  const stdoutTail = sliceEndAtCharacter(stdoutRest.text, budget);
  const stdoutGap = gapBefore(stdoutRest, stdoutTail);
  const stderrGap = gapBefore(stderrRest, stderrTail);
  let kept: { stdout: string; stderr: string };
  if (stdoutTail === '' && head.stderr === '' && stdoutGap.left && stderrGap.left) {
    const across: Gap = {
      // The newline between the streams is left out with them.
      chars: stdoutGap.chars + 1 + stderrGap.chars,
      bounded: stdoutGap.bounded || stderrGap.bounded,
      left: true,
    };
    kept = { stdout: withGap(head.stdout, across, ''), stderr: stderrTail };
  } else {
    kept = {
      stdout: withGap(head.stdout, stdoutGap, stdoutTail),
      stderr: withGap(head.stderr, stderrGap, stderrTail),
    };
  }
  return {
    ...output,
    stdout: kept.stdout,
    stderr: kept.stderr,
    stdoutTruncated: output.stdoutTruncated || kept.stdout !== stdout,
    stderrTruncated: output.stderrTruncated || kept.stderr !== stderr,
  };
}

/** What of one retained stream comes after the part of it the head shows. */
interface AfterHead {
  readonly text: string;
  /** Characters of the stream between the head's part and `text`. */
  readonly before: number;
  /** `before` is a lower bound: the file on disk did not hold the whole stream. */
  readonly bounded: boolean;
  /** Something lies between them even when `before` cannot count it. */
  readonly missing: boolean;
}

const NOTHING_AFTER_HEAD: AfterHead = { text: '', before: 0, bounded: false, missing: false };

/**
 * `retained` is the stream's end as the result kept it; `lost` when that is
 * not the whole stream. The head showed the stream's first `shown`
 * characters, and `extent` says how much of the stream the file holds.
 */
function afterHead(
  retained: string,
  lost: boolean,
  shown: number,
  extent: SavedStreamExtent,
): AfterHead {
  if (!lost) {
    // The whole stream: the head showed its start.
    let start = Math.min(shown, retained.length);
    if (isLowSurrogate(retained.charCodeAt(start))) start++;
    return { text: retained.slice(start), before: 0, bounded: false, missing: false };
  }
  if (!extent.ends) {
    // The file stops short of this stream's end, at its size limit, so the
    // retained end lies past everything the file holds of the stream.
    return {
      text: retained,
      before: Math.max(0, extent.chars - retained.length - shown),
      bounded: true,
      missing: true,
    };
  }
  // The retained end is the last characters of the stream the file holds.
  const offset = extent.chars - retained.length;
  let start = Math.max(0, shown - offset);
  if (start > 0 && isLowSurrogate(retained.charCodeAt(start))) start++;
  const before = Math.max(0, offset - shown);
  return {
    text: retained.slice(start),
    before,
    bounded: !extent.complete,
    missing: before > 0,
  };
}

interface Gap {
  readonly chars: number;
  readonly bounded: boolean;
  /** Anything at all is left out. */
  readonly left: boolean;
}

function gapBefore(rest: AfterHead, tail: string): Gap {
  const chars = rest.before + rest.text.length - tail.length;
  return { chars, bounded: rest.bounded, left: chars > 0 || rest.missing };
}

/** A stream's head part, then its tail; a line between them when something was left out. */
function withGap(head: string, gap: Gap, tail: string): string {
  if (!gap.left) return `${head}${tail}`;
  return [head, `[... ${omittedCount(gap.chars, gap.bounded)} omitted ...]`, tail]
    .filter((part) => part !== '')
    .join('\n');
}

function omittedMarker(omitted: number, lowerBound: boolean): string {
  return `\n[... ${omittedCount(omitted, lowerBound)} omitted ...]\n`;
}

function omittedCount(omitted: number, lowerBound: boolean): string {
  return `${lowerBound ? 'more than ' : ''}${formatCount(omitted)} character${omitted === 1 && !lowerBound ? '' : 's'}`;
}

function savedResult(
  result: TerminalToolResult,
  output: PipeShellOutput,
  saved: SavedShellOutput,
): TerminalToolResult {
  const preview = saved.preview;
  const savedOutput: TerminalSavedOutput = {
    path: saved.path,
    chars: saved.chars,
    truncated: saved.truncated,
  };
  return {
    ...result,
    output: {
      ...output,
      stdout: preview.stdout,
      stderr: preview.stderr,
      stdoutTruncated:
        output.stdoutTruncated ||
        preview.stdout.length < trimTrailingNewlines(output.stdout).length,
      stderrTruncated:
        output.stderrTruncated ||
        preview.stderr.length < trimTrailingNewlines(output.stderr).length,
    },
    savedOutput,
  };
}

/** The text that stands for a saved output: where it is, then the start of it. */
export function savedOutputText(savedOutput: TerminalSavedOutput, preview: string): string {
  return `${savedOutputNotice(savedOutput)}\n\nPreview (first ${formatCount(preview.length)} characters):\n${preview}`;
}

/**
 * Where a saved output is, and whether the file holds all of it. One that
 * does not was cut at the size limit or lost a line too long to keep; either
 * way a line in the file marks the place.
 */
function savedOutputNotice(saved: TerminalSavedOutput): string {
  if (!saved.truncated) return savedToolResultNotice(saved);
  return `Output too long to show, and too long to save whole: ${saved.path} holds ${formatCount(saved.chars)} characters of it, and a line in the file marks where output was left out. Read it with Read or search it with Grep.`;
}

/**
 * Remove `[start, end)` of the joined text from the streams it falls in,
 * putting `marker` where the cut starts.
 */
function cutStreams(
  stdout: string,
  stderr: string,
  start: number,
  end: number,
  marker: string,
): { stdout: string; stderr: string } {
  const offset = stdout === '' ? 0 : stdout.length + 1;
  if (stdout !== '' && start <= stdout.length) {
    if (end <= stdout.length) {
      return { stdout: `${stdout.slice(0, start)}${marker}${stdout.slice(end)}`, stderr };
    }
    return {
      stdout: `${stdout.slice(0, start)}${marker}`,
      stderr: stderr.slice(Math.max(0, end - offset)),
    };
  }
  return {
    stdout,
    stderr: `${stderr.slice(0, start - offset)}${marker}${stderr.slice(end - offset)}`,
  };
}

/**
 * `value` without its trailing newlines. Scanned back from the end: `/\n+$/`
 * is tried again from every newline of a run that something follows, which
 * takes time in the square of the run's length.
 */
export function trimTrailingNewlines(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x0a) end--;
  return end === value.length ? value : value.slice(0, end);
}
