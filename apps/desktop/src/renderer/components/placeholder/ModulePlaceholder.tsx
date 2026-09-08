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

// The module pages Phase 5b owns, standing in for themselves until it does.
//
// Settings had a placeholder here too, with the reference design's 220px-nav
// geometry; `components/settings/SettingsView.tsx` replaced it in Phase 5a.
// What is left is the plain page the module views (skills, MCP, scheduled
// tasks) will replace.
//
// It says what it is rather than pretending to work: a page that looks
// finished and does nothing is a bug report waiting to happen.

import { useUiLocale } from '@maka/ui';
import { Anthropicon, type AnthropiconName } from '../icons/Anthropicon.js';
import { Skeleton } from '../ui/skeleton.js';
import { MainHeader } from '../layout/MainHeader.js';
import { getSharedPlaceholderCopy } from '../../locales/placeholder-copy.js';

export function ModulePlaceholder(props: {
  title: string;
  icon: AnthropiconName;
  description: string;
}) {
  const copy = getSharedPlaceholderCopy(useUiLocale());
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-maka-contract="module-main">
      <MainHeader
        contextIcon={<Anthropicon name={props.icon} size={16} />}
        title={<span className="px-2.5 font-medium">{props.title}</span>}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pt-6">
          <p className="text-sm leading-5 text-text-secondary">{props.description}</p>
          <p className="text-sm leading-5 text-text-muted" role="status">
            {copy.comingInPhase}
          </p>
          <div className="flex flex-col gap-2" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
