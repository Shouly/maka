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

// Four tasks worth having, offered below the ones you already have.
//
// The empty state asks for a task and gives no idea what one looks like; the
// hardest part of a scheduler is not the form, it is knowing what to schedule.
// A template is a create-mode seed, nothing more: `scheduledTaskTemplateSeed`
// turns the row into the same `ScheduledTaskFormSeed` the New button produces,
// so the dialog opens filled in and every field stays editable.
//
// Rows, not a second grid of cards: these are suggestions under the real list
// and a card would give them the same weight as a task that actually fires.

import { scheduledTaskTemplateSeed, useUiLocale, type ScheduledTaskFormSeed } from '@maka/ui';
import { ListRow } from '../../ui/list-page.js';
import { Anthropicon, type AnthropiconName } from '../../icons/Anthropicon.js';
import { getScheduledPageCopy } from '../../../locales/scheduled-page-copy.js';

/**
 * Template id → icon. Not copy: the glyph is the same in every locale, and a
 * translator asked to keep it in step would be the one to get it wrong. An
 * unknown id falls back to the page's own clock.
 */
const TEMPLATE_ICONS: Record<string, AnthropiconName> = {
  'repo-morning-briefing': 'sunHorizon',
  'repo-weekly-review': 'calendar',
  'repo-dependency-triage': 'shieldCheck',
  'repo-inbox-triage': 'tasks',
};

export function ScheduleTemplates(props: {
  disabled: boolean;
  onUse: (seed: ScheduledTaskFormSeed) => void;
}) {
  const locale = useUiLocale();
  const page = getScheduledPageCopy(locale);

  return (
    <section
      aria-labelledby="scheduled-templates-title"
      className="mt-8 border-t border-hairline pt-6"
    >
      <h2
        id="scheduled-templates-title"
        className="text-sm font-medium leading-5 text-text-primary"
      >
        {page.templatesTitle}
      </h2>
      <p className="mt-1 text-xs leading-4 text-text-muted">{page.templatesDescription}</p>
      <div className="mt-2 flex flex-col">
        {page.templates.map((template) => (
          <ListRow
            key={template.id}
            icon={<Anthropicon name={TEMPLATE_ICONS[template.id] ?? 'clock'} size={20} />}
            title={template.title}
            meta={template.note}
            trailing={
              <span className="text-xs leading-4 text-text-muted">{template.scheduleLabel}</span>
            }
            openLabel={page.useTemplate(template.title)}
            busy={props.disabled}
            onOpen={() => {
              if (props.disabled) return;
              props.onUse(scheduledTaskTemplateSeed(template));
            }}
          />
        ))}
      </div>
    </section>
  );
}
