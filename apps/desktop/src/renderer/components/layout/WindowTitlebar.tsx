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
//   [traffic lights] [sidebar toggle] [search] | [session identity] … [actions]
//
// The row is a normal flow row at the top of `.appFrame`; the sidebar and
// the content column start BELOW it, and so does the hover-peek panel — so
// nothing ever covers the toggle, and it never moves, whatever the sidebar's
// state. The row is the app's only drag surface; its controls are `no-drag`.
// The left segment is as wide as the sidebar and paints the sidebar's
// background, so the sidebar reads as one column up to the window edge.

import type { ReactNode } from 'react';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { SidebarTooltip, SidebarTooltipProvider } from '../ui/sidebar-tooltip.js';
import { cn } from '../../lib/cn.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import type { SidebarLayout } from '../../hooks/use-sidebar-layout.js';

const iconButtonClass =
  'sidebar-icon-btn maka-no-drag flex size-7 cursor-pointer items-center justify-center rounded-md text-sidebar-text-secondary hover:bg-sidebar-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none';

export interface WindowTitlebarProps {
  layout: SidebarLayout;
  onOpenSearch: () => void;
  /** Who the content column is showing. */
  identity?: ReactNode;
  /** Right-side actions: model switcher, later the workbar toggle. */
  actions?: ReactNode;
}

export function WindowTitlebar(props: WindowTitlebarProps) {
  const locale = useUiLocale();
  const chrome = getShellCopy(locale).chrome;
  const sidebar = getSidebarCopy(locale);
  const layout = props.layout;
  const collapsed = layout.collapsed;
  return (
    <SidebarTooltipProvider>
      <div className="maka-window-titlebar" role="presentation">
        {/* Left segment: the sidebar's share of the row. Its width follows the
            sidebar so the identity starts at the seam; when collapsed it only
            wraps the two buttons. */}
        <div
          className={cn(
            'maka-titlebar-rail maka-titlebar-gutter-left',
            collapsed ? 'maka-titlebar-rail-collapsed' : 'bg-sidebar',
            layout.isResizing
              ? 'transition-none'
              : 'transition-[width] duration-200 ease-out motion-reduce:transition-none',
          )}
          style={collapsed ? undefined : { width: layout.width }}
          data-maka-contract="shell-topbar-rail"
          role="group"
          aria-label={chrome.windowActions}
          // Collapsed: hovering the toggle peeks the sidebar open below this row.
          {...(collapsed ? layout.openerHoverProps : {})}
        >
          <SidebarTooltip
            content={collapsed ? chrome.expandSidebar : chrome.collapseSidebar}
            alwaysShow
            side="bottom"
          >
            <button
              ref={(element) => {
                // The same button is the collapsed-state opener and the
                // expanded-state close the layout hook hands focus to.
                layout.peekOpenerRef.current = element;
                layout.sidebarCloseButtonRef.current = element;
              }}
              type="button"
              onClick={() => {
                layout.closePeek();
                layout.toggle();
              }}
              aria-label={collapsed ? chrome.expandSidebar : chrome.collapseSidebar}
              aria-controls="app-sidebar"
              aria-expanded={!collapsed}
              aria-keyshortcuts="Meta+B"
              className={iconButtonClass}
            >
              <Anthropicon name="sidebar" />
            </button>
          </SidebarTooltip>
          <SidebarTooltip content={sidebar.search} alwaysShow side="bottom">
            <button
              type="button"
              onClick={props.onOpenSearch}
              aria-label={sidebar.search}
              data-maka-search-trigger=""
              className={iconButtonClass}
            >
              <Anthropicon name="search" />
            </button>
          </SidebarTooltip>
        </div>
        <div className="maka-titlebar-identity">{props.identity}</div>
        <div className="maka-titlebar-actions maka-titlebar-gutter-right">{props.actions}</div>
      </div>
    </SidebarTooltipProvider>
  );
}
