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

// Why a call failed, drawn once for every way a call can fail.
//
// Two shapes, and which one appears is decided by whether there is anything to
// DO about it:
//
//   a boundary the reader can move -> the card, with the control on it
//   anything else                  -> the reason, as a block in a result panel
//
// The card is the sandbox affordance, which was the app's one fully designed
// error presentation and was reachable only for a sandbox denial. What it is
// NOT is the default: wrapping every failure in a panel headed "This call
// failed" says nothing the row's own mark did not already say, and pushes the
// reason — the only part the reader came for — into its small print.
//
// The other shape borrows the grammar every result body already uses: the
// panel, one block inside it, a label naming what the text is. That is what The label is
// the GRADE, not a generic "Reason" — and not "Error" either, which would put
// that word back on the amber rows this change exists to stop calling errors:
// a memory merge-and-retry and a loop-gate block are refusals, and nothing
// broke.
// makes it read as part of the row rather than as a stray red paragraph, and
// it is also why the reason needs the label — directly above a command's
// output, an unlabelled line is just more output. The block is tinted by the
// grade and the label carries its colour; the reason itself stays in the
// body's own colour, because it is text to read, not a warning to absorb.
//
// Either shape renders ABOVE the result body rather than instead of it: a
// command that failed has both a reason and its output, and showing one at the
// cost of the other is what the old `errored -> renderer 'none'` rule did.

import { getToolActivityCopy, useUiLocale, type ToolFailurePresentation } from '@maka/ui';
import { getTranscriptCopy } from '../../../locales/transcript-copy.js';
import { cn } from '../../../lib/cn.js';
import {
  ToolResultPanel,
  toolResultBlockClass,
  toolResultBlockLabelClass,
  toolResultBlockLabelRowClass,
} from './tool-result.js';

export interface ToolFailureBlockProps {
  failure: ToolFailurePresentation;
  /** Raises the permission mode and re-runs the turn; absent when neither is possible. */
  onSwitchToFullAccessAndRetry?: () => void;
  /** True while that switch is in flight. */
  switching?: boolean;
}

export function ToolFailureBlock(props: ToolFailureBlockProps) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale);
  const toolCopy = getToolActivityCopy(locale);
  const failure = props.failure;
  const danger = failure.tone === 'danger';
  // A remedy names the situation far more precisely than the grade can, and
  // the app already had the words for both of its cases.
  const remedyCopy =
    failure.remedy === 'bypass'
      ? toolCopy.requiresBypass
      : failure.remedy === 'raise_permission'
        ? toolCopy.sandboxBlocked
        : undefined;

  if (!remedyCopy) {
    // Nothing at all when the runtime had no sentence: the result body below
    // is the explanation, and the row's mark has already said which way it
    // went. An empty labelled block would be chrome around nothing.
    if (!failure.message) return null;
    return (
      <ToolResultPanel>
        <div
          className={cn(toolResultBlockClass, danger ? 'bg-danger-subtle' : 'bg-warning-subtle')}
        >
          <div className={toolResultBlockLabelRowClass}>
            <p className={cn(toolResultBlockLabelClass, danger ? 'text-danger' : 'text-warning')}>
              {toolCopy.failure.mark[failure.kind]}
            </p>
          </div>
          <p className="min-w-0 whitespace-pre-wrap break-words text-xs leading-5 text-text-secondary">
            {failure.message}
          </p>
        </div>
      </ToolResultPanel>
    );
  }

  return (
    <div
      className={cn(
        'mx-2.5 mt-1 flex flex-col gap-2 rounded-lg border-[0.5px] p-3',
        danger ? 'border-danger-line bg-danger-subtle' : 'border-warning-line bg-warning-subtle',
      )}
    >
      <p className={cn('text-xs font-medium leading-5', danger ? 'text-danger' : 'text-warning')}>
        {remedyCopy.title}
      </p>
      <p className="min-w-0 whitespace-pre-wrap break-words text-xs leading-5 text-text-secondary">
        {failure.message ?? remedyCopy.description}
      </p>
      {failure.message && (
        <p className="text-xs leading-5 text-text-muted">{remedyCopy.description}</p>
      )}
      {props.onSwitchToFullAccessAndRetry && (
        <button
          type="button"
          onClick={props.onSwitchToFullAccessAndRetry}
          disabled={props.switching}
          className={cn(
            'ui-control-squish ui-control-squish-ghost inline-flex h-7 w-fit cursor-pointer items-center rounded-md px-2 text-xs leading-5 outline-none',
            'focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50',
            danger ? 'text-danger' : 'text-warning',
          )}
        >
          {props.switching ? copy.sandbox.pending : copy.sandbox.action}
        </button>
      )}
    </div>
  );
}
