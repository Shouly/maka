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

// The `mcp` namespace of the preload bridge, wrapped.

import type {
  McpConfigFile,
  McpServerConfig,
  McpServerStatus,
  McpTestResult,
} from '@maka/core/mcp';
import type { DesktopRuntimeHostRef, MakaBridge } from '../../preload/bridge-contract.js';
import { requireNamespace, toUnsubscribe, tryNamespace } from './bridge.js';

type Mcp = MakaBridge['mcp'];

export type { McpConfigFile, McpServerConfig, McpServerStatus, McpTestResult };

const mcp = (): Mcp => requireNamespace('mcp');

export function getMcpConfig(host?: DesktopRuntimeHostRef): Promise<McpConfigFile> {
  return mcp().getConfig(host);
}

export function listMcpStatuses(host?: DesktopRuntimeHostRef): Promise<McpServerStatus[]> {
  return mcp().listStatuses(host);
}

export function addMcpServer(
  serverId: string,
  config: McpServerConfig,
  host?: DesktopRuntimeHostRef,
): ReturnType<Mcp['add']> {
  return mcp().add(serverId, config, host);
}

export function upsertMcpServer(
  serverId: string,
  config: McpServerConfig,
  host?: DesktopRuntimeHostRef,
): Promise<McpConfigFile> {
  return mcp().upsert(serverId, config, host);
}

export function removeMcpServer(
  serverId: string,
  host?: DesktopRuntimeHostRef,
): Promise<McpConfigFile> {
  return mcp().remove(serverId, host);
}

export function testMcpServer(
  serverId: string,
  host?: DesktopRuntimeHostRef,
): Promise<McpTestResult> {
  return mcp().test(serverId, host);
}

export function subscribeMcpChanges(handler: (statuses: McpServerStatus[]) => void): () => void {
  return toUnsubscribe(tryNamespace('mcp')?.subscribeChanges(handler));
}
