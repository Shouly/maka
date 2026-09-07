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

// What stays of the sidebar when it is collapsed: its titlebar row's two
// buttons, fixed at the window's top-left in exactly the position the
// sidebar's own row (`SidebarChrome`) draws them, so collapsing and expanding
// never moves the toggle. Hovering the toggle peeks the sidebar open; the
// peek panel then covers this rail with its own identical row.

import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { SidebarTooltip, SidebarTooltipProvider } from '../ui/sidebar-tooltip.js';
import { cn } from '../../lib/cn.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import type { SidebarLayout } from '../../hooks/use-sidebar-layout.js';
import { titlebarIconButtonClass } from './SidebarChrome.js';

export function CollapsedSidebarRail(props: { layout: SidebarLayout; onOpenSearch: () => void }) {
  const locale = useUiLocale();
  const chrome = getShellCopy(locale).chrome;
  const sidebar = getSidebarCopy(locale);
  const layout = props.layout;
  return (
    <SidebarTooltipProvider>
      <div
        className={cn(
          'maka-collapsed-rail maka-titlebar-row maka-titlebar-gutter-left flex items-center gap-0.5',
          // While the peek panel is up it repaints this row in place; hide the
          // rail so the shell has one topbar rail at a time.
          layout.isPeekOpen && 'invisible',
        )}
        data-maka-contract={layout.isPeekOpen ? undefined : 'shell-topbar-rail'}
        role="group"
        aria-label={chrome.windowActions}
        aria-hidden={layout.isPeekOpen || undefined}
        inert={layout.isPeekOpen || undefined}
        {...layout.openerHoverProps}
      >
        <SidebarTooltip content={chrome.expandSidebar} alwaysShow side="bottom">
          <button
            ref={layout.peekOpenerRef}
            type="button"
            onClick={(event) => {
              layout.closePeek();
              // Keyboard activation: this rail is about to be replaced by the
              // expanded sidebar, whose own toggle takes the focus.
              if (event.detail === 0) layout.requestSidebarFocus('close');
              layout.toggle();
            }}
            aria-label={chrome.expandSidebar}
            aria-controls="app-sidebar"
            aria-expanded={false}
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
            className={titlebarIconButtonClass}
          >
            <Anthropicon name="search" />
          </button>
        </SidebarTooltip>
      </div>
    </SidebarTooltipProvider>
  );
}
