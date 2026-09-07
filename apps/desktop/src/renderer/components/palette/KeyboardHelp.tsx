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

// The keyboard cheat sheet (? and ⌘/).
//
// The five sections come from `shell-copy.ts` unchanged — they were written
// for this surface and describe shortcuts that still exist. Nothing here is
// derived from the live key map: a cheat sheet that silently disagrees with
// the bindings is worse than none, so `use-hotkeys.ts` and this copy are
// checked against each other by a test rather than by generation, which would
// have produced a table nobody could word.

import { useUiLocale } from '@maka/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog.js';
import { getShellCopy } from '../../locales/shell-copy.js';

export function KeyboardHelp(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const copy = getShellCopy(useUiLocale()).keyboardHelp;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent data-maka-contract="keyboard-help" className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {copy.sections.map((section) => (
            <section key={section.heading} aria-labelledby={`kb-${section.heading}`}>
              <h3
                id={`kb-${section.heading}`}
                className="pb-2 text-xs uppercase leading-4 tracking-wide text-text-muted"
              >
                {section.heading}
              </h3>
              <dl className="flex flex-col gap-1.5">
                {section.rows.map((row) => (
                  <div key={row.description} className="flex items-center justify-between gap-4">
                    <dt className="min-w-0 truncate text-sm leading-5 text-text-secondary">
                      {row.description}
                    </dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {row.keys.map((key) => (
                        <kbd
                          key={key}
                          className="rounded-md bg-alpha-1 px-1.5 py-0.5 font-mono text-xs leading-4 text-text-primary"
                        >
                          {key}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
