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

// Create or edit one scheduled task.
//
// The dialog holds fields and nothing else. The seed comes from
// `@maka/ui`'s `scheduledTaskEditSeed` / `createScheduledTaskFormSeed`, the
// validation from `scheduledTaskFormValidation`, and the payload from
// `lib/ported/scheduled-task-form-payload.ts` — three modules that already
// agree with each other, so the form cannot disagree with the Host about what
// a valid task is.
//
// One thing the form deliberately does not author: an INTERVAL cadence. A task
// an agent created with `everySeconds` keeps it verbatim; the recurrence
// control says so and stays disabled, because the alternative is silently
// turning a repeating job into a one-shot. An agent-authored `agent_run`
// effect is preserved untouched for the same reason, and its delivery control
// reads back the frozen choice rather than offering to replace it.
//
// Delivery itself IS authored, both channels. The form used to hard-code a
// local reminder, which quietly did more than defer a feature: a bot task
// opened for editing came back as a local one, dropping its platform and chat
// id with no warning, because the seed carried them and the payload did not.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  formatScheduledTaskDeliveryProviderList,
  getScheduledTaskCopy,
  scheduledTaskFormValidation,
  scheduledTaskPresetRunAt,
  toScheduledTaskLocalDateTimeValue,
  useUiLocale,
  type ScheduledTaskFormSeed,
} from '@maka/ui';
import { BOT_DELIVERY_PROVIDERS } from '@maka/core/bot-chat-settings';
import type { BotProvider } from '@maka/core/bot-chat-settings';
import { botDisplayLabel } from '@maka/core/bot-events';
import { Button } from '../../ui/button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog.js';
import { Input } from '../../ui/input.js';
import { Label } from '../../ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Textarea } from '../../ui/textarea.js';
import {
  createScheduledTaskInputFromFields,
  scheduledTaskEffectFromFields,
  updateScheduledTaskInputFromFields,
  type ScheduledTaskFormFields,
} from '../../../lib/ported/scheduled-task-form-payload.js';
import { getSettingsSharedCopy } from '../../../locales/settings-shared-copy.js';

export function ScheduleFormDialog(props: {
  open: boolean;
  seed: ScheduledTaskFormSeed;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: NonNullable<ReturnType<typeof createScheduledTaskInputFromFields>>) => void;
  onUpdate: (
    id: string,
    patch: NonNullable<ReturnType<typeof updateScheduledTaskInputFromFields>>,
  ) => void;
}) {
  const locale = useUiLocale();
  const catalog = getScheduledTaskCopy(locale);
  const copy = catalog.form;
  const shared = getSettingsSharedCopy(locale);
  const [fields, setFields] = useState<ScheduledTaskFormFields>(() => toFields(props.seed));
  // The empty form is invalid by definition; the title error waits for a
  // submit attempt rather than greeting the user in red.
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setFields(toFields(props.seed));
    setSubmitted(false);
  }, [props.open, props.seed]);

  const validation = useMemo(
    () =>
      scheduledTaskFormValidation(
        {
          title: fields.title,
          parsedRunAt: Date.parse(fields.runAtLocal),
          recurrence: fields.recurrence,
          cronExpression: fields.cronExpression,
          delivery: scheduledTaskEffectFromFields(fields),
          now: Date.now(),
        },
        locale,
      ),
    [fields, locale],
  );

  const editingId = props.seed.editingId;
  const lockedInterval = fields.recurrence === 'interval';
  const patch = (next: Partial<ScheduledTaskFormFields>) =>
    setFields((current) => ({ ...current, ...next }));

  const submit = () => {
    setSubmitted(true);
    if (validation) return;
    if (editingId) {
      const update = updateScheduledTaskInputFromFields(fields);
      if (update) props.onUpdate(editingId, update);
      return;
    }
    const create = createScheduledTaskInputFromFields(fields);
    if (create) props.onCreate(create);
  };

  const errorFor = (field: 'title' | 'time' | 'cron' | 'chatId') =>
    submitted && validation?.field === field ? validation.message : undefined;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader closeLabel={shared.close}>
          <DialogTitle>{editingId ? copy.editTitle : copy.createTitle}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label={copy.field.title} htmlFor="schedule-title" error={errorFor('title')}>
            <Input
              id="schedule-title"
              value={fields.title}
              placeholder={copy.titlePlaceholder}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </Field>

          <Field label={copy.field.time} htmlFor="schedule-time" error={errorFor('time')}>
            <Input
              id="schedule-time"
              type="datetime-local"
              value={fields.runAtLocal}
              disabled={lockedInterval}
              onChange={(event) => patch({ runAtLocal: event.target.value })}
            />
            <div
              role="group"
              aria-label={copy.presetsAriaLabel}
              className="flex flex-wrap items-center gap-2 pt-1"
            >
              {copy.presets.map(([preset, label]) => (
                <Button
                  key={preset}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={lockedInterval}
                  onClick={() =>
                    patch({
                      runAtLocal: toScheduledTaskLocalDateTimeValue(
                        scheduledTaskPresetRunAt(preset),
                      ),
                    })
                  }
                >
                  {label}
                </Button>
              ))}
            </div>
          </Field>

          <Field
            label={copy.field.recurrence}
            {...(lockedInterval ? {} : { htmlFor: 'schedule-recurrence' })}
          >
            {lockedInterval ? (
              <p className="text-sm leading-5 text-text-secondary">{copy.intervalOption}</p>
            ) : (
              <Select
                value={fields.recurrence}
                onValueChange={(value) =>
                  patch({ recurrence: value as ScheduledTaskFormFields['recurrence'] })
                }
              >
                <SelectTrigger id="schedule-recurrence" aria-label={copy.field.recurrence}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {copy.recurrenceOptions
                    .filter(([value]) => value !== 'interval')
                    .map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          {fields.recurrence === 'cron' && (
            <Field label={copy.field.cron} htmlFor="schedule-cron" error={errorFor('cron')}>
              <Input
                id="schedule-cron"
                value={fields.cronExpression}
                placeholder={copy.cronPlaceholder}
                onChange={(event) => patch({ cronExpression: event.target.value })}
              />
            </Field>
          )}

          {fields.lockedEffect ? (
            <Field label={copy.field.channel} help={catalog.detail.agentSourceHint}>
              <p className="text-sm leading-5 text-text-primary">{catalog.detail.agentDelivery}</p>
            </Field>
          ) : (
            <Field label={copy.field.channel} htmlFor="schedule-channel">
              <Select
                value={fields.deliveryMethod ?? 'local'}
                onValueChange={(value) =>
                  patch({ deliveryMethod: value as ScheduledTaskFormFields['deliveryMethod'] })
                }
              >
                <SelectTrigger id="schedule-channel" aria-label={copy.field.channel}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {copy.deliveryOptions.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          {fields.deliveryMethod === 'bot' && !fields.lockedEffect && (
            <>
              <Field
                label={copy.field.platform}
                htmlFor="schedule-platform"
                help={copy.deliveryHelp(formatScheduledTaskDeliveryProviderList())}
              >
                <Select
                  value={fields.deliveryPlatform ?? 'telegram'}
                  onValueChange={(value) => patch({ deliveryPlatform: value as BotProvider })}
                >
                  <SelectTrigger id="schedule-platform" aria-label={copy.field.platform}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BOT_DELIVERY_PROVIDERS.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {botDisplayLabel(provider)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field
                label={copy.field.chatId}
                htmlFor="schedule-chat-id"
                error={errorFor('chatId')}
              >
                <Input
                  id="schedule-chat-id"
                  value={fields.deliveryChatId ?? ''}
                  placeholder={copy.chatIdPlaceholder}
                  onChange={(event) => patch({ deliveryChatId: event.target.value })}
                />
              </Field>
            </>
          )}

          <Field label={copy.field.note} htmlFor="schedule-note">
            <Textarea
              id="schedule-note"
              rows={3}
              value={fields.note}
              placeholder={copy.notePlaceholder}
              onChange={(event) => patch({ note: event.target.value })}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            {shared.cancel}
          </Button>
          <Button onClick={submit} disabled={props.saving} aria-busy={props.saving || undefined}>
            {editingId
              ? props.saving
                ? copy.saving
                : copy.save
              : props.saving
                ? copy.creating
                : copy.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toFields(seed: ScheduledTaskFormSeed): ScheduledTaskFormFields {
  return {
    title: seed.title,
    note: seed.note,
    runAtLocal: seed.runAtLocal,
    recurrence: seed.recurrence,
    cronExpression: seed.cronExpression,
    // A locked effect keeps `agent_run` out of the channel control's own
    // vocabulary: the control is hidden in that case, and the payload reads
    // `lockedEffect` rather than these three.
    deliveryMethod: seed.deliveryMethod === 'agent_run' ? 'local' : seed.deliveryMethod,
    deliveryPlatform: seed.deliveryPlatform,
    deliveryChatId: seed.deliveryChatId,
    ...(seed.lockedSchedule ? { lockedSchedule: seed.lockedSchedule } : {}),
    ...(seed.lockedEffect ? { lockedEffect: seed.lockedEffect } : {}),
  };
}

function Field(props: {
  label: string;
  /** Omitted where the control is not a labelable element (a radiogroup, or
   *  a read-only value): a `<label for>` pointing at a `<p>` names nothing. */
  htmlFor?: string;
  help?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {props.htmlFor ? (
        <Label htmlFor={props.htmlFor} className="text-sm leading-5 text-text-primary">
          {props.label}
        </Label>
      ) : (
        <span className="text-sm leading-5 text-text-primary">{props.label}</span>
      )}
      {props.children}
      {props.error ? (
        <p className="text-[0.8125rem] leading-[1.125rem] text-danger" role="alert">
          {props.error}
        </p>
      ) : props.help ? (
        <p className="text-[0.8125rem] leading-[1.125rem] text-text-secondary">{props.help}</p>
      ) : null}
    </div>
  );
}
