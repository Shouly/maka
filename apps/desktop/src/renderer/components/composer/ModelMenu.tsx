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

// The composer's model chip (relx `ModelSelector` look, bottom-right of the
// surface on both the welcome and the session composer): a 32px ghost chip
// with the provider mark and the model name, opening the grouped model menu.
// The thinking level is the model's own (`ChatModelChoice.thinkingLevels`),
// so it rides in the same menu as an "effort" submenu rather than as a
// second control beside the chip; a model change resets it, the way the Host
// does.
//
// Presentational: the welcome composer feeds it the new-task draft, the
// session composer the Session's own configuration.

import type { ChatModelChoice } from '@maka/core/chat-model-choice';
import type { ThinkingLevel } from '@maka/core/model-thinking';
import {
  getConversationCopy,
  modelChoiceDescription,
  modelMenuGroups,
  useUiLocale,
} from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { cn } from '../../lib/cn.js';
import { ProviderBrandMark } from '../../lib/ported/provider-brand-marks.js';
import { getComposerCopy } from '../../locales/composer-copy.js';
import { getWelcomeCopy } from '../../locales/welcome-copy.js';

const DEFAULT_LEVEL = '__default__';

export function ModelMenu(props: {
  choices: readonly ChatModelChoice[];
  /** The selection identity; `undefined` when nothing is chosen yet. */
  current: { connectionSlug: string | undefined; model: string | undefined } | undefined;
  /** What the chip says when `current` matches no choice (a model no longer offered). */
  fallbackLabel?: string;
  thinking: {
    current: ThinkingLevel | undefined;
    onChange: (level: ThinkingLevel | undefined) => void;
  };
  onPick: (choice: ChatModelChoice) => void;
  onOpenSettings: () => void;
  disabled?: boolean;
  /** The meta row under the surface: 24px chip, not the 32px in-surface control. */
  dense?: boolean;
}) {
  const locale = useUiLocale();
  const copy = getWelcomeCopy(locale).model;
  const modelCopy = getConversationCopy(locale).model;
  const menuCopy = getComposerCopy(locale).menu;
  const groups = modelMenuGroups([...props.choices], locale);
  const current = props.choices.find(
    (choice) =>
      choice.connectionSlug === props.current?.connectionSlug &&
      choice.model === props.current?.model,
  );
  const chipClass = cn(
    'ui-control-squish ui-control-squish-ghost inline-flex min-w-0 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 px-2 text-[0.8125rem] leading-[1.4] text-text-secondary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:pointer-events-none disabled:opacity-50',
    props.dense ? 'h-6 rounded-md' : 'h-8 rounded-lg',
  );

  if (props.choices.length === 0) {
    return (
      <button type="button" onClick={props.onOpenSettings} className={chipClass}>
        <Anthropicon name="warningCircle" size={16} className="shrink-0" />
        <span className="min-w-0 truncate">{copy.empty}</span>
      </button>
    );
  }

  const label = current?.label ?? props.fallbackLabel ?? props.current?.model ?? copy.none;
  const levels = current?.thinkingLevels ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${copy.label}: ${label}`}
          data-maka-contract="composer-model"
          disabled={props.disabled}
          className={chipClass}
        >
          {current && (
            <span className="flex size-3.5 shrink-0 items-center justify-center [&>img]:size-full [&>svg]:size-full">
              <ProviderBrandMark type={current.providerType} />
            </span>
          )}
          <span className="min-w-0 truncate text-text-primary">{label}</span>
          {/* The effort readout, whenever the model has levels to choose from. */}
          {levels.length > 0 && (
            <span className="shrink-0 text-text-muted">
              {props.thinking.current
                ? modelCopy.level[props.thinking.current]
                : menuCopy.effortDefault}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-[240px] max-w-[320px]">
        {groups.map((group) => (
          <div key={group.connectionSlug}>
            <DropdownMenuLabel>{group.heading}</DropdownMenuLabel>
            {group.choices.map((choice) => {
              const selected =
                choice.connectionSlug === props.current?.connectionSlug &&
                choice.model === props.current?.model;
              const subline = modelChoiceDescription(choice, locale);
              return (
                <DropdownMenuItem
                  key={`${choice.connectionSlug}:${choice.model}`}
                  className="flex cursor-pointer items-center gap-2 py-1.5"
                  onSelect={() => {
                    if (!selected) props.onPick(choice);
                  }}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center [&>img]:size-4 [&>svg]:size-4">
                    <ProviderBrandMark type={choice.providerType} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{choice.label}</span>
                    {subline && (
                      <span className="truncate text-xs text-menu-text-muted">{subline}</span>
                    )}
                  </span>
                  <span className="ml-2 flex size-5 shrink-0 items-center justify-center text-menu-accent">
                    {selected && <Anthropicon name="check" size={20} weight={566.5} />}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
        {levels.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span className="min-w-0 flex-1 truncate">{menuCopy.effort}</span>
                <span className="ml-2 shrink-0 text-menu-text-muted">
                  {props.thinking.current
                    ? modelCopy.level[props.thinking.current]
                    : menuCopy.effortDefault}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  aria-label={menuCopy.effort}
                  value={props.thinking.current ?? DEFAULT_LEVEL}
                  onValueChange={(value) =>
                    props.thinking.onChange(
                      value === DEFAULT_LEVEL ? undefined : (value as ThinkingLevel),
                    )
                  }
                >
                  <DropdownMenuRadioItem value={DEFAULT_LEVEL}>
                    <span className="truncate">{menuCopy.effortDefault}</span>
                  </DropdownMenuRadioItem>
                  {levels.map((level) => (
                    <DropdownMenuRadioItem key={level} value={level}>
                      <span className="truncate">{modelCopy.level[level]}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
