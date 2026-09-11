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

// One run of reasoning, as a step on a work group's timeline.
//
// Look ported from the reference design system's `ThinkingRenderer`: a clock
// glyph, the text at secondary weight, a 200px clip with a mask instead of a
// gradient overlay, and one Show more/less control that keeps `aria-expanded`
// on the same element across both states.
//
// A step has no title of its own. The group's summary line already says the
// turn is (or was) thinking, and a step that repeats it makes the reader read
// the same sentence twice. There is no standalone shape any more: every run of
// reasoning is a group (`groupTurnTimeline`), so a turn that thinks and then
// calls a tool does not change shape when the call lands.
//
// A mask rather than a gradient plate for the fade: a plate has to be painted
// the same colour as whatever is behind it (so changing the ground means
// changing two places), and the text under it is still selectable, so dragging
// across the fade highlights words nobody can read. A mask removes the pixels.

import { memo, useEffect, useId, useRef, useState } from 'react';
import { useUiLocale } from '@maka/ui';
import Markdown from '../ui/Markdown.js';
import StreamPopMarkdown from '../ui/StreamPopMarkdown.js';
import { Anthropicon } from '../icons/Anthropicon.js';
import { cn } from '../../lib/cn.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';
import { StepGap } from './tools/tool-result.js';

const CLIP_HEIGHT_PX = 200;

/** The reasoning text itself: clipped past 200px, with the one control that opens it. */
function ThinkingText(props: {
  text: string;
  live?: boolean;
  onOpenExternal?: (url: string) => void;
}) {
  const copy = getTranscriptCopy(useUiLocale());
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const bodyId = useId();

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    // One frame after the text lands: measuring in the same tick reads the
    // height the previous text had.
    const frame = window.requestAnimationFrame(() => {
      setClipped(element.scrollHeight > CLIP_HEIGHT_PX);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.text]);

  const collapsed = clipped && !expanded;

  return (
    <>
      <div
        id={bodyId}
        ref={contentRef}
        className={cn(
          'relative overflow-hidden',
          collapsed &&
            '[mask-image:linear-gradient(to_bottom,black_calc(100%_-_3rem),transparent)]',
        )}
        style={{ maxHeight: collapsed ? `${CLIP_HEIGHT_PX}px` : undefined }}
      >
        {/* The clipped tail is invisible but still tabbable and still read
            aloud without this. */}
        <div
          inert={collapsed}
          className="max-w-none text-sm [&_*]:text-sm [&_*]:leading-5 [&_*]:text-text-secondary"
        >
          {props.live ? (
            <StreamPopMarkdown
              noPadding
              {...(props.onOpenExternal ? { onOpenExternal: props.onOpenExternal } : {})}
            >
              {props.text}
            </StreamPopMarkdown>
          ) : (
            <Markdown
              noPadding
              {...(props.onOpenExternal ? { onOpenExternal: props.onOpenExternal } : {})}
            >
              {props.text}
            </Markdown>
          )}
        </div>
      </div>
      {collapsed && <span className="sr-only">{copy.turn.collapsed}</span>}
      {clipped && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((open) => !open)}
          className="ui-control-squish ui-control-squish-ghost -ml-2 mt-1 flex h-6 w-fit cursor-pointer items-center rounded-md px-2 text-xs leading-5 text-text-muted outline-none transition-colors hover:text-text-secondary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
        >
          {expanded ? copy.turn.showLess : copy.turn.showMore}
        </button>
      )}
    </>
  );
}

/**
 * A reasoning step on a group's timeline. `isFirst` / `isLast` draw the same
 * gaps and connector a `ToolRow` draws, so the two kinds of step share one
 * line.
 */
export const ThinkingStep = memo(function ThinkingStep(props: {
  text: string;
  live?: boolean;
  truncated?: boolean;
  isFirst: boolean;
  isLast: boolean;
  onOpenExternal?: (url: string) => void;
}) {
  const copy = getTranscriptCopy(useUiLocale());
  if (!props.text.trim()) return null;

  return (
    <div className="flex shrink-0 flex-col" data-maka-thinking="">
      <StepGap on={!props.isFirst} />
      <div className="flex flex-row">
        {/* Written out rather than composed from `stepIconColClass`: this
            column stacks a glyph over a line, so it centres across the axis
            that class centres along. */}
        <div className="flex w-5 shrink-0 flex-col items-center text-text-muted" aria-hidden="true">
          <div className="py-1">
            <Anthropicon name="thinking" size={20} />
          </div>
          <div className={cn('w-px flex-1', !props.isLast && 'bg-hairline')} />
        </div>
        {/* `px-2.5` is what puts the text in the same column as every row's
            title — the tool rows get theirs from `stepBodyClass`. */}
        <div className="min-w-0 flex-1 px-2.5 py-1">
          <ThinkingText
            text={props.text}
            {...(props.live ? { live: true } : {})}
            {...(props.onOpenExternal ? { onOpenExternal: props.onOpenExternal } : {})}
          />
          {props.truncated && (
            <p className="mt-1 text-xs leading-4 text-text-muted">{copy.thinking.truncated}</p>
          )}
        </div>
      </div>
      <StepGap on={!props.isLast} />
    </div>
  );
});
