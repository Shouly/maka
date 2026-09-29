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

// One read from the API, kept on screen while it is read again. A change
// answers with the fresh state, which replaces it without a second read.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  readonly data: T | undefined;
  readonly error: Error | undefined;
  readonly loading: boolean;
  reload(): void;
  replace(next: T): void;
}

export function useResource<T>(load: () => Promise<T>, key: string): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(() => {
    const request = ++generation.current;
    setLoading(true);
    loadRef
      .current()
      .then(
        (next) => {
          if (request !== generation.current) return;
          setData(next);
          setError(undefined);
        },
        (failure: unknown) => {
          if (request !== generation.current) return;
          setError(failure instanceof Error ? failure : new Error(String(failure)));
        },
      )
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    setData(undefined);
    reload();
  }, [key, reload]);

  const replace = useCallback((next: T) => {
    generation.current += 1;
    setData(next);
    setError(undefined);
    setLoading(false);
  }, []);

  return { data, error, loading, reload, replace };
}
