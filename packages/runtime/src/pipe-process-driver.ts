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

import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import type { ShellSpawnPlan } from './shell-detect.js';
import {
  buildSpawnStdio,
  closeChildFdSources,
  writeChildFdInputs,
  type ChildFdInput,
} from './child-fd-input.js';
import {
  trackCapturedOutputDrain,
  type CapturedOutputDrain,
  type CapturedOutputDrainResult,
} from './child-process-lifecycle.js';

type PipeOutputStream = 'stdout' | 'stderr';

export interface PipeProcessExit {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface PipeProcessDriverOptions {
  plan: ShellSpawnPlan;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  fdInputs?: readonly ChildFdInput[];
  outputDrainMs: number;
  /** Decoded text, and how many bytes the process wrote for it. */
  onData: (stream: 'stdout' | 'stderr', data: string, bytes: number) => void;
  onRootExit: () => void;
  onExit: (exit: PipeProcessExit) => void;
  onFailure: (error: Error) => void;
}

export class PipeProcessDriver {
  readonly pid: number | undefined;
  readonly ready: Promise<void>;

  private readonly child: ChildProcess;
  private readonly stdout: Readable;
  private readonly stderr: Readable;
  private readonly stdin: Writable | undefined;
  private readonly outputDrain: CapturedOutputDrain<PipeOutputStream>;
  // Decoded here rather than by the stream so that the bytes are counted too.
  private readonly decoders = {
    stdout: new StringDecoder('utf8'),
    stderr: new StringDecoder('utf8'),
  };
  private disposed = false;
  private settled = false;
  private outputDrainResult: CapturedOutputDrainResult<PipeOutputStream> | undefined;
  private rootExit: Omit<PipeProcessExit, 'stdoutTruncated' | 'stderrTruncated'> | undefined;
  private stdinSettled: boolean;
  private stdinError: Error | undefined;

  constructor(private readonly options: PipeProcessDriverOptions) {
    try {
      this.child = spawn(options.plan.file, options.plan.args, {
        cwd: options.cwd,
        env: options.env,
        shell: options.plan.useShellOption,
        stdio: buildSpawnStdio(
          options.fdInputs,
          options.plan.stdin === undefined ? 'ignore' : 'pipe',
        ),
        detached: process.platform !== 'win32',
      });
    } finally {
      closeChildFdSources(options.fdInputs);
    }
    if (!this.child.stdout || !this.child.stderr) {
      this.child.kill('SIGKILL');
      throw new Error('Pipe process did not expose stdout and stderr');
    }
    this.stdout = this.child.stdout;
    this.stderr = this.child.stderr;
    this.stdin = options.plan.stdin === undefined ? undefined : (this.child.stdin ?? undefined);
    if (options.plan.stdin !== undefined && !this.stdin) {
      this.child.kill('SIGKILL');
      throw new Error('Pipe process did not expose stdin');
    }
    this.stdinSettled = this.stdin === undefined;
    this.pid = this.child.pid;
    this.stdout.on('data', this.onStdout);
    this.stderr.on('data', this.onStderr);
    // Before the drain tracker's own listeners: the last partial character
    // is delivered before the stream counts as ended.
    this.stdout.on('end', this.onStdoutEnd);
    this.stderr.on('end', this.onStderrEnd);
    this.outputDrain = trackCapturedOutputDrain(
      [
        { key: 'stdout', stream: this.stdout },
        { key: 'stderr', stream: this.stderr },
      ],
      options.outputDrainMs,
    );
    void this.outputDrain.completion.then((result) => {
      if (this.disposed || this.settled) return;
      this.outputDrainResult = result;
      this.settleAfterDrain();
    });
    this.child.on('exit', this.onRootExit);
    this.child.on('close', this.onCloseFallback);
    this.child.on('error', this.onError);
    this.ready = waitForSpawn(this.child);
  }

  writeInputs(): void {
    writeChildFdInputs(this.child, this.options.fdInputs);
    if (!this.stdin || this.options.plan.stdin === undefined) return;
    this.stdin.once('error', this.onStdinError);
    this.stdin.end(this.options.plan.stdin, this.onStdinEnd);
  }

  kill(signal: 'SIGTERM' | 'SIGKILL'): boolean {
    return this.child.kill(signal);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.outputDrain.dispose();
    this.stdout.off('data', this.onStdout);
    this.stderr.off('data', this.onStderr);
    this.stdout.off('end', this.onStdoutEnd);
    this.stderr.off('end', this.onStderrEnd);
    this.child.off('exit', this.onRootExit);
    this.child.off('close', this.onCloseFallback);
    this.child.off('error', this.onError);
    this.stdin?.off('error', this.onStdinError);
    this.stdout.destroy();
    this.stderr.destroy();
  }

  private readonly onStdout = (chunk: Buffer): void => this.deliver('stdout', chunk);

  private readonly onStderr = (chunk: Buffer): void => this.deliver('stderr', chunk);

  private readonly onStdoutEnd = (): void => this.deliver('stdout');

  private readonly onStderrEnd = (): void => this.deliver('stderr');

  /** A chunk as text, or, at the end of the stream, a character it left unfinished. */
  private deliver(stream: PipeOutputStream, chunk?: Buffer): void {
    if (this.disposed || this.settled) return;
    const decoder = this.decoders[stream];
    const data = chunk ? decoder.write(chunk) : decoder.end();
    const bytes = chunk?.length ?? 0;
    if (data !== '' || bytes > 0) this.options.onData(stream, data, bytes);
  }

  private readonly onRootExit = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
    if (this.disposed || this.rootExit) return;
    this.rootExit = { exitCode, signal };
    this.options.onRootExit();
    this.outputDrain.startDeadline();
    this.settleAfterDrain();
  };

  private readonly onCloseFallback = (
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    if (!this.rootExit) this.onRootExit(exitCode, signal);
  };

  private settleAfterDrain(): void {
    if (!this.rootExit || !this.outputDrainResult || !this.stdinSettled) return;
    this.settle();
  }

  private settle(): void {
    if (this.disposed || this.settled || !this.rootExit || !this.outputDrainResult) return;
    this.settled = true;
    if (this.stdinError) this.options.onFailure(this.stdinError);
    this.options.onExit({
      ...this.rootExit,
      stdoutTruncated: this.outputDrainResult.incomplete.has('stdout'),
      stderrTruncated: this.outputDrainResult.incomplete.has('stderr'),
    });
  }

  private readonly onError = (error: Error): void => {
    if (!this.disposed && !this.settled) this.options.onFailure(error);
  };

  private readonly onStdinError = (error: Error): void => {
    this.stdinError ??= error;
    this.stdinSettled = true;
    this.settleAfterDrain();
  };

  private readonly onStdinEnd = (error?: Error | null): void => {
    if (error) this.stdinError ??= error;
    this.stdinSettled = true;
    this.settleAfterDrain();
  };
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}
