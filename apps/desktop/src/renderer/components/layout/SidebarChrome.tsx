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

// The sidebar's titlebar row (plan §2.12).
//
// The first row of the sidebar column IS the window titlebar: it leaves room
// for the macOS traffic lights on the left (`--maka-titlebar-gutter-left`) and
// then holds the collapse toggle and the search button. Because the row
// belongs to the sidebar, it is there whenever the sidebar is — expanded or
// hover-peeked — and the collapsed-state rail (`CollapsedSidebarRail`) draws
// the same two buttons at the same coordinates, so the toggle never moves.

import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { SidebarTooltip } from '../ui/sidebar-tooltip.js';
import { cn } from '../../lib/cn.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import type { SidebarLayout } from '../../hooks/use-sidebar-layout.js';

export const titlebarIconButtonClass =
  'sidebar-icon-btn maka-no-drag flex size-7 cursor-pointer items-center justify-center rounded-md text-sidebar-text-secondary hover:bg-sidebar-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none';

export function SidebarChrome(props: { layout: SidebarLayout; onOpenSearch: () => void }) {
  const locale = useUiLocale();
  const chrome = getShellCopy(locale).chrome;
  const sidebar = getSidebarCopy(locale);
  const layout = props.layout;
  return (
    <div
      className="maka-titlebar-row maka-titlebar-gutter-left flex shrink-0 items-center gap-0.5 pr-2"
      data-maka-contract="shell-topbar-rail"
      role="group"
      aria-label={chrome.windowActions}
    >
      <SidebarTooltip
        content={layout.collapsed ? chrome.expandSidebar : chrome.collapseSidebar}
        alwaysShow
        side="bottom"
      >
        <button
          ref={layout.sidebarCloseButtonRef}
          type="button"
          onClick={(event) => {
            // Expanded: collapse. Hover-peeked (still collapsed): pin it open.
            // Either way the peek is over, and the toggle flips the stored state.
            layout.closePeek();
            if (event.detail === 0) layout.requestSidebarFocus(layout.collapsed ? 'close' : 'opener');
            layout.toggle();
          }}
          aria-label={layout.collapsed ? chrome.expandSidebar : chrome.collapseSidebar}
          aria-controls="app-sidebar"
          aria-expanded={!layout.collapsed}
          aria-keyshortcuts="Meta+B"
          className={titlebarIconButtonClass}
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
          className={cn(titlebarIconButtonClass)}
        >
          <Anthropicon name="search" />
        </button>
      </SidebarTooltip>
    </div>
  );
}
