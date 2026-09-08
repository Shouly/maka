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

// A settings page that exists as a nav row before it exists as a page.
//
// Models, Subagents, Memory and Web Search land in Phase 5b. Their rows stay
// in the nav because removing and re-adding them would move every row below
// twice; what they open says plainly that it is not built rather than showing
// controls that do nothing.

import { useUiLocale } from '@maka/ui';
import { Skeleton } from '../ui/skeleton.js';
import { SettingsSection } from './settings-row.js';
import { getSettingsCopy } from '../../locales/settings-copy.js';
import { getSharedPlaceholderCopy } from '../../locales/placeholder-copy.js';

export function ComingSoon(props: { title: string; description: string }) {
  const locale = useUiLocale();
  const copy = getSettingsCopy(locale);
  const shared = getSharedPlaceholderCopy(locale);
  return (
    <SettingsSection title={props.title} description={props.description}>
      <div className="flex flex-col gap-3 py-3">
        <p className="text-sm leading-5 text-text-muted" role="status">
          {copy.comingSoonTitle} — {shared.comingInPhase}
        </p>
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}
