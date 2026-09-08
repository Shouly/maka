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

// Which model this task is on, and how hard it thinks.
//
// It lives in the titlebar's third column (plan §2.12), not in a header bar of
// its own and not in the composer: the model is a property of the task, the
// same way its name and its project are, and those are already in that row.
//
// Two menus in one, because they are one decision made twice: the thinking
// levels a model offers are the model's own (`ChatModelChoice.thinkingLevels`),
// so switching model can invalidate the level — which is why the Host clears
// it on a model change and the second section only lists what the current
// choice declares.

import { memo } from 'react';
import { useStore } from 'zustand';
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { cn } from '../../lib/cn.js';
import { ProviderBrandMark } from '../../lib/ported/provider-brand-marks.js';
import { chatModelChoiceLabel } from '../../lib/ported/shell-chat-model-selection.js';
import { connectionsStore, sessionsStore, turnActionsStore } from '../../store/index.js';
import { pendingActionsOf } from '../../store/turn-actions-store.js';
import { getTranscriptCopy } from '../../locales/transcript-copy.js';

export const ModelSwitcher = memo(function ModelSwitcher(props: {
  sessionId: string;
  onOpenSettings: () => void;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getTranscriptCopy(locale).model;
  // The thinking-depth vocabulary is already spelled once, in `@maka/ui`.
  const modelCopy = getConversationCopy(locale).model;
  const session = useStore(sessionsStore, (state) =>
    state.sessions.find((row) => row.id === props.sessionId),
  );
  const connections = useStore(connectionsStore, (state) => state.data);
  const pending = useStore(turnActionsStore, (state) => pendingActionsOf(state, props.sessionId));
  const choices = connections?.chatModelChoices ?? [];
  const groups = modelMenuGroups(choices, locale);
  const current = choices.find(
    (choice) =>
      choice.connectionSlug === session?.llmConnectionSlug && choice.model === session?.model,
  );
  const busy =
    session?.localState === 'pending' || pending.includes('model') || pending.includes('thinking');

  if (!session) return null;

  if (choices.length === 0) {
    return (
      <button
        type="button"
        onClick={props.onOpenSettings}
        className="maka-no-drag ui-control-squish ui-control-squish-ghost inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] leading-[1.4] text-text-secondary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]"
      >
        <Anthropicon name="warningCircle" size={16} className="shrink-0" />
        <span>{copy.empty}</span>
      </button>
    );
  }

  const label =
    chatModelChoiceLabel(
      choices,
      session.llmConnectionId,
      session.llmConnectionSlug,
      session.model,
    ) ?? copy.none;
  const thinkingLevels = current?.thinkingLevels ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${copy.label}: ${label}`}
          data-maka-contract="model-switcher"
          disabled={busy}
          className="maka-no-drag ui-control-squish ui-control-squish-ghost inline-flex h-7 min-w-0 max-w-56 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] leading-[1.4] text-text-secondary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)] disabled:opacity-50"
        >
          {current && (
            <span className="flex size-3.5 shrink-0 items-center justify-center [&>img]:size-full [&>svg]:size-full">
              <ProviderBrandMark type={current.providerType} />
            </span>
          )}
          <span className="min-w-0 truncate text-text-primary">{label}</span>
          {session.thinkingLevel && (
            <span className="shrink-0 text-text-muted">
              {modelCopy.level[session.thinkingLevel]}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="min-w-[260px] max-w-[340px]">
        {groups.map((group) => (
          <div key={group.connectionSlug}>
            <DropdownMenuLabel>{group.heading}</DropdownMenuLabel>
            {group.choices.map((choice) => {
              const selected =
                choice.connectionSlug === session.llmConnectionSlug &&
                choice.model === session.model;
              const subline = modelChoiceDescription(choice, locale);
              return (
                <DropdownMenuItem
                  key={`${choice.connectionSlug}:${choice.model}`}
                  className="flex cursor-pointer items-center gap-2 py-1.5"
                  onSelect={() => {
                    if (selected) return;
                    void turnActionsStore
                      .setModel(props.sessionId, {
                        llmConnectionId: choice.connectionId,
                        llmConnectionSlug: choice.connectionSlug,
                        model: choice.model,
                        // A level belongs to the model that offered it, so a
                        // model change clears it rather than carrying a
                        // setting the new model may not have.
                        thinkingLevel: null,
                      })
                      .then((row) => sessionsStore.upsert(row))
                      .catch((error) => props.onError(copy.changeFailedTitle, error));
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

        {thinkingLevels.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{modelCopy.thinkingLevel}</DropdownMenuLabel>
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2 py-1.5"
              onSelect={() => {
                void turnActionsStore
                  .setThinking(props.sessionId, null)
                  .then((row) => sessionsStore.upsert(row))
                  .catch((error) => props.onError(copy.changeFailedTitle, error));
              }}
            >
              <span className="min-w-0 flex-1 truncate">{modelCopy.defaultLevel}</span>
              <span className="ml-2 flex size-5 shrink-0 items-center justify-center text-menu-accent">
                {!session.thinkingLevel && <Anthropicon name="check" size={20} weight={566.5} />}
              </span>
            </DropdownMenuItem>
            {thinkingLevels.map((level: ThinkingLevel) => (
              <DropdownMenuItem
                key={level}
                className={cn('flex cursor-pointer items-center gap-2 py-1.5')}
                onSelect={() => {
                  void turnActionsStore
                    .setThinking(props.sessionId, level)
                    .then((row) => sessionsStore.upsert(row))
                    .catch((error) => props.onError(copy.changeFailedTitle, error));
                }}
              >
                <span className="min-w-0 flex-1 truncate">{modelCopy.level[level]}</span>
                <span className="ml-2 flex size-5 shrink-0 items-center justify-center text-menu-accent">
                  {session.thinkingLevel === level && (
                    <Anthropicon name="check" size={20} weight={566.5} />
                  )}
                </span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
