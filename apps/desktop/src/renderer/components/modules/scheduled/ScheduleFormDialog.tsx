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

// Create or edit one scheduled task, as the reference draws it.
//
// The shape is a composer, not a settings sheet: Name, then Instructions in a
// box with the workspace and model fused to its bottom edge — the two choices
// that describe the session the instructions will run in, sitting on the
// instructions rather than in a list below them. Frequency and Permissions are
// the only labelled rows, because they are the only two that are about the
// SCHEDULE rather than about the work.
//
// What the reference has and this does not: "Require this computer". That row
// chooses between running in the cloud and running on the user's machine, and
// Maka only ever does the latter. Its other half — "only runs while your
// computer is awake" — is already one switch, in the page's ⋯ menu.
//
// The form holds fields and nothing else. The seed comes from `@maka/ui`'s
// `scheduledTaskEditSeed` / `createScheduledTaskFormSeed`, the cadence mapping
// and validation from the same module, and the payload from
// `lib/ported/scheduled-task-form-payload.ts` — so the form cannot disagree
// with the Host about what a valid task is.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import {
  createScheduledTaskFormSeed,
  describeScheduledTaskCadence,
  formatTaskTime,
  getScheduledTaskCopy,
  scheduledTaskAnchorAt,
  scheduledTaskFormValidation,
  scheduledTaskFrequencyNeeds,
  scheduledTaskScheduleFromSeed,
  useUiLocale,
  type ScheduledTaskFormSeed,
  type ScheduledTaskFrequency,
} from '@maka/ui';
import { Button } from '../../ui/button.js';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../ui/dialog.js';
import { Input } from '../../ui/input.js';
import { Label } from '../../ui/label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Textarea } from '../../ui/textarea.js';
import { Switch } from '../../ui/switch.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { ModelMenu } from '../../composer/ModelMenu.js';
import { WorkspacePicker } from '../../welcome/WorkspacePicker.js';
import { cn } from '../../../lib/cn.js';
import { connectionsStore, uiStore } from '../../../store/index.js';
import { getSettingsSharedCopy } from '../../../locales/settings-shared-copy.js';
import {
  createScheduledTaskInputFromFields,
  updateScheduledTaskInputFromFields,
  type ScheduledTaskFormFields,
} from '../../../lib/ported/scheduled-task-form-payload.js';

/**
 * The labelled rows under the instructions box. 128px label column and a 12px
 * gap, measured off the reference — the same rhythm the detail page's own
 * label column uses, so the two read as one place.
 */
const rowClass = 'flex items-center gap-3';
const rowLabelClass = 'w-32 shrink-0 text-sm font-medium leading-5 text-text-primary';

/**
 * The instructions box: ONE field, whose surface is the wrapper.
 *
 * Measured off the reference, which builds the same composite the same way —
 * background, ring, hover and focus all live on the wrapper, and the textarea
 * inside is bare. That is not a style preference: the strip covers the field's
 * bottom edge, so a ring drawn on the textarea can only ever be three-sided,
 * and a focus ring has nowhere to show at all. The tokens are Maka's own field
 * tokens, the same ones `fieldSurfaceClass` hands an ordinary Input.
 */
const instructionsFieldClass = [
  'flex w-full flex-col overflow-hidden rounded-lg text-sm',
  'bg-fill-field text-text-primary',
  'shadow-[var(--field-shadow)]',
  '[&:hover:not(:has(textarea:focus))]:shadow-[var(--field-shadow-hover)]',
  'has-[textarea:focus]:shadow-[var(--sidebar-focus-shadow)]',
  'transition-shadow duration-[var(--dur-fast)] ease-out',
].join(' ');

/**
 * The textarea inside it, stripped of everything the wrapper now owns. The
 * variant prefixes are repeated verbatim from `fieldSurfaceClass` so that
 * tailwind-merge resolves them last-wins instead of leaving both rules live.
 */
const instructionsInputClass = [
  'block resize-none rounded-none bg-transparent px-3 py-2',
  'shadow-none focus:shadow-none focus-visible:shadow-none',
  '[&:hover:not(:focus):not(:disabled)]:shadow-none',
].join(' ');

/**
 * The strip fused to its bottom edge: 6px of padding around 24px chips, an
 * 8px gap, a hairline above and a 5% ink wash — the reference's own numbers.
 *
 * The chips are the composer's, used exactly as the composer uses them, so
 * "where this runs" and "on what model" are the same two controls here as
 * under the chat input. The reference draws a folder glyph and a chevron on
 * them; Maka's composer language has neither, and matching the reference
 * glyph-for-glyph here would have made this the one place in the app where
 * those chips look different.
 */
const composerStripClass =
  'flex items-center justify-between gap-2 rounded-b-lg border-t border-hairline bg-alpha-1 p-1.5';

export function ScheduleFormDialog(props: {
  open: boolean;
  seed: ScheduledTaskFormSeed;
  saving: boolean;
  /** `undefined` until the client snapshot arrives; the row waits rather than guessing. */
  keepSystemAwake: boolean | undefined;
  onKeepSystemAwakeChange: (next: boolean) => void;
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
  const choices = useStore(connectionsStore, (state) => state.data)?.chatModelChoices ?? [];
  const editing = props.seed.editingId !== null;
  const keepSystemAwake = props.keepSystemAwake;

  const [fields, setFields] = useState<ScheduledTaskFormFields>(props.seed);
  const [submitted, setSubmitted] = useState(false);

  // One seed per open: the dialog mounts with what the page handed it, and a
  // second open of the same dialog for a different task must not keep the
  // first task's words.
  useEffect(() => {
    if (!props.open) return;
    setFields(props.seed);
    setSubmitted(false);
  }, [props.open, props.seed]);

  const needs = scheduledTaskFrequencyNeeds(fields.frequency);
  const locked = fields.lockedSchedule;
  const patch = (next: Partial<ScheduledTaskFormFields>) =>
    setFields((current) => ({ ...current, ...next }));

  const problem = useMemo(
    () =>
      scheduledTaskFormValidation(
        {
          title: fields.title,
          note: fields.note,
          hasWorkspace: fields.workspace.cwd.trim().length > 0,
          parsedRunAt: needs.time ? scheduledTaskAnchorAt(fields) : Date.now() + 1,
          oneOff: fields.frequency === 'once',
          now: Date.now(),
        },
        locale,
      ),
    [fields, needs.time, locale],
  );

  // What the cadence will actually mean, before anything is saved. The native
  // time input renders 12-hour under some locales, where the AM/PM half is the
  // one people forget to move; without this line a task set for 3am is only
  // discovered on the detail page afterwards.
  const preview = useMemo(() => {
    if (fields.frequency === 'manual') return { tone: 'muted' as const, text: copy.nextRunManual };
    const schedule = scheduledTaskScheduleFromSeed(fields);
    if (!schedule) return null;
    if (fields.frequency === 'once') {
      const runAt = scheduledTaskAnchorAt(fields);
      if (!Number.isFinite(runAt)) return null;
      if (runAt <= Date.now()) return { tone: 'danger' as const, text: copy.nextRunPast };
      return {
        tone: 'muted' as const,
        text: copy.nextRunPreview(formatTaskTime(runAt, locale)),
      };
    }
    return {
      tone: 'muted' as const,
      text: copy.nextRunPreview(describeScheduledTaskCadence({ schedule } as never, locale)),
    };
  }, [fields, copy, locale]);

  const submit = () => {
    setSubmitted(true);
    if (problem) return;
    if (editing && props.seed.editingId) {
      const update = updateScheduledTaskInputFromFields(fields, props.seed);
      if (update) props.onUpdate(props.seed.editingId, update);
      return;
    }
    const create = createScheduledTaskInputFromFields(fields);
    if (create) props.onCreate(create);
  };

  const errorFor = (field: 'title' | 'note' | 'workspace' | 'time') =>
    submitted && problem?.field === field ? problem.message : undefined;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="md:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{editing ? copy.editTitle : copy.createTitle}</DialogTitle>
        </DialogHeader>

        {/* 24px between fields, like the reference. The dialog primitive's own
            gap is 16 and lands on a wrapper this cannot reach, so the spacing
            is owned here rather than by changing the shared primitive. */}
        <div className="flex flex-col gap-6">
          <Field
            label={copy.field.title}
            htmlFor="schedule-title"
            required
            error={errorFor('title')}
          >
            <Input
              id="schedule-title"
              value={fields.title}
              placeholder={copy.titlePlaceholder}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </Field>

          <Field
            label={copy.field.note}
            htmlFor="schedule-note"
            required
            error={errorFor('note') ?? errorFor('workspace')}
          >
            {/* Five rows of instructions, like the reference — enough that a
                real prompt is visible without scrolling. */}
            <div className={instructionsFieldClass}>
              <Textarea
                id="schedule-note"
                rows={5}
                value={fields.note}
                placeholder={copy.notePlaceholder}
                onChange={(event) => patch({ note: event.target.value })}
                className={instructionsInputClass}
              />
              <div className={composerStripClass}>
                <WorkspacePicker
                  dense
                  side="bottom"
                  placeholder={copy.workspacePlaceholder}
                  value={fields.workspace}
                  onChange={(option) =>
                    patch({
                      workspace: option
                        ? { projectId: option.projectId, cwd: option.path ?? '' }
                        : { projectId: null, cwd: '' },
                    })
                  }
                />
                <ModelMenu
                  dense
                  choices={choices}
                  current={
                    fields.model.kind === 'pinned'
                      ? {
                          connectionSlug: fields.model.llmConnectionSlug,
                          model: fields.model.model,
                        }
                      : undefined
                  }
                  fallbackLabel={copy.defaultModel}
                  thinking={{ current: undefined, onChange: () => {} }}
                  onPick={(choice) =>
                    patch({
                      model: {
                        kind: 'pinned',
                        llmConnectionId: choice.connectionId,
                        llmConnectionSlug: choice.connectionSlug,
                        model: choice.model,
                      },
                    })
                  }
                  onOpenSettings={() => uiStore.openSettings('models')}
                />
              </div>
            </div>
          </Field>

          {/* Frequency and Permissions are two rows of one block, 12px apart:
              the reference's row pitch is 44px, a 32px control plus 12. They
              are not two sections, so they do not take the 24px the fields
              above them take. A help line hugs its own row at 8px. */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <div className={rowClass}>
                <Label className={rowLabelClass} htmlFor="schedule-frequency">
                  {copy.field.frequency}
                </Label>
                {locked ? (
                  <p className="text-sm leading-5 text-text-secondary">
                    {copy.fixedCadence(
                      describeScheduledTaskCadence({ schedule: locked } as never, locale),
                    )}
                  </p>
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Select
                      value={fields.frequency}
                      onValueChange={(value) =>
                        patch({ frequency: value as ScheduledTaskFrequency })
                      }
                    >
                      <SelectTrigger
                        id="schedule-frequency"
                        aria-label={copy.field.frequency}
                        className="w-[130px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {copy.frequencyOptions.map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {needs.date && (
                      <Input
                        type="date"
                        aria-label={copy.field.date}
                        value={fields.dateLocal}
                        onChange={(event) => patch({ dateLocal: event.target.value })}
                        className="w-[160px] cursor-pointer"
                      />
                    )}

                    {needs.weekday && (
                      <Select
                        value={String(fields.weekday)}
                        onValueChange={(value) => patch({ weekday: Number(value) })}
                      >
                        <SelectTrigger aria-label={copy.field.weekday} className="w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {copy.weekdayNames.map((name, index) => (
                            <SelectItem key={name} value={String(index)}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {needs.dayOfMonth && (
                      <Select
                        value={String(fields.dayOfMonth)}
                        onValueChange={(value) => patch({ dayOfMonth: Number(value) })}
                      >
                        <SelectTrigger aria-label={copy.field.dayOfMonth} className="w-[100px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-[240px]">
                          {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                            <SelectItem key={day} value={String(day)}>
                              {day}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {needs.time && (
                      <Input
                        type="time"
                        aria-label={copy.field.time}
                        value={fields.timeLocal}
                        onChange={(event) => patch({ timeLocal: event.target.value })}
                        className="w-[140px] cursor-pointer"
                      />
                    )}
                  </div>
                )}
              </div>

              {/* 128px label column + 12px gap = 140px, so the preview lines up
                under the controls rather than under the label. */}
              {preview && !locked && (
                <p
                  className={cn(
                    'pl-[140px] text-sm leading-5',
                    preview.tone === 'danger' ? 'text-danger' : 'text-text-muted',
                  )}
                >
                  {preview.text}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className={rowClass}>
                <Label className={rowLabelClass} htmlFor="schedule-permissions">
                  {copy.field.permissions}
                </Label>
                {/* Two rows, not the three permission modes: the choice a
                  scheduled task actually faces is "go ahead unattended" or
                  "stop and wait", and `explore` — read-only — is a mode for
                  somebody sitting there watching. `bypass` is what automatic
                  approval means to the Host. */}
                <Select
                  value={fields.permissionMode === 'bypass' ? 'auto' : 'ask'}
                  onValueChange={(value) =>
                    patch({ permissionMode: value === 'auto' ? 'bypass' : 'ask' })
                  }
                >
                  <SelectTrigger
                    id="schedule-permissions"
                    aria-label={copy.field.permissions}
                    className="w-auto"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {copy.permissionOptions.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {fields.permissionMode === 'ask' && (
                <p className="pl-[140px] text-sm leading-5 text-text-muted">
                  {copy.permissionHelp}
                </p>
              )}
            </div>
          </div>

          {/* The reference's last row is "Require this computer", whose first
              line is "Only runs while your computer is awake". Maka only ever
              runs here, so the binding half is moot — but the awake half is
              exactly true, and it is the one switch that makes a scheduled task
              silently not happen. It sits where the reference puts it, and the
              text says plainly that it is not a per-task setting. */}
          {keepSystemAwake !== undefined && (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium leading-5 text-text-primary">
                  <Anthropicon name="computer" size={16} className="shrink-0" />
                  {copy.keepAwakeTitle}
                </p>
                <p className="mt-1 text-sm leading-5 text-text-muted">{copy.keepAwakeHelp}</p>
              </div>
              <Switch
                aria-label={copy.keepAwakeTitle}
                checked={keepSystemAwake}
                onCheckedChange={props.onKeepSystemAwakeChange}
                className="mt-0.5 shrink-0"
              />
            </div>
          )}
        </div>

        <DialogFooter className="pt-2">
          <Button
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={props.saving}
          >
            {shared.cancel}
          </Button>
          <Button onClick={submit} disabled={props.saving}>
            {props.saving
              ? editing
                ? copy.saving
                : copy.creating
              : editing
                ? copy.save
                : copy.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field(props: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.htmlFor} className="text-sm font-medium leading-none text-text-primary">
        {props.label}
        {props.required && <span className="ml-1 text-danger">*</span>}
      </Label>
      {props.children}
      {props.error && <p className="text-sm leading-5 text-danger">{props.error}</p>}
    </div>
  );
}

/**
 * The blank seed the page opens the dialog with: nothing chosen.
 *
 * It used to inherit whatever the app's next-task target happened to be, so
 * every new task silently arrived pre-pointed at the last folder somebody
 * chatted in — a choice the person never made, on a task that will run
 * unattended. The reference opens on its placeholder too. A task still cannot
 * run nowhere, so the requirement is stated by validation instead of guessed
 * at here.
 */
export function blankScheduledTaskSeed(): ScheduledTaskFormSeed {
  return createScheduledTaskFormSeed({});
}
