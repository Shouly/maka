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

// The palette's command list, as data.
//
// Pure: a builder that takes what the shell knows and the callbacks it can
// perform, and returns rows. Keeping it out of the component is what lets the
// command set be unit-tested — which commands exist under which conditions is
// product behaviour, while how they are drawn is not.
//
// Session rows are built separately from the static ones. The static list is
// frozen for as long as the palette is open; the session rows must stay live,
// because a task that finishes or is renamed while the palette is open should
// say so.

import type { LlmConnection } from '@maka/core/llm-connections';
import { isRetiredProvider } from '@maka/core/provider-registry';
import { SETTINGS_SECTIONS, type SettingsSection, type ThemePreference } from '@maka/core/settings';
import type { UiLocale } from '@maka/core/ui-locale';
import type { AnthropiconName } from '../icons/Anthropicon.js';
import { getShellCopy, type StaticCommandId } from '../../locales/shell-copy.js';
import { getPaletteCopy } from '../../locales/palette-copy.js';
import type { SessionListRow } from '../../store/session-list-model.js';

export interface PaletteCommand {
  readonly id: string;
  readonly kind: 'action' | 'session';
  readonly label: string;
  readonly group: string;
  readonly hint?: string;
  readonly icon: AnthropiconName;
  readonly keywords: readonly string[];
  run(): void | Promise<void>;
}

const STATIC_ICONS: Partial<Record<StaticCommandId, AnthropiconName>> = {
  'action:new-chat': 'add',
  'action:open-settings': 'settings',
  'action:keyboard-help': 'code',
  'theme:light': 'sun',
  'theme:dark': 'moon',
  'theme:auto': 'sunHorizon',
  'nav:sessions': 'chat',
  'nav:automations': 'clock',
  'nav:skills': 'shapes',
  'nav:mcp': 'plugin',
  'diag:open-workspace': 'folderOpen',
  'diag:open-project-folder': 'folderOpen',
  'diag:copy-diagnostics': 'clipboard',
  'diag:test-network-proxy': 'globe',
};

export interface PaletteCommandInput {
  readonly locale: UiLocale;
  readonly activeSessionId: string | undefined;
  readonly theme: ThemePreference;
  readonly connections: readonly LlmConnection[];
  readonly defaultSlug: string | null;
  onNewTask(): void;
  onOpenSettings(): void;
  onOpenSettingsSection(section: SettingsSection): void;
  onOpenKeyboardHelp(): void;
  onSetTheme(theme: ThemePreference): void;
  onSelectModule(module: 'sessions' | 'skills' | 'mcp' | 'scheduled-tasks'): void;
  onOpenWorkspaceFolder(): void;
  onOpenProjectFolder?(): void;
  onCopyDiagnostics(): void;
  onTestNetworkProxy(): void;
  onSetDefaultConnection(slug: string): void;
  onOpenRuntimeDebug(): void;
}

export function buildPaletteCommands(input: PaletteCommandInput): PaletteCommand[] {
  const copy = getShellCopy(input.locale).commandPalette;
  const palette = getPaletteCopy(input.locale);
  const staticCommand = (id: StaticCommandId, run: () => void, hint?: string): PaletteCommand => ({
    id,
    kind: 'action',
    label: copy.commands[id].label,
    group: copy.commands[id].group,
    ...(hint !== undefined ? { hint } : {}),
    icon: STATIC_ICONS[id] ?? 'lightning',
    keywords: copy.staticKeywords[id],
    run,
  });

  const commands: PaletteCommand[] = [
    staticCommand('action:new-chat', input.onNewTask),
    staticCommand('action:open-settings', input.onOpenSettings),
    staticCommand('action:keyboard-help', input.onOpenKeyboardHelp),
    staticCommand(
      'theme:light',
      () => input.onSetTheme('light'),
      input.theme === 'light' ? copy.current : undefined,
    ),
    staticCommand(
      'theme:dark',
      () => input.onSetTheme('dark'),
      input.theme === 'dark' ? copy.current : undefined,
    ),
    staticCommand(
      'theme:auto',
      () => input.onSetTheme('auto'),
      input.theme === 'auto' ? copy.current : undefined,
    ),
    staticCommand('nav:sessions', () => input.onSelectModule('sessions')),
    staticCommand('nav:skills', () => input.onSelectModule('skills')),
    staticCommand('nav:mcp', () => input.onSelectModule('mcp')),
    staticCommand('nav:automations', () => input.onSelectModule('scheduled-tasks')),
    staticCommand('diag:open-workspace', input.onOpenWorkspaceFolder),
    staticCommand('diag:copy-diagnostics', input.onCopyDiagnostics),
    staticCommand('diag:test-network-proxy', input.onTestNetworkProxy),
  ];

  // Only when a task is open: without one there is no project to open.
  if (input.activeSessionId && input.onOpenProjectFolder) {
    commands.push(staticCommand('diag:open-project-folder', input.onOpenProjectFolder));
  }

  for (const section of SETTINGS_SECTIONS) {
    commands.push({
      id: `settings:${section}`,
      kind: 'action',
      label: copy.settingsCommand(copy.settingsSections[section]),
      group: copy.groups.settings,
      icon: 'settings',
      keywords: copy.settingsKeywords(section, copy.settingsSections[section]),
      run: () => input.onOpenSettingsSection(section),
    });
  }

  for (const connection of input.connections) {
    // A retired provider's connection row still exists so its credential stays
    // deletable, but the default-target gate refuses it — offering the command
    // could only produce a failure that reads as transient.
    if (!connection.enabled || isRetiredProvider(connection.providerType)) continue;
    if (connection.slug === input.defaultSlug) continue;
    // The workspace default is the {connection, model} pair; half of one is
    // not selectable.
    if (!connection.defaultModel) continue;
    commands.push({
      id: `connection:set-default:${connection.slug}`,
      kind: 'action',
      label: copy.setDefaultConnection(connection.name),
      hint: connection.providerType,
      group: copy.groups.connections,
      icon: 'connectors',
      keywords: copy.connectionKeywords('default', connection.name, connection.providerType),
      run: () => input.onSetDefaultConnection(connection.slug),
    });
  }

  commands.push({
    id: 'diag:runtime-debug',
    kind: 'action',
    label: palette.commands.runtimeDebug,
    group: palette.commands.runtimeDebugGroup,
    icon: 'terminal',
    keywords: palette.commands.runtimeDebugKeywords,
    run: input.onOpenRuntimeDebug,
  });

  return commands;
}

export function buildSessionCommands(input: {
  readonly locale: UiLocale;
  readonly rows: readonly SessionListRow[];
  readonly activeSessionId: string | undefined;
  onSelectSession(id: string): void;
}): PaletteCommand[] {
  const copy = getShellCopy(input.locale).commandPalette;
  return input.rows.map((row) => ({
    id: `session:${row.id}`,
    kind: 'session' as const,
    label: row.displayName,
    ...(row.id === input.activeSessionId ? { hint: copy.current } : {}),
    group: copy.groups.conversations,
    icon: row.flagged ? ('starFilled' as const) : ('chat' as const),
    keywords: [row.displayName, row.projectName ?? '', row.profileName],
    run: () => input.onSelectSession(row.id),
  }));
}

/** Case-insensitive match over the label, the hint and the keyword list. */
export function filterPaletteCommands(
  commands: readonly PaletteCommand[],
  query: string,
): PaletteCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...commands];
  return commands.filter((command) =>
    [command.label, command.hint ?? '', ...command.keywords].some((value) =>
      value.toLowerCase().includes(needle),
    ),
  );
}
