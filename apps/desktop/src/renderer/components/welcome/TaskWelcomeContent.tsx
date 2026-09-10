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
import { useStore } from 'zustand';
import { settingsStore } from '../../store/settings-store.js';
import { useWelcomeMessage } from '../../hooks/use-welcome-message.js';
import { ChatInput } from '../composer/ChatInput.js';
import { getWelcomeCopy } from '../../locales/welcome-copy.js';
import { OnboardingHero } from './OnboardingHero.js';
import { ReadinessNotice } from './ReadinessNotice.js';

const brandSymbol = new URL('../../../../assets/brand/relx-symbol.svg', import.meta.url).href;

export function TaskWelcomeContent(props: {
  onOpenSettings: () => void;
  onOpenModels: () => void;
  onOpenConnection: (connectionSlug: string) => void;
  onError: (title: string, error: unknown) => void;
}) {
  const locale = useUiLocale();
  const copy = getWelcomeCopy(locale);
  const username = useStore(settingsStore.host, (state) => state.data?.personalization.displayName);
  const greeting = useWelcomeMessage(locale, username);

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
          <div className="mx-auto flex h-full w-full max-w-7xl flex-col items-center gap-6 px-1 pt-0 md:px-14 md:pt-[25vh]">
            <div className="mx-auto my-3 flex w-full max-w-2xl flex-col items-center gap-7 max-md:pt-4">
              <h1 className="text-balance text-center font-display text-[clamp(1.875rem,1.2rem+2vw,2.375rem)] font-[330] leading-[1.25] text-text-primary [font-variation-settings:'opsz'_48] max-sm:px-[0.96em]">
                <span
                  aria-hidden="true"
                  data-maka-contract="welcome-brand"
                  className="me-[0.3em] inline-block size-[0.72em] supports-[height:1cap]:size-[1cap]"
                >
                  <span
                    className="block size-full scale-[1.6] bg-fill-brand [mask-size:contain] [mask-repeat:no-repeat] [mask-position:center]"
                    style={{
                      maskImage: `url(${JSON.stringify(brandSymbol)})`,
                      WebkitMaskImage: `url(${JSON.stringify(brandSymbol)})`,
                    }}
                  />
                </span>
                <span className="select-none">{greeting}</span>
              </h1>
            </div>

            <div className="flex w-full max-w-2xl flex-col gap-3 pb-10">
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
