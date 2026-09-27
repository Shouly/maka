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

// Where the app is in starting up, shared by the main process, which drives
// it, and the renderer, which shows it inside the main window. There is no
// separate startup window: the main window opens before the Runtime Host has
// connected and says what it is waiting for only when the wait is long.

export type DesktopStartupPhase =
  | 'prepare'
  | 'storage'
  | 'connect'
  | 'package'
  | 'checking'
  | 'staging'
  | 'retiring'
  | 'replacing'
  | 'restart'
  | 'attention'
  | 'renderer';

export type DesktopStartupHandoffAction = 'cancel' | 'retry' | 'replace' | 'interrupt';

/** A Runtime Host handoff (upgrade, repair, replacement), already in the app's words. */
export interface DesktopStartupHandoff {
  /** Which handoff this is — one per Runtime Host target — across its revisions. */
  readonly owner: string;
  readonly revision: string;
  /** `attention` waits on a decision; `progress` is under way. */
  readonly state: 'attention' | 'progress';
  /** While `progress`: when this handoff's work got under way (epoch ms). */
  readonly since?: number;
  readonly title: string;
  readonly description: string;
  readonly detail: string;
  readonly diagnostic?: string;
  readonly actions: readonly {
    readonly action: DesktopStartupHandoffAction;
    readonly label: string;
  }[];
}

export interface DesktopStartupState {
  /** The Runtime Host is connected: the app itself can mount. Stays true after. */
  readonly ready: boolean;
  readonly phase: DesktopStartupPhase;
  /** When this launch began (epoch ms): the elapsed time is measured from it. */
  readonly startedAt: number;
  /** A handoff under way or waiting on a decision — at startup or later. */
  readonly handoff?: DesktopStartupHandoff;
}
