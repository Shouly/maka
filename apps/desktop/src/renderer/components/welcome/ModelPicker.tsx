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

// Which model the next task starts on.
//
// Look ported from the reference design system's `ModelSelector` — the dense
// chip with a provider mark, the grouped menu, the check on the current row.
// The data is the Host-resolved `ChatModelChoice[]` from the new-task
// connection snapshot, grouped by `modelMenuGroups`, which is what keeps two
// connections to the same provider distinguishable without ever putting an
// OAuth account's email in a menu heading.

import { useStore } from 'zustand';
import { modelChoiceDescription, modelMenuGroups, useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { cn } from '../../lib/cn.js';
import { ProviderBrandMark } from '../../lib/ported/provider-brand-marks.js';
import { newTaskStore } from '../../store/index.js';
import { getWelcomeCopy } from '../../locales/welcome-copy.js';

export function ModelPicker(props: { onOpenSettings: () => void; className?: string }) {
  const locale = useUiLocale();
  const copy = getWelcomeCopy(locale).model;
  const connections = useStore(newTaskStore, (state) => state.connections);
  const model = useStore(newTaskStore, (state) => state.model);
  const choices = connections?.chatModelChoices ?? [];
  const groups = modelMenuGroups(choices, locale);
  const current = choices.find(
    (choice) =>
      choice.connectionSlug === model?.llmConnectionSlug && choice.model === model?.model,
  );

  if (choices.length === 0) {
    return (
      <button
        type="button"
        onClick={props.onOpenSettings}
        className={cn(
          'ui-control-squish ui-control-squish-ghost inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] leading-[1.4] text-text-secondary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]',
          props.className,
        )}
      >
        <Anthropicon name="warningCircle" size={16} className="shrink-0" />
        <span>{copy.empty}</span>
      </button>
    );
  }

  const label = current?.label ?? model?.model ?? copy.none;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${copy.label}: ${label}`}
          className={cn(
            'ui-control-squish ui-control-squish-ghost inline-flex h-8 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[13px] leading-[1.4] text-text-secondary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]',
            props.className,
          )}
        >
          {current && (
            <span className="flex size-3.5 shrink-0 items-center justify-center [&>img]:size-full [&>svg]:size-full">
              <ProviderBrandMark type={current.providerType} />
            </span>
          )}
          <span className="min-w-0 truncate text-text-primary">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-[240px] max-w-[320px]">
        {groups.map((group) => (
          <div key={group.connectionSlug}>
            <DropdownMenuLabel>{group.heading}</DropdownMenuLabel>
            {group.choices.map((choice) => {
              const selected =
                choice.connectionSlug === model?.llmConnectionSlug &&
                choice.model === model?.model;
              const subline = modelChoiceDescription(choice, locale);
              return (
                <DropdownMenuItem
                  key={`${choice.connectionSlug}:${choice.model}`}
                  className="flex cursor-pointer items-center gap-2 py-1.5"
                  onSelect={() =>
                    newTaskStore.selectModel({
                      llmConnectionId: choice.connectionId,
                      llmConnectionSlug: choice.connectionSlug,
                      model: choice.model,
                    })
                  }
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
