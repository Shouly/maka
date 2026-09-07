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

// The app shell frame. Ported from the reference design system's `AppLayout`:
// `data-app-shell` + `data-sidebar-collapsed` on the root, the sidebar, and a
// `<main data-sidebar-main>` that owns everything to its right.
//
// `relative` on `<main>` is the positioning base the right pane (Phase 4) will
// use for its full-screen state; keeping it here means that pane lays out
// against the same box the sidebar sits beside, so it narrows and widens with
// the rail rather than over it.
//
// This sits INSIDE `.appFrame`, below the 36px titlebar strip, because the
// window is frameless with a native overlay and that strip is the whole tree's
// only draggable surface.

import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.js';

export function AppLayout(props: {
  sidebar: ReactNode;
  collapsed: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-app-shell=""
      data-sidebar-collapsed={props.collapsed ? 'true' : 'false'}
      // `relative`: the hover-peek sidebar is `absolute top-0` and must be
      // positioned against THIS box (below the titlebar row), never the window.
      className={cn('relative flex min-h-0 flex-1 bg-surface-1', props.className)}
    >
      {props.sidebar}
      <main
        data-sidebar-main=""
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        {props.children}
      </main>
    </div>
  );
}
