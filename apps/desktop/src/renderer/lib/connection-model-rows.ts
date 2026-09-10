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

// Which model rows a connection shows, and what a switch writes back.
//
// A selection is the user's and a catalog is the provider's, so the catalog
// must not be able to edit the selection by leaving an id out.

import type { ModelCatalogEntry } from '@maka/core/model-catalog';

export interface ConnectionModelRow {
  readonly id: string;
  /** The catalog's description of it, when the catalog still offers it. */
  readonly entry: ModelCatalogEntry | undefined;
  readonly enabled: boolean;
  /** Enabled, but the catalog no longer offers it. Shown so it can be turned off. */
  readonly missingFromCatalog: boolean;
}

export function connectionModelRows(
  entries: readonly ModelCatalogEntry[],
  enabledIds: readonly string[],
): readonly ConnectionModelRow[] {
  const enabled = new Set(enabledIds);
  const offered = new Set(entries.map((entry) => entry.id));
  return [
    ...entries.map((entry) => ({
      id: entry.id,
      entry,
      enabled: enabled.has(entry.id),
      missingFromCatalog: false,
    })),
    // After the catalog, not interleaved: they are not on offer.
    ...enabledIds
      .filter((id) => !offered.has(id))
      .map((id) => ({ id, entry: undefined, enabled: true, missingFromCatalog: true })),
  ];
}

/** The selection after one switch: edited, never rebuilt from the catalog. */
export function toggledModelIds(
  enabledIds: readonly string[],
  modelId: string,
  next: boolean,
): string[] {
  const ids = enabledIds.filter((id) => id !== modelId);
  return next ? [...ids, modelId] : ids;
}
