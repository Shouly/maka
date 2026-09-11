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

// The 220px sticky settings nav, from the reference design's
// `app/(app)/setting/layout.tsx`: 32px rows, r8, 14/20, icon 20px that does
// NOT change colour when selected — only the label rises to the primary tier
// and 500.
//
// One difference from the reference, and it is Maka's: the reference has five
// destinations and no grouping. Eleven need one, so the pre-rewrite grouping
// (`nav-group-summary.ts`, four groups) comes back as headings. There is no
// routing behind it — a section is `uiStore` state (plan §2.12).

import type { SettingsSection } from '@maka/core/settings';
import { Anthropicon } from '../icons/Anthropicon.js';
import { cn } from '../../lib/cn.js';
import { SETTINGS_NAV_GROUPS, SETTINGS_SECTION_ICONS } from './settings-sections.js';
import type { SettingsNavigationCopy } from '../../locales/settings-navigation-copy.js';

export function SettingsNav(props: {
  section: SettingsSection;
  label: string;
  copy: SettingsNavigationCopy;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <nav
      data-maka-contract="settings-sidebar"
      aria-label={props.label}
      className="relative z-10 -ml-3 mb-4 min-w-0 self-start md:sticky md:top-4 md:mb-0"
    >
      <div className="min-w-0 overflow-x-auto overflow-y-hidden">
        {SETTINGS_NAV_GROUPS.map((group) => (
          <div key={group.group} className="mb-3 last:mb-0">
            <p className="px-2 pb-1 text-[0.6875rem] font-medium uppercase leading-4 tracking-wider text-text-muted">
              {props.copy.groups[group.group]}
            </p>
            {/* 竖排行距 1px:导航项自带 32px 高和 hover 底,再撑 4px 整列会散。 */}
            <ul className="mb-0 flex flex-col gap-px">
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
                        'flex h-8 w-full cursor-pointer items-center gap-3 whitespace-nowrap rounded-lg px-2 text-left text-sm leading-5 outline-none transition-colors focus-visible:shadow-[var(--sidebar-focus-shadow)]',
                        active
                          ? 'bg-alpha-2 font-medium text-text-primary'
                          : 'text-text-secondary hover:bg-alpha-1 hover:text-text-primary',
                      )}
                    >
                      <Anthropicon
                        name={SETTINGS_SECTION_ICONS[id]}
                        size={20}
                        className="shrink-0 text-text-secondary"
                      />
                      <span className="truncate">{props.copy.sections[id].label}</span>
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
