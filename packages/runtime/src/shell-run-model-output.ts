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

// What the model reads for a background task, on every tool that can hand
// one back — Bash starting it, Read on its ref, TaskStop and TaskInput. The
// shapes follow the reference harness: starting a task answers with a
// sentence naming the ref; reading it answers with the output the way a Read
// numbers a file, ending in one bracketed status line ("[exited with code 0]",
// "[killed]"); stopping it answers with one JSON line. The durable result
// keeps the structured record for the UI; this is the model's view of it.

import { capturedOutput, sandboxDenialNote } from './bash-model-output.js';
import { numberReadLines } from './file-tool-model-output.js';
import type { ToolResultOutput } from './model-protocol.js';
import { toolResultOutput } from './tool-result-output.js';

interface ShellRunLikeResult {
  readonly kind: 'shell_run';
  readonly ref: string;
  readonly status?: unknown;
  readonly mode?: unknown;
  readonly cmd?: unknown;
  readonly exitCode?: unknown;
  readonly failureMessage?: unknown;
  readonly timeoutMs?: unknown;
  /** A pipes or PTY output record; `capturedOutput` reads whichever it is. */
  readonly output?: unknown;
  readonly sandboxDenial?: unknown;
  readonly operation?: {
    readonly kind?: unknown;
    readonly applied?: unknown;
    readonly failed?: unknown;
    readonly input?: { readonly bytes?: unknown; readonly queued?: unknown };
    readonly resize?: {
      readonly cols?: unknown;
      readonly rows?: unknown;
      readonly applied?: unknown;
    };
  };
}

export function isShellRunResult(output: unknown): output is ShellRunLikeResult {
  return (
    !!output &&
    typeof output === 'object' &&
    !Array.isArray(output) &&
    (output as { kind?: unknown }).kind === 'shell_run' &&
    typeof (output as { ref?: unknown }).ref === 'string'
  );
}

/** The text for a background-task result, or the output untouched when it is not one. */
export function projectShellRunResultForModel(output: unknown): unknown {
  return isShellRunResult(output) ? shellRunResultText(output) : output;
}

export function shellRunResultToModelOutput(output: unknown): ToolResultOutput {
  return toolResultOutput(projectShellRunResultForModel(output), false);
}

export function shellRunResultText(result: ShellRunLikeResult): string {
  if (result.operation?.kind === 'stop') return stopResultLine(result);
  if (result.output === undefined) return startedLine(result);
  const lines: string[] = [];
  if (result.operation?.kind === 'pty_control') lines.push(ptyControlLine(result.operation));
  lines.push(numberReadLines(outputWithStatus(result), 0));
  const denial = sandboxDenialNote(result.sandboxDenial);
  if (denial) lines.push(denial);
  return lines.join('\n');
}

/** `Command running in background with ref: …` — the one thing the model has to keep. */
function startedLine(result: ShellRunLikeResult): string {
  const terminal =
    result.mode === 'pty' ? ' It has a terminal: send keystrokes with TaskInput.' : '';
  return `Command running in background with ref: ${result.ref}. You will be notified when it completes. To check interim output, use Read on that ref; to end it, use TaskStop.${terminal}`;
}

/** The output as a Read would number it, ending in the status line. */
function outputWithStatus(result: ShellRunLikeResult): string {
  const body = capturedOutput(result.output);
  return `${body === '' ? '' : `${body}\n\n`}${statusLine(result)}\n`;
}

function statusLine(result: ShellRunLikeResult): string {
  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : undefined;
  const failure =
    typeof result.failureMessage === 'string' && result.failureMessage.trim() !== ''
      ? result.failureMessage.trim()
      : undefined;
  switch (result.status) {
    case 'starting':
    case 'running':
      return '[running]';
    case 'completed':
      return `[exited with code ${exitCode ?? 0}]`;
    case 'failed':
      return exitCode !== undefined
        ? `[exited with code ${exitCode}]`
        : `[failed: ${failure ?? 'unknown'}]`;
    case 'timed_out':
      return typeof result.timeoutMs === 'number'
        ? `[timed out after ${result.timeoutMs}ms]`
        : '[timed out]';
    case 'cancelled':
      return '[killed]';
    case 'orphaned':
      return `[orphaned: ${failure ?? 'the runtime restarted without a live process handle'}]`;
    default:
      return `[${String(result.status)}]`;
  }
}

/** One JSON line, the way the reference's TaskStop answers. */
function stopResultLine(result: ShellRunLikeResult): string {
  const command = typeof result.cmd === 'string' ? result.cmd : '';
  const exitCode = typeof result.exitCode === 'number' ? ` (code ${result.exitCode})` : '';
  const message =
    result.operation?.applied === true
      ? `Successfully stopped task: ${result.ref} (${command})`
      : `Task ${result.ref} had already exited${exitCode} (${command})`;
  return JSON.stringify({
    message,
    ref: result.ref,
    task_type: 'local_bash',
    command,
    status: result.status,
  });
}

function ptyControlLine(operation: NonNullable<ShellRunLikeResult['operation']>): string {
  const parts: string[] = [];
  if (operation.input && typeof operation.input.bytes === 'number') {
    parts.push(
      operation.input.queued === true
        ? `${operation.input.bytes} bytes of input queued`
        : `${operation.input.bytes} bytes of input not accepted`,
    );
  }
  if (operation.resize && typeof operation.resize.cols === 'number') {
    parts.push(
      operation.resize.applied === true
        ? `resized to ${operation.resize.cols}x${operation.resize.rows}`
        : `resize to ${operation.resize.cols}x${operation.resize.rows} not applied`,
    );
  }
  if (operation.failed === true) parts.push('the terminal rejected the operation');
  return `[${parts.join('; ') || 'terminal state'}]`;
}
