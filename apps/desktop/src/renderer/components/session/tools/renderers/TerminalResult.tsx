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

// A `terminal` / `shell_run` result — the command, where it ran, and what it
// printed. Look ported from the reference design system's `BashToolRenderer`:
// a "bash" block over an "Output" block, both inside the shared result panel.
//
// A background run has no final output to wait for, so its live chunks ARE the
// output until the durable snapshot catches up. `withLiveStreamFallback` is
// what merges them, and it also carries the truncation and redaction hints
// forward so a settled row does not silently lose the "[Redacted]" the live
// one showed.

import { memo } from 'react';
import { isShellOutput } from '@maka/core/shell-run';
import type { ToolResultContent } from '@maka/core/events';
import {
  capLines,
  getToolActivityCopy,
  useUiLocale,
  withLiveStreamFallback,
  type ToolActivityItem,
} from '@maka/ui';
import CodeRenderer from '../../../ui/CodeRenderer.js';
import { cn } from '../../../../lib/cn.js';
import { getTranscriptCopy } from '../../../../locales/transcript-copy.js';
import {
  ToolHandoffButton,
  ToolResultPanel,
  toolResultBlockClass,
  toolResultBlockLabelClass,
  toolResultBlockLabelRowClass,
} from '../tool-result.js';
import { getWorkbarCopy } from '../../../../locales/workbar-copy.js';

type TerminalResultContent = Extract<
  ToolResultContent,
  { kind: 'terminal' } | { kind: 'shell_run' }
>;

const BACKGROUND_STATUS_TONE: Record<string, string> = {
  starting: 'text-text-muted',
  running: 'text-accent',
  completed: 'text-success',
  failed: 'text-danger',
  timed_out: 'text-danger',
  cancelled: 'text-warning',
  orphaned: 'text-warning',
};

function Block(props: { label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={toolResultBlockClass}>
      <div className={toolResultBlockLabelRowClass}>
        <p className={toolResultBlockLabelClass}>{props.label}</p>
        {props.action}
      </div>
      {props.children}
    </div>
  );
}

export const TerminalResult = memo(function TerminalResult(props: {
  item: ToolActivityItem;
  result: TerminalResultContent;
  /** Attaches the right pane's Terminal face to this run. Background runs only. */
  onOpenTerminal?: (ref: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).result;
  const handoff = getWorkbarCopy(locale).handoff;
  const toolCopy = getToolActivityCopy(locale).result;
  const outputCopy = getToolActivityCopy(locale).output;
  const merged = withLiveStreamFallback(props.result, props.item.outputChunks, {
    ...(props.item.outputTruncated === true ? { truncated: true } : {}),
    locale,
  }) as TerminalResultContent;
  const output = isShellOutput(merged.output) ? merged.output : undefined;

  const streams: { label: string; text: string; tone: 'normal' | 'error' }[] = [];
  if (output?.mode === 'pipes') {
    if (output.stdout.trim())
      streams.push({ label: 'stdout', text: output.stdout, tone: 'normal' });
    if (output.stderr.trim()) streams.push({ label: 'stderr', text: output.stderr, tone: 'error' });
  } else if (output?.mode === 'pty') {
    const screen = output.screen || output.scrollback;
    if (screen.trim()) streams.push({ label: 'pty', text: screen, tone: 'normal' });
  }

  const status = merged.status;
  // Only a `shell_run` is a background run, and only it earns the background
  // status vocabulary. A `terminal` result is a foreground command that has
  // already finished; labelling it "Background task completed" describes a
  // different thing than the one on screen.
  const backgroundLabel =
    merged.kind !== 'shell_run'
      ? undefined
      : status in toolCopy.backgroundStatus
        ? toolCopy.backgroundStatus[status as keyof typeof toolCopy.backgroundStatus]
        : toolCopy.backgroundUnknown(status);

  return (
    <ToolResultPanel>
      <Block
        label={copy.command}
        action={
          <span className="flex items-center gap-2">
            {/* A live shell run is the only one the pane can attach to: a
                finished foreground command has no PTY left to type into. */}
            {props.onOpenTerminal && merged.kind === 'shell_run' && (
              <ToolHandoffButton
                label={handoff.openInTerminal}
                onClick={() => props.onOpenTerminal?.(merged.ref)}
              />
            )}
            {backgroundLabel ? (
              <span className={cn('text-[0.6875rem] leading-none', BACKGROUND_STATUS_TONE[status])}>
                {backgroundLabel}
              </span>
            ) : null}
          </span>
        }
      >
        <CodeRenderer
          content={merged.cmd}
          language="bash"
          showLineNumbers={false}
          fontSize="12px"
        />
        {merged.cwd && (
          <p className="truncate font-mono text-[0.6875rem] leading-4 text-text-muted">
            {copy.workingDirectory}: {merged.cwd}
          </p>
        )}
      </Block>
      <Block
        label={copy.output}
        action={
          merged.exitCode !== undefined ? (
            <span
              className={cn(
                'font-mono text-[0.6875rem] leading-none',
                merged.exitCode === 0 ? 'text-text-muted' : 'text-danger',
              )}
            >
              {toolCopy.exitCode(merged.exitCode)}
            </span>
          ) : undefined
        }
      >
        {streams.length === 0 ? (
          <p className="text-xs leading-5 text-text-muted">
            {status === 'starting' || status === 'running'
              ? toolCopy.noOutputYet
              : toolCopy.noOutput}
          </p>
        ) : (
          streams.map((stream) => {
            const { body, capped } = capLines(stream.text);
            return (
              <div key={stream.label} className="flex min-w-0 flex-col gap-1">
                <CodeRenderer
                  content={body}
                  language="bash"
                  showLineNumbers={false}
                  fontSize="12px"
                  className={stream.tone === 'error' ? 'text-danger' : undefined}
                />
                {capped > 0 && (
                  <p className={toolResultBlockLabelClass}>{toolCopy.hiddenLines(capped)}</p>
                )}
              </div>
            );
          })
        )}
        {merged.failureMessage && (
          <p className="text-xs leading-5 text-danger">{merged.failureMessage}</p>
        )}
        {output?.redacted && <p className={toolResultBlockLabelClass}>{outputCopy.redacted}</p>}
        {((output?.mode === 'pipes' && (output.stdoutTruncated || output.stderrTruncated)) ||
          (output?.mode === 'pty' && output.truncated)) && (
          <p className={toolResultBlockLabelClass}>{outputCopy.truncated}</p>
        )}
      </Block>
    </ToolResultPanel>
  );
});
