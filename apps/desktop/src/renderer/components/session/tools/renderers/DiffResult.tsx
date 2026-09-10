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

// A `file_diff` result.
//
// Three colours (added / removed / context) is what a diff had before syntax
// colouring, and it reads as three blocks of tint with no structure inside
// them. `diffSyntaxTokens` tokenizes the stripped code per row, so each line
// keeps its +/- ground AND its own keywords, strings and comments. Rows the
// tokenizer has nothing to say about render as plain text, which is exactly
// the old result and never a wrong colouring.

import { memo, useMemo, type ReactNode } from 'react';
import { diffSyntaxTokens, type TokenLine } from '@maka/ui';
import { capLines, getToolActivityCopy } from '@maka/ui';
import { useUiLocale } from '@maka/ui';
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

type DiffLineKind = 'added' | 'removed' | 'context' | 'meta';

function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) return 'meta';
  if (line.startsWith('+')) return 'added';
  if (line.startsWith('-')) return 'removed';
  return 'context';
}

/** The line without its marker column, which is what the tokenizer sees. */
function stripMarker(line: string, kind: DiffLineKind): string {
  if (kind === 'meta') return line;
  if (kind === 'added' || kind === 'removed') return line.slice(1);
  return line.startsWith(' ') ? line.slice(1) : line;
}

function renderTokens(text: string, tokens: TokenLine | undefined): ReactNode {
  if (!tokens || tokens.length === 0) return text;
  const out: ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((token, index) => {
    // Prism can emit adjacent spans that touch; anything before this one is
    // untokenized text and has to survive.
    const start = Math.max(token.start, cursor);
    if (start >= token.end) return;
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(
      <span key={`${index}-${start}`} className={`token ${token.type}`}>
        {text.slice(start, token.end)}
      </span>,
    );
    cursor = token.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export const DiffResult = memo(function DiffResult(props: {
  paths: readonly string[];
  diff: string;
  /** Opens this file in the right pane's Files face. Absent when it cannot. */
  onOpenFile?: (path: string | undefined) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).result;
  const toolCopy = getToolActivityCopy(locale);
  const handoff = getWorkbarCopy(locale).handoff;
  const model = useMemo(() => {
    // A diff is read from the top, so the head is what it keeps.
    const { body, capped } = capLines(props.diff, 'head');
    const lines = body.split('\n');
    const kinds = lines.map(classifyDiffLine);
    const stripped = lines.map((line, index) => stripMarker(line, kinds[index]!));
    return { lines, kinds, stripped, capped, tokens: diffSyntaxTokens(props.paths, stripped) };
  }, [props.diff, props.paths]);

  const added = model.kinds.filter((kind) => kind === 'added').length;
  const removed = model.kinds.filter((kind) => kind === 'removed').length;

  return (
    <ToolResultPanel>
      <div className={toolResultBlockClass}>
        <div className={toolResultBlockLabelRowClass}>
          <p className={toolResultBlockLabelClass}>{copy.diff}</p>
          <span className="flex items-center gap-1.5 font-mono text-[0.6875rem] leading-none">
            <span className="text-success">{copy.linesAdded(added)}</span>
            <span className="text-danger">{copy.linesRemoved(removed)}</span>
            {props.onOpenFile && (
              <ToolHandoffButton
                label={handoff.openInFiles}
                onClick={() => props.onOpenFile?.(props.paths[0])}
              />
            )}
          </span>
        </div>
        <div className="custom-code-highlight min-w-0 overflow-x-auto font-mono text-xs leading-5">
          {model.lines.map((line, index) => {
            const kind = model.kinds[index]!;
            return (
              <div
                key={index}
                className={cn(
                  'flex min-w-max',
                  kind === 'added' && 'bg-success-fill/8',
                  kind === 'removed' && 'bg-danger-fill/8',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'w-4 shrink-0 select-none text-center',
                    kind === 'added' && 'text-success',
                    kind === 'removed' && 'text-danger',
                    kind !== 'added' && kind !== 'removed' && 'text-text-muted',
                  )}
                >
                  {kind === 'added' ? '+' : kind === 'removed' ? '-' : ''}
                </span>
                <code
                  className={cn('flex-1 whitespace-pre px-2', kind === 'meta' && 'text-text-muted')}
                >
                  {kind === 'meta'
                    ? model.stripped[index]
                    : renderTokens(model.stripped[index]!, model.tokens[index])}
                </code>
              </div>
            );
          })}
        </div>
        {model.capped > 0 && (
          <p className={toolResultBlockLabelClass}>{toolCopy.result.hiddenLines(model.capped)}</p>
        )}
      </div>
    </ToolResultPanel>
  );
});
