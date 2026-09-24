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

import { relative, sep } from 'node:path';
import { countDiffLineStats } from '@maka/core/unified-diff';
import { TOOL_NAMES } from '@maka/core/tool-names';
import type { GrepOutputMode } from './filesystem-worker/protocol.js';
import type { ToolResultOutput } from './model-protocol.js';
import { isPathInside } from './path-containment.js';
import { isShellRunResult, shellRunResultText } from './shell-run-model-output.js';
import { toolResultOutput } from './tool-result-output.js';

/**
 * A write tool has just shown the model the file's new state, so a Read of the
 * same file right after is a call that can only confirm what the model already
 * knows. Saying so once, on the result, is cheaper than the call it prevents.
 */
const STATE_IS_CURRENT_NOTE = ' (file state is current in your context — no need to Read it back)';

/**
 * What the model is owed for a Read: the file's lines, numbered the way `cat -n`
 * numbers them.
 *
 * The numbers are not decoration. Every later Edit has to name text the model
 * can only have got from a Read, and a numbered transcript is what lets it say
 * *where* — to itself while reasoning, and to a person reading the transcript.
 * They are also what makes a windowed read legible: the first line of a read
 * that started at `offset: 200` is numbered 200.
 *
 * The file is its text split on '\n', so a file that ends in a newline shows
 * a numbered empty last line, and a CRLF file's '\r' is not shown.
 *
 * The durable result keeps the raw content, because the UI renders the file and
 * not a listing of it; this is the model's view of the same bytes.
 */
const READ_EMPTY_FILE_NOTE =
  '<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>';

/** Same range, same file, same turn: the earlier result already says it. */
export const READ_UNCHANGED_NOTE =
  'Wasted call — file unchanged since your last Read. Refer to that earlier tool_result instead.';

/**
 * Whether a tool result is that pointer, in any of the shapes a result takes
 * on its way to the model. The pruner must never take it for a newer read of
 * the file: the result it points at would be archived, and the pointer would
 * point at nothing.
 */
export function isReadUnchangedResult(value: unknown): boolean {
  if (value === READ_UNCHANGED_NOTE) return true;
  if (!value || typeof value !== 'object') return false;
  const record = value as { unchanged?: unknown; text?: unknown; value?: unknown };
  return (
    record.unchanged === true ||
    record.text === READ_UNCHANGED_NOTE ||
    record.value === READ_UNCHANGED_NOTE
  );
}

export function readToolResultToModelOutput(
  _input: unknown,
  output: unknown,
): ToolResultOutput | undefined {
  // A Read on a background-task ref answers with that task's output and status.
  if (isShellRunResult(output)) return { type: 'text', value: shellRunResultText(output) };
  if (isRecord(output) && output.unchanged === true) {
    return { type: 'text', value: READ_UNCHANGED_NOTE };
  }
  if (isRecord(output) && output.notebook === true && typeof output.content === 'string') {
    return { type: 'text', value: output.content };
  }
  const result = readResult(output);
  // Images, runtime resources and attachments answer in their own shapes; they
  // have no lines to number, so they keep the default projection.
  if (result === undefined) return undefined;
  if (result.totalLines === 0) return { type: 'text', value: READ_EMPTY_FILE_NOTE };
  if (result.beyondEnd) {
    return {
      type: 'text',
      value: `<system-reminder>Warning: the file exists but is shorter than the provided offset (${result.startLine}). The file has ${result.totalLines} lines.</system-reminder>`,
    };
  }
  return { type: 'text', value: numberFileLines(result.content, result.startLine) };
}

function readResult(
  output: unknown,
): { content: string; startLine: number; totalLines: number; beyondEnd: boolean } | undefined {
  if (!isRecord(output)) return undefined;
  const keys = Object.keys(output);
  if (!keys.includes('content') || keys.some((key) => !READ_RESULT_KEYS.has(key))) {
    return undefined;
  }
  const { content, startLine, totalLines, beyondEnd } = output;
  if (typeof content !== 'string') return undefined;
  return {
    content,
    startLine: typeof startLine === 'number' && startLine >= 1 ? startLine : 1,
    // A result without the count is whole-file text; count it the same way.
    totalLines: typeof totalLines === 'number' ? totalLines : content === '' ? 0 : 1,
    beyondEnd: beyondEnd === true,
  };
}

const READ_RESULT_KEYS = new Set(['content', 'startLine', 'totalLines', 'beyondEnd']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** A file's lines as `<number>\t<line>`, the first numbered `startLine`. */
function numberFileLines(content: string, startLine: number): string {
  const lines = content.split('\n');
  let numbered = '';
  for (let index = 0; index < lines.length; index++) {
    if (index > 0) numbered += '\n';
    const line = lines[index]!;
    numbered += `${startLine + index}\t${line.endsWith('\r') ? line.slice(0, -1) : line}`;
  }
  return numbered;
}

/**
 * A background command's output as `cat -n` numbers it: a final newline ends
 * the last line rather than starting an empty one. File reads are numbered by
 * `numberFileLines`, which counts that empty line the way Read does.
 */
export function numberReadLines(content: string, offset: number): string {
  const body = content.endsWith('\n') ? content.slice(0, -1) : content;
  const lines = body.split('\n');
  let numbered = '';
  for (let index = 0; index < lines.length; index++) {
    if (index > 0) numbered += '\n';
    numbered += `${offset + index + 1}\t${lines[index]}`;
  }
  return numbered;
}

/**
 * The diff is for the reader; the model is owed only what happened — a bounded
 * one-line summary. Editing is the hottest tool in the loop, so anything
 * attached to its output compounds across a turn; the full diff stays in the
 * durable result where the UI renders it.
 */
export function fileWriteToolResultToModelOutput(
  toolName: FileWriteToolName,
  output: unknown,
  input?: unknown,
): ToolResultOutput {
  const summary = fileWriteToolResultSummary(toolName, output, editReplacedAll(input));
  return summary !== undefined ? { type: 'text', value: summary } : toolResultOutput(output, false);
}

/**
 * Replay counterpart of `fileWriteToolResultToModelOutput`. The durable ledger
 * keeps the full diff for the UI, and every model re-read of history — prior
 * turns, compaction, resume — flows through the replay plan. Without this
 * projection the model saw a one-line summary live but the full diff JSON on
 * every later turn, which is both a token leak and a shape inconsistency.
 * Same precedent as `projectBashToolResultForModel`.
 */
export function projectFileWriteToolResultForModel(toolName: string, output: unknown): unknown {
  if (!isFileWriteToolName(toolName)) return output;
  return fileWriteToolResultSummary(toolName, output) ?? output;
}

type FileWriteToolName = typeof TOOL_NAMES.write | typeof TOOL_NAMES.edit;

function isFileWriteToolName(name: string): name is FileWriteToolName {
  return name === TOOL_NAMES.write || name === TOOL_NAMES.edit;
}

/** `replace_all: true` on the Edit call, so the receipt can say every occurrence went. */
function editReplacedAll(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { replace_all?: unknown }).replace_all === true
  );
}

function writeReceipt(path: string, created: boolean | undefined): string {
  return created
    ? `File created successfully at: ${path}${STATE_IS_CURRENT_NOTE}`
    : `The file ${path} has been updated successfully.${STATE_IS_CURRENT_NOTE}`;
}

/**
 * An Edit that landed in a file changed on disk since the session read it:
 * the replacement is right, the text around it may not be what the model
 * remembers.
 */
const MODIFIED_SINCE_READ_NOTE =
  ' (note: the file had been modified on disk since you last read it — the edit applied cleanly, but the file contains other changes not in your context. Read it before edits that depend on surrounding content.)';

function editReceipt(path: string, replacedAll: boolean, modifiedSinceRead = false): string {
  const tail = modifiedSinceRead ? MODIFIED_SINCE_READ_NOTE : STATE_IS_CURRENT_NOTE;
  return replacedAll
    ? `The file ${path} has been updated. All occurrences were successfully replaced.${tail}`
    : `The file ${path} has been updated successfully.${tail}`;
}

function fileWriteToolResultSummary(
  toolName: FileWriteToolName,
  output: unknown,
  replacedAll = false,
): string | undefined {
  if (isFileDiff(output)) {
    const path = output.shownPath ?? output.paths[0] ?? 'file';
    if (toolName === TOOL_NAMES.write) {
      // `--- /dev/null` is how the diff says the file did not exist before, and
      // "created" versus "updated" is the one fact a writer checks next.
      return writeReceipt(path, output.diff.startsWith('--- /dev/null'));
    }
    if (toolName === TOOL_NAMES.edit)
      return editReceipt(path, replacedAll, output.modifiedSinceRead === true);
    const { additions, deletions } = countDiffLineStats(output.diff);
    return `Formatted ${path} (+${additions} -${deletions})${STATE_IS_CURRENT_NOTE}`;
  }
  // No diff to tell from: an empty file, or content that is not text.
  if (isFileWrite(output)) return writeReceipt(output.shownPath ?? output.path, output.created);
  if (isEditResult(output)) {
    return editReceipt(
      output.shownPath ?? output.path,
      replacedAll,
      output.modifiedSinceRead === true,
    );
  }
  return undefined;
}

function isEditResult(output: unknown): output is {
  path: string;
  replacements: number;
  shownPath?: string;
  modifiedSinceRead?: boolean;
} {
  return (
    typeof output === 'object' &&
    output !== null &&
    !Array.isArray(output) &&
    typeof (output as { path?: unknown }).path === 'string' &&
    typeof (output as { replacements?: unknown }).replacements === 'number'
  );
}

// ---------------------------------------------------------------------------
// Search tools
// ---------------------------------------------------------------------------

/**
 * Grep answers with what ripgrep printed, as text.
 *
 * Search output is lines, and lines survive a JSON array only by being counted,
 * quoted and escaped — the model then has to undo all three before it can read
 * a path. Returning the lines themselves costs less and reads the way `rg` does
 * on a terminal. The durable result keeps `matches` as an array because the UI
 * renders it; this is the model's view of the same facts.
 */
export function grepToolResultToModelOutput(output: unknown): ToolResultOutput {
  const result = asGrepResult(output);
  if (!result) return toolResultOutput(output, false);
  // Paths inside the session cwd read relative to it, as Glob's do.
  const cwd = result.cwd;
  const matches =
    cwd === undefined
      ? result.matches
      : result.matches.map((line) =>
          line.startsWith(`${cwd}${sep}`) ? line.slice(cwd.length + 1) : line,
        );
  return { type: 'text', value: grepResultText({ ...result, matches }) };
}

function grepResultText(result: GrepLikeResult): string {
  // The paging an answer states: the limit when it cut the list short, and
  // the offset it started from.
  const paging = [
    ...(result.limit !== undefined ? [`limit: ${result.limit}`] : []),
    ...(result.offset ? [`offset: ${result.offset}`] : []),
  ].join(', ');
  if (result.mode === 'content') {
    const content = result.matches.join('\n') || 'No matches found';
    return paging ? `${content}\n\n[Showing results with pagination = ${paging}]` : content;
  }
  if (result.mode === 'count') {
    // The totals cover every file, the ones past the limit included.
    const total = result.countTotal ?? countTotals(result.matches);
    const occurrences = total.occurrences === 1 ? 'occurrence' : 'occurrences';
    const files = total.files === 1 ? 'file' : 'files';
    return `${result.matches.join('\n') || 'No matches found'}\n\nFound ${total.occurrences} total ${occurrences} across ${total.files} ${files}.${paging ? ` with pagination = ${paging}` : ''}`;
  }
  if (result.matches.length === 0) return 'No files found';
  const found = `Found ${result.matches.length} ${result.matches.length === 1 ? 'file' : 'files'}`;
  return [paging ? `${found} ${paging}` : found, ...result.matches].join('\n');
}

/** `path:count` lines summed, for a result that did not carry its totals. */
function countTotals(lines: readonly string[]): { occurrences: number; files: number } {
  let occurrences = 0;
  for (const line of lines) {
    const separator = line.lastIndexOf(':');
    const count = separator === -1 ? Number.NaN : Number(line.slice(separator + 1));
    if (Number.isFinite(count)) occurrences += count;
  }
  return { occurrences, files: lines.length };
}

/**
 * Glob answers one path per line, oldest first, relative to the session cwd
 * when the file is inside it and absolute when it is not. A capped list says
 * how many it left out.
 */
export function globToolResultToModelOutput(output: unknown): ToolResultOutput {
  const result = asGlobResult(output);
  if (!result) return toolResultOutput(output, false);
  if (result.files.length === 0) return { type: 'text', value: 'No files found' };
  const body = result.files
    .map((file) =>
      result.cwd !== undefined && isPathInside(result.cwd, file)
        ? relative(result.cwd, file)
        : file,
    )
    .join('\n');
  const omitted = result.omitted ?? 0;
  return {
    type: 'text',
    value:
      omitted > 0
        ? `${body}\n(Showing ${result.files.length} of ${result.files.length + omitted} matching files; ${omitted} more are not listed. Narrow the pattern or path to see the rest.)`
        : body,
  };
}

interface GrepLikeResult {
  readonly matches: string[];
  /** The session cwd, which the model's view of the paths is relative to. */
  readonly cwd?: string;
  readonly mode?: GrepOutputMode;
  readonly truncated?: boolean;
  readonly omitted?: number;
  /** The head limit, when it cut the list short. */
  readonly limit?: number;
  /** The caller's `offset`, when it set one. */
  readonly offset?: number;
  /** Count mode: occurrences and files over every line, before the limit. */
  readonly countTotal?: { readonly occurrences: number; readonly files: number };
}

function asGrepResult(output: unknown): GrepLikeResult | undefined {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return undefined;
  const matches = (output as { matches?: unknown }).matches;
  if (!Array.isArray(matches) || matches.some((line) => typeof line !== 'string')) {
    return undefined;
  }
  return output as GrepLikeResult;
}

function asGlobResult(
  output: unknown,
): { files: string[]; cwd?: string; omitted?: number } | undefined {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return undefined;
  const files = (output as { files?: unknown }).files;
  if (!Array.isArray(files) || files.some((file) => typeof file !== 'string')) return undefined;
  return output as { files: string[]; cwd?: string; omitted?: number };
}

function isFileDiff(output: unknown): output is {
  kind: 'file_diff';
  paths: string[];
  diff: string;
  shownPath?: string;
  modifiedSinceRead?: boolean;
} {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as { kind?: unknown }).kind === 'file_diff' &&
    Array.isArray((output as { paths?: unknown }).paths) &&
    typeof (output as { diff?: unknown }).diff === 'string'
  );
}

function isFileWrite(output: unknown): output is {
  kind: 'file_write';
  path: string;
  bytes: number;
  created?: boolean;
  shownPath?: string;
} {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as { kind?: unknown }).kind === 'file_write' &&
    typeof (output as { bytes?: unknown }).bytes === 'number'
  );
}
