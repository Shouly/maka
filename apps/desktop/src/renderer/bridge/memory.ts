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

// The `memory` namespace of the preload bridge, wrapped.

import type { LocalMemoryState } from '@maka/core/local-memory';
import type { DesktopRuntimeHostRef, MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace } from './bridge.js';

type Memory = MakaBridge['memory'];

export type { LocalMemoryState };
export type MemoryRestoreResult = Awaited<ReturnType<Memory['restoreLatestBackup']>>;

const memory = (): Memory => requireNamespace('memory');

export function getMemoryState(
  sessionId?: string,
  host?: DesktopRuntimeHostRef,
): Promise<LocalMemoryState> {
  return memory().getState(sessionId, host);
}

export function saveMemory(
  content: string,
  host?: DesktopRuntimeHostRef,
): Promise<LocalMemoryState> {
  return memory().save(content, host);
}

export function resetMemory(host?: DesktopRuntimeHostRef): Promise<LocalMemoryState> {
  return memory().reset(host);
}

export function restoreLatestMemoryBackup(
  host?: DesktopRuntimeHostRef,
): Promise<MemoryRestoreResult> {
  return memory().restoreLatestBackup(host);
}

export function setMemoryEnabled(
  enabled: boolean,
  host?: DesktopRuntimeHostRef,
): Promise<LocalMemoryState> {
  return memory().setEnabled(enabled, host);
}

export function setMemoryAgentReadEnabled(
  enabled: boolean,
  host?: DesktopRuntimeHostRef,
): Promise<LocalMemoryState> {
  return memory().setAgentReadEnabled(enabled, host);
}

export function openMemoryFile(host?: DesktopRuntimeHostRef): ReturnType<Memory['openFile']> {
  return memory().openFile(host);
}
