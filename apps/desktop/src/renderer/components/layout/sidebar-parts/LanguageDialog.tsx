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

// "Choose your language": a titled bar across the top of
// the dialog and a three-column grid of choices, each its own name over what
// it is called in the current language, the current one tinted and ticked.
// Maka's choices are its interface languages plus following the system.

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useUiLocale } from '@maka/ui';
import type { UiLocalePreference } from '@maka/core/ui-locale';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Dialog, DialogContent, DialogTitle } from '../../ui/dialog.js';
import { cn } from '../../../lib/cn.js';
import { getOrgAccountCopy } from '../../../locales/org-account-copy.js';
import { getUiCopy } from '../../../locales/ui-copy.js';

const CHOICES: readonly UiLocalePreference[] = ['auto', 'zh-CN', 'zh-TW', 'en'];

export function LanguageDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The saved choice; nothing is ticked until it is known. */
  value: UiLocalePreference | undefined;
  onChoose: (value: UiLocalePreference) => void;
}) {
  const locale = useUiLocale();
  const copy = getOrgAccountCopy(locale).language;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent aria-describedby={undefined} className="md:max-w-[45rem]">
        <div className="-mx-6 -mt-6 flex h-12 shrink-0 items-center gap-2 border-b-[0.5px] border-alpha-3 bg-alpha-1 px-2">
          <DialogTitle className="min-w-0 truncate px-1.5 text-[0.9375rem] leading-5 font-semibold">
            {copy.title}
          </DialogTitle>
          <div className="flex-1" />
          <DialogPrimitive.Close className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-text-primary transition-colors hover:bg-sidebar-menu-hover focus:outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]">
            <Anthropicon name="x" size={20} />
            <span className="sr-only">{getUiCopy(locale).close}</span>
          </DialogPrimitive.Close>
        </div>
        <div
          role="radiogroup"
          aria-label={copy.title}
          className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 md:grid-cols-3"
        >
          {CHOICES.map((choice) => {
            const checked = props.value === choice;
            const option = copy.options[choice];
            return (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => props.onChoose(choice)}
                className={cn(
                  'flex cursor-pointer items-start justify-between gap-3 rounded-lg px-3 py-2 text-left outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]',
                  checked ? 'bg-accent-fill/10' : 'hover:bg-alpha-1',
                )}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm leading-5 font-medium text-text-primary">
                    {option.name}
                  </span>
                  <span className="truncate text-[0.8125rem] leading-[17px] text-text-secondary">
                    {option.detail}
                  </span>
                </span>
                {checked && (
                  <Anthropicon name="check" size={16} className="mt-0.5 shrink-0 text-accent" />
                )}
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
