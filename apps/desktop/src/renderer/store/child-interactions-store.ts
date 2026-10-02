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

// What a parent's running child agents are waiting on the user for.
//
// A child's request — a sandbox boundary, a desktop tool, a form — lives on
// the child's own Session, and nothing of it reaches the parent, where the
// user is reading; unanswered, the child waits for good. While a parent is on
// screen this reads the pending requests of each child it has running, again
// whenever the catalog reports a change to that child (a request admitted, a
// request settled), so the parent can show and answer them. Answers go out on
// the child's own Session.

import { createStore } from 'zustand/vanilla';
import type { ActiveInteractionRequestEvent } from '@maka/core/events';
import * as bridge from '../bridge/sessions.js';

export interface ChildInteractionsState {
  /** Requests waiting on the user, per watched child Session, as last read; none, no key. */
  readonly byChild: Readonly<Record<string, readonly ActiveInteractionRequestEvent[]>>;
}

export function createChildInteractionsStore(
  api: Pick<typeof bridge, 'listActiveInteractions'> = bridge,
) {
  const store = createStore<ChildInteractionsState>(() => ({ byChild: {} }));
  let watched: ReadonlySet<string> = new Set();
  // One read per child at a time; a change reported meanwhile reads once more after it.
  const reading = new Map<string, Promise<void>>();
  const again = new Set<string>();

  const read = (childId: string): Promise<void> => {
    const running = reading.get(childId);
    if (running) {
      again.add(childId);
      return running;
    }
    const task = (async () => {
      try {
        const requests = await api.listActiveInteractions(childId);
        if (!watched.has(childId)) return;
        store.setState((state) => ({ byChild: withRequests(state.byChild, childId, requests) }));
      } catch {
        // The last reading stands; the next change reported reads again.
      } finally {
        reading.delete(childId);
        if (again.delete(childId) && watched.has(childId)) void read(childId);
      }
    })();
    reading.set(childId, task);
    return task;
  };

  return {
    ...store,
    /** Watch exactly these children: newly watched ones are read, the rest forgotten. */
    watch(childIds: readonly string[]): void {
      const next = new Set(childIds);
      const added = childIds.filter((id) => !watched.has(id));
      watched = next;
      const held = store.getState().byChild;
      if (Object.keys(held).some((id) => !next.has(id))) {
        store.setState({
          byChild: Object.fromEntries(Object.entries(held).filter(([id]) => next.has(id))),
        });
      }
      for (const id of added) void read(id);
    },
    /** The catalog reported a change to this Session: read it again if it is watched. */
    changed(sessionId: string | undefined): void {
      if (sessionId !== undefined && watched.has(sessionId)) void read(sessionId);
    },
    /** Read one watched child again, as after answering it. */
    refresh(childId: string): Promise<void> {
      return watched.has(childId) ? read(childId) : Promise.resolve();
    },
  };
}

function withRequests(
  held: ChildInteractionsState['byChild'],
  childId: string,
  requests: readonly ActiveInteractionRequestEvent[],
): ChildInteractionsState['byChild'] {
  if (requests.length === 0) {
    if (!(childId in held)) return held;
    const { [childId]: _settled, ...rest } = held;
    return rest;
  }
  return { ...held, [childId]: requests };
}

export const childInteractionsStore = createChildInteractionsStore();
