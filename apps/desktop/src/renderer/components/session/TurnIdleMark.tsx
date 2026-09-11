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

// The mark at the foot of a settled conversation. Ported from the reference
// design system's `ChatStatusIndicator` completed state: where the status line
// stood while the turn ran, the same mark now stands still, with a quip on
// hover, and a click makes it breathe for a second. It is the one bit of play
// in the transcript, and it also tells the reader where the end is.
//
// It is only ever shown at the tail: not while a turn runs (the status line
// has that spot), not while a page of older history is on screen.

import { useMemo, useRef, useState } from 'react';
import { useUiLocale } from '@maka/ui';
import { RelxMark } from '../icons/RelxMark.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';

const BREATHE_ON_CLICK_MS = 1_000;

export function TurnIdleMark() {
  const copy = getTranscriptCopy(useUiLocale()).idleMark;
  // One quip per mount, like the reference — not one per render.
  const quip = useMemo(
    () => copy.quips[Math.floor(Math.random() * copy.quips.length)] ?? copy.label,
    [copy],
  );
  const [breathing, setBreathing] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const poke = () => {
    setBreathing(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setBreathing(false), BREATHE_ON_CLICK_MS);
  };

  return (
    <div className="ml-1 mt-6" data-maka-contract="turn-idle-mark">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={copy.label}
            onClick={poke}
            className="flex w-fit cursor-pointer rounded-md text-fill-brand outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]"
          >
            <RelxMark size={32} animated={breathing} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{quip}</TooltipContent>
      </Tooltip>
    </div>
  );
}
