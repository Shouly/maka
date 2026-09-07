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

// The composer's unsent input, one draft per scope key. A scope is either a
// Session id or `new:<target>` for the welcome surface, so switching Sessions
// never shows another Session's half-typed message.
//
// A draft is the TipTap document (text plus file/skill atoms), the staged
// attachments and folder references, and the new-task settings the welcome
// composer collects before a Session exists (permission, thinking, plan).
//
// `revision` counts content edits; `intent` pins a send's admission id to the
// revision it was reserved for, so a retry after `outcome_unknown` reuses the
// same id (the Host de-duplicates) while a newer edit gets a fresh one.
//
// The document and the folder references persist to localStorage (bounded),
// so a draft survives an app restart the way the old renderer's did.
// Attachments do not: a staged `File` or approval id is only valid inside the
// process that staged it.

import { createStore } from 'zustand/vanilla';
import type { JSONContent } from '@tiptap/core';
import type { DirectoryReference } from '@maka/core/events';
import type { PermissionMode } from '@maka/core/permission';
import type { ThinkingLevel } from '@maka/core/model-thinking';
import type { PendingAttachment } from '../lib/ported/composer-attachments.js';
import { textDocument } from '../lib/composer-document.js';

export interface InputDraft {
  document: JSONContent;
  attachments: readonly PendingAttachment[];
  directories: readonly DirectoryReference[];
  error?: string;
  intent?: { revision: number; id: string };
  permission: PermissionMode;
  thinking: ThinkingLevel | undefined;
  plan: boolean;
  revision: number;
}

export const EMPTY_INPUT: InputDraft = {
  document: textDocument(''),
  attachments: [],
  directories: [],
  permission: 'ask',
  thinking: undefined,
  plan: false,
  revision: 0,
};

/** What survives a restart, per scope key. */
interface PersistedDraft {
  document: JSONContent;
  directories: readonly DirectoryReference[];
}

export interface ComposerDraftStorage {
  read(): string | null;
  write(value: string): void;
}

const STORAGE_KEY = 'maka-composer-drafts';
/** Same bounds as the old renderer's draft map. */
const MAX_PERSISTED_DRAFTS = 32;
const MAX_PERSISTED_CHARS = 120_000;

const localStorageDraftStorage: ComposerDraftStorage = {
  read() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  },
  write(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Quota or unavailable storage: the in-memory draft still works.
    }
  },
};

function readPersisted(storage: ComposerDraftStorage): Record<string, PersistedDraft> {
  const raw = storage.read();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, PersistedDraft> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const row = value as Partial<PersistedDraft>;
      if (!row.document || row.document.type !== 'doc') continue;
      out[key] = {
        document: row.document,
        directories: Array.isArray(row.directories) ? row.directories : [],
      };
    }
    return out;
  } catch {
    return {};
  }
}

function isEmptyDocument(document: JSONContent): boolean {
  return !(document.content ?? []).some((node) => (node.content ?? []).length > 0);
}

export function createComposerInputStore(
  storage: ComposerDraftStorage = localStorageDraftStorage,
) {
  const store = createStore<{ drafts: Record<string, InputDraft> }>(() => ({ drafts: {} }));

  // Hydrate: every persisted draft becomes an in-memory draft at revision 0.
  const hydrated: Record<string, InputDraft> = {};
  for (const [key, row] of Object.entries(readPersisted(storage))) {
    hydrated[key] = { ...EMPTY_INPUT, document: row.document, directories: row.directories };
  }
  store.setState({ drafts: hydrated });

  const read = (key: string) => store.getState().drafts[key] ?? EMPTY_INPUT;

  // Write back only the non-empty drafts, newest last, bounded in count and
  // in serialized size so one runaway paste cannot evict everything else.
  const persist = () => {
    const rows: [string, PersistedDraft][] = [];
    for (const [key, draft] of Object.entries(store.getState().drafts)) {
      if (isEmptyDocument(draft.document) && draft.directories.length === 0) continue;
      rows.push([key, { document: draft.document, directories: draft.directories }]);
    }
    let kept = rows.slice(-MAX_PERSISTED_DRAFTS);
    let serialized = JSON.stringify(Object.fromEntries(kept));
    while (serialized.length > MAX_PERSISTED_CHARS && kept.length > 1) {
      kept = kept.slice(1);
      serialized = JSON.stringify(Object.fromEntries(kept));
    }
    storage.write(serialized.length > MAX_PERSISTED_CHARS ? '{}' : serialized);
  };

  const patch = (key: string, update: Partial<InputDraft>) => {
    const contentEdit = Object.keys(update).some(
      (field) => field !== 'error' && field !== 'intent',
    );
    store.setState((s) => ({
      drafts: {
        ...s.drafts,
        [key]: {
          ...read(key),
          ...update,
          revision: read(key).revision + (contentEdit ? 1 : 0),
        },
      },
    }));
    if (update.document !== undefined || update.directories !== undefined) persist();
  };

  const revoke = (items: readonly PendingAttachment[]) => {
    for (const item of items) {
      if (item.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
    }
  };

  return {
    ...store,
    read,
    patch,
    reserveIntent(key: string, revision: number) {
      const current = read(key);
      if (current.intent?.revision === revision) return current.intent.id;
      const id = crypto.randomUUID();
      store.setState((s) => ({
        drafts: { ...s.drafts, [key]: { ...current, intent: { revision, id } } },
      }));
      return id;
    },
    setText(key: string, text: string) {
      patch(key, { document: textDocument(text) });
    },
    removeAttachment(key: string, id: string) {
      const draft = read(key);
      revoke(draft.attachments.filter((a) => a.stagingKey === id));
      patch(key, { attachments: draft.attachments.filter((a) => a.stagingKey !== id) });
    },
    /** The welcome draft follows the Session its first send created. */
    transfer(from: string, to: string) {
      const draft = read(from);
      store.setState((s) => ({ drafts: { ...s.drafts, [to]: draft, [from]: EMPTY_INPUT } }));
      persist();
    },
    /**
     * A send succeeded: drop exactly what was sent. Text typed since the send
     * started, and attachments staged since, stay.
     */
    acknowledge(key: string, sent: InputDraft) {
      const current = read(key);
      const ids = new Set(sent.attachments.map((a) => a.stagingKey));
      revoke(current.attachments.filter((a) => ids.has(a.stagingKey)));
      patch(key, {
        intent: undefined,
        error: undefined,
        ...(JSON.stringify(current.document) === JSON.stringify(sent.document)
          ? { document: textDocument('') }
          : {}),
        attachments: current.attachments.filter((a) => !ids.has(a.stagingKey)),
        directories: current.directories.filter((d) => !sent.directories.includes(d)),
      });
    },
  };
}

export const composerInputStore = createComposerInputStore();
