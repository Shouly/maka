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

// One read, with the three states a read has.
//
// Several settings pages are a single snapshot plus a refresh button
// (permissions, capabilities, health, the app info, the usage ledger). Each one
// hand-rolling load / cancel / latest-wins is how a page ends up rendering an
// older answer than the one it asked for last. `createResourceStore` is the
// store-level answer to the same problem; this is the component-level one, for
// reads that belong to a mounted page rather than to the app's lifetime.

import { useCallback, useEffect, useState } from 'react';

export interface AsyncRead<T> {
  readonly data: T | undefined;
  readonly loading: boolean;
  readonly error: unknown;
  readonly reload: () => void;
}

export function useAsync<T>(
  load: (() => Promise<T>) | undefined,
  deps: readonly unknown[],
): AsyncRead<T> {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: unknown }>({
    data: undefined,
    loading: load !== undefined,
    error: undefined,
  });
  useEffect(() => {
    if (!load) {
      setState({ data: undefined, loading: false, error: undefined });
      return;
    }
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: undefined }));
    void load().then(
      (data) => {
        if (!cancelled) setState({ data, loading: false, error: undefined });
      },
      (error: unknown) => {
        if (!cancelled) setState({ data: undefined, loading: false, error });
      },
    );
    return () => {
      cancelled = true;
    };
    // The caller states what the read depends on; `load` is rebuilt on every
    // render and would restart the read forever if it were a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return {
    ...state,
    reload: useCallback(() => setTick((value) => value + 1), []),
  };
}
