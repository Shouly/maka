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

// What the file currently remembers, as rows.
//
// Read-only on purpose: an entry is a section of MEMORY.md, so editing one is
// editing the document — which the page already offers, in the one place where
// the change is visible before it is saved. Two lists rather than one because
// "archived" is the difference that decides whether the model ever sees it.

import { useUiLocale } from '@maka/ui';
import type { LocalMemoryEntryPreview } from '@maka/core/local-memory';
import { statusChipClass, statusChipNeutralClass } from '../../ui/status-chip.js';
import { getMemorySettingsCopy } from '../../../locales/settings-memory-copy.js';

export function MemoryEntryList(props: {
  title: string;
  entries: ReadonlyArray<LocalMemoryEntryPreview>;
  emptyLabel: string;
}) {
  const copy = getMemorySettingsCopy(useUiLocale());
  const timestamps = new Intl.DateTimeFormat(copy.intlLocale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm leading-5 text-text-primary">{props.title}</h3>
        <span className="text-[13px] leading-[18px] text-text-secondary">
          {copy.countEntries(props.entries.length)}
        </span>
      </div>
      {props.entries.length === 0 ? (
        <p className="py-2 text-[13px] leading-[18px] text-text-secondary">{props.emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={copy.listAria(props.title)}>
          {props.entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-1.5 rounded-xl border border-hairline bg-surface-1 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm leading-5 text-text-primary">
                  {entry.title}
                </span>
                <span className={`${statusChipClass} ${statusChipNeutralClass}`}>
                  {copy.entryStatuses[entry.status]}
                </span>
              </div>
              <p className="whitespace-pre-wrap break-words text-[13px] leading-[18px] text-text-secondary">
                {entry.content}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-text-muted">
                <span>{copy.origins[entry.origin]}</span>
                {entry.createdAt !== undefined && (
                  <span>{`${copy.text.created}${timestamps.format(entry.createdAt)}`}</span>
                )}
                {entry.updatedAt !== undefined && entry.updatedAt !== entry.createdAt && (
                  <span>{`${copy.text.updated}${timestamps.format(entry.updatedAt)}`}</span>
                )}
                {entry.tags.length > 0 && <span>{entry.tags.join(' · ')}</span>}
                <span>
                  {entry.status === 'archived'
                    ? copy.text.archivedNoPrompt
                    : copy.text.activePrompt}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
