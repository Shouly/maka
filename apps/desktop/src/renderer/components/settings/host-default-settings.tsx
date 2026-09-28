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

// The Runtime Host defaults that used to sit under General › Tasks, each now
// placed on the page that owns what it decides: the thinking level on Models
// under the default model, the permission mode and the Bash shell on
// Permissions, and the project-instructions switch on Projects.
//
// They are Runtime Host settings, read from and written to the Host this
// window is talking to. Every write is a fire-and-forget with a toast on
// failure, as on every other settings page.

import { useState } from 'react';
import {
  CHAT_DEFAULT_PERMISSION_MODES,
  type ChatDefaultPermissionMode,
  type ShellPreference,
} from '@maka/core/settings';
import { THINKING_LEVELS, type ThinkingLevel } from '@maka/core/model-thinking';
import { getConversationCopy, useUiLocale } from '@maka/ui';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select.js';
import { Skeleton } from '../ui/skeleton.js';
import { Switch } from '../ui/switch.js';
import { CommittedInput } from './settings-fields.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import { useHostSettings, useSettingsErrorReporter } from '../../hooks/use-settings.js';
import { settingsStore } from '../../store/index.js';
import { getSettingsPreferencesCopy } from '../../locales/settings-preferences-copy.js';
import { getSettingsSharedCopy } from '../../locales/settings-shared-copy.js';
import { getShellCopy } from '../../locales/shell-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

const FOLLOW_MODEL = '__model__';

type HostProps = { host: DesktopRuntimeHostRef | undefined };

function useHostWrite(host: DesktopRuntimeHostRef | undefined) {
  const report = useSettingsErrorReporter();
  return (patch: Parameters<typeof settingsStore.update>[0], failure: string) => {
    void settingsStore.update(patch, host).catch((error: unknown) => report(failure, error));
  };
}

/** Models: the thinking level a new task starts at. */
export function DefaultThinkingRow(props: HostProps) {
  const locale = useUiLocale();
  const copy = getSettingsPreferencesCopy(locale).general;
  const conversation = getConversationCopy(locale);
  const settings = useHostSettings().data;
  const write = useHostWrite(props.host);
  return (
    <SettingsRow
      title={copy.defaultThinking}
      description={copy.defaultThinkingHelp}
      control={
        <Select
          value={settings?.chatDefaults.thinkingLevel ?? FOLLOW_MODEL}
          disabled={settings === undefined}
          onValueChange={(value) =>
            write(
              {
                chatDefaults: {
                  thinkingLevel: value === FOLLOW_MODEL ? undefined : (value as ThinkingLevel),
                },
              },
              copy.saveDefaultThinkingFailed,
            )
          }
        >
          <SelectTrigger aria-label={copy.defaultThinking} variant="ghost">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FOLLOW_MODEL}>{copy.followModelDefault}</SelectItem>
            {THINKING_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {conversation.model.level[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

/** Permissions: the mode a new task starts in. Full access is confirmed first. */
export function DefaultPermissionSection(props: HostProps) {
  const locale = useUiLocale();
  const copy = getSettingsPreferencesCopy(locale).general;
  const conversation = getConversationCopy(locale);
  const bypassCopy = getShellCopy(locale).sessionSettingsActions;
  const shared = getSettingsSharedCopy(locale);
  const settings = useHostSettings().data;
  const write = useHostWrite(props.host);
  const [bypassOpen, setBypassOpen] = useState(false);
  return (
    <SettingsSection>
      <SettingsRow
        title={copy.defaultPermission}
        description={copy.defaultPermissionHelp}
        control={
          <Select
            value={settings?.chatDefaults.permissionMode ?? 'ask'}
            disabled={settings === undefined}
            onValueChange={(value) => {
              const next = value as ChatDefaultPermissionMode;
              // Full access is confirmed before it is written, the same way
              // the composer's picker confirms it.
              if (next === 'bypass') setBypassOpen(true);
              else
                write({ chatDefaults: { permissionMode: next } }, copy.saveDefaultPermissionFailed);
            }}
          >
            <SelectTrigger aria-label={copy.defaultPermission} variant="ghost">
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
    </SettingsSection>
  );
}

/** Permissions: which shell the Bash tool runs, and where Git Bash lives. */
export function ShellSection(props: HostProps) {
  const preferences = getSettingsPreferencesCopy(useUiLocale());
  const copy = preferences.general;
  const settings = useHostSettings().data;
  const write = useHostWrite(props.host);
  return (
    <SettingsSection title={preferences.sections.shell}>
      <SettingsRow
        title={copy.shellPreference}
        description={copy.shellPreferenceHelp}
        control={
          <Select
            value={settings?.shell.preference ?? 'auto'}
            disabled={settings === undefined}
            onValueChange={(value) =>
              write({ shell: { preference: value as ShellPreference } }, copy.saveShellFailed)
            }
          >
            <SelectTrigger aria-label={copy.shellPreference} variant="ghost">
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
          settings ? (
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
  );
}

/** Projects › Working folders: whether each project's own instruction files are read. */
export function WorkspaceInstructionsRow(props: HostProps) {
  const copy = getSettingsPreferencesCopy(useUiLocale()).general;
  const settings = useHostSettings().data;
  const write = useHostWrite(props.host);
  return (
    <SettingsRow
      title={copy.workspaceInstructions}
      description={copy.workspaceInstructionsHelp}
      control={
        <Switch
          aria-label={copy.workspaceInstructions}
          disabled={settings === undefined}
          checked={settings?.workspaceInstructions.enabled ?? false}
          onCheckedChange={(enabled) =>
            write({ workspaceInstructions: { enabled } }, copy.workspaceInstructionsFailed)
          }
        />
      }
    />
  );
}
