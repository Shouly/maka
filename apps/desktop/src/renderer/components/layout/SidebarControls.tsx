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
// of the traffic lights. Rendered in two places with identical geometry: the
// window titlebar's left segment, and the top row of the hover-peek panel,
// which slides over that segment from the window's top edge so the panel
// and the titlebar read as one surface (the reference desktop pattern). The
// pointer never sees the buttons move: the peek row draws them where the
// titlebar drew them.

import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { SidebarTooltip } from '../ui/sidebar-tooltip.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import type { SidebarLayout } from '../../hooks/use-sidebar-layout.js';

export const sidebarControlButtonClass =
  'sidebar-icon-btn maka-no-drag flex size-7 cursor-pointer items-center justify-center rounded-md text-sidebar-text-secondary hover:bg-sidebar-hover hover:text-sidebar-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none';

export function SidebarControls(props: {
  layout: SidebarLayout;
  onOpenSearch: () => void;
  /**
   * `titlebar`: the persistent copy (owns the layout hook's opener/close refs
   * and the collapsed-state hover). `peek`: the copy inside the peek panel,
   * whose toggle pins the panel open.
   */
  place: 'titlebar' | 'peek';
}) {
  const locale = useUiLocale();
  const chrome = getShellCopy(locale).chrome;
  const sidebar = getSidebarCopy(locale);
  const layout = props.layout;
  const collapsed = layout.collapsed;
  const inTitlebar = props.place === 'titlebar';
  return (
    <>
      <SidebarTooltip
        content={collapsed ? chrome.expandSidebar : chrome.collapseSidebar}
        alwaysShow
        side="bottom"
      >
        <button
          ref={
            inTitlebar
              ? (element) => {
                  layout.peekOpenerRef.current = element;
                  layout.sidebarCloseButtonRef.current = element;
                }
              : undefined
          }
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
          data-maka-search-trigger={inTitlebar ? '' : undefined}
          className={sidebarControlButtonClass}
        >
          <Anthropicon name="search" />
        </button>
      </SidebarTooltip>
    </>
  );
}
