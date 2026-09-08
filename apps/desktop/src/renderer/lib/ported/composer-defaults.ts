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

// Ported from upstream `renderer/composer-defaults.ts`. Global "last
// selection" default for the composer's model chip. Survives reloads so a
// freshly created task inherits the most recent pick instead of the catalog's
// factory default. Keyed with a `v1` suffix to allow schema migration later.

import { safeLocalStorageGet, safeLocalStorageSet } from './browser-storage.js';

const STORAGE_KEY = 'maka-composer-defaults-v1';

export interface ComposerDefaults {
  model: { llmConnectionId?: string; llmConnectionSlug: string; model: string } | null;
}

const EMPTY: ComposerDefaults = { model: null };

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
function isModel(value: unknown): value is NonNullable<ComposerDefaults['model']> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    (record.llmConnectionId === undefined || isString(record.llmConnectionId)) &&
    isString(record.llmConnectionSlug) &&
    isString(record.model)
  );
}

function parse(raw: string | null): ComposerDefaults | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return { model: isModel(parsed.model) ? parsed.model : null };
  } catch {
    // Corrupt JSON — treat as absent so callers fall back to defaults.
    return null;
  }
}

/** Read the persisted defaults. `null` when storage is empty or invalid. */
export function loadComposerDefaults(): ComposerDefaults | null {
  return parse(safeLocalStorageGet(STORAGE_KEY));
}

/** Merge-write: fields set to `null` are cleared, omitted ones kept. */
export function saveComposerDefaults(patch: Partial<ComposerDefaults>): void {
  const current = loadComposerDefaults() ?? EMPTY;
  const next: ComposerDefaults = {
    model: patch.model !== undefined ? patch.model : current.model,
  };
  safeLocalStorageSet(STORAGE_KEY, JSON.stringify(next));
}
