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

// One DOM node, several owners of its ref: the component that renders it and
// a parent that needs it too (a presence wrapper measuring the node on exit,
// a popover anchoring to it). React 19 passes `ref` as an ordinary prop, so a
// component forwards it by composing it with its own and handing the result
// to the element.

import type { Ref, RefCallback } from 'react';

/**
 * A callback ref that feeds every given ref. Callback refs may return a
 * cleanup (React 19); the composed ref honours it, and detaches object refs
 * the same way React would — by setting them back to `null`.
 *
 * Pure: memoize the result (`useMemo`) so React does not re-attach it on
 * every render.
 */
export function composeRefs<T>(...refs: readonly (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    const cleanups = refs.map((ref) => {
      if (!ref) return undefined;
      if (typeof ref === 'function') {
        const cleanup = ref(node);
        return typeof cleanup === 'function' ? cleanup : () => ref(null);
      }
      ref.current = node;
      return () => {
        ref.current = null;
      };
    });
    return () => {
      for (const cleanup of cleanups) cleanup?.();
    };
  };
}
