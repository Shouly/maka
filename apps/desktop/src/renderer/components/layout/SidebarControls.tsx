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

// One stable toggle, shared by the collapsed preview and expanded sidebar.

import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { SidebarTooltip } from '../ui/sidebar-tooltip.js';
import { getSidebarCopy } from '../../locales/sidebar-copy.js';
import type { PageHistoryControls } from '../../hooks/use-page-history.js';
import { cn } from '../../lib/cn.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import type { SidebarLayout } from '../../hooks/use-sidebar-layout.js';

// Primary, not the reference's secondary: these buttons stand in the window
// titlebar beside the traffic lights, and at that spot the secondary grey read
// as disabled (owner decision 2026-09-11). Hover keeps the background lift.
export const sidebarControlButtonClass =
  'sidebar-icon-btn maka-no-drag flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-text-primary hover:bg-sidebar-hover focus-visible:shadow-[var(--sidebar-focus-shadow)] focus-visible:outline-none';

export function SidebarControls(props: { layout: SidebarLayout; history: PageHistoryControls }) {
  const locale = useUiLocale();
  const chrome = getShellCopy(locale).chrome;
  const copy = getSidebarCopy(locale);
  const layout = props.layout;
  const collapsed = layout.collapsed;
  return (
    <>
      <div className="flex items-center" {...(collapsed ? layout.openerHoverProps : {})}>
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
      </div>
      {(
        [
          {
            label: copy.goBack,
            icon: 'arrowLeft',
            enabled: props.history.canGoBack,
            onClick: props.history.goBack,
          },
          {
            label: copy.goForward,
            icon: 'arrowRight',
            enabled: props.history.canGoForward,
            onClick: props.history.goForward,
          },
        ] as const
      ).map((action) => (
        <SidebarTooltip key={action.icon} content={action.label} alwaysShow side="bottom">
          <span className="inline-flex">
            <button
              type="button"
              aria-label={action.label}
              disabled={!action.enabled}
              onClick={action.onClick}
              className={cn(
                sidebarControlButtonClass,
                'disabled:cursor-default disabled:text-sidebar-text-muted/40 disabled:hover:bg-transparent disabled:hover:text-sidebar-text-muted/40',
              )}
            >
              <Anthropicon name={action.icon} size={16} />
            </button>
          </span>
        </SidebarTooltip>
      ))}
    </>
  );
}
