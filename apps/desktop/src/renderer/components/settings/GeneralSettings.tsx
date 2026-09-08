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

// The page that owns "how this app behaves for me".
//
// Two channels, one form. The identity, privacy, chat-default, shell and proxy
// rows are Runtime Host settings; the language and notification rows are the
// Desktop client's own. `settingsStore.update` routes each patch by the same
// `settings-ownership.ts` rule the main process routes by, and each row reads
// from the snapshot that actually owns it (`use-settings.ts` says why the two
// are read separately).
//
// The default model is neither: it is a Runtime Host CONNECTION target, so it
// is written through `connections.setDefaultModel`, not through settings.
//
// Every write is a fire-and-forget with a toast on failure. There is no Save
// button and no success toast: a settings page that stays silent when it works
// is how the reference design behaves, and a row that failed has to say so
// because nothing else will.

import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import {
  CHAT_DEFAULT_PERMISSION_MODES,
  type ChatDefaultPermissionMode,
  type ShellPreference,
  type UiLocalePreference,
} from '@maka/core/settings';
import { THINKING_LEVELS, type ThinkingLevel } from '@maka/core/model-thinking';
import {
  getConversationCopy,
  modelChoiceValue,
  parseModelChoiceValue,
  useUiLocale,
} from '@maka/ui';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Input } from '../ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Skeleton } from '../ui/skeleton.js';
import { Switch } from '../ui/switch.js';
import { NetworkProxySection } from './NetworkProxySection.js';
import { SettingsRow, SettingsSection, settingsFieldWidthClass } from './settings-row.js';
import {
  useClientSettings,
  useHostSettings,
  useSettingsErrorReporter,
} from '../../hooks/use-settings.js';
import { connectionsStore, settingsStore } from '../../store/index.js';
import { getSettingsPreferencesCopy } from '../../locales/settings-preferences-copy.js';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

const NO_MODEL = '__none__';

export function GeneralSettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const preferences = getSettingsPreferencesCopy(locale);
  const copy = preferences.general;
  const identity = preferences.personalization;
  const sections = preferences.sections;
  const shared = getSettingsSharedCopy(locale);
  const conversation = getConversationCopy(locale);
  const bypassCopy = getShellCopy(locale).sessionSettingsActions;
  const report = useSettingsErrorReporter();
  const host = props.host;
  const client = useClientSettings();
  const hostSettings = useHostSettings();
  const connections = useStore(connectionsStore, (state) => state.data);
  const [bypassOpen, setBypassOpen] = useState(false);

  const write = (patch: Parameters<typeof settingsStore.update>[0], failure: string) => {
    void settingsStore.update(patch, host).catch((error: unknown) => report(failure, error));
  };

  const settings = hostSettings.data;
  const ready = settings !== undefined;
  const choices = connections?.chatModelChoices ?? [];
  const currentModel = choices.find((choice) => choice.isDefault);

  return (
    <>
      <SettingsSection title={sections.identity} description={sections.identityHelp}>
        <SettingsRow
          title={identity.displayName}
          description={identity.displayNameHelp}
          control={
            ready ? (
              <CommittedInput
                label={identity.displayName}
                placeholder={identity.displayNamePlaceholder}
                value={settings.personalization.displayName}
                maxLength={60}
                onCommit={(displayName) =>
                  write({ personalization: { displayName } }, identity.saveFailed)
                }
              />
            ) : (
              <Skeleton className="h-8 w-56 rounded-lg" />
            )
          }
        />
        <SettingsRow
          title={identity.interfaceLanguage}
          description={identity.interfaceLanguageHelp}
          control={
            client.data ? (
              <Select
                value={client.data.personalization.uiLocale}
                onValueChange={(value) =>
                  // Client-owned: the whole app re-renders through
                  // `LocaleProvider` as soon as the snapshot comes back.
                  write(
                    { personalization: { uiLocale: value as UiLocalePreference } },
                    identity.saveFailed,
                  )
                }
              >
                <SelectTrigger
                  aria-label={identity.interfaceLanguage}
                  className={settingsFieldWidthClass}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {identity.localeOptions.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Skeleton className="h-8 w-56 rounded-lg" />
            )
          }
        />
        <SettingsRow
          title={identity.assistantTone}
          description={identity.assistantToneHelp}
          control={
            ready ? (
              <CommittedInput
                label={identity.assistantTone}
                placeholder={identity.assistantTonePlaceholder}
                value={settings.personalization.assistantTone}
                maxLength={500}
                onCommit={(assistantTone) =>
                  write({ personalization: { assistantTone } }, identity.saveFailed)
                }
              />
            ) : (
              <Skeleton className="h-8 w-56 rounded-lg" />
            )
          }
        />
      </SettingsSection>

      <SettingsSection title={sections.privacy} description={sections.privacyHelp}>
        <SettingsRow
          title={copy.notifications}
          description={copy.notificationsHelp}
          control={
            <Switch
              aria-label={copy.notifications}
              disabled={!client.data}
              checked={client.data?.notifications.runComplete ?? false}
              onCheckedChange={(runComplete) =>
                write({ notifications: { runComplete } }, copy.notificationsFailed)
              }
            />
          }
        />
        <SettingsRow
          title={copy.incognito}
          description={copy.incognitoHelp}
          control={
            <Switch
              aria-label={copy.enableIncognito}
              disabled={!ready}
              checked={settings?.privacy.incognitoActive ?? false}
              onCheckedChange={(incognitoActive) =>
                write({ privacy: { incognitoActive } }, copy.incognitoFailed)
              }
            />
          }
        />
        <SettingsRow
          title={copy.workspaceInstructions}
          description={copy.workspaceInstructionsHelp}
          control={
            <Switch
              aria-label={copy.workspaceInstructions}
              disabled={!ready}
              checked={settings?.workspaceInstructions.enabled ?? false}
              onCheckedChange={(enabled) =>
                write({ workspaceInstructions: { enabled } }, copy.workspaceInstructionsFailed)
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection title={sections.chatDefaults} description={sections.chatDefaultsHelp}>
        <SettingsRow
          title={copy.defaultModel}
          description={copy.defaultModelHelp}
          control={
            <Select
              value={
                currentModel
                  ? modelChoiceValue(currentModel.connectionSlug, currentModel.model)
                  : NO_MODEL
              }
              disabled={!host || choices.length === 0}
              onValueChange={(value) => {
                const parsed = value === NO_MODEL ? undefined : parseModelChoiceValue(value);
                if (!host) return;
                void connectionsStore
                  .setDefaultModel(
                    parsed ? { slug: parsed.llmConnectionSlug, model: parsed.model } : null,
                    host,
                  )
                  .catch((error: unknown) => report(copy.saveDefaultModelFailed, error));
              }}
            >
              <SelectTrigger aria-label={copy.defaultModel} className="w-64">
                <SelectValue placeholder={copy.notSet} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_MODEL}>{copy.notSet}</SelectItem>
                {choices.map((choice) => (
                  <SelectItem
                    key={`${choice.connectionSlug}:${choice.model}`}
                    value={modelChoiceValue(choice.connectionSlug, choice.model)}
                  >
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title={copy.defaultPermission}
          description={copy.defaultPermissionHelp}
          control={
            <Select
              value={settings?.chatDefaults.permissionMode ?? 'ask'}
              disabled={!ready}
              onValueChange={(value) => {
                const next = value as ChatDefaultPermissionMode;
                // Full access is confirmed before it is written, the same way
                // the composer's picker confirms it.
                if (next === 'bypass') setBypassOpen(true);
                else
                  write(
                    { chatDefaults: { permissionMode: next } },
                    copy.saveDefaultPermissionFailed,
                  );
              }}
            >
              <SelectTrigger
                aria-label={copy.defaultPermission}
                className={settingsFieldWidthClass}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_DEFAULT_PERMISSION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {conversation.permissions.mode[mode].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title={copy.defaultThinking}
          description={copy.defaultThinkingHelp}
          control={
            <Select
              value={settings?.chatDefaults.thinkingLevel ?? NO_MODEL}
              disabled={!ready}
              onValueChange={(value) =>
                write(
                  {
                    chatDefaults: {
                      thinkingLevel: value === NO_MODEL ? undefined : (value as ThinkingLevel),
                    },
                  },
                  copy.saveDefaultThinkingFailed,
                )
              }
            >
              <SelectTrigger aria-label={copy.defaultThinking} className={settingsFieldWidthClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_MODEL}>{copy.followModelDefault}</SelectItem>
                {THINKING_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {conversation.model.level[level]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection title={sections.shell} description={sections.shellHelp}>
        <SettingsRow
          title={copy.shellPreference}
          description={copy.shellPreferenceHelp}
          control={
            <Select
              value={settings?.shell.preference ?? 'auto'}
              disabled={!ready}
              onValueChange={(value) =>
                write({ shell: { preference: value as ShellPreference } }, copy.saveShellFailed)
              }
            >
              <SelectTrigger aria-label={copy.shellPreference} className={settingsFieldWidthClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{copy.shellAuto}</SelectItem>
                <SelectItem value="git_bash">{copy.shellGitBash}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          title={copy.shellExecutable}
          description={copy.shellExecutableHelp}
          control={
            ready ? (
              <CommittedInput
                label={copy.shellExecutable}
                value={settings.shell.executable}
                onCommit={(executable) => write({ shell: { executable } }, copy.saveShellFailed)}
              />
            ) : (
              <Skeleton className="h-8 w-56 rounded-lg" />
            )
          }
        />
      </SettingsSection>

      <NetworkProxySection host={host} />

      <ConfirmDialog
        open={bypassOpen}
        onOpenChange={setBypassOpen}
        title={bypassCopy.bypassConfirmTitle}
        description={bypassCopy.bypassConfirmDescription}
        confirmText={bypassCopy.bypassConfirmLabel}
        cancelText={shared.cancel}
        variant="destructive"
        onConfirm={() =>
          write({ chatDefaults: { permissionMode: 'bypass' } }, copy.saveDefaultPermissionFailed)
        }
      />
    </>
  );
}

/**
 * A text field that writes when the user is done, not on every keystroke.
 *
 * Enter and blur both commit; the local value is re-seeded whenever the stored
 * one changes, so a write that fails (or that the Host sanitized) shows what is
 * actually stored rather than what was typed.
 */
function CommittedInput(props: {
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState(props.value);
  const persisted = props.value;
  useEffect(() => setValue(persisted), [persisted]);
  const commit = () => {
    const next = value.trim();
    if (next === persisted) return;
    props.onCommit(next);
  };
  return (
    <Input
      aria-label={props.label}
      className={settingsFieldWidthClass}
      value={value}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        // A composing IME's Enter confirms a candidate; it is not a submit.
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setValue(persisted);
      }}
    />
  );
}
