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

// Where a background command's output goes while it runs.
//
// The model reads it with Read, as an ordinary file: a task is something it
// started, not a kind of thing Read has to know about. The file carries what
// the command printed and, last, how it stands — `[running]` until it ends,
// then the line that says how it ended.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ShellRunRecord } from '@maka/core/shell-run';

/**
 * Both ids reach a path join, and one of them reaches a recursive delete, so
 * neither is taken on trust from the caller: a separator or a `..` here would
 * write or delete outside the root.
 */
const PATH_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/u;

function segment(value: string, what: string): string {
  if (!PATH_SEGMENT.test(value)) throw new Error(`Unsafe ${what} for a task output path`);
  return value;
}

/** One file per run, under a directory of its Session's own. */
export function shellRunOutputFilePath(
  root: string,
  sessionId: string,
  shellRunId: string,
): string {
  return join(root, segment(sessionId, 'Session id'), `${segment(shellRunId, 'task id')}.output`);
}

/** Everything the reader sees: the output, then the status, then a newline. */
export function shellRunOutputFileContent(record: ShellRunRecord): string {
  const output = record.output;
  const body =
    output.mode === 'pty'
      ? output.screen
      : [output.stdout, output.stderr]
          .map((part) => part.replace(/\n+$/u, ''))
          .filter((part) => part !== '')
          .join('\n');
  const trimmed = body.replace(/\n+$/u, '');
  const note = truncated(output)
    ? '\n[Output was truncated; only the tail is shown. Re-run narrowing the output to see more.]'
    : '';
  return `${trimmed === '' ? '' : `${trimmed}${note}\n`}\n${statusLine(record)}\n`;
}

/** A shortened tail read as a complete one is how a model stops looking. */
function truncated(output: ShellRunRecord['output']): boolean {
  return output.mode === 'pty'
    ? output.truncated === true
    : output.stdoutTruncated === true || output.stderrTruncated === true;
}

function statusLine(record: ShellRunRecord): string {
  switch (record.status) {
    case 'starting':
    case 'running':
      return '[running]';
    case 'completed':
    case 'failed':
      return record.exitCode === undefined
        ? `[ended: ${record.failureMessage ?? 'no exit code'}]`
        : `[exited with code ${record.exitCode}]`;
    case 'cancelled':
      return '[killed]';
    case 'timed_out':
      return record.timeoutMs === undefined
        ? '[timed out]'
        : `[timed out after ${record.timeoutMs}ms]`;
    case 'orphaned':
      return `[orphaned: ${record.failureMessage ?? 'the runtime lost the process'}]`;
    default:
      return '[running]';
  }
}

/**
 * One writer per file, and never a step backwards.
 *
 * Snapshots of a run are mirrored as they are persisted, and each write
 * truncates and rewrites the whole file. Left unordered, a slow early write
 * can land after the final one and leave a finished task reading `[running]`
 * for ever, which is worse than no file at all. Writes are therefore queued
 * per file, and one carrying an older revision than what is already on disk
 * is dropped rather than applied.
 */
const writers = new Map<string, { chain: Promise<void>; revision: number }>();
/**
 * The newest revision each file has been asked to hold.
 *
 * Kept apart from the queue above, which is emptied as soon as it drains: a
 * late write arriving after the queue emptied would otherwise find nothing to
 * compare itself against and overwrite a newer snapshot with an older one.
 */
const written = new Map<string, number>();

export function writeShellRunOutputFile(record: ShellRunRecord): Promise<void> {
  const path = record.outputFile;
  if (path === undefined) return Promise.resolve();
  const content = shellRunOutputFileContent(record);
  const revision = record.revision;
  const newest = written.get(path);
  const current = writers.get(path);
  if (newest !== undefined && newest > revision) return current?.chain ?? Promise.resolve();
  written.set(path, revision);
  const chain = (current?.chain ?? Promise.resolve()).then(async () => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  });
  writers.set(path, { chain, revision });
  // A failed write must not poison the queue for the writes after it.
  const settled = chain
    .catch(() => undefined)
    .then(() => {
      if (writers.get(path)?.chain === chain) writers.delete(path);
    });
  void settled;
  return chain;
}

/** Drop every task output of a Session, when the Session itself is retired. */
export async function purgeSessionShellRunOutputFiles(
  root: string,
  sessionId: string,
): Promise<void> {
  const directory = join(root, segment(sessionId, 'Session id'));
  // The revision each file was last asked to hold is remembered for the life
  // of the process; a retired Session's files are gone, so drop theirs with
  // them rather than growing that map for ever.
  const prefix = `${directory}/`;
  for (const path of [...written.keys()]) {
    if (path.startsWith(prefix)) written.delete(path);
  }
  await rm(directory, { recursive: true, force: true });
}
