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

import type { MemoryDocumentProjection, MemoryMutateResult } from '@maka/runtime-host/protocol';
import type { MemoryListState } from '../../main/runtime-host-memory-ipc-main.js';
import type { DesktopRuntimeHostRef, MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace } from './bridge.js';

type Memory = MakaBridge['memory'];

export type { MemoryDocumentProjection, MemoryListState, MemoryMutateResult };

const memory = (): Memory => requireNamespace('memory');

export function listMemory(host?: DesktopRuntimeHostRef): Promise<MemoryListState> {
  return memory().list(host);
}

export function readMemoryFile(
  path: string,
  host?: DesktopRuntimeHostRef,
): Promise<MemoryDocumentProjection | null> {
  return memory().read(path, host);
}

export function writeMemoryFile(
  input: { path: string; content: string; ifVersion: string },
  host?: DesktopRuntimeHostRef,
): Promise<MemoryMutateResult> {
  return memory().write(input, host);
}

export function deleteMemoryFile(
  input: { path: string; ifVersion: string },
  host?: DesktopRuntimeHostRef,
): Promise<MemoryMutateResult> {
  return memory().delete(input, host);
}

export function setMemoryEnabled(
  enabled: boolean,
  host?: DesktopRuntimeHostRef,
): Promise<MemoryListState> {
  return memory().setEnabled(enabled, host);
}
