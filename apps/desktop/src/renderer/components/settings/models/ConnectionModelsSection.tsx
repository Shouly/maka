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
// is a property of the provider registry (`modelOverrides`), not a list of
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
  type ModelOverrides,
  type ThinkingLevel,
} from '@maka/core/model-thinking';
import { getConversationCopy, useUiLocale } from '@maka/ui';
import {
  connectionModelRows,
  toggledModelIds,
  type ConnectionModelRow,
} from '../../../lib/connection-model-rows.js';
import { Anthropicon } from '../../icons/Anthropicon.js';
import { Button } from '../../ui/button.js';
import { checkboxBoxClass, CHECKBOX_TICK_SIZE } from '../../ui/checkbox-box.js';
import { Input } from '../../ui/input.js';
import { statusChipClass, statusChipToneClass } from '../../ui/status-chip.js';
import { Switch } from '../../ui/switch.js';
import { AddModelDialog } from './AddModelDialog.js';
import { SettingsModal } from '../settings-kit.js';
import { SettingsRow, SettingsSection } from '../settings-row.js';
import { cn } from '../../../lib/cn.js';
import { getSettingsModelsCopy } from '../../../locales/settings-models-copy.js';

/** More models than this and the list gets a search box. */
const SEARCHABLE_FROM = 8;

export function ConnectionModelsSection(props: {
  connection: ProjectedLlmConnection;
  busy: boolean;
  fetching: boolean;
  onSetEnabledModels: (enabledModelIds: string[]) => void;
  onAddModel: (input: { id: string; contextWindow: number }) => void;
  onFetchModels: () => void;
  onSetModelOverrides: (profiles: ModelOverrides) => void;
}) {
  const locale = useUiLocale();
  const copy = getSettingsModelsCopy(locale);
  const thinkingCopy = getConversationCopy(locale).model.level;
  const [filter, setFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [declaring, setDeclaring] = useState<string | null>(null);

  const entries = props.connection.catalogEntries;
  const enabledIds = useMemo(() => connectionEnabledModelIds(props.connection), [props.connection]);
  // The models that were on when the page opened lead the list, so a catalog
  // of hundreds opens on the few in use. Switching one does not move it: a
  // row that jumps away from the pointer is how the wrong one gets switched.
  const [inUse] = useState(() => new Set(enabledIds));
  // The catalog's models AND anything else this connection still has enabled.
  const rows = useMemo(() => {
    const all = connectionModelRows(entries, enabledIds);
    return [...all.filter((row) => inUse.has(row.id)), ...all.filter((row) => !inUse.has(row.id))];
  }, [entries, enabledIds, inUse]);
  const relay = isRelayProviderType(props.connection.providerType);
  // The search applies only while it is on screen: a list that drops to a
  // readable length must not stay narrowed by a box no longer there.
  const needle = rows.length > SEARCHABLE_FROM ? filter.trim().toLowerCase() : '';
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
    props.connection.modelOverrides?.[modelId]?.thinkingLevels ?? [];

  const toggleLevel = (modelId: string, level: ThinkingLevel, next: boolean) => {
    const current = new Set(declaredLevels(modelId));
    if (next) current.add(level);
    else current.delete(level);
    const levels = DECLARABLE_RELAY_THINKING_LEVELS.filter((value) => current.has(value));
    const existing = props.connection.modelOverrides ?? {};
    const profile = {
      ...existing[modelId],
      ...(levels.length > 0 ? { thinkingLevels: levels } : {}),
    };
    if (levels.length === 0) delete (profile as { thinkingLevels?: unknown }).thinkingLevels;
    const next_: Record<string, typeof profile> = { ...existing };
    if (Object.keys(profile).length === 0) delete next_[modelId];
    else next_[modelId] = profile;
    props.onSetModelOverrides(next_);
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
            className="rounded-[7px] text-sm"
            disabled={props.busy || props.fetching}
            onClick={props.onFetchModels}
          >
            {props.fetching ? copy.sources.refreshing : copy.sources.refresh}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="rounded-[7px] text-sm"
            disabled={props.busy}
            onClick={() => setAddOpen(true)}
          >
            {copy.detail.addModel}
          </Button>
        </span>
      }
    >
      {/* The table toolbar: the search at the left, the count at the right. A
          list that fits on the page is read, not searched. */}
      {rows.length > SEARCHABLE_FROM && (
        <div className="flex items-center justify-between gap-4 pb-2">
          <Input
            aria-label={copy.detail.filterModels}
            placeholder={copy.detail.filterModels}
            className="w-full max-w-md"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <span className="shrink-0 text-sm leading-5 text-text-muted">
            {copy.detail.modelsSummary(rows.filter((row) => row.enabled).length, rows.length)}
          </span>
        </div>
      )}

      {rows.length === 0 && <SettingsRow title={copy.detail.noModels} control={null} />}

      {rows.length > 0 && shown.length === 0 && (
        <SettingsRow title={copy.detail.noModelsMatch} control={null} />
      )}

      {shown.map((row) => {
        const entry = row.entry;
        const label = entry?.displayName?.trim() || row.id;
        return (
          <SettingsRow
            key={row.id}
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{label}</span>
                {entry?.isDefault && (
                  <span className={cn(statusChipClass, statusChipToneClass('active'))}>
                    {copy.panel.default}
                  </span>
                )}
              </span>
            }
            description={<ModelFacts row={row} />}
            control={
              <span className="flex items-center gap-3">
                {/* Nothing to declare capabilities against without a catalog entry. */}
                {relay && entry !== undefined && (
                  <Button
                    variant="ghost"
                    aria-label={copy.detail.declareCapabilitiesAria(label)}
                    onClick={() => setDeclaring(row.id)}
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
            }
          />
        );
      })}

      <SettingsModal
        open={declaring !== null}
        onOpenChange={(open) => {
          if (!open) setDeclaring(null);
        }}
        size="sm"
        title={copy.detail.declareCapabilities}
        description={declaring ?? undefined}
        footer={
          <Button variant="secondary" onClick={() => setDeclaring(null)}>
            {copy.detail.done}
          </Button>
        }
      >
        {declaring !== null && (
          <div
            className="flex flex-col gap-2"
            role="group"
            aria-label={copy.detail.declareCapabilities}
          >
            {/* Each box writes as it is ticked, as the switches on the page do. */}
            {DECLARABLE_RELAY_THINKING_LEVELS.map((level) => {
              const checked = declaredLevels(declaring).includes(level);
              return (
                <button
                  key={level}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={props.busy}
                  onClick={() => toggleLevel(declaring, level, !checked)}
                  className="group/cb flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm leading-5 text-text-primary outline-none hover:bg-alpha-1 focus-visible:shadow-[var(--sidebar-focus-shadow)]"
                >
                  <span className={checkboxBoxClass(checked, 'xs')} aria-hidden>
                    {checked && <Anthropicon name="check" size={CHECKBOX_TICK_SIZE.xs} />}
                  </span>
                  <span>{thinkingCopy[level]}</span>
                </button>
              );
            })}
          </div>
        )}
      </SettingsModal>

      <AddModelDialog
        open={addOpen}
        existingIds={entries.map((entry) => entry.id)}
        onOpenChange={setAddOpen}
        onAdd={props.onAddModel}
      />
    </SettingsSection>
  );
}

/** Under a model's name: its id, then what it takes and does. */
export function ModelFacts(props: { row: ConnectionModelRow }) {
  const copy = getSettingsModelsCopy(useUiLocale());
  const { row } = props;
  const entry = row.entry;
  const facts = [
    row.missingFromCatalog ? copy.detail.modelNotOffered : undefined,
    entry?.contextWindow === undefined
      ? undefined
      : copy.detail.contextToken(compactTokens(entry.contextWindow)),
    entry?.supportsVision ? copy.detail.visionToken : undefined,
    entry === undefined || entry.thinkingSource === 'none'
      ? undefined
      : copy.detail.thinkingSourceToken[entry.thinkingSource],
  ].filter(Boolean);
  return (
    <span className="block truncate">
      <span data-mono="true">{row.id}</span>
      {facts.length > 0 && ` · ${facts.join(' · ')}`}
    </span>
  );
}

/** A context window as people say it: 200K, 1M. */
function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}
