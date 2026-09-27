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

// The startup state the main window shows (shared/desktop-startup.d.ts): the
// phase, whether the Runtime Host is ready, and a Runtime Host handoff when
// one is under way. Pure — no Electron — so the rules are testable: the
// Electron wiring lives in startup-presentation.ts.

import type {
  DesktopStartupHandoff,
  DesktopStartupPhase,
  DesktopStartupState,
} from '../shared/desktop-startup.js';

/** A handoff as its surface words it; the state adds its owner and clock. */
export type DesktopStartupHandoffView = Omit<DesktopStartupHandoff, 'owner' | 'since'>;

export interface DesktopStartupStateHandle {
  state(): DesktopStartupState;
  update(phase: DesktopStartupPhase): void;
  markReady(): void;
  /**
   * Show `owner`'s handoff, or its newer view. Several can be open at once (a
   * handoff per Runtime Host target); the window shows one — the newest that
   * waits on a decision, else the newest under way — and the next when it
   * closes. `becameAttention` tells the caller to bring the window forward.
   */
  showHandoff(owner: string, handoff: DesktopStartupHandoffView): { readonly becameAttention: boolean };
  /** The next handoff in line may now wait on a decision: bring the window forward then too. */
  clearHandoff(owner: string): { readonly becameAttention: boolean };
  /** The owner of the handoff on screen, when it offers `action` at `revision`. */
  answerable(revision: string, action: string): string | undefined;
  subscribe(listener: (state: DesktopStartupState) => void): () => void;
}

const NOTHING_NEW = { becameAttention: false } as const;

export function createDesktopStartupState(
  startedAt: number,
  now: () => number = Date.now,
): DesktopStartupStateHandle {
  let current: DesktopStartupState = { ready: false, phase: 'prepare', startedAt };
  // Insertion order is opening order: a newer view keeps its owner's place.
  const open = new Map<string, DesktopStartupHandoff>();
  const listeners = new Set<(state: DesktopStartupState) => void>();
  const set = (next: DesktopStartupState) => {
    current = next;
    for (const listener of listeners) listener(current);
  };
  const pick = (): DesktopStartupHandoff | undefined => {
    const entries = [...open.values()];
    for (let index = entries.length - 1; index >= 0; index -= 1)
      if (entries[index]!.state === 'attention') return entries[index];
    return entries.at(-1);
  };
  const showPicked = (): { readonly becameAttention: boolean } => {
    const before = current.handoff;
    const picked = pick();
    if (picked === before) return NOTHING_NEW;
    if (picked) set({ ...current, handoff: picked });
    else {
      const { handoff: _cleared, ...rest } = current;
      set(rest);
    }
    return {
      becameAttention:
        picked?.state === 'attention' &&
        !(before?.owner === picked.owner && before.state === 'attention'),
    };
  };
  return {
    state: () => current,
    update(phase) {
      // Once ready, the phases of a later Host restart belong to its handoff.
      if (current.ready || current.phase === phase) return;
      set({ ...current, phase });
    },
    markReady() {
      if (current.ready) return;
      set({ ...current, ready: true, phase: 'renderer' });
    },
    showHandoff(owner, view) {
      const previous = open.get(owner);
      // The surface republishes an unchanged view while it waits; that is not news.
      if (previous && sameView(previous, view)) return NOTHING_NEW;
      const since =
        view.state === 'progress'
          ? previous?.state === 'progress' && previous.since !== undefined
            ? previous.since
            : now()
          : undefined;
      open.set(owner, { ...view, owner, ...(since === undefined ? {} : { since }) });
      return showPicked();
    },
    clearHandoff(owner) {
      if (!open.delete(owner)) return NOTHING_NEW;
      return showPicked();
    },
    answerable(revision, action) {
      const handoff = current.handoff;
      if (
        handoff?.revision !== revision ||
        !handoff.actions.some((offered) => offered.action === action)
      )
        return undefined;
      return handoff.owner;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function sameView(shown: DesktopStartupHandoff, view: DesktopStartupHandoffView): boolean {
  const { owner: _owner, since: _since, ...words } = shown;
  return JSON.stringify(words) === JSON.stringify(view);
}
