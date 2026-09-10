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

// The window titlebar (plan §2.12): ONE fixed row across the whole window,
// exactly like a native desktop app.
//
//   [traffic lights] [sidebar toggle] | [session identity] … [actions]
//
// The row is a normal flow row at the top of `.appFrame`; the sidebar and
// the content column start BELOW it. The hover-peek panel is the exception:
// it slides in from the window's top edge OVER the left segment and redraws
// the same toggle (`SidebarControls`) at the same coordinates, so panel
// and titlebar read as one surface and the toggle never appears to move. The
// row is the app's only drag surface; its controls are `no-drag`. The left
// segment is as wide as the sidebar and paints the sidebar's background and
// hairline edge, so the sidebar reads as one column up to the window edge.

import type { ReactNode } from 'react';
import { useUiLocale } from '@maka/ui';
import { SidebarTooltipProvider } from '../ui/sidebar-tooltip.js';
import { SidebarControls } from './SidebarControls.js';
import { cn } from '../../lib/cn.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import type { PageHistoryControls } from '../../hooks/use-page-history.js';
import type { SidebarLayout } from '../../hooks/use-sidebar-layout.js';

export interface WindowTitlebarProps {
  layout: SidebarLayout;
  history: PageHistoryControls;
  /** Who the content column is showing. */
  identity?: ReactNode;
  softEdge?: boolean;
  /** Actions for the current page. */
  actions?: ReactNode;
  /**
   * Not drawn, but still holding its 48px. The full-screen right pane covers
   * the window, and every control in this row then points at something the
   * pane is on top of: the sidebar it would expand, the pages it would step
   * back through. Drawing them would put a row of dead buttons over the pane.
   *
   * `visibility: hidden` rather than unmounting or `display: none`: the row
   * keeps its height, so the column under it is not relaid out on the way in
   * and back out, and hit-testing and the accessibility tree drop it too.
   */
  concealed?: boolean;
}

export function WindowTitlebar(props: WindowTitlebarProps) {
  const locale = useUiLocale();
  const chrome = getShellCopy(locale).chrome;
  const layout = props.layout;
  const collapsed = layout.collapsed;
  return (
    <SidebarTooltipProvider>
      <div
        className={cn('maka-window-titlebar', props.concealed && 'maka-window-titlebar-concealed')}
        role="presentation"
      >
        {/* Left segment: the sidebar's share of the row. Its width follows the
            sidebar so the identity starts at the seam; when collapsed it only
            wraps the navigation controls. */}
        <div
          className={cn(
            'maka-titlebar-rail maka-titlebar-gutter-left',
            // Expanded: this segment is the top of the sidebar column, so it
            // carries the column's background and its hairline right edge.
            // Width = the sidebar's LIVE width (`--maka-sidenav-width`, written
            // per frame by the resize drag), never a React-committed number.
            collapsed
              ? 'maka-titlebar-rail-collapsed'
              : 'w-[var(--maka-sidenav-width)] border-r border-hairline bg-sidebar',
            layout.isResizing
              ? 'transition-none'
              : 'transition-[width] duration-200 ease-out motion-reduce:transition-none',
          )}
          data-maka-contract="shell-topbar-rail"
          role="group"
          aria-label={chrome.windowActions}
        >
          <SidebarControls layout={layout} history={props.history} />
        </div>
        <div className="relative isolate z-10 flex h-full min-w-0 flex-1 items-center">
          <div className="maka-titlebar-identity">{props.identity}</div>
          <div className="maka-titlebar-actions maka-titlebar-gutter-right">{props.actions}</div>
          {props.softEdge && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -bottom-6 z-[-1] bg-surface-1 [mask-image:linear-gradient(to_bottom,black_66.67%,transparent)]"
            />
          )}
        </div>
      </div>
    </SidebarTooltipProvider>
  );
}
