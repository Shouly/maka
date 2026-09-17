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

// What this task produced, read once for everyone who shows it.
//
// Three surfaces want this list now — the session panel's Outputs section, the
// pane's preview, and the pane's own header, which names the open file — and
// the Files face used to own it privately. Three private copies would be three
// `artifacts:list` calls per refresh and three chances to disagree about what
// is in the catalog.
//
// Only USER-VISIBLE artifacts are kept (`isArtifactUserVisible`): a tool result
// and its projections are the transcript's evidence, not the task's output, and
// the timeline already shows them in place.
//
// The list re-reads on the events that can change it — a settled tool result or
// a finished turn — rather than on a timer, and writeback can commit a moment
// after the event, so the read is debounced past the burst rather than issued
// per event.

import { createStore } from 'zustand/vanilla';
import { isArtifactUserVisible, type ArtifactDescriptor } from '@maka/core/artifacts';
import { listArtifacts } from '../bridge/artifacts.js';
import { activeSessionStore } from './index.js';

/** Long enough to absorb a turn's closing burst, short enough to feel live. */
const REFRESH_DEBOUNCE_MS = 400;

export interface SessionArtifactsEntry {
  readonly records: readonly ArtifactDescriptor[];
  /** False until the first read settles, so an empty list is not read as "none". */
  readonly loaded: boolean;
  readonly error: unknown;
}

const EMPTY: SessionArtifactsEntry = Object.freeze({
  records: Object.freeze([]),
  loaded: false,
  error: null,
});

interface SessionArtifactsState {
  readonly bySession: Readonly<Record<string, SessionArtifactsEntry>>;
}

const store = createStore<SessionArtifactsState>(() => ({ bySession: {} }));

/** One live read per session, however many surfaces are showing it. */
interface Lease {
  holders: number;
  request: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  unsubscribe: () => void;
}

const leases = new Map<string, Lease>();

function put(sessionId: string, entry: SessionArtifactsEntry): void {
  store.setState((state) => ({ bySession: { ...state.bySession, [sessionId]: entry } }));
}

async function read(sessionId: string): Promise<void> {
  const lease = leases.get(sessionId);
  if (!lease) return;
  const request = ++lease.request;
  try {
    const next = await listArtifacts(sessionId);
    // A read that lost its race, or whose last reader unmounted mid-flight,
    // must not land: it would overwrite a newer list with an older one.
    if (leases.get(sessionId) !== lease || request !== lease.request) return;
    put(sessionId, {
      records: next.filter((record) => isArtifactUserVisible(record)),
      loaded: true,
      error: null,
    });
  } catch (error) {
    if (leases.get(sessionId) !== lease || request !== lease.request) return;
    put(sessionId, { records: [], loaded: true, error });
  }
}

export const sessionArtifactsStore = {
  subscribe: store.subscribe,
  getState: store.getState,
  getInitialState: store.getInitialState,

  /**
   * Hold the list open for as long as a surface is showing it.
   *
   * ONE read per lease, not per holder: the panel's Outputs, the pane's body
   * and the pane's header all want this list, and three `artifacts:list` calls
   * for one answer is what having a store here is meant to avoid.
   *
   * The release is idempotent per call, and the last one out stops LISTENING —
   * it does not throw the list away. The session panel and the pane are two
   * occupants of one column, so opening a file unmounts the panel and drops the
   * count to zero on the way in; discarding there would make every switch
   * between them re-read the catalog from scratch, with the pane drawing an
   * empty state until it landed.
   */
  retain(sessionId: string): () => void {
    let lease = leases.get(sessionId);
    if (!lease) {
      const created: Lease = {
        holders: 0,
        request: 0,
        timer: undefined,
        unsubscribe: () => undefined,
      };
      created.unsubscribe = activeSessionStore.subscribeSessionEvents((eventSessionId, event) => {
        if (eventSessionId !== sessionId) return;
        if (event.type !== 'tool_result' && event.type !== 'complete') return;
        clearTimeout(created.timer);
        created.timer = setTimeout(() => void read(sessionId), REFRESH_DEBOUNCE_MS);
      });
      leases.set(sessionId, created);
      lease = created;
      // A new lease reads; a second holder joining an existing one does not.
      void read(sessionId);
    }
    lease.holders += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = leases.get(sessionId);
      if (!current) return;
      current.holders -= 1;
      if (current.holders > 0) return;
      clearTimeout(current.timer);
      current.unsubscribe();
      leases.delete(sessionId);
    };
  },

  /** A refresh a caller asks for outright — after a delete, say. */
  refresh(sessionId: string): Promise<void> {
    return read(sessionId);
  },
};

export function selectSessionArtifacts(
  state: SessionArtifactsState,
  sessionId: string,
): SessionArtifactsEntry {
  return state.bySession[sessionId] ?? EMPTY;
}
