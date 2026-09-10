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

// The composer's permission control (upstream `PermissionModeSelect`) as a
// meta-row chip under the surface — the mode's label as text, opening a
// radio menu of the two selectable modes. Read-only (`explore`) is a real
// boundary a Session can be running under, so it is displayed with its own
// words, but never offered — the picker lists Auto and full access.
// Each mode explains its boundary in a tooltip on its menu row.

import type { PermissionMode } from '@maka/core/permission';
import type { ChatDefaultPermissionMode } from '@maka/core/settings';
import { CHAT_DEFAULT_PERMISSION_MODES } from '@maka/core/settings';
import { getConversationCopy, useUiLocale } from '@maka/ui';
import { Anthropicon, type AnthropiconName } from '../icons/Anthropicon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItemIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { COMPOSER_META_CHIP, COMPOSER_META_CHIP_IDLE } from '../../lib/composer-surface.js';
import { cn } from '../../lib/cn.js';

const MODE_ICON: Record<PermissionMode, AnthropiconName> = {
  explore: 'eye',
  ask: 'shieldCheck',
  bypass: 'shieldAlert',
};

/** relx 32px ghost icon control: the ＋ trigger in the surface. */
export const COMPOSER_ICON_CONTROL_CLASS =
  'ui-control-squish ui-control-squish-ghost flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-primary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-60';

export function PermissionModeMenu(props: {
  activeMode: PermissionMode;
  onSelect: (mode: ChatDefaultPermissionMode) => void;
  disabled?: boolean;
  side: 'top' | 'bottom';
}) {
  const copy = getConversationCopy(useUiLocale()).permissions;
  const meta = copy.mode[props.activeMode];
  const label = copy.modeAriaLabel(meta.label);
  const selected = (CHAT_DEFAULT_PERMISSION_MODES as readonly string[]).includes(props.activeMode)
    ? props.activeMode
    : undefined;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={label}
              aria-description={meta.hint}
              disabled={props.disabled}
              className={cn(COMPOSER_META_CHIP, COMPOSER_META_CHIP_IDLE)}
            >
              {meta.label}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={props.side}>{`${meta.label} — ${meta.hint}`}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" side={props.side} sideOffset={6}>
        <DropdownMenuRadioGroup
          aria-label={label}
          value={selected}
          onValueChange={(value) => props.onSelect(value as ChatDefaultPermissionMode)}
        >
          {CHAT_DEFAULT_PERMISSION_MODES.map((mode) => (
            <Tooltip key={mode}>
              <TooltipTrigger asChild>
                <DropdownMenuRadioItem
                  value={mode}
                  reserveIndicator
                  className="w-full"
                  aria-description={copy.mode[mode].hint}
                >
                  <DropdownMenuItemIcon>
                    <Anthropicon name={MODE_ICON[mode]} size={20} />
                  </DropdownMenuItemIcon>
                  <span className="truncate">{copy.mode[mode].label}</span>
                </DropdownMenuRadioItem>
              </TooltipTrigger>
              <TooltipContent side="right" align="center" variant="description">
                {copy.mode[mode].hint}
              </TooltipContent>
            </Tooltip>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
