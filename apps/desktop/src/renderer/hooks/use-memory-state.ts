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

// The local-memory snapshot the settings page reads, and the way a mutation
// replaces it.
//
// Every `memory.*` mutation answers with the complete new `LocalMemoryState`,
// so re-reading after a write would be a second round trip for an answer the
// first one already gave — and a window in which the page shows the old file.
// `apply` takes the returned state; `reload` is for the button that exists
// because the file can also change underneath (an external editor, another
// window). A reload supersedes any applied state, which is what makes "Reload"
// mean what it says.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getMemoryState, type LocalMemoryState } from '../bridge/memory.js';
import type { DesktopRuntimeHostRef } from '../bridge/projects.js';

export interface MemoryStateRead {
  readonly state: LocalMemoryState | undefined;
  readonly loading: boolean;
  readonly error: unknown;
  readonly reload: () => void;
  readonly apply: (next: LocalMemoryState) => void;
}

export function useMemoryState(host: DesktopRuntimeHostRef | undefined): MemoryStateRead {
  const [state, setState] = useState<LocalMemoryState | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(undefined);
  const [tick, setTick] = useState(0);
  // Reads are latest-wins: a reload started after a mutation must not be
  // overwritten by the earlier read landing late.
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    setError(undefined);
    void getMemoryState(undefined, host).then(
      (next) => {
        if (request !== generation.current) return;
        setState(next);
        setLoading(false);
      },
      (reason: unknown) => {
        if (request !== generation.current) return;
        setError(reason);
        setLoading(false);
      },
    );
  }, [host?.profileId, host?.hostId, tick]);

  return {
    state,
    loading,
    error,
    reload: useCallback(() => setTick((value) => value + 1), []),
    apply: useCallback((next: LocalMemoryState) => {
      generation.current += 1;
      setState(next);
      setLoading(false);
      setError(undefined);
    }, []),
  };
}
