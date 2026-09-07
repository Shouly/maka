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

// The `connections` namespace of the preload bridge, wrapped.

import type { ConnectionEvent } from '@maka/core/connections';
import type {
  ConnectionTestResult,
  CreateConnectionInput,
  IdentifiedLlmConnection,
  LlmConnection,
  ModelDiscoveryResult,
  RequestHeaderUpdate,
  SavedRequestHeaders,
  UpdateConnectionInput,
} from '@maka/core/llm-connections';
import type {
  DesktopConnectionIdentity,
  DesktopConnectionSnapshot,
} from '../../shared/desktop-connection-snapshot.js';
import type { DesktopRuntimeHostRef, MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type Connections = MakaBridge['connections'];

export type { DesktopConnectionSnapshot, DesktopConnectionIdentity };

const connections = (): Connections => requireNamespace('connections');

export function getConnectionSnapshot(
  sessionId?: string,
  host?: DesktopRuntimeHostRef,
): Promise<DesktopConnectionSnapshot> {
  return connections().getSnapshot(sessionId, host);
}

export function setDefaultConnection(
  connection: DesktopConnectionIdentity | string | null,
  host?: DesktopRuntimeHostRef,
): Promise<void> {
  return connections().setDefault(connection, host);
}

export function setDefaultModel(
  input: { slug: string; model: string } | null,
  host?: DesktopRuntimeHostRef,
): Promise<void> {
  return connections().setDefaultModel(input, host);
}

export function createConnection(
  input: CreateConnectionInput,
  host?: DesktopRuntimeHostRef,
): Promise<IdentifiedLlmConnection> {
  return connections().create(input, host);
}

export function updateConnection(
  connection: DesktopConnectionIdentity,
  patch: UpdateConnectionInput,
  host?: DesktopRuntimeHostRef,
): Promise<LlmConnection> {
  return connections().update(connection, patch, host);
}

export function deleteConnection(
  connection: DesktopConnectionIdentity,
  host?: DesktopRuntimeHostRef,
): Promise<void> {
  return connections().delete(connection, host);
}

export function testConnection(
  connection: DesktopConnectionIdentity | string,
  options?: { model?: string },
  host?: DesktopRuntimeHostRef,
): Promise<ConnectionTestResult> {
  return connections().test(connection, options, host);
}

export function fetchConnectionModels(
  connection: DesktopConnectionIdentity,
  host?: DesktopRuntimeHostRef,
): Promise<Pick<ModelDiscoveryResult, 'models' | 'source'>> {
  return connections().fetchModels(connection, host);
}

export function connectionHasSecret(
  connection: DesktopConnectionIdentity,
  host?: DesktopRuntimeHostRef,
): Promise<boolean> {
  return connections().hasSecret(connection, host);
}

export function getConnectionRequestHeaders(
  connection: DesktopConnectionIdentity,
  host?: DesktopRuntimeHostRef,
): Promise<SavedRequestHeaders> {
  return connections().getRequestHeaders(connection, host);
}

export function setConnectionRequestHeaders(
  connection: DesktopConnectionIdentity,
  headers: readonly RequestHeaderUpdate[],
  host?: DesktopRuntimeHostRef,
): Promise<SavedRequestHeaders> {
  return connections().setRequestHeaders(connection, headers, host);
}

export function verifyConnectionOnboarding(
  input: Parameters<Connections['verifyOnboarding']>[0],
  host?: DesktopRuntimeHostRef,
): ReturnType<Connections['verifyOnboarding']> {
  return connections().verifyOnboarding(input, host);
}

export function saveConnectionOnboarding(
  input: Parameters<Connections['saveOnboarding']>[0],
  host?: DesktopRuntimeHostRef,
): ReturnType<Connections['saveOnboarding']> {
  return connections().saveOnboarding(input, host);
}

export function subscribeConnectionEvents(
  handler: (event: ConnectionEvent) => void,
  host?: DesktopRuntimeHostRef,
): () => void {
  return toUnsubscribe(tryNamespace('connections')?.subscribeEvents(handler, host));
}
