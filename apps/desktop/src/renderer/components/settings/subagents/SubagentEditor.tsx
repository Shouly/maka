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

// One subagent preset, create and edit in the same form.
//
// The two levels differ in exactly one field: a new preset's id is the user's
// to type (derived from the name until they take it over), an existing one's is
// a settled fact that session history and the main agent's routing key on, so
// it is rendered as a value and never re-derived. Everything else is shared,
// which is why this is one component and not two.
//
// Model options come from the Host's `offerableCatalogEntries`, not from the
// raw enabled ids: those still list a model the Host quarantined or ruled out
// of chat, and every other picker in the app already drops them.

import { useMemo, useState } from 'react';
import {
  isSafeSubagentPresetId,
  SUBAGENT_PRESET_DESCRIPTION_MAX_CHARS,
  SUBAGENT_PRESET_ID_MAX_CHARS,
  SUBAGENT_PRESET_NAME_MAX_CHARS,
  SUBAGENT_PROFILES,
  type SubagentPreset,
  type SubagentProfile,
} from '@maka/core/subagent-settings';
import { offerableCatalogEntries, type ProjectedLlmConnection } from '@maka/core/llm-connections';
import type { ThinkingLevel } from '@maka/core/model-thinking';
import { useUiLocale } from '@maka/ui';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select.js';
import { Textarea } from '../../ui/textarea.js';
import { Switch } from '../../ui/switch.js';
import { SettingsRow, SettingsSection, settingsFieldWidthClass } from '../settings-row.js';
import {
  isSelectableSubagentConnection,
  nextSubagentDraftForName,
  subagentLeadingSpace,
} from '../../../lib/ported/subagent-preset-presentation.js';
import { getSubagentSettingsCopy } from '../../../locales/settings-subagents-copy.js';

/** Radix Select forbids an empty option value, so "follow the model" is named. */
const MODEL_DEFAULT_THINKING = '__model_default__';

/** The preset as the form holds it: `thinkingLevel` gains the "unset" option. */
type EditorDraft = Omit<SubagentPreset, 'thinkingLevel'> & {
  thinkingLevel: ThinkingLevel | typeof MODEL_DEFAULT_THINKING;
};

export function SubagentEditor(props: {
  preset: SubagentPreset | null;
  presets: readonly SubagentPreset[];
  connections: readonly ProjectedLlmConnection[];
  saving: boolean;
  onBack: () => void;
  onDelete?: () => void;
  onSave: (preset: SubagentPreset) => void | Promise<void>;
}) {
  const locale = useUiLocale();
  const copy = getSubagentSettingsCopy(locale);
  const editor = copy.editor;

  const usable = useMemo(
    () => props.connections.filter(isSelectableSubagentConnection),
    [props.connections],
  );
  const existingIds = useMemo(
    () =>
      new Set(
        props.presets.filter((preset) => preset.id !== props.preset?.id).map((preset) => preset.id),
      ),
    [props.presets, props.preset?.id],
  );

  const [draft, setDraft] = useState<EditorDraft>(() => {
    const initialConnection = props.preset
      ? props.connections.find((row) => row.slug === props.preset?.connectionSlug)
      : usable[0];
    const initialModels = initialConnection ? offerableCatalogEntries(initialConnection) : [];
    return {
      // Empty, not a pre-derived `subagent`: an id the user has not been asked
      // for yet reads as a value the page already decided for them.
      id: props.preset?.id ?? '',
      name: props.preset?.name ?? '',
      description: props.preset?.description ?? '',
      profile: props.preset?.profile ?? 'local_read',
      connectionSlug: props.preset?.connectionSlug ?? usable[0]?.slug ?? '',
      model: props.preset?.model ?? initialModels[0]?.id ?? '',
      thinkingLevel: props.preset?.thinkingLevel ?? MODEL_DEFAULT_THINKING,
      enabled: props.preset?.enabled ?? true,
    };
  });
  const [idWasEdited, setIdWasEdited] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const selected = props.connections.find((row) => row.slug === draft.connectionSlug);
  const offerable = selected ? offerableCatalogEntries(selected) : [];
  const thinkingLevels =
    selected?.catalogEntries.find((entry) => entry.id === draft.model)?.thinkingLevels ?? [];

  const trimmedId = draft.id.trim();
  const validId = isSafeSubagentPresetId(trimmedId);
  const duplicateId = existingIds.has(trimmedId);
  const validConnection = Boolean(selected && isSelectableSubagentConnection(selected));
  const validModel = offerable.some((entry) => entry.id === draft.model);
  const canSave = Boolean(
    draft.name.trim() &&
      (props.preset !== null || (validId && !duplicateId)) &&
      validConnection &&
      validModel,
  );

  const idError =
    submitted && !validId
      ? editor.invalidId(SUBAGENT_PRESET_ID_MAX_CHARS)
      : submitted && duplicateId
        ? editor.duplicateId
        : undefined;

  const updateName = (value: string) => {
    // Capped where the name changes, because the store DROPS a preset whose
    // name is over the limit rather than trimming it: an error message would
    // arrive after the row had already disappeared. Measured the way the store
    // measures it — after trimming — so leading spaces cost no real characters.
    const name = value.slice(0, SUBAGENT_PRESET_NAME_MAX_CHARS + subagentLeadingSpace(value));
    if (props.preset) {
      setDraft((current) => ({ ...current, name }));
      return;
    }
    setDraft((current) => nextSubagentDraftForName(current, name, idWasEdited, existingIds));
  };

  const selectConnection = (connectionSlug: string) => {
    const connection = usable.find((row) => row.slug === connectionSlug);
    const models = connection ? offerableCatalogEntries(connection) : [];
    setDraft((current) => ({
      ...current,
      connectionSlug,
      model: models[0]?.id ?? '',
      thinkingLevel: MODEL_DEFAULT_THINKING,
    }));
  };

  const submit = () => {
    setSubmitted(true);
    if (!canSave) return;
    void props.onSave({
      // An existing preset's id comes from the preset, never from the draft.
      id: props.preset ? props.preset.id : trimmedId,
      name: draft.name.trim(),
      description: draft.description.trim(),
      profile: draft.profile,
      connectionSlug: draft.connectionSlug,
      model: draft.model,
      // Only when the row is on screen: a level left over from a previous model
      // is not a choice the user can still see, let alone change.
      ...(draft.thinkingLevel !== MODEL_DEFAULT_THINKING &&
      thinkingLevels.includes(draft.thinkingLevel)
        ? { thinkingLevel: draft.thinkingLevel }
        : {}),
      enabled: draft.enabled,
    });
  };

  return (
    <div data-maka-contract="subagent-detail">
      <div className="mb-6 flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2.5 self-start"
          disabled={props.saving}
          onClick={props.onBack}
        >
          <Anthropicon name="arrowLeft" size={16} />
          {editor.backToList}
        </Button>
        <h2 className="text-[15px] font-semibold leading-5 text-text-primary">
          {props.preset ? props.preset.name : copy.section.add}
        </h2>
        <p className="text-[13px] leading-[18px] text-text-secondary">
          {props.preset ? editor.editSubtitle : editor.createSubtitle}
        </p>
      </div>

      <SettingsSection title={editor.groupPurpose} description={editor.groupPurposeHelp}>
        <SettingsRow title={editor.name} layout="stacked">
          <Input
            aria-label={editor.name}
            value={draft.name}
            placeholder={editor.namePlaceholder}
            disabled={props.saving}
            onChange={(event) => updateName(event.target.value)}
          />
          {submitted && !draft.name.trim() && (
            <p className="text-[13px] leading-[18px] text-danger">{editor.requiredName}</p>
          )}
        </SettingsRow>
        <SettingsRow
          title={editor.description}
          description={editor.descriptionPlaceholder}
          layout="stacked"
        >
          <Textarea
            aria-label={editor.description}
            rows={3}
            value={draft.description}
            placeholder={editor.descriptionPlaceholder}
            disabled={props.saving}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((current) => ({
                ...current,
                // The store TRUNCATES a long description rather than dropping
                // the preset, but a field that silently loses its tail is the
                // same surprise in smaller print.
                description: value.slice(
                  0,
                  SUBAGENT_PRESET_DESCRIPTION_MAX_CHARS + subagentLeadingSpace(value),
                ),
              }));
            }}
          />
        </SettingsRow>
        {props.preset ? (
          <SettingsRow
            title={editor.id}
            description={editor.idDescription}
            control={
              <span className="font-mono text-[13px] leading-[18px] text-text-secondary">
                {props.preset.id}
              </span>
            }
          />
        ) : (
          <SettingsRow title={editor.id} description={editor.idDescription} layout="stacked">
            <Input
              aria-label={editor.id}
              value={draft.id}
              placeholder={editor.idPlaceholder}
              disabled={props.saving}
              onChange={(event) => {
                setIdWasEdited(true);
                const id = event.target.value;
                setDraft((current) => ({ ...current, id }));
              }}
            />
            {idError && <p className="text-[13px] leading-[18px] text-danger">{idError}</p>}
          </SettingsRow>
        )}
      </SettingsSection>

      <SettingsSection title={editor.groupRoute} description={editor.groupRouteHelp}>
        <SettingsRow
          title={editor.profile}
          description={copy.profiles[draft.profile].description}
          control={
            <Select
              value={draft.profile}
              onValueChange={(profile) =>
                setDraft((current) => ({ ...current, profile: profile as SubagentProfile }))
              }
            >
              <SelectTrigger aria-label={editor.profile} className={settingsFieldWidthClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBAGENT_PROFILES.map((profile) => (
                  <SelectItem key={profile} value={profile}>
                    {copy.profiles[profile].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {draft.profile === 'implementation' && (
          <SettingsRow
            title={
              <span className="flex items-center gap-2 text-warning">
                <Anthropicon name="warning" size={16} />
                {editor.implementationWarning}
              </span>
            }
          />
        )}
        <SettingsRow
          title={editor.connection}
          description={usable.length === 0 ? editor.noConnection : undefined}
          control={
            <Select
              value={draft.connectionSlug || undefined}
              disabled={props.saving || usable.length === 0}
              onValueChange={selectConnection}
            >
              <SelectTrigger aria-label={editor.connection} className={settingsFieldWidthClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* A slug the catalog no longer carries still appears, disabled
                    and labelled: a route that silently emptied itself is the
                    state this page exists to make visible. */}
                {draft.connectionSlug &&
                  !props.connections.some((row) => row.slug === draft.connectionSlug) && (
                    <SelectItem value={draft.connectionSlug} disabled>
                      {`${draft.connectionSlug} · ${copy.status.missingConnection}`}
                    </SelectItem>
                  )}
                {props.connections.map((connection) => {
                  // Enabled yet unselectable means retired: the option says why
                  // rather than greying out with no explanation.
                  const retired = connection.enabled && !isSelectableSubagentConnection(connection);
                  return (
                    <SelectItem
                      key={connection.slug}
                      value={connection.slug}
                      disabled={!isSelectableSubagentConnection(connection)}
                    >
                      {retired
                        ? `${connection.name} · ${copy.status.providerRetired}`
                        : connection.name}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          }
        />
        {submitted && !validConnection && (
          <SettingsRow title={<span className="text-danger">{editor.invalidConnection}</span>} />
        )}
        <SettingsRow
          title={editor.model}
          description={offerable.length === 0 ? editor.noModel : undefined}
          control={
            <Select
              value={draft.model || undefined}
              disabled={props.saving || offerable.length === 0}
              onValueChange={(model) =>
                setDraft((current) => ({
                  ...current,
                  model,
                  thinkingLevel: MODEL_DEFAULT_THINKING,
                }))
              }
            >
              <SelectTrigger aria-label={editor.model} className={settingsFieldWidthClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {draft.model && !validModel && (
                  <SelectItem value={draft.model} disabled>
                    {`${draft.model} · ${copy.status.modelDisabled}`}
                  </SelectItem>
                )}
                {offerable.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.displayName?.trim() || entry.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        {submitted && validConnection && !validModel && (
          <SettingsRow title={<span className="text-danger">{editor.invalidModel}</span>} />
        )}
        {thinkingLevels.length > 0 && (
          <SettingsRow
            title={editor.thinking}
            control={
              <Select
                value={
                  draft.thinkingLevel !== MODEL_DEFAULT_THINKING &&
                  thinkingLevels.includes(draft.thinkingLevel)
                    ? draft.thinkingLevel
                    : MODEL_DEFAULT_THINKING
                }
                disabled={props.saving}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    thinkingLevel: value as EditorDraft['thinkingLevel'],
                  }))
                }
              >
                <SelectTrigger aria-label={editor.thinking} className={settingsFieldWidthClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MODEL_DEFAULT_THINKING}>{editor.defaultThinking}</SelectItem>
                  {thinkingLevels.map((level) => (
                    <SelectItem key={level} value={level}>
                      {copy.thinking[level]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        )}
        <SettingsRow
          title={editor.enabled}
          description={editor.enabledDescription}
          control={
            <Switch
              aria-label={editor.enabled}
              checked={draft.enabled}
              disabled={props.saving}
              onCheckedChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
            />
          }
        />
      </SettingsSection>

      {/* Save commits the whole preset, not the group above it. */}
      <div className="mb-10 flex flex-wrap items-center gap-2">
        <Button disabled={props.saving} onClick={submit}>
          {props.saving ? editor.saving : props.preset ? editor.save : editor.create}
        </Button>
        <Button variant="ghost" disabled={props.saving} onClick={props.onBack}>
          {editor.cancel}
        </Button>
      </div>

      {/* Deletion stands alone and last, so a mis-aimed cursor has nothing
          quiet to hit beside it. */}
      {props.onDelete && (
        <SettingsSection title={editor.dangerZone} description={editor.dangerZoneHelp}>
          <SettingsRow
            title={editor.delete}
            control={
              <Button
                variant="destructive"
                size="sm"
                disabled={props.saving}
                onClick={props.onDelete}
              >
                {editor.delete}
              </Button>
            }
          />
        </SettingsSection>
      )}
    </div>
  );
}
