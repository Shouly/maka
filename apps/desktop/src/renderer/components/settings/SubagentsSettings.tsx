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
// Two levels in one column — list, then editor — because the whole page is one
// array on the settings object: every write is `{ subagents: { presets } }`,
// and the editor edits one element of it. Nothing here is modal.
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
import { Anthropicon } from '../icons/Anthropicon.js';
import { Button } from '../ui/button.js';
import { ConfirmDialog } from '../ui/confirm-dialog.js';
import { Skeleton } from '../ui/skeleton.js';
import { Switch } from '../ui/switch.js';
import { statusChipClass, statusChipToneClass } from '../ui/status-chip.js';
import { SubagentEditor } from './subagents/SubagentEditor.js';
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

  // Both faces render inside one tree because the removal confirm has to be
  // mounted on both. It used to live only in the list branch, and the editor's
  // own Remove therefore set the pending preset and opened nothing: a delete
  // that resolves successfully and does nothing at all.
  return (
    <>
      {level !== 'list' ? (
        <SubagentEditor
          key={editing?.id ?? '__new__'}
          preset={editing}
          presets={presets}
          connections={rows}
          saving={saving}
          onBack={() => setRoute({ kind: 'list' })}
          onDelete={editing ? () => setPendingRemove(editing) : undefined}
          onSave={async (next) => {
            const nextPresets = editing
              ? presets.map((candidate) => (candidate.id === editing.id ? next : candidate))
              : [...presets, next];
            if (await persist(nextPresets, next.id)) setRoute({ kind: 'list' });
          }}
        />
      ) : (
        <SettingsSection
          title={copy.section.title}
          description={copy.section.count(presets.length)}
          action={
            presets.length > 0 ? (
              <Button
                size="sm"
                disabled={saving || atLimit}
                onClick={() => setRoute({ kind: 'create' })}
              >
                {copy.section.add}
              </Button>
            ) : undefined
          }
        >
          {presets.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm leading-5 text-text-primary">{copy.section.emptyTitle}</p>
              <p className="max-w-md text-[13px] leading-[18px] text-text-secondary">
                {copy.section.emptyDescription}
              </p>
              <Button size="sm" disabled={saving} onClick={() => setRoute({ kind: 'create' })}>
                {copy.section.add}
              </Button>
            </div>
          ) : (
            presets.map((preset) => {
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
              return (
                <SettingsRow
                  key={preset.id}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate">{preset.name}</span>
                      {problem && (
                        <span
                          className={`${statusChipClass} ${statusChipToneClass(availability.tone)}`}
                        >
                          {problem}
                        </span>
                      )}
                    </span>
                  }
                  description={preset.description || copy.row.fallbackDescription}
                  control={
                    <span className="flex items-center gap-2">
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
                      <Button
                        variant="ghost"
                        size="iconSm"
                        aria-label={copy.row.configure(preset.name)}
                        disabled={saving}
                        onClick={() => setRoute({ kind: 'edit', presetId: preset.id })}
                      >
                        <Anthropicon name="caretRight" size={16} />
                      </Button>
                    </span>
                  }
                />
              );
            })
          )}
        </SettingsSection>
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
