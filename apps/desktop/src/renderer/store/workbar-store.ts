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

// What the right pane is LOOKING AT, per task.
//
// The pane's geometry — which faces are open, which is active, how wide it is,
// whether it is collapsed — belongs to `ui-store`'s workbar layout, because
// that is what the main-process tests pin to localStorage. This store owns the
// other half: the artifact the Files face has open and the shell run the
// Terminal face is attached to. Neither is persisted. An artifact id outlives
// nothing (the Host may delete it between runs) and a shell run is process
// state, so restoring either from disk would open a face onto something that
// is no longer there.
//
// It is keyed by session because both selections are: switching tasks and
// coming back should land on the file you were reading, not reset to the top.
// `forget` drops a task's entries when its rows leave the catalog.
//
// Two callers write here besides the pane itself: a `file_write` / `file_diff`
// tool row's "Open in Files", and a shell-run row's "Open in Terminal". They
// name a PATH and a REF respectively — the pane resolves a path to an artifact
// itself, because only it has the list.

import { createStore } from 'zustand/vanilla';

export interface WorkbarSelectionState {
  /**
   * The pane's full-screen state. Not per session and not persisted: it is a
   * reading posture, and restoring it on launch would hide the conversation
   * behind a file the reader has forgotten opening.
   */
  paneExpanded: boolean;
  /** Artifact id per session, or a pending path the list has not resolved yet. */
  artifactBySession: Readonly<Record<string, string | undefined>>;
  /**
   * A path a tool row asked for before the artifact list could name an id.
   * The Files face clears it the moment it matches a row, so a request that
   * never matches does not keep re-selecting on every refresh.
   */
  pendingPathBySession: Readonly<Record<string, string | undefined>>;
  /** Shell-run ref the Terminal face is attached to, per session. */
  terminalRefBySession: Readonly<Record<string, string | undefined>>;
}

const initialState = (): WorkbarSelectionState => ({
  paneExpanded: false,
  artifactBySession: {},
  pendingPathBySession: {},
  terminalRefBySession: {},
});

function withEntry<T>(
  map: Readonly<Record<string, T | undefined>>,
  key: string,
  value: T | undefined,
): Readonly<Record<string, T | undefined>> {
  if (map[key] === value) return map;
  const next = { ...map };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

export function createWorkbarStore() {
  const store = createStore<WorkbarSelectionState>(initialState);
  return {
    ...store,
    setPaneExpanded(paneExpanded: boolean) {
      store.setState({ paneExpanded });
    },
    selectArtifact(sessionId: string, artifactId: string | undefined) {
      store.setState((state) => ({
        artifactBySession: withEntry(state.artifactBySession, sessionId, artifactId),
        pendingPathBySession: withEntry(state.pendingPathBySession, sessionId, undefined),
      }));
    },
    /** A tool row's request, resolved against the artifact list when it arrives. */
    requestArtifactPath(sessionId: string, path: string | undefined) {
      store.setState((state) => ({
        pendingPathBySession: withEntry(state.pendingPathBySession, sessionId, path),
      }));
    },
    resolvePendingPath(sessionId: string, artifactId: string) {
      store.setState((state) => ({
        artifactBySession: withEntry(state.artifactBySession, sessionId, artifactId),
        pendingPathBySession: withEntry(state.pendingPathBySession, sessionId, undefined),
      }));
    },
    clearPendingPath(sessionId: string) {
      store.setState((state) => ({
        pendingPathBySession: withEntry(state.pendingPathBySession, sessionId, undefined),
      }));
    },
    selectTerminalRun(sessionId: string, ref: string | undefined) {
      store.setState((state) => ({
        terminalRefBySession: withEntry(state.terminalRefBySession, sessionId, ref),
      }));
    },
    /** Drop everything remembered for tasks that are no longer in the catalog. */
    retain(sessionIds: ReadonlySet<string>) {
      store.setState((state) => {
        const keep = <T>(map: Readonly<Record<string, T | undefined>>) => {
          const entries = Object.entries(map).filter(([id]) => sessionIds.has(id));
          return entries.length === Object.keys(map).length
            ? map
            : (Object.fromEntries(entries) as Readonly<Record<string, T | undefined>>);
        };
        return {
          artifactBySession: keep(state.artifactBySession),
          pendingPathBySession: keep(state.pendingPathBySession),
          terminalRefBySession: keep(state.terminalRefBySession),
        };
      });
    },
  };
}

export const workbarStore = createWorkbarStore();

/**
 * The artifact a `file_write` / `file_diff` row means, matched by the file
 * name the row carries.
 *
 * The tool result names a workspace PATH; the artifact catalog names artifacts
 * by their own `name`, which for a written file is its basename. Matching on
 * the basename is therefore the only join the two sides share — and it is
 * ambiguous when two directories hold the same file name, so the newest match
 * wins rather than the first. A row that matches nothing simply opens the face.
 */
export function matchArtifactForPath<T extends { id: string; name: string; createdAt: number }>(
  records: readonly T[],
  path: string,
): T | undefined {
  const wanted = basename(path);
  if (!wanted) return undefined;
  let best: T | undefined;
  for (const record of records) {
    if (basename(record.name) !== wanted) continue;
    if (!best || record.createdAt > best.createdAt) best = record;
  }
  return best;
}

function basename(path: string): string {
  const trimmed = path.replaceAll('\\', '/').replace(/\/+$/u, '');
  const slash = trimmed.lastIndexOf('/');
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}
