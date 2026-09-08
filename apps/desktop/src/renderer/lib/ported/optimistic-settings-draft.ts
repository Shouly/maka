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

// Optimistic settings edits, ported from the pre-rewrite
// `settings/optimistic-settings-draft-controller.ts`.
//
// A settings control has to show the new value the instant it is clicked and
// still be honest when the write fails. Three facts make that harder than a
// `useState` + `catch`:
//
//   1. Writes overlap. Two clicks on the same switch are two IPC calls with no
//      ordering guarantee, so the LAST INTENT — not the last response — has to
//      win. Every save carries a monotonic ticket; only the newest one is
//      allowed to reconcile the draft.
//   2. A failure must roll back to what is actually stored, not to the value
//      the control had before this click: an earlier successful write may have
//      moved it since. That is what `authoritative` holds.
//   3. The settings subscription pushes snapshots while a write is in flight.
//      Applying one would reset the control under the user's finger, so a
//      snapshot arriving mid-flight is recorded and applied when the last save
//      settles.
//
// Pure and DOM-free so the semantics can be unit-tested without React.

export interface OptimisticSettingsDraftOptions<T> {
  readonly initial: T;
  /** Persist a patch and resolve with the settings the write produced. */
  readonly commit: (patch: Partial<T>) => Promise<T>;
  readonly onDraftChange: (draft: T) => void;
  readonly onSavingChange?: (saving: boolean) => void;
  readonly onError?: (error: unknown) => void;
  /** False once the owner is gone; late responses are dropped, not applied. */
  readonly isActive?: () => boolean;
}

export interface OptimisticSettingsDraft<T> {
  readonly draft: () => T;
  readonly saving: () => boolean;
  /** Merge locally without persisting (a text field being typed into). */
  readonly edit: (patch: Partial<T>) => void;
  /** Merge, show it immediately, persist. Resolves true when it stuck. */
  readonly update: (patch: Partial<T>) => Promise<boolean>;
  /** A snapshot from the outside world (subscription refresh, host change). */
  readonly syncPersisted: (persisted: T) => void;
  readonly dispose: () => void;
}

export function createOptimisticSettingsDraft<T extends object>(
  options: OptimisticSettingsDraftOptions<T>,
): OptimisticSettingsDraft<T> {
  let draft = options.initial;
  let authoritative = options.initial;
  let pending = 0;
  let ticket = 0;
  let confirmed = 0;
  let generation = 0;
  let disposed = false;
  const active = () => !disposed && (options.isActive?.() ?? true);

  const commitDraft = (next: T) => {
    draft = next;
    options.onDraftChange(next);
  };

  return {
    draft: () => draft,
    saving: () => pending > 0,
    edit(patch) {
      if (disposed) return;
      commitDraft({ ...draft, ...patch });
    },
    async update(patch) {
      if (disposed) return false;
      const owner = generation;
      const mine = ++ticket;
      pending += 1;
      commitDraft({ ...draft, ...patch });
      if (pending === 1 && active()) options.onSavingChange?.(true);
      try {
        const next = await options.commit(patch);
        // A stale response still advances the stored value when it is the
        // newest CONFIRMED one — otherwise a rollback after it would restore
        // something older than what the Host actually holds.
        if (!disposed && owner === generation && mine > confirmed) {
          confirmed = mine;
          authoritative = next;
        }
        const current = !disposed && owner === generation && active() && mine === ticket;
        if (current) commitDraft(next);
        return current;
      } catch (error) {
        if (!disposed && owner === generation && active() && mine === ticket) {
          commitDraft(authoritative);
          options.onError?.(error);
        }
        return false;
      } finally {
        if (owner === generation) {
          pending -= 1;
          if (pending === 0 && active()) {
            if (draft !== authoritative) commitDraft(authoritative);
            options.onSavingChange?.(false);
          }
        }
      }
    },
    syncPersisted(persisted) {
      if (disposed) return;
      authoritative = persisted;
      // Mid-flight snapshots are recorded, never applied: the `finally` above
      // lands them once the last write settles.
      if (pending === 0) commitDraft(persisted);
    },
    dispose() {
      disposed = true;
      generation += 1;
      pending = 0;
      ticket += 1;
    },
  };
}
