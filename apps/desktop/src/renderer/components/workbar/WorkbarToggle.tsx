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

import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { SidebarTooltip } from '../ui/sidebar-tooltip.js';
import { sidebarControlButtonClass } from '../layout/SidebarControls.js';
import { cn } from '../../lib/cn.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import type { WorkbarModel } from '../../hooks/use-workbar.js';

export function WorkbarToggle(props: { workbar: WorkbarModel }) {
  const chrome = getShellCopy(useUiLocale()).chrome;
  const { collapsed } = props.workbar;
  const label = collapsed ? chrome.expandWorkbar : chrome.collapseWorkbar;
  return (
    // The same button as the sidebar toggle at the other end of the titlebar
    // — one class, one icon size, one colour — mirrored. While the pane is
    // open it keeps the lifted background, the same token hover uses, so an
    // open pane reads on the button that closes it.
    <SidebarTooltip content={label} alwaysShow side="bottom">
      <button
        type="button"
        onClick={props.workbar.toggle}
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls="maka-workbar-pane"
        aria-keyshortcuts="Meta+Alt+S"
        data-maka-contract="session-workbar-toggle"
        className={cn(
          sidebarControlButtonClass,
          !collapsed && 'bg-sidebar-hover text-sidebar-text-primary',
        )}
      >
        <Anthropicon name="sidebar" className="rotate-180" />
      </button>
    </SidebarTooltip>
  );
}
