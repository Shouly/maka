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

// The model routes the main agent is allowed to delegate to.
//
// A list of presets and, over it, the editor as a dialog — create and edit are
// forms, and forms open over the settings rather than in them. The
// whole page is one array on the settings object: every write is
// `{ subagents: { presets } }`, and the editor edits one element of it.
//
// The failure mode this page is built around: `normalizeSubagentSettings`
// DROPS a preset it dislikes rather than rejecting the write, so a resolved
// promise is not a saved preset. The editor holds every field inside the
// limits normalization measures, and `persist` re-reads the answer for the id
// it just wrote — a preset that vanished on the way to disk has to say so,
// because the alternative is a list quietly missing what the user just saved.

import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { MAX_SUBAGENT_PRESETS, type SubagentPreset } from '@maka/core/subagent-settings';
import { useUiLocale } from '@maka/ui';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Skeleton } from '../ui/skeleton.js';
import { Switch } from '../ui/switch.js';
import { statusChipClass, statusChipToneClass } from '../ui/status-chip.js';
import { SubagentEditor } from './subagents/SubagentEditor.js';
import {
  RowActionsMenu,
  SettingsEmpty,
  SettingsTable,
  SettingsTableActionsCell,
  SettingsTableCell,
  SettingsTableRow,
} from './settings-kit.js';
import { SettingsRow, SettingsSection } from './settings-row.js';
import { useHostSettings, useSettingsErrorReporter } from '../../hooks/use-settings.js';
import {
  resolveSubagentRoute,
  subagentPresetAvailability,
  type SubagentPageRoute,
} from '../../lib/ported/subagent-preset-presentation.js';
import { connectionsStore, settingsStore } from '../../store/index.js';
import { toast } from '../../store/toast-store.js';
import { getSubagentSettingsCopy } from '../../locales/settings-subagents-copy.js';
import type { DesktopRuntimeHostRef } from '../../bridge/projects.js';

export function SubagentsSettings(props: { host: DesktopRuntimeHostRef | undefined }) {
  const locale = useUiLocale();
  const copy = getSubagentSettingsCopy(locale);
  const report = useSettingsErrorReporter();
  const settings = useHostSettings().data;
  const connections = useStore(connectionsStore, (state) => state.data);
  const [route, setRoute] = useState<SubagentPageRoute>({ kind: 'list' });
  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<SubagentPreset | null>(null);

  const presets = useMemo(() => settings?.subagents.presets ?? [], [settings]);
  const rows = connections?.connections ?? [];
  const { level, preset: editing } = resolveSubagentRoute(route, presets);
  const atLimit = presets.length >= MAX_SUBAGENT_PRESETS;

  /**
   * Write the whole array and check the answer.
   *
   * `expectPresent` is the backstop for a rule this page has not heard about —
   * a count that filled up elsewhere, a field a newer Host validates — because
   * normalization's refusal is silent and would otherwise land the user back on
   * a list without their preset and without an explanation.
   */
  const persist = async (next: SubagentPreset[], expectPresent?: string): Promise<boolean> => {
    if (!props.host) return false;
    setSaving(true);
    try {
      const result = await settingsStore.update({ subagents: { presets: next } }, props.host);
      if (
        expectPresent !== undefined &&
        !result.subagents.presets.some((candidate) => candidate.id === expectPresent)
      ) {
        toast({
          title: copy.toast.saveFailed,
          description: copy.toast.rejected,
          variant: 'destructive',
        });
        return false;
      }
      return true;
    } catch (error) {
      report(copy.toast.saveFailed, error);
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <SettingsSection title={copy.section.title}>
        <SettingsRow
          title={copy.section.title}
          control={<Skeleton className="h-8 w-28 rounded-lg" />}
        />
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection
        title={copy.section.title}
        description={copy.section.count(presets.length)}
        action={
          presets.length > 0 ? (
            <Button disabled={saving || atLimit} onClick={() => setRoute({ kind: 'create' })}>
              {copy.section.add}
            </Button>
          ) : undefined
        }
      >
        {presets.length === 0 ? (
          <SettingsEmpty
            title={copy.section.emptyTitle}
            body={copy.section.emptyDescription}
            action={
              <Button disabled={saving} onClick={() => setRoute({ kind: 'create' })}>
                {copy.section.add}
              </Button>
            }
          />
        ) : (
          <SettingsTable label={copy.section.title}>
            {presets.map((preset) => {
              const availability = subagentPresetAvailability(preset, rows);
              // Only a route the main agent cannot take earns a chip: "disabled"
              // is the switch beside it said twice, and "available" says nothing
              // a list of approved presets does not already say.
              const problem = {
                available: null,
                disabled: null,
                missing_connection: copy.status.missingConnection,
                provider_retired: copy.status.providerRetired,
                connection_disabled: copy.status.connectionDisabled,
                model_disabled: copy.status.modelDisabled,
              }[availability.kind];
              const connection = rows.find((row) => row.slug === preset.connectionSlug);
              return (
                <SettingsTableRow
                  key={preset.id}
                  onOpen={() => setRoute({ kind: 'edit', presetId: preset.id })}
                  openLabel={copy.row.configure(preset.name)}
                >
                  <SettingsTableCell>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium">{preset.name}</span>
                        {problem && (
                          <span
                            className={`${statusChipClass} ${statusChipToneClass(availability.tone)}`}
                          >
                            {problem}
                          </span>
                        )}
                      </span>
                      <span className="truncate text-[0.8125rem] leading-[1.0625rem] text-text-muted">
                        {preset.description || copy.row.fallbackDescription}
                      </span>
                    </span>
                  </SettingsTableCell>
                  <SettingsTableCell className="w-[34%] truncate text-text-secondary">
                    {`${connection?.name ?? preset.connectionSlug} · ${preset.model}`}
                  </SettingsTableCell>
                  <SettingsTableCell className="w-14">
                    <span className="flex justify-end" onClick={(event) => event.stopPropagation()}>
                      <Switch
                        aria-label={`${copy.row.enabled}: ${preset.name}`}
                        checked={preset.enabled}
                        disabled={saving}
                        onCheckedChange={(enabled) => {
                          void persist(
                            presets.map((candidate) =>
                              candidate.id === preset.id ? { ...candidate, enabled } : candidate,
                            ),
                          );
                        }}
                      />
                    </span>
                  </SettingsTableCell>
                  <SettingsTableActionsCell>
                    <RowActionsMenu
                      label={copy.row.actions(preset.name)}
                      actions={[
                        {
                          label: copy.row.edit,
                          icon: 'edit',
                          disabled: saving,
                          onSelect: () => setRoute({ kind: 'edit', presetId: preset.id }),
                        },
                        {
                          label: copy.remove.confirm,
                          icon: 'trash',
                          danger: true,
                          disabled: saving,
                          onSelect: () => setPendingRemove(preset),
                        },
                      ]}
                    />
                  </SettingsTableActionsCell>
                </SettingsTableRow>
              );
            })}
          </SettingsTable>
        )}
      </SettingsSection>

      {level !== 'list' && (
        <SubagentEditor
          key={editing?.id ?? '__new__'}
          preset={editing}
          presets={presets}
          connections={rows}
          saving={saving}
          onClose={() => setRoute({ kind: 'list' })}
          onSave={async (next) => {
            const nextPresets = editing
              ? presets.map((candidate) => (candidate.id === editing.id ? next : candidate))
              : [...presets, next];
            if (await persist(nextPresets, next.id)) setRoute({ kind: 'list' });
          }}
        />
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
        title={pendingRemove ? copy.remove.title(pendingRemove.name) : ''}
        description={copy.remove.description}
        confirmText={copy.remove.confirm}
        cancelText={copy.remove.cancel}
        variant="destructive"
        waitForConfirm
        onConfirm={async () => {
          const target = pendingRemove;
          if (!target) return;
          // No explicit route reset: with the preset gone the edit route is
          // unsatisfiable, and `resolveSubagentRoute` renders the list for this
          // path and for a deletion that happened elsewhere alike.
          await persist(presets.filter((candidate) => candidate.id !== target.id));
          setPendingRemove(null);
        }}
      />
    </>
  );
}
