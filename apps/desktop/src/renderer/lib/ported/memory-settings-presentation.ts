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

// Local-memory presentation, as pure data.
//
// Ported from the pre-rewrite `settings/memory-settings-labels.ts` and the
// derivation half of `memory-settings-view-model.ts`. One deliberate change:
// nothing here takes a copy catalog. The old helpers did, which made "filter
// these entries" and "which of four sentences explains why nothing is
// injected" depend on the same argument, and neither is really a copy
// question. They return the locale-independent answer; the page names it.

import {
  LOCAL_MEMORY_PROMPT_MAX_CHARS,
  LOCAL_MEMORY_PROMPT_TRUNCATION_MARKER,
  buildLocalMemoryPromptBody,
  type LocalMemoryEntryPreview,
  type LocalMemoryState,
} from '@maka/core/local-memory';

/** Chip tones, the vocabulary `components/ui/status-chip.ts` understands. */
export type MemoryStatusTone = 'success' | 'active' | 'attention' | 'error' | 'neutral';

/**
 * `disabled` is a settled fact the user chose, so it is neutral rather than
 * an alert: a feature deliberately switched off must not look like one that
 * is failing.
 */
export function memoryStatusTone(status: LocalMemoryState['status']): MemoryStatusTone {
  switch (status) {
    case 'ok':
      return 'success';
    case 'disabled':
      return 'neutral';
    case 'safe_mode':
    case 'incognito_blocked':
      return 'attention';
    case 'error':
      return 'error';
  }
}

/**
 * Why the model will not be given local memory on the next send, or `null`
 * when it will. Ordered by which fact wins: the master switch first, then the
 * two states the file itself can be in, then the read permission.
 */
export function localMemoryPromptBlockedReason(
  state: Pick<LocalMemoryState, 'enabled' | 'status' | 'agentReadEnabled'>,
): 'disabled' | 'incognito' | 'safeMode' | 'agentRead' | null {
  if (!state.enabled) return 'disabled';
  if (state.status === 'incognito_blocked') return 'incognito';
  if (state.status === 'safe_mode') return 'safeMode';
  if (!state.agentReadEnabled) return 'agentRead';
  return null;
}

/**
 * Narrow a list of entries by a free-text query.
 *
 * The haystack is everything the row shows plus the ids and timestamps it does
 * not, because a user searching for a memory rarely remembers which of those
 * they are typing. `originLabel` is injected rather than looked up: the label
 * is localized, and a filter that silently matched only the English word would
 * behave differently per language for no stated reason.
 */
export function filterLocalMemoryEntries(
  entries: ReadonlyArray<LocalMemoryEntryPreview>,
  query: string,
  options: {
    intlLocale: string;
    originLabel: (origin: LocalMemoryEntryPreview['origin']) => string;
  },
): ReadonlyArray<LocalMemoryEntryPreview> {
  const needle = query.trim().toLocaleLowerCase(options.intlLocale);
  if (!needle) return entries;
  return entries.filter((entry) => {
    const haystack = [
      entry.id,
      entry.title,
      entry.content,
      entry.origin,
      options.originLabel(entry.origin),
      entry.createdAt === undefined ? '' : String(entry.createdAt),
      entry.updatedAt === undefined ? '' : String(entry.updatedAt),
      ...entry.tags,
    ]
      .join('\n')
      .toLocaleLowerCase(options.intlLocale);
    return haystack.includes(needle);
  });
}

/** `…/workspaces/default/MEMORY.md` — the tail is what identifies the file. */
export function displayMemoryPath(path: string): string {
  const separator = /^[A-Za-z]:\\/.test(path) || path.startsWith('\\\\') ? '\\' : '/';
  const parts = path.split(/[/\\]+/).filter(Boolean);
  if (parts.length <= 3) return path;
  return `…${separator}${parts.slice(-3).join(separator)}`;
}

export interface MemoryPromptPreview {
  /** The body, with the core truncation marker removed. */
  readonly text: string;
  readonly truncated: boolean;
  readonly limit: number;
}

/**
 * What the next send would actually carry.
 *
 * Built from the DRAFT rather than the saved file so the preview answers the
 * question the editor raises ("what will this text do"), and through the same
 * `buildLocalMemoryPromptBody` the runtime uses so the two cannot drift. The
 * core marks its own truncation with a fixed Chinese-language marker; it is
 * stripped here and the page states the fact in the user's language instead.
 */
export function memoryPromptPreview(draft: string): MemoryPromptPreview {
  const raw = buildLocalMemoryPromptBody(draft) ?? '';
  return {
    text: raw.replace(LOCAL_MEMORY_PROMPT_TRUNCATION_MARKER, '').trimEnd(),
    truncated: raw.includes(LOCAL_MEMORY_PROMPT_TRUNCATION_MARKER),
    limit: LOCAL_MEMORY_PROMPT_MAX_CHARS,
  };
}
