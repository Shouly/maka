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
// meta-row chip under the surface — the mode's label as text, opening the
// menu of Claude's permission picker: a "Permission mode" heading, then each
// selectable mode as its name over a sentence saying when Maka asks, the
// chosen one checked. Read-only (`explore`) is a real boundary a Session can
// be running under, so the chip names it in its own words, but the menu never
// offers it — the picker lists Manual and Full access.

import type { PermissionMode } from '@maka/core/permission';
import type { ChatDefaultPermissionMode } from '@maka/core/settings';
import { CHAT_DEFAULT_PERMISSION_MODES } from '@maka/core/settings';
import { getConversationCopy, useUiLocale } from '@maka/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { COMPOSER_META_CHIP, COMPOSER_META_CHIP_IDLE } from '../../lib/composer-surface.js';
import { cn } from '../../lib/cn.js';

/** relx 32px ghost icon control: the ＋ trigger in the surface. */
export const COMPOSER_ICON_CONTROL_CLASS =
  'ui-control-squish ui-control-squish-ghost flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-primary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-60';

export function PermissionModeMenu(props: {
  /** The boundary the Session runs under, which the chip names. */
  activeMode: PermissionMode;
  /** The mode the Session chose, which the menu marks; Plan can hold it read-only. */
  chosenMode?: PermissionMode;
  onSelect: (mode: ChatDefaultPermissionMode) => void;
  disabled?: boolean;
  side: 'top' | 'bottom';
}) {
  const copy = getConversationCopy(useUiLocale()).permissions;
  const meta = copy.mode[props.activeMode];
  const label = copy.modeAriaLabel(meta.label);
  const chosen = props.chosenMode ?? props.activeMode;
  const selected = (CHAT_DEFAULT_PERMISSION_MODES as readonly string[]).includes(chosen)
    ? chosen
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
      <DropdownMenuContent align="start" side={props.side} sideOffset={6} className="w-72">
        <DropdownMenuLabel className="font-medium text-menu-text-muted">
          {copy.menuTitle}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-label={copy.menuTitle}
          value={selected}
          onValueChange={(value) => props.onSelect(value as ChatDefaultPermissionMode)}
        >
          {CHAT_DEFAULT_PERMISSION_MODES.map((mode) => (
            <DropdownMenuRadioItem
              key={mode}
              value={mode}
              reserveIndicator
              className="gap-3 py-2"
              aria-label={copy.mode[mode].label}
              aria-description={copy.mode[mode].hint}
              data-maka-permission-mode={mode}
            >
              {/* The row wrapper truncates; the sentence wraps instead. */}
              <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal">
                <span>{copy.mode[mode].label}</span>
                {/* The model menu's subline: the same small muted line under a name. */}
                <span className="text-xs text-menu-text-muted">{copy.mode[mode].hint}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
