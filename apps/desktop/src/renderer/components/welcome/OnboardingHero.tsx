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

// The first-run recovery hero.
//
// Semantics ported from the previous shell's `onboarding-hero.tsx`: the
// onboarding snapshot resolves to exactly one next action — add a provider,
// fix a connection's credentials, pick a model — and this surface states that
// one action and nothing else. A ready workspace returns null, so the ordinary
// welcome takes the space back rather than keeping a permanent banner.
//
// The two `data-maka-contract` values are the ones the accessibility audit and
// the e2e suite look for.

import { useStore } from 'zustand';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { cn } from '../../lib/cn.js';
import { onboardingStore } from '../../store/index.js';
import { getOnboardingHeroCopy } from '../../lib/ported/onboarding-hero-copy.js';
import { getWelcomeCopy } from '../../locales/welcome-copy.js';

export function OnboardingHero(props: {
  onOpenModels: () => void;
  onOpenConnection: (connectionSlug: string) => void;
}) {
  const locale = useUiLocale();
  const copy = getWelcomeCopy(locale).onboarding;
  const snapshot = useStore(onboardingStore, (state) => state.snapshot);
  const dismissed = useStore(onboardingStore, (state) => state.dismissed);
  if (!snapshot || dismissed) return null;
  const hero = getOnboardingHeroCopy(snapshot.state, locale);
  if (!hero) return null;

  return (
    <section
      data-maka-contract="onboarding-surface"
      aria-label={copy.surfaceLabel}
      className="w-full"
    >
      <div
        data-maka-contract="onboarding-card"
        className={cn(
          'flex w-full items-start gap-3 rounded-xl border border-hairline bg-surface-2 p-4 shadow-[var(--card-shadow)]',
          hero.tone === 'destructive' && 'border-danger-line',
        )}
      >
        <span
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
            hero.tone === 'destructive'
              ? 'bg-danger-subtle text-danger'
              : 'bg-accent-subtle text-accent',
          )}
        >
          <Anthropicon
            name={hero.tone === 'destructive' ? 'warningCircle' : 'lightbulb'}
            size={20}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase leading-4 tracking-wide text-text-muted">
            {hero.eyebrow}
          </p>
          <h2 className="mt-0.5 font-display text-base leading-6 text-text-primary">
            {hero.title}
          </h2>
          <p className="mt-1 text-sm leading-5 text-text-secondary">{hero.body}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => onboardingStore.dismiss()}>
            {copy.dismiss}
          </Button>
          <Button
            size="sm"
            variant={hero.tone === 'destructive' ? 'destructive' : 'default'}
            onClick={() => {
              if (hero.cta.target.kind === 'connection')
                props.onOpenConnection(hero.cta.target.connectionSlug);
              else props.onOpenModels();
            }}
          >
            {hero.cta.label}
          </Button>
        </div>
      </div>
    </section>
  );
}
