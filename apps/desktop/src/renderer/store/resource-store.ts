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

import { createStore } from 'zustand/vanilla';

export interface ResourceState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  revision: number;
}
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Latest read wins. Stopping a scope also invalidates all of its outstanding reads. */
export function createResourceStore<T>() {
  const store = createStore<ResourceState<T>>(() => ({
    data: undefined,
    loading: false,
    error: undefined,
    revision: 0,
  }));
  let generation = 0;
  let scope = 0;
  let stop = () => {};
  let read: (() => Promise<T>) | undefined;
  const refresh = async (): Promise<void> => {
    if (!read) return;
    const request = ++generation;
    store.setState({ loading: true, error: undefined });
    try {
      const data = await read();
      if (request === generation)
        store.setState((s) => ({
          data,
          loading: false,
          error: undefined,
          revision: s.revision + 1,
        }));
    } catch (error) {
      if (request === generation) store.setState({ loading: false, error: errorMessage(error) });
    }
  };
  const disconnect = () => {
    generation++;
    scope++;
    stop();
    stop = () => {};
    read = undefined;
    store.setState({ data: undefined, loading: false, error: undefined });
  };
  // Capture before queueing: a delayed write must retain its original display owner.
  const captureMutation = () => {
    const owner = scope;
    return async <R>(operation: () => Promise<R>): Promise<R> => {
      if (owner === scope) generation++;
      try {
        const result = await operation();
        if (owner === scope) await refresh();
        return result;
      } catch (error) {
        if (owner === scope) store.setState({ error: errorMessage(error), loading: false });
        throw error;
      }
    };
  };
  return {
    ...store,
    refresh,
    disconnect,
    captureMutation,
    mutate: <R>(operation: () => Promise<R>) => captureMutation()(operation),
    connect(load: () => Promise<T>, subscribe: (refresh: () => void) => () => void): () => void {
      disconnect();
      store.setState({ data: undefined, error: undefined });
      read = load;
      // Scope token is independent of the read generation, which advances on every refresh.
      const owner = scope;
      try {
        stop = subscribe(() => {
          if (scope === owner) void refresh();
        });
      } catch (error) {
        store.setState({ error: errorMessage(error) });
      }
      void refresh();
      return () => {
        if (scope === owner) disconnect();
      };
    },
  };
}
