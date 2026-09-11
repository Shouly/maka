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

// "Quote this into the composer", floating over a settled selection.
//
// `useMessageSelectionQuote` owns when it appears: a selection that has held
// still for a moment, inside a turn, with text in it. It re-measures the
// anchor rather than snapshotting it, so scrolling never leaves the button
// pointing at a place the selection has left — which is why the position comes
// from the hook on every render instead of from state of our own.
//
// Fixed positioning, not absolute: the anchor is in viewport coordinates and
// the transcript scroller would otherwise carry the button away with it.

import { memo, type RefObject } from 'react';
import { useMessageSelectionQuote, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { composerDraftStore } from '../../store/index.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';

export const SelectionQuote = memo(function SelectionQuote(props: {
  sessionId: string;
  scrollRef: RefObject<HTMLElement | null>;
  enabled: boolean;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).quote;
  const { quote, clear } = useMessageSelectionQuote(props.scrollRef, props.enabled);
  if (!quote) return null;
  return (
    <div
      className="fixed z-50 -translate-x-1/2 -translate-y-full pb-2"
      style={{ left: quote.anchor.x, top: quote.anchor.y }}
      data-maka-contract="selection-quote"
    >
      <button
        type="button"
        onClick={() => {
          composerDraftStore.addQuote(props.sessionId, {
            text: quote.text,
            sourceTurnId: quote.turnId,
          });
          clear();
        }}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-hairline bg-surface-3 px-3 text-[0.8125rem] leading-5 text-text-primary shadow-[var(--menu-shadow)] outline-none transition-colors hover:bg-alpha-1 focus-visible:shadow-[var(--sidebar-focus-shadow)]"
      >
        <Anthropicon name="reply" size={16} />
        {copy.action}
      </button>
    </div>
  );
});
