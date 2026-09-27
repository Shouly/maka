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

// The `startup` namespace of the preload bridge, wrapped: where this launch
// is — the Runtime Host still connecting, a handoff under way or waiting on a
// decision — so the main window can say so itself (there is no separate
// startup window).

import type {
  DesktopStartupHandoff,
  DesktopStartupHandoffAction,
  DesktopStartupPhase,
  DesktopStartupState,
} from '../../shared/desktop-startup.js';
import type { MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type Startup = MakaBridge['startup'];

export type {
  DesktopStartupHandoff,
  DesktopStartupHandoffAction,
  DesktopStartupPhase,
  DesktopStartupState,
};

const startup = (): Startup => requireNamespace('startup');

export function getStartupState(): Promise<DesktopStartupState> {
  return startup().state();
}

export function subscribeStartup(handler: (state: DesktopStartupState) => void): () => void {
  return toUnsubscribe(tryNamespace('startup')?.subscribe(handler));
}

/** Answer the handoff on screen; false when it has moved on meanwhile. */
export function submitStartupHandoff(
  revision: string,
  action: DesktopStartupHandoffAction,
): Promise<boolean> {
  return startup().submitHandoff(revision, action);
}

export function copyStartupDiagnostics(): Promise<void> {
  return startup().copyDiagnostics();
}
