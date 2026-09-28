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

// The Settings dialog's rail: 192px on the surface-1 tint
// with a hairline on its right; a search field at the top; then the groups,
// each a 12/17 muted label over 32px rows 1px apart — r8, 14/20, a 20px icon
// that keeps the secondary tier when its row is selected, while the label
// rises to primary and 500 on the 10% fill.
//
// The pages sort into four groups, the pre-rewrite grouping
// (`nav-group-summary.ts`); only its headings were restyled. The search
// narrows the rows by label.

import { useMemo, useState } from 'react';
import type { SettingsSection } from '@maka/core/settings';
import { Anthropicon } from '../icons/Anthropicon.js';
import { cn } from '../../lib/cn.js';
import { SETTINGS_NAV_GROUPS, SETTINGS_SECTION_ICONS } from './settings-sections.js';
import type { SettingsNavigationCopy } from '../../locales/settings-navigation-copy.js';

export function SettingsNav(props: {
  section: SettingsSection;
  label: string;
  searchPlaceholder: string;
  searchLabel: string;
  noResults: string;
  copy: SettingsNavigationCopy;
  onSelect: (section: SettingsSection) => void;
}) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return SETTINGS_NAV_GROUPS.map((group) => ({
      ...group,
      sections: needle
        ? group.sections.filter((id) =>
            props.copy.sections[id].label.toLocaleLowerCase().includes(needle),
          )
        : group.sections,
    })).filter((group) => group.sections.length > 0);
  }, [query, props.copy]);

  return (
    <nav
      data-maka-contract="settings-sidebar"
      aria-label={props.label}
      className="flex w-48 shrink-0 flex-col gap-3 border-r-[1px] border-alpha-2 bg-surface-1"
    >
      <div className="shrink-0 px-3 pt-3">
        {/* The field: the frame is the label, so the focus ring is drawn
            on it when the input inside is keyboard-focused, not on every focus
            (the dialog focuses this field as it opens). */}
        <label className="flex h-8 w-full cursor-text items-center gap-3 rounded-lg bg-fill-field px-2 shadow-[var(--field-shadow)] transition-shadow duration-[var(--dur-fast)] ease-out [&:hover:not(:focus-within)]:shadow-[var(--field-shadow-hover)] has-[:focus-visible]:shadow-[var(--sidebar-focus-shadow)]">
          <Anthropicon name="search" size={20} className="shrink-0 text-text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={props.searchPlaceholder}
            aria-label={props.searchLabel}
            className="min-w-0 flex-1 bg-transparent text-sm leading-5 text-text-primary outline-none placeholder:text-text-muted [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
        {groups.length === 0 && (
          <p className="px-2 pt-3 text-xs leading-[17px] text-text-muted">{props.noResults}</p>
        )}
        {groups.map((group) => (
          <div key={group.group} className="flex flex-col gap-3">
            <p className="px-2 pt-3 text-xs leading-[17px] text-text-muted">
              {props.copy.groups[group.group]}
            </p>
            <ul className="flex flex-col gap-px">
              {group.sections.map((id) => {
                const active = id === props.section;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      data-settings-section={id}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => props.onSelect(id)}
                      className={cn(
                        'flex h-8 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left text-sm leading-5 outline-none transition-colors focus-visible:shadow-[var(--sidebar-focus-shadow)]',
                        active
                          ? 'bg-alpha-2 font-medium text-text-primary'
                          : 'text-text-secondary hover:bg-alpha-1',
                      )}
                    >
                      <Anthropicon
                        name={SETTINGS_SECTION_ICONS[id]}
                        size={20}
                        className="shrink-0 text-text-secondary"
                      />
                      <span className="min-w-0 truncate">{props.copy.sections[id].label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
