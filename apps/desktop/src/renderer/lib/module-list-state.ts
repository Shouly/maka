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

// Which face a module list shows, for the pages that read a `ResourceState`.
//
// The MCP and Scheduled pages used to ask `error ? failed : rows`, which reads
// as "an error means there is nothing to show". It does not: the store keeps
// the last good snapshot through a failed refresh on purpose, so that question
// threw away a list it was still holding. The rule is about the SNAPSHOT — a
// list is shown whenever one exists — and the error only decides whether the
// page also says the reading is behind.

export type ModuleListFace = 'loading' | 'failed' | 'empty' | 'rows';

export interface ModuleListDisplay {
  readonly face: ModuleListFace;
  /**
   * A read failed while a usable snapshot is still on screen: say so above the
   * rows rather than in place of them. Never set together with `'failed'`.
   */
  readonly staleNotice: boolean;
}

export function moduleListState(input: {
  /** A read is in flight. */
  loading: boolean;
  /** The last read's failure. `undefined` — and only that — means it succeeded. */
  error: unknown;
  /** Whether a snapshot has arrived for the scope now on screen. */
  loaded: boolean;
  /** Rows in that snapshot. */
  count: number;
}): ModuleListDisplay {
  // Nothing behind the page yet: a failure has to take the slot, because there
  // is no list to keep and an empty state would blame the user's workspace for
  // a read that never landed. A retry in flight shows the skeleton again.
  if (!input.loaded)
    return {
      face: input.error !== undefined && !input.loading ? 'failed' : 'loading',
      staleNotice: false,
    };
  return {
    face: input.count === 0 ? 'empty' : 'rows',
    staleNotice: input.error !== undefined,
  };
}
