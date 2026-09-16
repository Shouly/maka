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

// The task document, as the renderer sees it: one session's tasks, kept live
// off the Host's `session_task` invalidations.

import { useEffect, useSyncExternalStore } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { openBlockersOf, type SessionTask } from '@maka/core/session-task';
import { readSessionTasks, subscribeSessionTaskChanges } from '../bridge/session-tasks.js';

export { openBlockersOf };

export interface TaskProgress {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly sessionId: string | undefined;
  readonly tasks: readonly SessionTask[];
}

const EMPTY: TaskProgress = { status: 'idle', sessionId: undefined, tasks: [] };

// `openBlockersOf` is re-exported from core rather than reimplemented here.
// The two copies had drifted — core counted an id that names no task as a
// standing blocker, this one did not — so TaskList could tell the model a task
// was blocked while this panel drew it ready. One function, one answer.

/**
 * One store per session, created on demand.
 *
 * A single module-level store would be a bug waiting for the second reader:
 * two mounted hooks on different sessions would each write the whole thing,
 * and whichever effect ran last would decide what BOTH of them rendered.
 * Keyed, they cannot collide, and a session's tasks survive a panel that
 * unmounts and comes back.
 */
const stores = new Map<string, StoreApi<TaskProgress>>();

function storeFor(sessionId: string): StoreApi<TaskProgress> {
  const existing = stores.get(sessionId);
  if (existing) return existing;
  const created = createStore<TaskProgress>(() => ({
    status: 'loading',
    sessionId,
    tasks: [],
  }));
  stores.set(sessionId, created);
  return created;
}

/** Ordered by id, numerically: `#10` comes after `#9`, not after `#1`. */
function ordered(tasks: readonly SessionTask[]): readonly SessionTask[] {
  return [...tasks].sort((left, right) => Number(left.id) - Number(right.id));
}

/**
 * Per-session generation counters. A reply that arrives after the panel has
 * moved on — a slow read for a session the reader already left, or one that
 * raced a re-subscribe — is dropped rather than written over newer state.
 */
const generations = new Map<string, number>();

async function load(sessionId: string, generation: number): Promise<void> {
  const store = storeFor(sessionId);
  try {
    const tasks = await readSessionTasks(sessionId);
    if (generations.get(sessionId) !== generation) return;
    store.setState({ status: 'ready', sessionId, tasks: ordered(tasks) });
  } catch {
    if (generations.get(sessionId) !== generation) return;
    store.setState({ status: 'error', sessionId, tasks: [] });
  }
}

const EMPTY_STORE = createStore<TaskProgress>(() => EMPTY);

/** One session's task list, refreshed when the Host says the document changed. */
export function useTaskProgress(sessionId: string | undefined): TaskProgress {
  useEffect(() => {
    if (!sessionId) return;
    const generation = (generations.get(sessionId) ?? 0) + 1;
    generations.set(sessionId, generation);
    void load(sessionId, generation);
    return subscribeSessionTaskChanges((event) => {
      if (event.sessionId !== sessionId) return;
      const next = (generations.get(sessionId) ?? 0) + 1;
      generations.set(sessionId, next);
      void load(sessionId, next);
    });
  }, [sessionId]);

  const store = sessionId ? storeFor(sessionId) : EMPTY_STORE;
  return useSyncExternalStore(store.subscribe, store.getState, () => EMPTY);
}
