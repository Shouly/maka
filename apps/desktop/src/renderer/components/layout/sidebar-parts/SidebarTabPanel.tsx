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

// The panel skeleton: a fixed header, one scrolling list below it. Ported from
// the reference design system's `SidebarTabPanel`.
//
// The `min-h-0` chain is what makes it work — a flex child defaults to
// `min-height: auto`, and one missing `min-h-0` lets the list push the whole
// column past the viewport, taking the footer with it.
//
// The fade at the scroll boundary is a mask applied only while actually
// scrolled away from the top (`[data-scrolled]` in globals.css); at scrollTop 0
// it would eat the first row for no reason. It is a data attribute rather than
// state because scrolling is a high-frequency event and `setState` would
// re-render every row in the list per frame.

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../../lib/cn.js';

export function SidebarTabPanel(props: {
  header: ReactNode;
  children: ReactNode;
  scrollClassName?: string;
  scrollLabel?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sync = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (element.scrollTop > 0) element.setAttribute('data-scrolled', '');
    else element.removeAttribute('data-scrolled');
  }, []);
  // Also on mount: the scroll position survives a re-mount, and without this
  // the mask would be missing on the frame that restores it.
  useEffect(sync, [sync]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {props.header}
      <div
        ref={scrollRef}
        onScroll={sync}
        aria-label={props.scrollLabel}
        className={cn('sidebar-nav-scroll min-h-0 flex-1 overflow-y-auto', props.scrollClassName)}
      >
        {props.children}
      </div>
    </div>
  );
}
