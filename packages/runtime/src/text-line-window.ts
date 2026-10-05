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

// The lines a Read returns, counted the way the Read tool numbers them: a
// file is its text split on '\n', so a file that ends in a newline has an
// empty last line, and a CRLF file keeps its '\r' here for the caller to drop
// when it prints. `offset` is the number of the first line shown — 0 reads as
// 1 — and a missing or zero `limit` runs to the end.
//
// One Read returns at most READ_MAX_TOKENS, measured as the model gets it:
// every line with its number and a tab in front, and, on a first page, the
// notice that ends it. A whole-file read past that returns the lines that
// fit, and the Read tool marks it a partial view; a read that names its range
// and still passes it is refused.
//
// Only a regular file is read. A device, a pipe or a socket may never end,
// and opening a pipe waits for a writer, so each is refused before it is read.

import { constants, type Stats } from 'node:fs';
import { type FileHandle, open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { estimateTokens } from './context-budget-helpers.js';
import { isNotebookPath } from './notebook.js';

/** The most one Read may return, in estimated tokens (UTF-8 bytes / 4). */
export const READ_MAX_TOKENS = 25_000;

/**
 * A notebook is shown whole, as its cells, so it has no first page to stop
 * at: one larger than this is refused.
 */
export const NOTEBOOK_READ_MAX_BYTES = 256 * 1024;

const READ_CHUNK_BYTES = 64 * 1024;
/**
 * How far past the lines it shows a read goes on counting the file's lines.
 * Past it the count stops, and the file is said to have more lines than it
 * counted.
 */
export const LINE_COUNT_MAX_BYTES = 64 * 1024 * 1024;
const NEWLINE = 0x0a;
const READ_MAX_BYTES = READ_MAX_TOKENS * 4;
/**
 * The most a first page's notice can take, with the blank line before it. Its
 * numbers never run to 16 digits: a page holds at most 50,000 lines, and a
 * count stops within 64 MiB of it. What they leave over makes room for "more
 * than " too.
 */
const PARTIAL_NOTICE_MAX_BYTES = Buffer.byteLength(
  `\n\n${partialViewNotice(1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)}`,
  'utf8',
);
/** Opened so that a pipe swapped in after the check cannot make the open wait. */
const OPEN_WITHOUT_WAITING = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);

export interface TextLineWindow {
  /** The lines shown, joined with '\n', exactly as they are in the file. */
  readonly content: string;
  /** Number of the first line shown, from 1. */
  readonly startLine: number;
  /** Lines in the file; 0 for an empty file. */
  readonly totalLines: number;
  /** `offset` named a line past the end, so nothing is shown. */
  readonly beyondEnd: boolean;
}

export function readTextLineWindowFacts(
  content: string,
  offset?: number,
  limit?: number,
): TextLineWindow {
  if (content === '') return { content: '', startLine: 1, totalLines: 0, beyondEnd: false };
  let totalLines = 1;
  for (let at = content.indexOf('\n'); at !== -1; at = content.indexOf('\n', at + 1)) {
    totalLines++;
  }
  const startLine = Math.max(1, Math.trunc(offset ?? 1) || 1);
  if (startLine > totalLines) return { content: '', startLine, totalLines, beyondEnd: true };
  const count = limit && limit > 0 ? Math.trunc(limit) : totalLines;
  const endLine = Math.min(totalLines, startLine + count - 1);
  if (startLine === 1 && endLine === totalLines) {
    return { content, startLine, totalLines, beyondEnd: false };
  }
  let from = 0;
  for (let line = 1; line < startLine; line++) from = content.indexOf('\n', from) + 1;
  let to = from;
  for (let line = startLine; line <= endLine; line++) {
    const newline = content.indexOf('\n', to);
    to = newline === -1 ? content.length : newline + 1;
  }
  // The window's last newline ends its last line; it is not part of the text.
  const text = content.slice(from, to);
  return {
    content: endLine < totalLines && text.endsWith('\n') ? text.slice(0, -1) : text,
    startLine,
    totalLines,
    beyondEnd: false,
  };
}

/** A read refused; the message is the model's answer. */
export class ReadRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReadRefusedError';
  }
}

/** A read refused for its size. */
export class ReadLimitError extends ReadRefusedError {
  constructor(message: string) {
    super(message);
    this.name = 'ReadLimitError';
  }
}

export interface FileLineWindow extends TextLineWindow {
  /** A whole-file read stopped at the token limit: only the first lines are here. */
  readonly partial: boolean;
  /**
   * The count stopped {@link LINE_COUNT_MAX_BYTES} past the lines shown: the
   * file has more lines than `totalLines`.
   */
  readonly moreLines?: true;
}

/**
 * What a first page says about itself: how much it is, and how to read on.
 * `moreLines` when the file has more than `totalLines` lines.
 */
export function partialViewNotice(
  firstLine: number,
  lastLine: number,
  totalLines: number,
  moreLines = false,
): string {
  return `PARTIAL view: lines ${firstLine}-${lastLine} of ${moreLines ? 'more than ' : ''}${totalLines} are shown, because the whole file exceeds the maximum of ${READ_MAX_TOKENS} tokens one Read can return. Read the rest with offset and limit, starting at offset ${lastLine + 1}.`;
}

/**
 * `path`'s lines as {@link readTextLineWindowFacts} counts them, read without
 * holding more of the file than the answer.
 *
 * A whole-file read (no `limit`, from the first line) larger than
 * {@link READ_MAX_TOKENS} answers with as many whole lines as fit with the
 * notice that ends a first page, marked partial; its first line is kept even
 * when only it and not the notice fits. A read that names its range stops at
 * the first line that passes the limit and throws, without reading the rest
 * of the range. What is measured is what the model is shown: each line's
 * number and tab, and its text, where bytes that are not UTF-8 come back as
 * U+FFFD, three bytes each.
 *
 * Past the lines shown the file is only counted, for its total, and no
 * further than {@link LINE_COUNT_MAX_BYTES}: past that the answer says the
 * file has more lines (`moreLines`) than the ones it ended. `signal` stops the
 * read between chunks.
 */
export async function readFileLineWindow(
  path: string,
  offset?: number,
  limit?: number,
  signal?: AbortSignal,
): Promise<FileLineWindow> {
  const whole = !limit && (offset ?? 1) <= 1;
  const handle = await openRegularFile(path);
  try {
    if (isNotebookPath(path)) return await readNotebookText(handle, whole, offset, limit);
    return await readLineWindow(handle, whole, offset, limit, signal);
  } finally {
    await handle.close();
  }
}

async function readLineWindow(
  handle: FileHandle,
  whole: boolean,
  offset: number | undefined,
  limit: number | undefined,
  signal: AbortSignal | undefined,
): Promise<FileLineWindow> {
  const startLine = Math.max(1, Math.trunc(offset ?? 1) || 1);
  const lastLine =
    limit && limit > 0 ? startLine + Math.trunc(limit) - 1 : Number.POSITIVE_INFINITY;
  const shown: string[] = [];
  // UTF-8 bytes of the shown lines as the model gets them: each one's number
  // and tab and text, and the newlines between them.
  let shownBytes = 0;
  // How many of the shown lines fit with a first page's notice after them.
  let fitWithNotice = 0;
  // The line being read, decoded, and its UTF-8 bytes.
  let text = '';
  let textBytes = 0;
  let decoder = new StringDecoder('utf8');
  let line = 1;
  let empty = true;
  let stopped = false;
  let collecting = startLine === 1;
  // What the shown lines take with the line being read after them, even an empty one.
  const withLine = () => shownBytes + (shown.length > 0 ? 1 : 0) + numberBytes(line) + textBytes;
  const add = (decoded: string) => {
    if (decoded !== '') {
      text += decoded;
      textBytes += Buffer.byteLength(decoded, 'utf8');
    }
    if (estimateTokens(withLine()) <= READ_MAX_TOKENS) return;
    if (whole && shown.length > 0) {
      // The first page ends at the last whole line that fits; the rest of
      // the file is only counted.
      collecting = false;
      stopped = true;
      text = '';
      textBytes = 0;
      decoder = new StringDecoder('utf8');
    } else {
      throw new ReadLimitError(readRangeTooLargeMessage(startLine, shown.length, limit));
    }
  };
  const endLine = () => {
    // A character the line left unfinished decodes to U+FFFD here. Every
    // line is measured here, the empty ones too.
    add(decoder.end());
    if (!collecting) return;
    shownBytes = withLine();
    shown.push(text);
    if (shownBytes + PARTIAL_NOTICE_MAX_BYTES <= READ_MAX_BYTES) fitWithNotice = shown.length;
    text = '';
    textBytes = 0;
  };
  const buffer = Buffer.alloc(READ_CHUNK_BYTES);
  // Bytes read, and where the lines shown were behind: from there the file is only counted.
  let position = 0;
  let countFrom: number | undefined;
  let moreLines = false;
  for (;;) {
    signal?.throwIfAborted();
    if (countFrom !== undefined && position - countFrom >= LINE_COUNT_MAX_BYTES) {
      moreLines = true;
      break;
    }
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) break;
    empty = false;
    const chunk = buffer.subarray(0, bytesRead);
    let at = 0;
    while (at < chunk.length) {
      const newline = chunk.indexOf(NEWLINE, at);
      const end = newline === -1 ? chunk.length : newline;
      if (collecting) add(decoder.write(chunk.subarray(at, end)));
      if (newline === -1) break;
      if (collecting) endLine();
      line++;
      collecting = !stopped && line >= startLine && line <= lastLine;
      at = newline + 1;
    }
    position += bytesRead;
    if (countFrom === undefined && (stopped || line > lastLine)) countFrom = position;
  }
  if (empty) return { content: '', startLine: 1, totalLines: 0, beyondEnd: false, partial: false };
  if (collecting) endLine();
  if (startLine > line) {
    return { content: '', startLine, totalLines: line, beyondEnd: true, partial: false };
  }
  // A first page makes room for its notice.
  if (stopped) shown.length = Math.max(1, fitWithNotice);
  return {
    content: shown.join('\n'),
    startLine,
    // A count that stopped is of the lines it saw end; the one it was in is more.
    totalLines: moreLines ? line - 1 : line,
    beyondEnd: false,
    partial: stopped,
    ...(moreLines ? { moreLines: true as const } : {}),
  };
}

/**
 * `path` opened for reading, or a refusal when it is not a regular file:
 * looked at before it is opened, and again once it is.
 */
async function openRegularFile(path: string): Promise<FileHandle> {
  refuseUnlessRegularFile(path, await stat(path));
  const handle = await open(path, OPEN_WITHOUT_WAITING);
  try {
    refuseUnlessRegularFile(path, await handle.stat());
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function refuseUnlessRegularFile(path: string, info: Stats): void {
  if (info.isFile()) return;
  if (info.isDirectory()) {
    // The words the callers use for a directory, and the code.
    throw Object.assign(new Error(`EISDIR: illegal operation on a directory, read '${path}'`), {
      code: 'EISDIR',
    });
  }
  throw new ReadRefusedError(notRegularFileMessage(path, info));
}

/** A path Read refuses for what it is: a device, a pipe or a socket. */
function notRegularFileMessage(path: string, info: Stats): string {
  const kind = info.isCharacterDevice()
    ? 'a character device'
    : info.isBlockDevice()
      ? 'a block device'
      : info.isFIFO()
        ? 'a named pipe'
        : info.isSocket()
          ? 'a socket'
          : undefined;
  return `Read cannot read '${path}': it is ${kind ? `${kind}, ` : ''}not a regular file. Read reads only regular files; to read from it, use Bash with a command that stops on its own (for example head -c).`;
}

/** A notebook is read whole and refused past {@link NOTEBOOK_READ_MAX_BYTES}. */
async function readNotebookText(
  handle: FileHandle,
  whole: boolean,
  offset: number | undefined,
  limit: number | undefined,
): Promise<FileLineWindow> {
  if (whole) {
    // The whole file is the answer, so its size decides before it is read.
    const size = (await handle.stat()).size;
    if (size > NOTEBOOK_READ_MAX_BYTES) throw new ReadLimitError(notebookTooLargeMessage(size));
  }
  const window = readTextLineWindowFacts(await handle.readFile('utf8'), offset, limit);
  const bytes = Buffer.byteLength(window.content, 'utf8');
  if (bytes > NOTEBOOK_READ_MAX_BYTES) throw new ReadLimitError(notebookTooLargeMessage(bytes));
  return { ...window, partial: false };
}

/**
 * A read that names its range and passes the token limit. When not even its
 * first line fits, no range starting there can help; when some lines fit, a
 * limit that stops before the next one does, unless that line alone is too
 * large.
 */
export function readRangeTooLargeMessage(
  startLine: number,
  linesThatFit: number,
  limit: number | undefined,
): string {
  const maximum = `the maximum of ${READ_MAX_TOKENS} tokens one Read can return`;
  if (linesThatFit === 0) {
    return `Line ${startLine} alone exceeds ${maximum}. Search for specific content with Grep instead.`;
  }
  const lines = `${linesThatFit} line${linesThatFit === 1 ? '' : 's'}`;
  const requested = limit
    ? 'The requested lines exceed'
    : `The lines from line ${startLine} to the end of the file exceed`;
  return `${requested} ${maximum}; only ${lines} from line ${startLine} fit. Read them with a limit of ${linesThatFit}. If line ${startLine + linesThatFit} alone exceeds the maximum, search for specific content with Grep instead.`;
}

/**
 * A notebook too large to show. Read shows a notebook whole, as its cells,
 * and takes no range for one, so the way on is another tool.
 */
export function notebookTooLargeMessage(bytes: number): string {
  return `Notebook content (${formatFileSize(bytes)}) exceeds the maximum size Read can show (${formatFileSize(NOTEBOOK_READ_MAX_BYTES)}), and a notebook is only read whole. Search its cells with Grep, or read part of it with Bash, for example \`jq '.cells[0:20]' notebook.ipynb\` for the first 20 cells or \`jq '.cells | length'\` to count them.`;
}

/** The number and tab Read puts in front of line `line`, in bytes. */
function numberBytes(line: number): number {
  return String(line).length + 1;
}

/** `517.2KB`, `256KB`, `1.5MB` — one decimal, a trailing `.0` dropped. */
export function formatFileSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes} bytes`;
  const fixed = (value: number) => value.toFixed(1).replace(/\.0$/, '');
  if (kb < 1024) return `${fixed(kb)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${fixed(mb)}MB`;
  return `${fixed(mb / 1024)}GB`;
}
