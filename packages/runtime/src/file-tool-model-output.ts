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

import { countDiffLineStats } from '@maka/core/unified-diff';
import { TOOL_NAMES } from '@maka/core/tool-names';
import type { GrepOutputMode } from './filesystem-worker/protocol.js';
import type { ToolResultOutput } from './model-protocol.js';
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
 * They are also what makes a windowed read legible: line 4 of a read that
 * started at `offset: 200` is line 204 of the file, and nothing else in the
 * result says so.
 *
 * The durable result keeps the raw content, because the UI renders the file and
 * not a listing of it; this is the model's view of the same bytes.
 */
const READ_EMPTY_FILE_NOTE =
  '<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>';

export function readToolResultToModelOutput(
  input: unknown,
  output: unknown,
): ToolResultOutput | undefined {
  const result = readResult(output);
  // Images, runtime resources and attachments answer in their own shapes; they
  // have no lines to number, so they keep the default projection.
  if (result === undefined) return undefined;
  if (result.content === '') return { type: 'text', value: READ_EMPTY_FILE_NOTE };
  const offset = readOffset(input);
  const numbered = numberReadLines(result.content, offset);
  if (!result.truncated || result.totalLines === undefined)
    return { type: 'text', value: numbered };
  // A capped read says so, or the model takes the window for the whole file.
  const shown = numbered.split('\n').length;
  const last = offset + shown;
  return {
    type: 'text',
    value: `${numbered}\n\n[Showing lines ${offset + 1}-${last} of ${result.totalLines}. Pass offset: ${last} to read on.]`,
  };
}

function readResult(
  output: unknown,
): { content: string; truncated?: boolean; totalLines?: number } | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined;
  const keys = Object.keys(output);
  if (!keys.includes('content') || keys.some((key) => !READ_RESULT_KEYS.has(key))) {
    return undefined;
  }
  const { content, truncated, totalLines } = output as {
    content: unknown;
    truncated?: unknown;
    totalLines?: unknown;
  };
  if (typeof content !== 'string') return undefined;
  return {
    content,
    ...(truncated === true ? { truncated: true } : {}),
    ...(typeof totalLines === 'number' ? { totalLines } : {}),
  };
}

const READ_RESULT_KEYS = new Set(['content', 'truncated', 'totalLines']);

/** `offset` is a zero-based line offset, so the first line shown is `offset + 1`. */
function readOffset(input: unknown): number {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 0;
  const offset = (input as { offset?: unknown }).offset;
  return typeof offset === 'number' && Number.isFinite(offset) && offset > 0
    ? Math.trunc(offset)
    : 0;
}

function numberReadLines(content: string, offset: number): string {
  // A file that ends in a newline has no final empty line; `cat -n` does not
  // number one, and neither may this.
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

function editReceipt(path: string, replacedAll: boolean): string {
  return replacedAll
    ? `The file ${path} has been updated. All occurrences were successfully replaced.${STATE_IS_CURRENT_NOTE}`
    : `The file ${path} has been updated successfully.${STATE_IS_CURRENT_NOTE}`;
}

function fileWriteToolResultSummary(
  toolName: FileWriteToolName,
  output: unknown,
  replacedAll = false,
): string | undefined {
  if (isFileDiff(output)) {
    const path = output.paths[0] ?? 'file';
    if (toolName === TOOL_NAMES.write) {
      // `--- /dev/null` is how the diff says the file did not exist before, and
      // "created" versus "updated" is the one fact a writer checks next.
      return output.diff.startsWith('--- /dev/null')
        ? `File created successfully at: ${path}${STATE_IS_CURRENT_NOTE}`
        : `The file ${path} has been updated successfully.${STATE_IS_CURRENT_NOTE}`;
    }
    if (toolName === TOOL_NAMES.edit) return editReceipt(path, replacedAll);
    const { additions, deletions } = countDiffLineStats(output.diff);
    return `Formatted ${path} (+${additions} -${deletions})${STATE_IS_CURRENT_NOTE}`;
  }
  if (isFileWrite(output))
    return `File written successfully at: ${output.path} (${output.bytes} bytes)${STATE_IS_CURRENT_NOTE}`;
  if (isEditResult(output)) return editReceipt(output.path, replacedAll);
  return undefined;
}

function isEditResult(output: unknown): output is { path: string; replacements: number } {
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
  return { type: 'text', value: grepResultText(result) };
}

function grepResultText(result: GrepLikeResult): string {
  if (result.matches.length === 0) return 'No files found';
  const body =
    result.mode === 'count'
      ? [result.matches.join('\n'), '', countSummary(result.matches)].join('\n')
      : result.mode === 'files_with_matches' || result.mode === undefined
        ? [
            `Found ${result.matches.length} ${result.matches.length === 1 ? 'file' : 'files'}`,
            ...result.matches,
          ].join('\n')
        : result.matches.join('\n');
  // The paging state is echoed whenever the caller set it or the cap bit, so
  // a partial list is never mistaken for the whole.
  if (!result.truncated && result.limit === undefined && !result.offset) return body;
  const paging = [
    ...(result.limit !== undefined ? [`limit: ${result.limit}`] : []),
    ...(result.offset ? [`offset: ${result.offset}`] : []),
  ].join(', ');
  const omitted = result.omitted ?? 0;
  const more = result.truncated
    ? ` — ${omitted} more matching ${omitted === 1 ? 'line' : 'lines'} not shown; narrow the search or page with offset`
    : '';
  return `${body}\n\n[Showing results with pagination = ${paging || 'default'}${more}]`;
}

/** `path:count` lines rolled up, so the model does not have to add them itself. */
function countSummary(lines: readonly string[]): string {
  let total = 0;
  for (const line of lines) {
    const separator = line.lastIndexOf(':');
    const count = separator === -1 ? Number.NaN : Number(line.slice(separator + 1));
    if (Number.isFinite(count)) total += count;
  }
  return `Found ${total} total ${total === 1 ? 'occurrence' : 'occurrences'} across ${lines.length} ${lines.length === 1 ? 'file' : 'files'}.`;
}

/**
 * Glob answers with one path per line, most recently modified LAST.
 *
 * The order is the useful half of the answer and the end of a list is where a
 * reader's attention already is, so the freshest match sits there rather than
 * at the top where a long list buries it.
 */
export function globToolResultToModelOutput(output: unknown): ToolResultOutput {
  const result = asGlobResult(output);
  if (!result) return toolResultOutput(output, false);
  if (result.files.length === 0) return { type: 'text', value: 'No files found' };
  const body = result.files.join('\n');
  return {
    type: 'text',
    value: result.truncated
      ? `${body}\n[More files matched than are shown; these are the most recently modified. Narrow the pattern or the path to see the rest.]`
      : body,
  };
}

interface GrepLikeResult {
  readonly matches: string[];
  readonly mode?: GrepOutputMode;
  readonly truncated?: boolean;
  readonly omitted?: number;
  /** The caller's `head_limit`, when it set one. */
  readonly limit?: number;
  /** The caller's `offset`, when it set one. */
  readonly offset?: number;
}

function asGrepResult(output: unknown): GrepLikeResult | undefined {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return undefined;
  const matches = (output as { matches?: unknown }).matches;
  if (!Array.isArray(matches) || matches.some((line) => typeof line !== 'string')) {
    return undefined;
  }
  return output as GrepLikeResult;
}

function asGlobResult(output: unknown): { files: string[]; truncated?: boolean } | undefined {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return undefined;
  const files = (output as { files?: unknown }).files;
  if (!Array.isArray(files) || files.some((file) => typeof file !== 'string')) return undefined;
  return output as { files: string[]; truncated?: boolean };
}

function isFileDiff(
  output: unknown,
): output is { kind: 'file_diff'; paths: string[]; diff: string } {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as { kind?: unknown }).kind === 'file_diff' &&
    Array.isArray((output as { paths?: unknown }).paths) &&
    typeof (output as { diff?: unknown }).diff === 'string'
  );
}

function isFileWrite(
  output: unknown,
): output is { kind: 'file_write'; path: string; bytes: number } {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as { kind?: unknown }).kind === 'file_write' &&
    typeof (output as { bytes?: unknown }).bytes === 'number'
  );
}
