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

// The memory listing the settings page reads, and how a change replaces it.
//
// The switch answers with the new listing, so `apply` takes what the write
// returned rather than reading again. Files change underneath the page — the
// background pass files after every turn, the model writes on request, the
// user edits the folder directly — so `reload` exists and supersedes any
// applied state, which is what makes "Reload" mean what it says.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listMemory, type MemoryListState } from '../bridge/memory.js';
import type { DesktopRuntimeHostRef } from '../bridge/projects.js';

export interface MemoryListRead {
  readonly state: MemoryListState | undefined;
  readonly loading: boolean;
  readonly error: unknown;
  readonly reload: () => void;
  readonly apply: (next: MemoryListState) => void;
}

export function useMemoryList(host: DesktopRuntimeHostRef | undefined): MemoryListRead {
  const [state, setState] = useState<MemoryListState | undefined>(undefined);
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
    void listMemory(host).then(
      (next) => {
        if (request !== generation.current) return;
        setState(next);
        setLoading(false);
      },
      (failure: unknown) => {
        if (request !== generation.current) return;
        setError(failure);
        setLoading(false);
      },
    );
  }, [host?.profileId, host?.hostId, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  const apply = useCallback((next: MemoryListState) => {
    generation.current += 1;
    setState(next);
    setLoading(false);
    setError(undefined);
  }, []);

  return { state, loading, error, reload, apply };
}
