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

// Which of a connection's models appear in the pickers, and — for a relay —
// what the user declares those models can do.
//
// The list is the Host's `catalogEntries`, not a client-side derivation: the
// Host owns the resolved catalog (its model-facts table may be newer than this
// build's) and two projections of one model's facts have drifted before.
//
// The thinking-level declaration is offered for relay providers only, and that
// is a property of the provider registry (`relayModelProfiles`), not a list of
// ids here. A relay's models are unknown to metadata, so the user is the only
// authority on which reasoning levels the endpoint accepts; for every other
// provider the metadata already knows, and an editable declaration would let a
// user turn off a level the model really has.

import { useMemo, useState } from 'react';
import {
  connectionEnabledModelIds,
  isRelayProviderType,
  type ProjectedLlmConnection,
} from '@maka/core/llm-connections';
import {
  DECLARABLE_RELAY_THINKING_LEVELS,
  type RelayModelProfiles,
  type ThinkingLevel,
} from '@maka/core/model-thinking';
import { getConversationCopy, useUiLocale } from '@maka/ui';
import { connectionModelRows, toggledModelIds } from '../../../lib/connection-model-rows.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { checkboxBoxClass, CHECKBOX_TICK_SIZE } from '../../ui/checkbox-box.js';
import { Input } from '../../ui/input.js';
import { Switch } from '../../ui/switch.js';
import { AddModelDialog } from './AddModelDialog.js';
import { SettingsRow, SettingsSection } from '../settings-row.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';

export function ConnectionModelsSection(props: {
  connection: ProjectedLlmConnection;
  busy: boolean;
  fetching: boolean;
  onSetEnabledModels: (enabledModelIds: string[]) => void;
  onAddModel: (input: { id: string; contextWindow: number }) => void;
  onFetchModels: () => void;
  onSetRelayProfiles: (profiles: RelayModelProfiles) => void;
}) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const thinkingCopy = getConversationCopy(locale).model.level;
  const [filter, setFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const entries = props.connection.catalogEntries;
  const enabledIds = useMemo(() => connectionEnabledModelIds(props.connection), [props.connection]);
  // The catalog's models AND anything else this connection still has enabled.
  const rows = useMemo(() => connectionModelRows(entries, enabledIds), [entries, enabledIds]);
  const relay = isRelayProviderType(props.connection.providerType);
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? rows.filter(
        (row) =>
          row.id.toLowerCase().includes(needle) ||
          (row.entry?.displayName ?? '').toLowerCase().includes(needle),
      )
    : rows;

  const toggle = (modelId: string, next: boolean) => {
    props.onSetEnabledModels(toggledModelIds(enabledIds, modelId, next));
  };

  const declaredLevels = (modelId: string): readonly ThinkingLevel[] =>
    props.connection.relayModelProfiles?.[modelId]?.thinkingLevels ?? [];

  const toggleLevel = (modelId: string, level: ThinkingLevel, next: boolean) => {
    const current = new Set(declaredLevels(modelId));
    if (next) current.add(level);
    else current.delete(level);
    const levels = DECLARABLE_RELAY_THINKING_LEVELS.filter((value) => current.has(value));
    const existing = props.connection.relayModelProfiles ?? {};
    const profile = {
      ...existing[modelId],
      ...(levels.length > 0 ? { thinkingLevels: levels } : {}),
    };
    if (levels.length === 0) delete (profile as { thinkingLevels?: unknown }).thinkingLevels;
    const next_: Record<string, typeof profile> = { ...existing };
    if (Object.keys(profile).length === 0) delete next_[modelId];
    else next_[modelId] = profile;
    props.onSetRelayProfiles(next_);
  };

  return (
    <SettingsSection
      title={copy.detail.modelManagement}
      description={copy.detail.modelManagementHelp}
      action={
        <span className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={props.busy}
            onClick={() => setAddOpen(true)}
          >
            {copy.detail.addModel}
          </Button>
          <Button variant="secondary" size="sm" disabled={props.busy} onClick={props.onFetchModels}>
            {props.fetching ? copy.page.modelsLoading : copy.detail.updateModels}
          </Button>
        </span>
      }
    >
      <SettingsRow
        title={copy.detail.modelsSummary(rows.filter((row) => row.enabled).length, rows.length)}
        control={
          <Input
            aria-label={copy.detail.filterModels}
            placeholder={copy.detail.filterModels}
            className="w-56"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        }
      />

      {rows.length === 0 && <SettingsRow title={copy.detail.noModels} control={null} />}

      {rows.length > 0 && shown.length === 0 && (
        <SettingsRow title={copy.detail.noModelsMatch} control={null} />
      )}

      {shown.map((row) => {
        const entry = row.entry;
        const label = entry?.displayName?.trim() || row.id;
        // Nothing to declare capabilities against, so it never expands.
        const open = expanded === row.id && entry !== undefined;
        return (
          <SettingsRow
            key={row.id}
            layout={relay && open ? 'stacked' : 'inline'}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{label}</span>
                {entry?.isDefault && (
                  <span className="shrink-0 text-[0.8125rem] text-text-muted">
                    {copy.page.defaultModel}
                  </span>
                )}
              </span>
            }
            description={
              <span className="flex flex-wrap items-center gap-x-2">
                <span className="font-mono text-[0.75rem]">{row.id}</span>
                {row.missingFromCatalog && (
                  <span className="text-text-muted">{copy.detail.modelNotOffered}</span>
                )}
                {entry?.contextWindow !== undefined && (
                  <span>{copy.detail.contextToken(String(entry.contextWindow))}</span>
                )}
                {entry?.supportsVision && <span>{copy.detail.visionToken}</span>}
                {entry !== undefined && entry.thinkingLevels.length > 0 && (
                  <span>{copy.detail.thinkingToken}</span>
                )}
                {entry !== undefined && !entry.describedByMetadata && (
                  <span className="text-text-muted">{copy.detail.modelUndescribed}</span>
                )}
              </span>
            }
            control={
              relay && open ? undefined : (
                <span className="flex items-center gap-3">
                  {relay && entry !== undefined && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={copy.detail.declareCapabilitiesAria(label)}
                      onClick={() => setExpanded(row.id)}
                    >
                      {copy.detail.declareCapabilities}
                    </Button>
                  )}
                  <Switch
                    aria-label={copy.detail.enableModelAria(label)}
                    disabled={props.busy}
                    checked={row.enabled}
                    onCheckedChange={(next) => toggle(row.id, next)}
                  />
                </span>
              )
            }
          >
            {relay && open && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {DECLARABLE_RELAY_THINKING_LEVELS.map((level) => {
                    const checked = declaredLevels(row.id).includes(level);
                    return (
                      <button
                        key={level}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        disabled={props.busy}
                        onClick={() => toggleLevel(row.id, level, !checked)}
                        className="group/cb flex cursor-pointer items-center gap-2 text-sm leading-5 text-text-primary outline-none focus-visible:shadow-[var(--sidebar-focus-shadow)]"
                      >
                        <span className={checkboxBoxClass(checked, 'xs')} aria-hidden>
                          {checked && <Anthropicon name="check" size={CHECKBOX_TICK_SIZE.xs} />}
                        </span>
                        <span>{thinkingCopy[level]}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    aria-label={copy.detail.enableModelAria(label)}
                    disabled={props.busy}
                    checked={row.enabled}
                    onCheckedChange={(next) => toggle(row.id, next)}
                  />
                  <Button variant="secondary" size="sm" onClick={() => setExpanded(null)}>
                    {copy.detail.save}
                  </Button>
                </div>
              </div>
            )}
          </SettingsRow>
        );
      })}

      <AddModelDialog
        open={addOpen}
        existingIds={entries.map((entry) => entry.id)}
        onOpenChange={setAddOpen}
        onAdd={props.onAddModel}
      />
    </SettingsSection>
  );
}
