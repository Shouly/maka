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

// A reasoning block. Look ported from the reference design system's
// `ThinkingRenderer`: a clock glyph, the text at secondary weight, a 200px
// clip with a mask instead of a gradient overlay, and one Show more/less
// control that keeps `aria-expanded` on the same element across both states.
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

/** Past this height the block clips and offers to open. */
const CLIP_HEIGHT_PX = 200;

export const ThinkingBlock = memo(function ThinkingBlock(props: {
  text: string;
  live?: boolean;
  truncated?: boolean;
  onOpenExternal?: (url: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale);
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

  if (!props.text.trim()) return null;
  const collapsed = clipped && !expanded;

  return (
    <div className="my-2 flex flex-row gap-2" data-maka-thinking="">
      <div className="flex w-5 shrink-0 justify-center pt-0.5 text-text-muted" aria-hidden="true">
        <Anthropicon name="thinking" size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 pb-1">
          <span
            className="text-sm leading-5 text-text-muted"
            role={props.live ? 'status' : undefined}
          >
            {props.live ? copy.thinking.active : copy.thinking.label}
          </span>
          {props.truncated && (
            <span className="rounded-full bg-alpha-1 px-2 py-0.5 text-[0.6875rem] leading-4 text-text-muted">
              {copy.thinking.truncated}
            </span>
          )}
        </div>
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
      </div>
    </div>
  );
});
