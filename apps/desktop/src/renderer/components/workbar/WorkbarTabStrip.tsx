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

// The faces on screen, and the menu that adds or removes one.
//
// A face is opened and closed only from the `[+]` menu — the pre-rewrite
// rule, kept for a reason that still holds: a per-tab close control would have
// to live inside the tab's own button, and the strip is narrow enough that a
// stray click on it would close the thing the reader was pointing at. The menu
// lists every registered face and marks the open ones, so the same gesture
// answers "what else is there" and "put this away".
//
// Tabs are never reordered: the strip's order is the order the faces were
// opened in, which is the only order a reader can predict.

import { useEffect, useRef } from 'react';
import { useUiLocale } from '@maka/ui';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItemIcon,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Anthropicon, type AnthropiconName } from '../icons/Anthropicon.js';
import { SidebarTooltip, SidebarTooltipProvider } from '../ui/sidebar-tooltip.js';
import { cn } from '../../lib/cn.js';
import { isApplePlatform } from '../../hooks/use-hotkeys.js';
import {
  WORKBAR_FACE_DEFINITIONS,
  type WorkbarFace,
  type WorkbarModel,
} from '../../hooks/use-workbar.js';
import { getDesktopConversationCopy } from '../../locales/conversation-copy.js';
import type { WorkbarToolDefinition } from '../../lib/ported/workbar-tool-definitions.js';

/**
 * The one place a face's semantic icon name becomes a glyph.
 * `workbar-tool-definitions.ts` names the icon; nothing else picks one.
 */
const FACE_GLYPH = {
  activity: 'chartLine',
  'file-diff': 'pullRequest',
  folder: 'folder',
  globe: 'globe',
  'list-todo': 'listBullet',
  'message-circle-question': 'questionCircle',
  terminal: 'terminal',
} as const satisfies Record<WorkbarToolDefinition['icon'], AnthropiconName>;

type WorkbarCopy = ReturnType<typeof getDesktopConversationCopy>['workbar'];

export function faceLabel(face: WorkbarFace, copy: WorkbarCopy): string {
  return copy[face];
}

/**
 * A chord as the reader's platform writes it.
 *
 * `mod` is the only token that changes between platforms; `ctrl` stays Control
 * everywhere, because that is what the binding is (§ `use-hotkeys.ts`).
 */
export function formatWorkbarShortcut(shortcut: string, apple: boolean): string {
  return shortcut
    .split('+')
    .map((token) => {
      if (token === 'mod') return apple ? '⌘' : 'Ctrl';
      if (token === 'ctrl') return apple ? '⌃' : 'Ctrl';
      if (token === 'alt') return apple ? '⌥' : 'Alt';
      if (token === 'shift') return apple ? '⇧' : 'Shift';
      return token.length === 1 ? token.toUpperCase() : token;
    })
    .join(apple ? '' : '+');
}

export function WorkbarTabStrip(props: { workbar: WorkbarModel }) {
  const locale = useUiLocale();
  const copy = getDesktopConversationCopy(locale).workbar;
  const apple = isApplePlatform();
  const { tabs, activeTabId } = props.workbar;
  const open = new Set(tabs.map((tab) => tab.kind));
  const listRef = useRef<HTMLDivElement>(null);

  // Five faces do not fit a 340px pane, so the strip scrolls — and a strip that
  // scrolls must bring the selected face back into view, or a ⌘T with Browser
  // at the far end changes what is on screen with nothing to show for it.
  useEffect(() => {
    if (!activeTabId) return;
    listRef.current
      ?.querySelector(`[data-maka-workbar-tab-id="${CSS.escape(activeTabId)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <SidebarTooltipProvider>
        <div
          ref={listRef}
          role="tablist"
          aria-label={copy.sectionsAriaLabel}
          aria-orientation="horizontal"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const face = tab.kind as WorkbarFace;
            const selected = tab.id === activeTabId;
            const label = faceLabel(face, copy);
            return (
              // Only the selected face spells its name: five labels need more
              // width than the pane's floor has, and a strip that scrolls the
              // reader's own tabs out of reach is worse than icons with names
              // on hover. The label is always the accessible name.
              <SidebarTooltip key={tab.id} content={label} alwaysShow side="bottom">
                <button
                  type="button"
                  role="tab"
                  id={`maka-workbar-tab-${tab.id}`}
                  data-maka-workbar-tab-id={tab.id}
                  aria-selected={selected}
                  aria-controls="maka-workbar-body"
                  aria-label={label}
                  tabIndex={selected ? 0 : -1}
                  data-maka-workbar-tab={face}
                  onClick={() => props.workbar.activate(tab.id)}
                  className={cn(
                    'ui-control-squish ui-control-squish-ghost inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-[7px] px-1.5 text-xs leading-5 outline-none',
                    'focus-visible:shadow-[var(--sidebar-focus-shadow)]',
                    selected
                      ? 'bg-alpha-1 text-text-primary'
                      : 'text-text-muted hover:text-text-secondary',
                  )}
                >
                  <Anthropicon name={FACE_GLYPH[faceDefinition(face).icon]} size={16} />
                  {selected && <span className="truncate">{label}</span>}
                </button>
              </SidebarTooltip>
            );
          })}
        </div>
      </SidebarTooltipProvider>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={copy.openTab}
            data-maka-contract="session-workbar-launcher"
            className="ui-control-squish ui-control-squish-ghost inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] text-text-muted outline-none hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)]"
          >
            <Anthropicon name="add" size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {WORKBAR_FACE_DEFINITIONS.map((definition) => {
            const face = definition.kind as WorkbarFace;
            const checked = open.has(face);
            return (
              <DropdownMenuCheckboxItem
                key={face}
                checked={checked}
                onSelect={(event) => {
                  // Radix closes on select; the menu is the only way back to a
                  // face, so keep it open while the reader arranges the strip.
                  event.preventDefault();
                  if (!checked) props.workbar.open(face);
                  else props.workbar.close(tabIdOf(props.workbar, face));
                }}
              >
                <DropdownMenuItemIcon>
                  <Anthropicon name={FACE_GLYPH[definition.icon]} size={20} />
                </DropdownMenuItemIcon>
                <span className="truncate">{faceLabel(face, copy)}</span>
                {definition.shortcut && (
                  <DropdownMenuShortcut>
                    {formatWorkbarShortcut(definition.shortcut, apple)}
                  </DropdownMenuShortcut>
                )}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function faceDefinition(face: WorkbarFace): WorkbarToolDefinition {
  // Present by construction: `WORKBAR_FACE_DEFINITIONS` is filtered from the
  // same registry the face type is derived from.
  return WORKBAR_FACE_DEFINITIONS.find((definition) => definition.kind === face)!;
}

function tabIdOf(workbar: WorkbarModel, face: WorkbarFace): string {
  return workbar.tabs.find((tab) => tab.kind === face)?.id ?? '';
}
