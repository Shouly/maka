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
// answers with the fresh state, which replaces it without a second read —
// and a read still out from before the change is dropped when it lands, so it
// cannot put back what the change replaced. A change to part of what is shown
// reads again afterwards when it dropped a read, since that read was out for
// something the change does not carry.

import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  readonly data: T | undefined;
  readonly error: Error | undefined;
  readonly loading: boolean;
  /** Read again; settles (never rejects) once this read has landed or been dropped. */
  reload(): Promise<void>;
  replace(next: T): void;
  /** Change what is shown from what is shown now: answers that land together each keep theirs. */
  update(change: (current: T) => T): void;
}

export function useResource<T>(load: () => Promise<T>, key: string): Resource<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const reading = useRef(false);
  const shown = useRef<T | undefined>(undefined);
  const loadRef = useRef(load);
  loadRef.current = load;

  const show = useCallback((next: T | undefined) => {
    shown.current = next;
    setData(next);
  }, []);

  const reload = useCallback((): Promise<void> => {
    const request = ++generation.current;
    reading.current = true;
    setLoading(true);
    return loadRef
      .current()
      .then(
        (next) => {
          if (request !== generation.current) return;
          show(next);
          setError(undefined);
        },
        (failure: unknown) => {
          if (request !== generation.current) return;
          setError(failure instanceof Error ? failure : new Error(String(failure)));
        },
      )
      .finally(() => {
        if (request !== generation.current) return;
        reading.current = false;
        setLoading(false);
      });
  }, [show]);

  useEffect(() => {
    show(undefined);
    void reload();
  }, [key, reload, show]);

  const replace = useCallback(
    (next: T) => {
      generation.current += 1;
      reading.current = false;
      show(next);
      setError(undefined);
      setLoading(false);
    },
    [show],
  );

  const update = useCallback(
    (change: (current: T) => T) => {
      // Nothing shown yet: the first read is still the only source, keep it.
      if (shown.current === undefined) return;
      const dropped = reading.current;
      generation.current += 1;
      reading.current = false;
      setLoading(false);
      setData((current) => {
        const next = current === undefined ? current : change(current);
        shown.current = next;
        return next;
      });
      if (dropped) void reload();
    },
    [reload],
  );

  return { data, error, loading, reload, replace, update };
}
