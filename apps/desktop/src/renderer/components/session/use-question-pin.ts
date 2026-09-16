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

// relx's reading model after a send (`ChatMessages.adjustScrollHeight`): the
// question the reader just sent goes to the top of the viewport, the answer
// fills the space beneath it, and the viewport stays put while it streams. The
// reader reads from the question down instead of being pushed along by the
// tail; the jump-to-latest disc offers the tail when there is more below.
//
// The scroll authority owns every write to `scrollTop`, including this one:
// `holdTurn` animates the question into place, holds it there against the row
// swap that follows admission, and ends the hold on the first reader input.
// What stays here is the surface's own knowledge — which element is the
// question, the feed that carries the floor, the end of content — and the
// two mechanics relx measures from the DOM rather than from message data:
//
// - A question can only reach the top if there is enough scroll room beneath
//   it, so the feed is given a `min-height` of "target scroll offset plus one
//   viewport" (relx's 人造留白) for every aim the authority takes. As the
//   answer grows the void it fills shrinks by itself: min-height is a floor.
// - The floor is released ratchet-wise as the reader scrolls: it only ever
//   shrinks, to the height that still keeps the question pinned, so scrolling
//   back into history cannot leave a blank block under the content. It goes
//   entirely whenever the authority pins to the tail, so the tail it writes to
//   is the content's real end.
// - The disc's visibility is the END OF CONTENT crossing a line 100px below
//   the viewport, observed by an IntersectionObserver rather than polled: the
//   floor would otherwise count as unread, and a timer would run for nothing.
// - A question that is already the transcript's first row is left alone: there
//   is nothing above it to carry it past, so both mechanics would fire for
//   nothing (see `standsAtTop`).
//
// One departure from relx, deliberate: a reader who scrolls back down to the
// tail re-engages the authority's pin, and the tail then follows the stream
// again, the way claude.ai behaves.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { TranscriptScrollAuthority, TranscriptViewportNavigation } from '@maka/ui';

/** Where the question sits below the viewport's top edge after a send. */
const QUESTION_TOP_OFFSET_PX = 24;
/** Content this far below the viewport bottom shows the jump-to-latest disc. */
const JUMP_THRESHOLD_PX = 100;
/** Attachment cards animate in; measuring earlier reads a shorter question. */
const PIN_DELAY_MS = 50;

/**
 * Whether the question is the transcript's first row, with nothing above it but
 * the feed's own leading space.
 *
 * The pin carries a question UP to the top edge. The first question of a
 * conversation is already there, so the aim measures the leading space as
 * travel — 16px of `pt-4`, or the whole attachment row when there is one — and
 * the floor then asks for a viewport plus that travel. On a conversation whose
 * whole content fits, that is a scrollbar on a page with nothing to scroll and
 * a viewport that creeps a few pixels at the moment the answer arrives. Nothing
 * to carry, so nothing is written.
 */
function standsAtTop(feed: HTMLElement, question: HTMLElement): boolean {
  let row: HTMLElement | null = question;
  while (row && row.parentElement !== feed) row = row.parentElement;
  return row !== null && row.previousElementSibling === null;
}

export function useQuestionPin(input: {
  scrollRef: RefObject<HTMLElement | null>;
  feedRef: RefObject<HTMLElement | null>;
  endRef: RefObject<HTMLElement | null>;
  sessionId: string;
  authority: TranscriptScrollAuthority;
  viewportNavigation: TranscriptViewportNavigation;
}): { contentBelow: boolean; jumpToLatest: () => void } {
  const { scrollRef, feedRef, endRef, sessionId, authority, viewportNavigation } = input;
  const [contentBelow, setContentBelow] = useState(false);
  const endBelow = useRef(false);

  /** Scroll-coordinate top of an element inside the scroller. */
  const topOf = useCallback(
    (root: HTMLElement, element: Element): number =>
      element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop,
    [],
  );
  const lastQuestion = useCallback((): HTMLElement | null => {
    const feed = feedRef.current;
    if (!feed) return null;
    const rows = feed.querySelectorAll<HTMLElement>('[data-role="user"]');
    return rows[rows.length - 1] ?? null;
  }, [feedRef]);
  // With attachments the card row reads as empty space above the text, so the
  // question sits flush with the top instead of 24px below it.
  const offsetFor = (question: HTMLElement): number =>
    question.dataset.hasAttachments === 'true' ? 0 : QUESTION_TOP_OFFSET_PX;
  const questionTarget = useCallback(
    (root: HTMLElement, question: HTMLElement): number =>
      Math.max(0, topOf(root, question) - offsetFor(question)),
    [topOf],
  );

  // The disc: content below, and the authority not mid-flight (a hold sweeps
  // the end of content past the line and back within one animation).
  const publishDisc = useCallback(() => {
    setContentBelow(endBelow.current && !authority.getSnapshot().holding);
  }, [authority]);

  const releaseFloor = useCallback(() => {
    const root = scrollRef.current;
    const feed = feedRef.current;
    if (!root || !feed || authority.getSnapshot().holding) return;
    const current = Number.parseFloat(feed.style.minHeight || '0');
    if (!current) return;
    const question = lastQuestion();
    const needed = question
      ? questionTarget(root, question) + root.clientHeight
      : root.scrollTop + root.clientHeight;
    if (needed < current - 1) feed.style.minHeight = `${needed}px`;
  }, [authority, feedRef, lastQuestion, questionTarget, scrollRef]);

  const pinQuestion = useCallback(() => {
    const root = scrollRef.current;
    const feed = feedRef.current;
    const question = lastQuestion();
    if (!root || !feed || !question) return;
    if (standsAtTop(feed, question)) return;
    authority.holdTurn(question, {
      offset: offsetFor(question),
      ensureRoom: (targetTop) => {
        feed.style.minHeight = `${targetTop + root.clientHeight}px`;
      },
    });
  }, [authority, feedRef, lastQuestion, scrollRef]);

  // A send: the store publishes one navigation per send, and the scroller has
  // already released its tail pin for it. Wait a frame plus the attachment
  // animation before measuring the question's height.
  useEffect(
    () =>
      viewportNavigation.subscribe((id) => {
        if (id !== sessionId) return;
        requestAnimationFrame(() => {
          window.setTimeout(pinQuestion, PIN_DELAY_MS);
        });
      }),
    [pinQuestion, sessionId, viewportNavigation],
  );

  // Reader movement releases the floor.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    root.addEventListener('scroll', releaseFloor, { passive: true });
    return () => root.removeEventListener('scroll', releaseFloor);
  }, [releaseFloor, scrollRef, sessionId]);

  // The end of content against a line 100px below the viewport. The observer
  // reports every crossing, whether the reader scrolled or the answer grew.
  useEffect(() => {
    const root = scrollRef.current;
    const end = endRef.current;
    if (!root || !end) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (!entry || !entry.rootBounds) return;
        endBelow.current =
          !entry.isIntersecting && entry.boundingClientRect.top > entry.rootBounds.bottom;
        publishDisc();
      },
      { root, rootMargin: `0px 0px ${JUMP_THRESHOLD_PX}px 0px` },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [endRef, publishDisc, scrollRef, sessionId]);

  // The authority's pin means "follow the tail": whenever it engages — a send
  // to a fresh Session, a reader scrolling back down to the bottom, a jump —
  // the floor goes. The end of a hold re-judges the disc.
  useEffect(() => {
    const follow = () => {
      const feed = feedRef.current;
      if (authority.getSnapshot().pinned && feed?.style.minHeight) feed.style.minHeight = '';
      publishDisc();
    };
    follow();
    return authority.subscribe(follow);
  }, [authority, feedRef, publishDisc]);

  // A new Session starts without a floor and without a stale verdict.
  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.style.minHeight = '';
    endBelow.current = false;
    setContentBelow(false);
  }, [feedRef, sessionId]);

  const jumpToLatest = useCallback(() => {
    const feed = feedRef.current;
    if (feed) feed.style.minHeight = '';
    authority.pinToTail();
  }, [authority, feedRef]);

  return { contentBelow, jumpToLatest };
}
