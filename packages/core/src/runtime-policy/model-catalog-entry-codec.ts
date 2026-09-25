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

import {
  isThinkingLevel,
  type ReasoningSupport,
  type ThinkingLevel,
  type ThinkingSource,
} from '../model-thinking.js';
import type { ModelCatalogEntry } from '../model-catalog.js';
import { decodeConnectionModel } from './connection-catalog-codec.js';
import { booleanValue, domainError, exactRecord, integerValue } from './domain-codec.js';

/**
 * A catalog entry as the Host resolved it. The entry is a projection, not
 * stored state: the Host owns the metadata that produced it, so a client
 * decodes what it was sent rather than re-deriving it from a bundled copy
 * that may be older or newer than the Host's.
 */
export function decodeModelCatalogEntry(value: unknown): ModelCatalogEntry {
  const item = exactRecord(
    value,
    'model catalog entry',
    [
      'id',
      'displayName',
      'description',
      'canUseAsChatDefault',
      'isDefault',
      'supportsVision',
      'defaultSupportsVision',
      'compactionThreshold',
      'thinkingLevels',
      'defaultThinkingLevel',
      'thinkingSource',
      'reasoningSupport',
      'contextWindow',
      'inputLimit',
      'defaultContextWindow',
      'defaultInputLimit',
      'knowledgeCutoff',
    ],
    [
      'id',
      'canUseAsChatDefault',
      'isDefault',
      'supportsVision',
      'thinkingLevels',
      'thinkingSource',
      'reasoningSupport',
    ],
  );
  // The fields an entry shares with a stored model row keep one decoder, so a
  // bound that moves moves for both. `decodeConnectionModel` rejects unknown
  // fields, so it is handed exactly the subset it owns.
  const shared = decodeConnectionModel({
    id: item.id,
    ...pick(item, ['displayName', 'description', 'contextWindow', 'inputLimit', 'knowledgeCutoff']),
  });
  return {
    ...shared,
    ...Object.fromEntries(
      ['defaultContextWindow', 'defaultInputLimit'].flatMap((field) =>
        item[field] === undefined
          ? []
          : [[field, integerValue(item[field], field, 1, Number.MAX_SAFE_INTEGER)]],
      ),
    ),
    canUseAsChatDefault: booleanValue(item.canUseAsChatDefault, 'entry chat default eligibility'),
    isDefault: booleanValue(item.isDefault, 'entry default flag'),
    supportsVision: booleanValue(item.supportsVision, 'entry vision support'),
    ...(item.compactionThreshold === undefined
      ? {}
      : {
          compactionThreshold: integerValue(
            item.compactionThreshold,
            'compaction threshold',
            1,
            Number.MAX_SAFE_INTEGER,
          ),
        }),
    ...(item.defaultSupportsVision !== undefined
      ? {
          defaultSupportsVision: booleanValue(
            item.defaultSupportsVision,
            'entry default vision support',
          ),
        }
      : {}),
    ...decodeThinkingFacts(item),
  };
}

const THINKING_SOURCES: readonly ThinkingSource[] = ['user', 'provider', 'catalog', 'none'];
const REASONING_SUPPORT: readonly ReasoningSupport[] = ['yes', 'no', 'unknown'];

function decodeThinkingFacts(
  item: Record<string, unknown>,
): Pick<
  ModelCatalogEntry,
  'thinkingLevels' | 'defaultThinkingLevel' | 'thinkingSource' | 'reasoningSupport'
> {
  const thinkingLevels = decodeThinkingLevels(item.thinkingLevels);
  if (!THINKING_SOURCES.includes(item.thinkingSource as ThinkingSource)) {
    throw domainError('entry thinking source is invalid');
  }
  if (!REASONING_SUPPORT.includes(item.reasoningSupport as ReasoningSupport)) {
    throw domainError('entry reasoning support is invalid');
  }
  const thinkingSource = item.thinkingSource as ThinkingSource;
  if ((thinkingSource === 'none') !== (thinkingLevels.length === 0)) {
    throw domainError('entry thinking source disagrees with its levels');
  }
  const defaultLevel = item.defaultThinkingLevel;
  if (
    defaultLevel !== undefined &&
    (!isThinkingLevel(defaultLevel) || !thinkingLevels.includes(defaultLevel))
  ) {
    throw domainError('entry default thinking level must be one of its levels');
  }
  return {
    thinkingLevels,
    ...(defaultLevel === undefined ? {} : { defaultThinkingLevel: defaultLevel as ThinkingLevel }),
    thinkingSource,
    reasoningSupport: item.reasoningSupport as ReasoningSupport,
  };
}

function decodeThinkingLevels(value: unknown): readonly ThinkingLevel[] {
  if (!Array.isArray(value)) throw domainError('entry thinking levels must be an array');
  const levels = value.map((level) => {
    if (!isThinkingLevel(level)) throw domainError('entry thinking level is invalid');
    return level;
  });
  if (new Set(levels).size !== levels.length) {
    throw domainError('entry thinking levels must be unique');
  }
  return levels;
}

function pick(item: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (item[key] !== undefined) result[key] = item[key];
  }
  return result;
}
