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

// The ＋ menu's Skills submenu (relx `SkillSubMenu`): the skills the Host
// would let this task invoke, each row inserting its `/skill` reference into
// the draft — the mouse entry to the same list the editor's `/` menu offers.
// Not a management panel: the pinned last row opens the Skills page.

import { getConversationCopy, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import {
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuPinnedBottom,
  DropdownMenuScrollArea,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../ui/dropdown-menu.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { getComposerCopy } from '../../locales/composer-copy.js';

export interface SkillMenuEntry {
  id: string;
  name: string;
  description?: string;
}

export function SkillSubMenu(props: {
  /** `undefined` while the catalog is still being read. */
  skills: readonly SkillMenuEntry[] | undefined;
  disabled?: boolean;
  onPick: (skill: SkillMenuEntry) => void;
  onManage: () => void;
}) {
  const locale = useUiLocale();
  const common = getConversationCopy(locale).composer;
  const copy = getComposerCopy(locale).menu;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={props.disabled}>
        <div className="flex flex-1 items-center gap-2 truncate">
          <DropdownMenuItemIcon>
            <Anthropicon name="scroll" size={20} />
          </DropdownMenuItemIcon>
          <span className="truncate">{copy.skills}</span>
        </div>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent shell className="w-64">
        <DropdownMenuScrollArea>
          {props.skills === undefined ? (
            <div className="px-2 py-3 text-center text-xs text-menu-text-muted" role="status">
              {copy.loadingSkills}
            </div>
          ) : props.skills.length === 0 ? (
            <div className="px-2 py-3 text-center text-xs text-menu-text-muted">
              {common.noSkillsAvailable}
            </div>
          ) : (
            props.skills.map((skill) => (
              <Tooltip key={skill.id} delayDuration={0}>
                <TooltipTrigger asChild>
                  <DropdownMenuItem onSelect={() => props.onPick(skill)}>
                    <div className="flex flex-1 items-center gap-2 truncate">
                      <DropdownMenuItemIcon>
                        <Anthropicon name="scroll" size={16} />
                      </DropdownMenuItemIcon>
                      <span className="truncate">{skill.name}</span>
                    </div>
                  </DropdownMenuItem>
                </TooltipTrigger>
                {skill.description && (
                  <TooltipContent side="right" sideOffset={8} align="start">
                    {skill.description}
                  </TooltipContent>
                )}
              </Tooltip>
            ))
          )}
        </DropdownMenuScrollArea>
        <DropdownMenuPinnedBottom>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={props.onManage}>
            <div className="flex items-center gap-2 truncate">
              <DropdownMenuItemIcon>
                <Anthropicon name="tool" size={16} />
              </DropdownMenuItemIcon>
              <span className="truncate">{copy.manageSkills}</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuPinnedBottom>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
