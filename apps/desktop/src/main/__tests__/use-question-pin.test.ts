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

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { act, createElement } from 'react';
import { createTranscriptScrollAuthority, createTranscriptViewportNavigation } from '@maka/ui';
import { cleanupFakeDom, installReactRenderer } from './fake-dom.js';
import { useQuestionPin } from '../../renderer/components/session/use-question-pin.js';

/**
 * The floor under a pinned question is what keeps it at the top while a short
 * answer does not fill the viewport. Right after a send the viewport sits at
 * the floor's bottom, so a trackpad brush downwards re-engages the authority's
 * pin there. Taking the floor with that pin shrank the page under the reader
 * and dropped the question by up to a viewport in one frame.
 */
describe('useQuestionPin', () => {
  afterEach(() => {
    cleanupFakeDom();
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it('keeps the floor when the pin re-engages, and drops it on a jump to latest', () => {
    const { root } = installReactRenderer();
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      observe(): void {}
      disconnect(): void {}
    };
    const scroller = {
      scrollTop: 0,
      clientHeight: 600,
      getBoundingClientRect: () => ({ top: 0 }),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const feed = { style: { minHeight: '' }, querySelectorAll: () => [] };
    const authority = createTranscriptScrollAuthority();
    let jumpToLatest: (() => void) | undefined;

    function Probe(): null {
      ({ jumpToLatest } = useQuestionPin({
        scrollRef: { current: scroller as unknown as HTMLElement },
        feedRef: { current: feed as unknown as HTMLElement },
        endRef: { current: {} as HTMLElement },
        sessionId: 'session-1',
        authority,
        viewportNavigation: createTranscriptViewportNavigation(),
      }));
      return null;
    }
    act(() => root.render(createElement(Probe)));

    // A send has carried the question up and laid a floor beneath it.
    feed.style.minHeight = '1500px';
    act(() => authority.releasePin());
    // The reader brushes downwards at the floor's bottom: the pin re-engages.
    act(() => authority.pinToTail());
    assert.equal(authority.getSnapshot().pinned, true);
    assert.equal(feed.style.minHeight, '1500px', 'the floor stays under the pin');

    // Asking for the latest is asking for the content's real end.
    act(() => jumpToLatest?.());
    assert.equal(feed.style.minHeight, '');
  });
});
