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

// The window titlebar row (plan §2.12).
//
// A desktop window's first row is the system titlebar: on macOS the traffic
// lights sit at its left edge, on Windows the caption buttons at its right.
// The app chrome that belongs on that row — the sidebar toggle and search
// button right next to the traffic lights, the session identity over the
// content column, the right-side actions — lives here and nowhere else. This
// is the only `-webkit-app-region: drag` surface in the tree (styles/globals.css
// `.maka-window-titlebar`); the three clusters opt back out.
//
// The strip is transparent and absolute: the sidebar and content columns paint
// its background and align to it through `--maka-sidenav-width`.

import type { ReactNode } from 'react';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { SidebarTooltip, SidebarTooltipProvider } from '../ui/sidebar-tooltip.js';
import { cn } from '../../lib/cn.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import type { SidebarLayout } from '../../hooks/use-sidebar-layout.js';

export const titlebarIconButtonClass =
  'sidebar-icon-btn flex size-7 cursor-pointer items-center justify-center rounded-md text-sidebar-text-secondary hover:bg-sidebar-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none';

export interface WindowTitlebarProps {
  layout: SidebarLayout;
  onOpenSearch: () => void;
  /** Column 2: who the content column is showing. */
  identity?: ReactNode;
  /** Column 3: right-side actions (model switcher, later the workbar toggle). */
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
        <div
          className="maka-titlebar-rail"
          data-maka-contract="shell-topbar-rail"
          role="group"
          aria-label={chrome.windowActions}
          // While collapsed, hovering the toggle peeks the sidebar open; the
          // hook owns that timing and reads the pointer through these props.
          {...(collapsed ? layout.openerHoverProps : {})}
        >
          <SidebarTooltip
            content={collapsed ? chrome.expandSidebar : chrome.collapseSidebar}
            alwaysShow
            side="bottom"
          >
            <button
              ref={(element) => {
                // One button serves both focus hand-offs the layout hook knows:
                // the collapsed-state opener and the expanded-state close.
                layout.peekOpenerRef.current = element;
                layout.sidebarCloseButtonRef.current = element;
              }}
              type="button"
              onClick={(event) => {
                if (collapsed) layout.closePeek();
                // `detail === 0` is a keyboard activation: keep focus on this
                // button, which stays in place across the toggle.
                if (event.detail === 0) layout.requestSidebarFocus(collapsed ? 'close' : 'opener');
                layout.toggle();
              }}
              aria-label={collapsed ? chrome.expandSidebar : chrome.collapseSidebar}
              aria-controls="app-sidebar"
              aria-expanded={!collapsed}
              aria-keyshortcuts="Meta+B"
              className={cn(titlebarIconButtonClass, 'maka-no-drag')}
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
              className={cn(titlebarIconButtonClass, 'maka-no-drag')}
            >
              <Anthropicon name="search" />
            </button>
          </SidebarTooltip>
        </div>
        <div className="maka-titlebar-identity">{props.identity}</div>
        <div className="maka-titlebar-actions">{props.actions}</div>
      </div>
    </SidebarTooltipProvider>
  );
}
