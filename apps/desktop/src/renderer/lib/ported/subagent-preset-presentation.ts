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

// What a subagent preset's route is worth, as pure data.
//
// Ported from the pre-rewrite `settings/subagent-preset-presentation.ts`. The
// only edit is the tone vocabulary: the old module spoke Astryx's Badge
// variants, this one speaks `components/ui/status-chip.ts`'s five tones, so the
// dot beside a row and the chip on it cannot disagree about the same state.

import { connectionEnabledModelIds, type LlmConnection } from '@maka/core/llm-connections';
import { isRetiredProvider } from '@maka/core/provider-registry';
import type { SubagentPreset } from '@maka/core/subagent-settings';

/** The chip tones `statusChipToneClass` understands. */
export type SubagentStatusTone = 'success' | 'active' | 'attention' | 'error' | 'neutral';

/**
 * Where the page is. `create` and `edit` are the same form; they are separate
 * cases because the id is settled in one and typed in the other, and because
 * an `edit` route can become unsatisfiable while `create` cannot.
 */
export type SubagentPageRoute =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; presetId: string };

/**
 * An edit route whose preset vanished (deleted, or removed by an external
 * settings write) is an unsatisfiable route, not a state to correct: the list
 * is what it renders as.
 */
export function resolveSubagentRoute(
  route: SubagentPageRoute,
  presets: readonly SubagentPreset[],
): { level: SubagentPageRoute['kind']; preset: SubagentPreset | null } {
  if (route.kind !== 'edit') return { level: route.kind, preset: null };
  const preset = presets.find((candidate) => candidate.id === route.presetId) ?? null;
  return preset ? { level: 'edit', preset } : { level: 'list', preset: null };
}

export type SubagentPresetAvailabilityKind =
  | 'available'
  | 'disabled'
  | 'missing_connection'
  | 'provider_retired'
  | 'connection_disabled'
  | 'model_disabled';

export interface SubagentPresetAvailability {
  readonly kind: SubagentPresetAvailabilityKind;
  readonly tone: SubagentStatusTone;
}

/**
 * Whether the editor may route a preset through this connection. One predicate
 * for the option list, the validation and the saved value, so the editor cannot
 * write a route the runtime admission is guaranteed to refuse.
 */
export function isSelectableSubagentConnection(
  connection: Pick<LlmConnection, 'enabled' | 'providerType'>,
): boolean {
  return connection.enabled && !isRetiredProvider(connection.providerType);
}

export function subagentPresetAvailability(
  preset: SubagentPreset,
  connections: readonly LlmConnection[],
): SubagentPresetAvailability {
  if (!preset.enabled) return { kind: 'disabled', tone: 'neutral' };
  const connection = connections.find((candidate) => candidate.slug === preset.connectionSlug);
  if (!connection) return { kind: 'missing_connection', tone: 'error' };
  // Before `enabled`: a retained retired connection stays enabled, and unlike
  // a disabled one there is no switch that brings it back.
  if (isRetiredProvider(connection.providerType)) {
    return { kind: 'provider_retired', tone: 'error' };
  }
  if (!connection.enabled) return { kind: 'connection_disabled', tone: 'attention' };
  if (!connectionEnabledModelIds(connection).includes(preset.model)) {
    return { kind: 'model_disabled', tone: 'attention' };
  }
  return { kind: 'available', tone: 'success' };
}

/**
 * Typing the display name fills the id — until the user takes the id over.
 *
 * State math, not rendering: `idWasEdited` is the whole contract ("the id is
 * derived until the user says otherwise, and an existing preset's id is never
 * derived"), and an editor that quietly stops honouring it looks identical on
 * screen.
 */
export function nextSubagentDraftForName<Draft extends { name: string; id: string }>(
  draft: Draft,
  name: string,
  idWasEdited: boolean,
  existingIds: ReadonlySet<string>,
): Draft {
  if (idWasEdited) return { ...draft, name };
  return { ...draft, name, id: suggestSubagentPresetId(name, existingIds) };
}

export function suggestSubagentPresetId(name: string, existingIds: ReadonlySet<string>): string {
  const normalized = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  const base = normalized || 'subagent';
  if (!existingIds.has(base)) return base;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * How many characters a value spends on leading whitespace the store trims.
 *
 * The store measures a name AFTER trimming and DROPS the preset when it is too
 * long, so a cap applied to the raw string would cost the user real characters
 * for spaces that never reach disk.
 */
export function subagentLeadingSpace(value: string): number {
  return value.length - value.trimStart().length;
}
