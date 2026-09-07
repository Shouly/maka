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

// The welcome surface: greeting, suggestions, and the entry composer.
//
// Layout ported from the reference design system's `TaskWelcomeContent` — one
// centred column, the 48px chrome row the page header would occupy, the serif
// greeting at `opsz 48`, and the composer directly under it at the same width.
//
// The composer here is deliberately a PLACEHOLDER: a plain textarea and a Send
// button. Phase 3 replaces it with the TipTap editor that carries mentions,
// slash commands, attachments and the mode controls. What is already real is
// the path it drives — create the Session through `newTasks.create` with the
// chosen workspace and model, then send the first message through the same
// turn actions every later message uses, so nothing about this surface is a
// special case downstream.

import { useStore } from 'zustand';
import { getConversationCopy, getPromptSuggestions, useUiLocale } from '@maka/ui';
import { ChatInput, newComposerKey } from '../composer/ChatInput.js';
import { composerInputStore } from '../../store/composer-input-store.js';
import { cn } from '../../lib/cn.js';
import { newTaskStore } from '../../store/index.js';
import { getWelcomeCopy } from '../../locales/welcome-copy.js';
import { OnboardingHero } from './OnboardingHero.js';
import { ReadinessNotice } from './ReadinessNotice.js';

export type DayPeriod = 'morning' | 'noon' | 'afternoon' | 'evening';

/**
 * The greeting bucket, from an epoch rather than `new Date()`.
 *
 * The e2e fixture freezes `Date.now` but not the `Date` constructor, so a
 * greeting read from `new Date()` would drift between otherwise identical runs.
 */
export function detectDayPeriod(nowMs: number = Date.now()): DayPeriod {
  const hour = new Date(nowMs).getHours();
  if (hour < 5) return 'evening';
  if (hour < 11) return 'morning';
  if (hour < 14) return 'noon';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

export function TaskWelcomeContent(props: {
  onOpenSettings: () => void;
  onOpenModels: () => void;
  onOpenConnection: (connectionSlug: string) => void;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getWelcomeCopy(locale);
  const conversation = getConversationCopy(locale).empty;
  const target = useStore(newTaskStore, (state) => state.target);
  const period = detectDayPeriod();
  const greeting = conversation.headlineFallback(
    conversation.greeting[period],
    conversation.greetingTail[period],
  );

  return (
    <div
      className="task-welcome relative isolate h-full"
      aria-label={copy.surfaceLabel}
      data-maka-contract="welcome-surface"
    >
      <div className="flex h-full min-w-0 flex-col">
        {/* The reference keeps a 48px chrome row even with no page header, so
            the hero never competes with the window controls. */}
        <div className="h-12 shrink-0" aria-hidden="true" />
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable_both-edges]">
          <div className="mx-auto flex h-full w-full max-w-7xl flex-col items-center gap-6 px-1 pt-0 md:px-14 md:pt-[18vh]">
            <div className="mx-auto my-3 flex w-full max-w-2xl flex-col items-center gap-7 max-md:pt-4">
              <h1 className="text-balance text-center font-display text-[clamp(1.875rem,1.2rem+2vw,2.375rem)] font-[330] leading-[1.25] text-text-primary [font-variation-settings:'opsz'_48] max-sm:px-[0.96em]">
                <span className="select-none">{greeting}</span>
              </h1>
            </div>

            <div className="flex w-full max-w-2xl flex-col gap-3">
              <OnboardingHero
                onOpenModels={props.onOpenModels}
                onOpenConnection={props.onOpenConnection}
              />
              <ReadinessNotice onOpenWorkspacePicker={props.onOpenSettings} />

              <ChatInput
                label={copy.composer.label}
                onOpenSettings={props.onOpenModels}
                onError={props.onError}
              />

              <ul
                aria-label={copy.suggestionsLabel}
                className="flex flex-wrap justify-center gap-2 pb-10"
              >
                {getPromptSuggestions(locale).map((suggestion) => (
                  <li key={suggestion.label}>
                    <button
                      type="button"
                      onClick={() =>
                        composerInputStore.setText(newComposerKey(target), suggestion.prompt)
                      }
                      className={cn(
                        'ui-control-squish ui-control-squish-ghost inline-flex h-8 cursor-pointer items-center rounded-full border border-hairline px-3 text-[13px] leading-5 text-text-secondary outline-none',
                        'hover:text-text-primary focus-visible:shadow-[var(--sidebar-focus-shadow)]',
                      )}
                    >
                      {suggestion.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
