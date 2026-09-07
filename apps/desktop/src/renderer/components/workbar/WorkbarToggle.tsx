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

// The right pane's switch, in the window titlebar's actions slot.
//
// It lives there rather than on the pane because it must be reachable when the
// pane is not on screen — a control that only exists while the thing it opens
// is already open cannot open it. It is the row's right-most control (plan
// §2.12), beside the model switcher, and it is `maka-no-drag` like every other
// control inside the drag strip.
//
// The count badge carries `data-maka-contract="session-workbar-count"`, the
// attribute the pre-rewrite accessibility contract named for it, and states how
// many faces are open — the one fact the collapsed pane cannot show itself.

import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { SidebarTooltip } from '../ui/sidebar-tooltip.js';
import { sidebarControlButtonClass } from '../layout/SidebarControls.js';
import { countBadgeClass, countBadgeAccentClass, formatCount } from '../ui/count-badge.js';
import { cn } from '../../lib/cn.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import type { WorkbarModel } from '../../hooks/use-workbar.js';

export function WorkbarToggle(props: { workbar: WorkbarModel }) {
  const chrome = getShellCopy(useUiLocale()).chrome;
  const { collapsed, tabs } = props.workbar;
  const label = collapsed ? chrome.expandWorkbar : chrome.collapseWorkbar;
  return (
    <SidebarTooltip content={label} alwaysShow side="bottom">
      <button
        type="button"
        onClick={props.workbar.toggle}
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls="maka-workbar-pane"
        aria-keyshortcuts="Meta+Alt+S"
        data-maka-contract="session-workbar-toggle"
        className={cn(sidebarControlButtonClass, 'relative')}
      >
        <Anthropicon name="sidebar" className="rotate-180" />
        {tabs.length > 0 && (
          <span
            data-maka-contract="session-workbar-count"
            className={cn(
              countBadgeClass,
              countBadgeAccentClass,
              'pointer-events-none absolute -right-0.5 -top-0.5',
            )}
          >
            {formatCount(tabs.length)}
          </span>
        )}
      </button>
    </SidebarTooltip>
  );
}
