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

// The two edges of a bounded transcript.
//
// A long conversation is never all in memory: the range store holds a byte-
// budgeted window and the Host owns the rest. So the transcript has edges
// where a scroll bar would normally have none, and a reader who reaches one
// needs to be told it is an edge rather than the beginning of the
// conversation, and offered the page beyond it.
//
// The scroller also asks for these pages on its own as the reader approaches
// an edge; the row is the explicit way to ask, and the place the wait is
// visible.

import { memo } from 'react';
import { getConversationCopy, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { cn } from '../../lib/cn.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';

export const TranscriptGapRow = memo(function TranscriptGapRow(props: {
  direction: 'older' | 'newer';
  pending: boolean;
  onLoad: () => void;
}) {
  const locale = useUiLocale();
  const gap = getConversationCopy(locale).chat.transcriptGap;
  const copy = getTranscriptCopy(locale).history;
  const description = props.direction === 'older' ? gap.olderDescription : gap.newerDescription;
  const action = props.direction === 'older' ? gap.olderAction : gap.newerAction;
  return (
    <div
      className="maka-transcript-gap-row my-3 flex items-center justify-center gap-2"
      data-maka-transcript-gap={props.direction}
    >
      <span className="text-xs leading-4 text-text-muted">{description}</span>
      <button
        type="button"
        onClick={props.onLoad}
        disabled={props.pending}
        aria-label={props.direction === 'older' ? copy.earlier : copy.later}
        className={cn(
          'ui-control-squish ui-control-squish-ghost inline-flex h-7 cursor-pointer items-center gap-1 rounded-full px-3 text-xs leading-4 text-text-secondary outline-none',
          'hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        <Anthropicon
          name={props.pending ? 'spinner' : props.direction === 'older' ? 'arrowUp' : 'arrowDown'}
          size={12}
        />
        {props.pending ? copy.loading : action}
      </button>
    </div>
  );
});

/** The floating "you have left the tail" affordance. */
export const JumpToLatest = memo(function JumpToLatest(props: {
  streaming: boolean;
  onJump: () => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).feed;
  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
      <button
        type="button"
        onClick={props.onJump}
        aria-label={copy.jumpToLatest}
        className={cn(
          'pointer-events-auto relative flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-hairline bg-surface-3 shadow-[var(--card-shadow)] outline-none transition-shadow duration-200',
          'hover:shadow-[var(--card-shadow-hover)] focus-visible:shadow-[var(--sidebar-focus-shadow)]',
        )}
      >
        {props.streaming && (
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-accent-subtle opacity-60"
          />
        )}
        <Anthropicon name="arrowDown" size={18} className="relative text-text-primary" />
      </button>
    </div>
  );
});
