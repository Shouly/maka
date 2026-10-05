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

// A foreground command's whole output, written to working files as it runs.
//
// The command's result keeps only a tail in memory, about 1 MiB a stream.
// When the output turns out too long to show, the model is given a file
// holding all of it, or, for a failure, the output's real start; so the
// output has to be on disk already: one working file per stream, each kept to
// the saved file's size limit. `save` writes the file the model reads, as the
// inline result would read: stdout, then stderr, redacted. The working files
// go either way.
//
// Redaction runs over whole lines, a block of them at a time, and keeps them
// where they were (`output-redaction.ts`): JSON is followed from one block to
// the next, so a secret in a JSON document is found wherever the document
// breaks. A text rule that reads across a line break (a value on the line
// after its key or header, a quoted value over several lines, a value
// continued with a backslash) is not cut by a block either: each block holds
// back its last lines, and the lines before them such a rule may still be
// reading, up to 64 KiB, and they are redacted with the next block; the last
// text of a stream, its last line with it, is redacted at once. So the file
// is redacted at least as that stream read whole would be, but for a quoted
// key spread over lines or a rule reaching further back than that.
//
// A working file that reaches its limit ends at its last whole line, and a
// line longer than SAVED_LINE_MAX_BYTES is left out with a marker in its
// place: a line split in two could carry the start of a secret in one half
// and its end in the other, and neither would be recognised.

import { createWriteStream, type WriteStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { trimTrailingNewlines } from './bash-output-limits.js';
import { heldBackStart, OutputRedactor } from './output-redaction.js';
import {
  makeToolResultRoot,
  sliceAtCharacter,
  sweepStaleWorkingFiles,
  TOOL_RESULT_FILE_MAX_BYTES,
  toolResultSaveTicket,
  toolResultWorkingFilePath,
  truncateUtf8,
  workingFileOptions,
  writeToolResultFile,
  type SavedToolResult,
} from './tool-result-file.js';

type Stream = 'stdout' | 'stderr';

/**
 * A line longer than this is left out of the saved output whole, never split.
 * A much longer one could take a single match of a redaction pattern past
 * what a regular expression can track, and fail the save.
 */
export const SAVED_LINE_MAX_BYTES = 4 * 1024 * 1024;
/**
 * How much of a working file is read at a time: no more than a line may hold,
 * so only a line that runs on from one read into the next can be too long.
 */
export const READ_BLOCK_BYTES = SAVED_LINE_MAX_BYTES;
const NEWLINE = 0x0a;

/** Stands where a line longer than {@link SAVED_LINE_MAX_BYTES} was left out. */
export const LONG_LINE_MARKER = `[a single line longer than ${formatSize(SAVED_LINE_MAX_BYTES)} was omitted for safety]`;

/** Ends a saved output that reached the size limit. */
export function savedOutputCutMarker(maxBytes: number): string {
  return `[... the output goes on; only its first ${formatSize(maxBytes)} are saved ...]`;
}

interface WorkingFile {
  readonly path: string;
  writer: WriteStream | undefined;
  /** This run created the file; only then is it removed. */
  opened: boolean;
  /** Bytes written to the working file. */
  written: number;
  /** Bytes up to the end of the last whole line written. */
  wholeLines: number;
  /** The stream reached the size limit: only its first `wholeLines` bytes count. */
  cut: boolean;
}

/** The first characters of a saved output, split back into the streams they came from. */
export interface SavedOutputPreview {
  readonly stdout: string;
  readonly stderr: string;
}

export interface SavedShellOutput extends SavedToolResult {
  /**
   * The saved file's first characters: `stdout`, then a newline and `stderr`
   * when both are non-empty, is exactly how the file starts.
   */
  readonly preview: SavedOutputPreview;
}

/** How much of one stream the saved file would hold. */
export interface SavedStreamExtent {
  /** Its characters in the file, not counting the marker that ends a stream cut at the size limit. */
  readonly chars: number;
  /** The file reaches the stream's end: it was not cut at the size limit in or before the stream. */
  readonly ends: boolean;
  /** The file reaches the stream's end and no line of it was left out: `chars` is exact. */
  readonly complete: boolean;
}

/** The start of the whole output, read for a failure whose retained tail lost it. */
export interface ShellOutputHead extends SavedOutputPreview {
  readonly streams: Readonly<Record<Stream, SavedStreamExtent>>;
}

interface RenderOutcome {
  /** The stream the size limit cut, after which nothing is rendered. */
  readonly cut: Stream | undefined;
  /** Streams a line was left out of for its length. */
  readonly dropped: Readonly<Record<Stream, boolean>>;
}

interface Piece {
  readonly stream: Stream;
  readonly text: string;
  /** The newline between the stdout and stderr parts. */
  readonly separator?: true;
}

export class ShellOutputSpool {
  private readonly files: Record<Stream, WorkingFile>;
  /** Taken when the run starts: a save is refused once the Session is purged after it. */
  private readonly ticket = toolResultSaveTicket();
  private failed = false;
  private closed: Promise<void> | undefined;
  /** Chunks handed to a working file that it has not finished writing. */
  private pendingWrites = 0;
  private readonly onWritten: Array<() => void> = [];

  private constructor(
    root: string,
    name: string,
    private readonly maxFileBytes: number,
  ) {
    const file = (stream: Stream): WorkingFile => ({
      path: toolResultWorkingFilePath(root, name, stream),
      writer: undefined,
      opened: false,
      written: 0,
      wholeLines: 0,
      cut: false,
    });
    this.files = { stdout: file('stdout'), stderr: file('stderr') };
  }

  /** A spool writing its working files under `root`, which is made if it is missing. */
  static async open(
    root: string,
    name: string,
    maxFileBytes = TOOL_RESULT_FILE_MAX_BYTES,
  ): Promise<ShellOutputSpool> {
    const spool = new ShellOutputSpool(root, name, maxFileBytes);
    await makeToolResultRoot(root);
    void sweepStaleWorkingFiles(root);
    return spool;
  }

  /** Take one chunk of what the command printed. */
  accept(stream: Stream, chunk: string): void {
    const file = this.files[stream];
    if (!chunk || this.failed || this.closed || file.cut) return;
    let kept = chunk;
    let bytes = Buffer.byteLength(chunk, 'utf8');
    if (file.written + bytes > this.maxFileBytes) {
      // The file ends at the last whole line that fits; the line in progress
      // is left out (see the note at the top).
      const fits = truncateUtf8(chunk, this.maxFileBytes - file.written);
      kept = fits.slice(0, fits.lastIndexOf('\n') + 1);
      bytes = Buffer.byteLength(kept, 'utf8');
      file.cut = true;
    }
    if (bytes === 0) return;
    if (!file.writer) {
      file.writer = createWriteStream(file.path, workingFileOptions());
      file.writer.once('open', () => {
        file.opened = true;
      });
      // A working file that cannot be written only costs the saved copy.
      file.writer.on('error', () => {
        this.failed = true;
      });
    }
    this.pendingWrites++;
    file.writer.write(kept, 'utf8', () => {
      if (--this.pendingWrites > 0) return;
      for (const resolve of this.onWritten.splice(0)) resolve();
    });
    const lastNewline = kept.lastIndexOf('\n');
    file.written += bytes;
    if (lastNewline !== -1) {
      file.wholeLines = file.written - Buffer.byteLength(kept.slice(lastNewline + 1), 'utf8');
    }
  }

  /** Settles once every chunk taken so far is in its working file, or failed to get there. */
  written(): Promise<void> {
    if (this.pendingWrites === 0) return Promise.resolve();
    return new Promise((resolve) => this.onWritten.push(resolve));
  }

  /**
   * Write the file the model reads to `path`: stdout then stderr, trailing
   * newlines dropped and one newline between them, redacted, cut at the size
   * limit. Its preview is its first `previewChars` characters or fewer, never
   * half a character. Undefined when the output could not be kept or saved.
   */
  async save(path: string, previewChars: number): Promise<SavedShellOutput | undefined> {
    try {
      await this.close();
      if (this.failed) return undefined;
      return await writeToolResultFile(
        path,
        async (handle) => {
          const preview = new PreviewCollector(previewChars);
          const cutMarker = savedOutputCutMarker(this.maxFileBytes);
          let written = 0;
          let chars = 0;
          let truncated = false;
          const outcome = await this.render(async (piece) => {
            let text = piece.text;
            const room = this.maxFileBytes - written;
            if (text.length * 3 > room && Buffer.byteLength(text, 'utf8') > room) {
              // Past the limit the file ends, at a whole character. This text
              // is redacted already, so the cut cannot expose a secret.
              const markerBytes = Buffer.byteLength(cutMarker, 'utf8') + 1;
              text = `${truncateUtf8(text, Math.max(0, room - markerBytes))}\n${cutMarker}`;
              truncated = true;
            }
            preview.add({ ...piece, text });
            const bytes = Buffer.from(text, 'utf8');
            await handle.write(bytes);
            written += bytes.length;
            chars += text.length;
            return !truncated;
          });
          return {
            path,
            chars,
            // A line left out for its length is output the file does not hold, as a cut is.
            truncated:
              truncated ||
              outcome.cut !== undefined ||
              outcome.dropped.stdout ||
              outcome.dropped.stderr,
            preview: preview.result(),
          };
        },
        this.ticket,
      );
    } catch {
      return undefined;
    } finally {
      await this.discard();
    }
  }

  /**
   * The first `maxChars` characters of the output as {@link save} would write
   * them, and how much of each stream that file would hold. Reads every
   * working file, as a save does; undefined when the output could not be kept.
   */
  async head(maxChars: number): Promise<ShellOutputHead | undefined> {
    try {
      await this.close();
      if (this.failed) return undefined;
      const preview = new PreviewCollector(maxChars);
      const chars: Record<Stream, number> = { stdout: 0, stderr: 0 };
      const outcome = await this.render((piece) => {
        preview.add(piece);
        if (!piece.separator) chars[piece.stream] += piece.text.length;
        return true;
      });
      if (outcome.cut) chars[outcome.cut] -= savedOutputCutMarker(this.maxFileBytes).length;
      const extent = (stream: Stream): SavedStreamExtent => {
        const ends = outcome.cut === undefined || (outcome.cut === 'stderr' && stream === 'stdout');
        return { chars: chars[stream], ends, complete: ends && !outcome.dropped[stream] };
      };
      return {
        ...preview.result(),
        streams: { stdout: extent('stdout'), stderr: extent('stderr') },
      };
    } catch {
      return undefined;
    }
  }

  /** Remove the working files. */
  async discard(): Promise<void> {
    await this.close();
    await Promise.all(
      Object.values(this.files).map((file) =>
        file.opened ? rm(file.path, { force: true }).catch(() => undefined) : undefined,
      ),
    );
  }

  /**
   * Hand `visit` the saved text in order: stdout, then stderr, each without
   * its trailing newlines, one newline between them. A stream that reached the
   * size limit ends with a marker, and nothing after it is rendered.
   */
  private async render(
    visit: (piece: Piece) => Promise<boolean> | boolean,
  ): Promise<RenderOutcome> {
    const dropped: Record<Stream, boolean> = { stdout: false, stderr: false };
    let separate = false;
    for (const stream of ['stdout', 'stderr'] as const) {
      const file = this.files[stream];
      let started = false;
      let held = '';
      const emit = async (block: string): Promise<boolean> => {
        // Trailing newlines wait until something follows them; a stream's
        // last ones are dropped, as the inline result drops them.
        const body = trimTrailingNewlines(block);
        if (body === '') {
          held += block;
          return true;
        }
        const text = `${held}${body}`;
        held = block.slice(body.length);
        if (!started) {
          started = true;
          if (separate && !(await visit({ stream, text: '\n', separator: true }))) return false;
        }
        return visit({ stream, text });
      };
      const length = file.cut ? file.wholeLines : file.written;
      if (length > 0) {
        const read = await forEachRedactedBlock(file.path, length, emit);
        dropped[stream] = read.dropped;
        if (!read.ended) return { cut: file.cut ? stream : undefined, dropped };
      }
      if (file.cut) {
        await emit(savedOutputCutMarker(this.maxFileBytes));
        return { cut: stream, dropped };
      }
      if (started) separate = true;
    }
    return { cut: undefined, dropped };
  }

  private close(): Promise<void> {
    this.closed ??= Promise.all(
      Object.values(this.files).map(
        (file) =>
          new Promise<void>((resolve) => {
            if (!file.writer || file.writer.destroyed) return resolve();
            file.writer.once('error', () => resolve());
            file.writer.end(() => resolve());
          }),
      ),
    ).then(() => undefined);
    return this.closed;
  }
}

/** The first characters of the saved text, kept by stream. */
class PreviewCollector {
  private stdout = '';
  private stderr = '';
  private separated = false;
  private taken = 0;

  constructor(private readonly maxChars: number) {}

  add(piece: Piece): void {
    if (this.taken >= this.maxChars) return;
    const text = piece.text.slice(0, this.maxChars - this.taken);
    this.taken += text.length;
    if (piece.separator) this.separated = true;
    else this[piece.stream] += text;
  }

  /**
   * What was kept, ending on a whole character. A separator with nothing
   * after it is not part of it: the preview then ends with stdout.
   */
  result(): SavedOutputPreview {
    if (this.separated && this.stderr !== '') {
      return { stdout: this.stdout, stderr: sliceAtCharacter(this.stderr, this.stderr.length) };
    }
    if (this.stdout !== '') {
      return { stdout: sliceAtCharacter(this.stdout, this.stdout.length), stderr: '' };
    }
    return { stdout: '', stderr: sliceAtCharacter(this.stderr, this.stderr.length) };
  }
}

/**
 * Hand the first `length` bytes of `path` to `visit` as redacted blocks of
 * whole lines, a line longer than {@link SAVED_LINE_MAX_BYTES} replaced by
 * {@link LONG_LINE_MARKER}. Stops when `visit` answers false.
 */
async function forEachRedactedBlock(
  path: string,
  length: number,
  visit: (text: string) => Promise<boolean>,
): Promise<{ ended: boolean; dropped: boolean }> {
  const handle = await open(path, 'r');
  // One stream is one text: a JSON document is followed from block to block.
  const redactor = new OutputRedactor();
  let dropped = false;
  // Whole lines read and not yet redacted: a text rule may read on from them
  // into the next block.
  let heldBack = '';
  const redactHeldBack = async (more = ''): Promise<boolean> => {
    const text = heldBack + more;
    heldBack = '';
    return text === '' || visit(redactor.redact(text));
  };
  const leaveOut = async (): Promise<boolean> => {
    dropped = true;
    if (!(await redactHeldBack())) return false;
    redactor.interrupt();
    return visit(LONG_LINE_MARKER);
  };
  try {
    const buffer = Buffer.alloc(READ_BLOCK_BYTES);
    // The start of a line no read has ended yet, and its size.
    let line: Buffer[] = [];
    let lineBytes = 0;
    // Inside a line too long to keep: everything up to its newline goes.
    let skipping = false;
    let position = 0;
    while (position < length) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, length - position),
        position,
      );
      if (bytesRead === 0) break;
      position += bytesRead;
      let data = buffer.subarray(0, bytesRead);
      const firstNewline = data.indexOf(NEWLINE);
      if (firstNewline === -1) {
        if (skipping) continue;
        if (lineBytes + data.length > SAVED_LINE_MAX_BYTES) {
          line = [];
          lineBytes = 0;
          skipping = true;
          continue;
        }
        line.push(Buffer.from(data));
        lineBytes += data.length;
        continue;
      }
      if (skipping || lineBytes + firstNewline > SAVED_LINE_MAX_BYTES) {
        // The long line ends here. The marker takes its place; its newline stays.
        line = [];
        lineBytes = 0;
        skipping = false;
        if (!(await leaveOut())) return { ended: false, dropped };
        data = data.subarray(firstNewline);
      }
      const end = data.lastIndexOf(NEWLINE) + 1;
      const whole = data.subarray(0, end);
      const text = `${heldBack}${(line.length > 0 ? Buffer.concat([...line, whole]) : whole).toString('utf8')}`;
      line = end < data.length ? [Buffer.from(data.subarray(end))] : [];
      lineBytes = data.length - end;
      const cut = heldBackStart(text);
      heldBack = text.slice(cut);
      if (cut > 0 && !(await visit(redactor.redact(text.slice(0, cut))))) {
        return { ended: false, dropped };
      }
    }
    if (skipping) {
      if (!(await leaveOut())) return { ended: false, dropped };
    } else if (!(await redactHeldBack(Buffer.concat(line).toString('utf8')))) {
      // The last text is redacted at once, its last line with the lines before it.
      return { ended: false, dropped };
    }
    return { ended: true, dropped };
  } finally {
    await handle.close();
  }
}

/** `16 MiB`, `64 KiB`, or bytes below that. */
function formatSize(bytes: number): string {
  for (const [unit, size] of [
    ['GiB', 1024 ** 3],
    ['MiB', 1024 ** 2],
    ['KiB', 1024],
  ] as const) {
    if (bytes >= size && bytes % size === 0) return `${bytes / size} ${unit}`;
  }
  return `${bytes} bytes`;
}
