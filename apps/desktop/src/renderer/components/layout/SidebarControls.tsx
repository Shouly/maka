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

// The sidebar toggle and the search button — the two controls that sit right
// of the traffic lights, in the window titlebar's left segment. There is ONE
// copy: when the hover-peek panel slides in from the window's top edge, the
// segment stays stacked above it (transparent, so the panel's surface shows
// through), and the same buttons keep their hover state, tooltip and place —
// nothing remounts, so nothing flickers or moves.

import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { SidebarTooltip } from '../ui/sidebar-tooltip.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import type { SidebarLayout } from '../../hooks/use-sidebar-layout.js';

export const sidebarControlButtonClass =
  'sidebar-icon-btn maka-no-drag flex size-7 cursor-pointer items-center justify-center rounded-md text-sidebar-text-secondary hover:bg-sidebar-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none';

export function SidebarControls(props: { layout: SidebarLayout; onOpenSearch: () => void }) {
  const locale = useUiLocale();
  const chrome = getShellCopy(locale).chrome;
  const sidebar = getSidebarCopy(locale);
  const layout = props.layout;
  const collapsed = layout.collapsed;
  return (
    <>
      <SidebarTooltip
        content={collapsed ? chrome.expandSidebar : chrome.collapseSidebar}
        alwaysShow
        side="bottom"
      >
        <button
          ref={(element) => {
            // The collapsed-state opener and the expanded-state close the
            // layout hook hands focus to are this one button.
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
          className={sidebarControlButtonClass}
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
          className={sidebarControlButtonClass}
        >
          <Anthropicon name="search" />
        </button>
      </SidebarTooltip>
    </>
  );
}
