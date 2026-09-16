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

import type { PipeShellOutput, PtyShellOutput } from '@maka/core/shell-run';
import type { ToolResultOutput } from './model-protocol.js';
import { toolResultOutput } from './tool-result-output.js';

const NO_OUTPUT = '(no output)';

/**
 * What the model is owed for a finished foreground command: what the command
 * printed, and — only when something went wrong — what went wrong.
 *
 * A shell's own output is already text, so wrapping it in JSON spends tokens on
 * field names the model has to read past on every command of the turn, and puts
 * the one line that decides the next move (the exit code) behind them. Success
 * is therefore the bare output, and failure leads with the code. Everything the
 * JSON carried that the model cannot act on — cwd, the echoed command, the
 * redaction and truncation bookkeeping — stays in the durable result, which is
 * what the UI renders.
 *
 * Background runs keep their structured shape: their payload is a ref the model
 * has to pass back to Read or TaskInput, not output to read.
 */
export function projectBashToolResultForModel(output: unknown): unknown {
  if (
    !output ||
    typeof output !== 'object' ||
    Array.isArray(output) ||
    (output as { kind?: unknown }).kind !== 'terminal'
  ) {
    return output;
  }
  return terminalResultText(output as TerminalLikeResult);
}

export function bashToolResultToModelOutput(output: unknown): ToolResultOutput {
  return toolResultOutput(projectBashToolResultForModel(output), false);
}

interface TerminalLikeResult {
  readonly kind: 'terminal';
  readonly status?: unknown;
  readonly exitCode?: unknown;
  readonly failureMessage?: unknown;
  readonly output?: unknown;
  readonly sandboxDenial?: unknown;
}

function terminalResultText(result: TerminalLikeResult): string {
  const body = capturedOutput(result.output);
  const header = failureHeader(result);
  const denial = sandboxDenialNote(result.sandboxDenial);
  const lines = [...(header ? [header] : []), body || NO_OUTPUT, ...(denial ? [denial] : [])];
  return lines.join('\n');
}

/**
 * A denial the sandbox backend signalled is the one fact that changes the
 * model's next move (request a boundary expansion rather than retry), so it
 * stays in the text, naming the backend so the diagnosis is checkable.
 */
function sandboxDenialNote(denial: unknown): string | undefined {
  if (!denial || typeof denial !== 'object') return undefined;
  const signal = denial as { likely?: unknown; backend?: unknown; recovery?: unknown };
  if (signal.likely !== true) return undefined;
  const backend = typeof signal.backend === 'string' ? ` by the ${signal.backend} sandbox` : '';
  const recovery =
    signal.recovery === 'require_escalated'
      ? ' Retrying as is will fail the same way; request the boundary expansion the command needs, or declare it up front with required_boundary.'
      : ' If the command needs that access, request a boundary expansion rather than retrying as is.';
  return `Sandbox denial: this command was likely blocked${backend}.${recovery}`;
}

/**
 * The first line of a failed command. The exit code is what a model reasons
 * with, so it leads whenever there is one; a run that never produced a code
 * (killed, timed out before exec, refused) says so in words instead.
 */
function failureHeader(result: TerminalLikeResult): string | undefined {
  const status = typeof result.status === 'string' ? result.status : undefined;
  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : undefined;
  if (status === 'completed' && exitCode === 0) return undefined;
  if (status === 'completed' && exitCode === undefined) return undefined;
  if (exitCode !== undefined) {
    const qualifier =
      status === 'timed_out' ? ' (timed out)' : status === 'cancelled' ? ' (cancelled)' : '';
    return `Exit code ${exitCode}${qualifier}`;
  }
  if (typeof result.failureMessage === 'string' && result.failureMessage.trim() !== '') {
    return result.failureMessage.trim();
  }
  if (status === 'timed_out') return 'Command timed out before it finished.';
  if (status === 'cancelled') return 'Command was cancelled before it finished.';
  return 'Command failed without reporting an exit code.';
}

/** stdout then stderr for a piped run; the visible screen for a PTY one. */
function capturedOutput(output: unknown): string {
  if (!output || typeof output !== 'object') return '';
  const shell = output as Partial<PipeShellOutput> & Partial<PtyShellOutput>;
  if (shell.mode === 'pty') {
    const screen = typeof shell.screen === 'string' ? shell.screen : '';
    return withTruncationNote(trimTrailingNewlines(screen), shell.truncated === true);
  }
  const stdout = typeof shell.stdout === 'string' ? trimTrailingNewlines(shell.stdout) : '';
  const stderr = typeof shell.stderr === 'string' ? trimTrailingNewlines(shell.stderr) : '';
  const body = [stdout, stderr].filter((part) => part !== '').join('\n');
  return withTruncationNote(body, shell.stdoutTruncated === true || shell.stderrTruncated === true);
}

/**
 * A silently shortened transcript reads as a complete one, and a model that
 * believes it saw everything stops looking. One line is cheaper than that.
 */
function withTruncationNote(body: string, truncated: boolean): string {
  if (!truncated) return body;
  const note =
    '[Output was truncated; only the tail is shown. Re-run narrowing the output to see more.]';
  return body === '' ? note : `${body}\n${note}`;
}

function trimTrailingNewlines(value: string): string {
  return value.replace(/\n+$/, '');
}
